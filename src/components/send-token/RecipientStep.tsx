import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useStellarTransactions } from '@/src/hooks/use-stellar-transactions';
import { useAddressBookStore } from '@/src/store/address-book';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { shortenAddress } from '@/src/utils';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Recipient } from './types';

const PASTE = require('@/src/assets/images/send/paste.svg');
const RECENT_LIMIT = 3;

const isValidAddress = (a: string) =>
  StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a);

const initials = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const ContactRow = ({
  label,
  subtitle,
  onPress,
}: {
  label: string;
  subtitle: string;
  onPress: () => void;
}) => (
  <TouchableOpacity accessibilityRole="button" activeOpacity={0.7} onPress={onPress}>
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      borderRadius={16}
      style={styles.row}
    >
      <Box
        width={40}
        height={40}
        borderRadius={20}
        justifyContent="center"
        alignItems="center"
        backgroundColor="avatarBgStrong"
        style={styles.avatar}
      >
        <Text
          fontSize={12}
          lineHeight={24}
          letterSpacing={0.24}
          fontFamily="SFproSemibold"
          color="textPrimary"
        >
          {initials(label)}
        </Text>
      </Box>
      <Box flex={1} style={styles.rowText}>
        <Text
          fontSize={16}
          lineHeight={24}
          letterSpacing={0.32}
          color="textPrimary"
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text fontSize={12} lineHeight={15} letterSpacing={0.24} color="textSubheading">
          {subtitle}
        </Text>
      </Box>
    </Box>
  </TouchableOpacity>
);

interface Props {
  onSelectWallet: (recipient: Recipient) => void;
  initialAddress?: string;
}

const RecipientStep = ({ onSelectWallet, initialAddress }: Props) => {
  const theme = useTheme<Theme>();
  const [address, setAddress] = useState(initialAddress ?? '');
  const addressBookEntries = useAddressBookStore((s) => s.entries);
  const rehydrateAddressBook = useAddressBookStore((s) => s.rehydrate);
  const findEntry = useAddressBookStore((s) => s.findByAddress);
  const smartAccountAddress = useWalletStore((s) => s.smartAccountAddress);
  const { data: payments } = useStellarTransactions(smartAccountAddress);

  useEffect(() => {
    rehydrateAddressBook();
  }, [rehydrateAddressBook]);

  const entries = useMemo(
    () => Object.values(addressBookEntries).sort((a, b) => a.createdAt - b.createdAt),
    [addressBookEntries],
  );

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of payments ?? []) {
      if (p.txType !== 'send' || p.to === smartAccountAddress || seen.has(p.to)) continue;
      if (!isValidAddress(p.to)) continue;
      seen.add(p.to);
      out.push(p.to);
      if (out.length === RECENT_LIMIT) break;
    }
    return out;
  }, [payments, smartAccountAddress]);

  const trimmed = address.trim();
  const isValid = isValidAddress(trimmed);
  const showError = trimmed.length > 0 && !isValid;

  const select = (to: string) => {
    const entry = findEntry(to);
    onSelectWallet({ address: to, label: entry?.label });
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    setAddress(text.trim());
  };

  return (
    <Box flex={1}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Box
          flexDirection="row"
          alignItems="center"
          backgroundColor="inputBox"
          borderRadius={40}
          borderWidth={1}
          borderColor={showError ? 'inputError' : 'inputBox'}
          style={styles.input}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Paste address"
            hitSlop={10}
            onPress={handlePaste}
          >
            <Image source={PASTE} contentFit="contain" style={styles.pasteIcon} />
          </TouchableOpacity>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Select or Paste Address"
            placeholderTextColor={theme.colors.textPlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.textInput, { color: theme.colors.textPrimary }]}
          />
        </Box>
        {showError && (
          <Text fontSize={12} lineHeight={18} color="inputError" style={styles.error}>
            Enter a valid Stellar G-address or smart account C-address
          </Text>
        )}

        {entries.length > 0 && (
          <Box style={styles.section}>
            <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
              Address Book
            </Text>
            <Box style={styles.list}>
              {entries.map((entry) => (
                <ContactRow
                  key={entry.id}
                  label={entry.label}
                  subtitle={shortenAddress(entry.address)}
                  onPress={() => select(entry.address)}
                />
              ))}
            </Box>
          </Box>
        )}

        {recent.length > 0 && (
          <Box style={styles.section}>
            <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
              Most Recent
            </Text>
            <Box style={styles.list}>
              {recent.map((to) => {
                const label = findEntry(to)?.label;
                return (
                  <ContactRow
                    key={to}
                    label={label ?? shortenAddress(to)}
                    subtitle={
                      label
                        ? shortenAddress(to)
                        : to.startsWith('C')
                          ? 'Smart account'
                          : 'Stellar account'
                    }
                    onPress={() => select(to)}
                  />
                );
              })}
            </Box>
          </Box>
        )}
      </ScrollView>

      {isValid && (
        <Box style={styles.footer}>
          <SetupButton label="Continue" onPress={() => select(trimmed)} />
        </Box>
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
  },
  input: {
    height: 48,
    paddingHorizontal: 22,
    gap: 10,
  },
  pasteIcon: {
    width: 16,
    height: 16,
  },
  textInput: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: 14,
    // Keeps the bundled SF Pro vertically centred in an iOS TextInput.
    lineHeight: 18,
    fontFamily: 'SFproRegular',
  },
  error: {
    marginTop: 8,
    paddingHorizontal: 8,
  },
  section: {
    marginTop: 18,
    gap: 18,
  },
  list: {
    gap: 10,
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  avatar: {},
  rowText: {
    gap: 2,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
});

export default RecipientStep;
