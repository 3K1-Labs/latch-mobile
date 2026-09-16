import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useAddressBookStore } from '@/src/store/address-book';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Recipient } from './types';

interface Props {
  onSelectWallet: (recipient: Recipient) => void;
  initialAddress?: string;
}

const RecipientStep = ({ onSelectWallet, initialAddress }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const [address, setAddress] = useState(initialAddress ?? '');
  const addressBookEntries = useAddressBookStore((s) => s.entries);
  const rehydrateAddressBook = useAddressBookStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrateAddressBook();
  }, [rehydrateAddressBook]);

  const entries = useMemo(
    () => Object.values(addressBookEntries).sort((a, b) => a.createdAt - b.createdAt),
    [addressBookEntries],
  );

  const isValid = StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);

  const handleSelectEntry = (entryAddress: string) => {
    setAddress(entryAddress);
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    setAddress(text);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }}
    >
      <Text variant="h11" color="textPrimary" fontWeight="700" mb="s" style={{ fontSize: 15 }}>
        Recipient Address
      </Text>

      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="bg11"
        borderRadius={12}
        paddingHorizontal="m"
        height={64}
        borderWidth={1}
        borderColor={address.length > 0 && !isValid ? 'inputError' : 'gray900'}
        mb="s"
      >
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="G... or C..."
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            flex: 1,
            color: isDark ? theme.colors.white : theme.colors.black,
            fontSize: 15,
            fontFamily: 'SFproRegular',
          }}
        />
        {address.length > 0 ? (
          <TouchableOpacity onPress={() => setAddress('')}>
            <Ionicons name="close-circle" size={20} color={theme.colors.gray600} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity activeOpacity={0.7} onPress={handlePaste}>
            <Box backgroundColor="primary" px="m" py="xs" borderRadius={8}>
              <Text variant="p8" color="black" fontWeight="700">
                Paste
              </Text>
            </Box>
          </TouchableOpacity>
        )}
      </Box>

      {address.length > 0 && !isValid && (
        <Text variant="p8" color="inputError" mb="m">
          Enter a valid Stellar G-address or smart account C-address
        </Text>
      )}

      <TouchableOpacity
        activeOpacity={isValid ? 0.8 : 1}
        onPress={() => isValid && onSelectWallet({ address })}
      >
        <Box
          height={56}
          borderRadius={28}
          justifyContent="center"
          alignItems="center"
          mt="s"
          mb="l"
          backgroundColor={isValid ? 'primary700' : 'btnDisabled'}
        >
          <Text variant="p6" color={isValid ? 'black' : 'textSecondary'} fontWeight="700">
            Continue
          </Text>
        </Box>
      </TouchableOpacity>

      {entries.length > 0 && (
        <>
          <Box flexDirection="row" alignItems="center" mb="m">
            <Ionicons name="book-outline" size={16} color={theme.colors.textSecondary} />
            <Text variant="p7" color="textSecondary" ml="s">
              Address Book
            </Text>
          </Box>

          <Box gap="s">
            {entries.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                activeOpacity={0.7}
                onPress={() => handleSelectEntry(entry.address)}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  backgroundColor="bg11"
                  borderRadius={14}
                  padding="m"
                >
                  <Box width={40} height={40} borderRadius={10} mr="m" overflow="hidden">
                    <Image
                      source={require('@/src/assets/icon/yellow-user.png')}
                      style={{ width: 40, height: 40, borderRadius: 10 }}
                    />
                  </Box>
                  <Box flex={1}>
                    <Text variant="p7" color="textPrimary" fontWeight="700">
                      {entry.label}
                    </Text>
                    <Text variant="p8" color="textSecondary" mt="xs">
                      {entry.address.slice(0, 8)}...{entry.address.slice(-4)}
                    </Text>
                  </Box>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                </Box>
              </TouchableOpacity>
            ))}
          </Box>
        </>
      )}
    </ScrollView>
  );
};

export default RecipientStep;
