import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import AddressBookForm from '@/src/components/address-book/AddressBookForm';
import AddressBookItem from '@/src/components/address-book/AddressBookItem';
import EmptyAddressBook from '@/src/components/address-book/EmptyAddressBook';
import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import { useAddressBook } from '@/src/hooks/use-address-book';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

type ScreenState = 'LIST' | 'FORM';

interface Props {
  visible: boolean;
  onClose: () => void;
  prefillAddress?: string;
}

const AddressBookSheet = ({ visible, onClose, prefillAddress }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const [screenState, setScreenState] = useState<ScreenState>('LIST');
  const { entries: addresses, addEntry, removeEntry } = useAddressBook();

  useEffect(() => {
    if (visible) setScreenState(prefillAddress ? 'FORM' : 'LIST');
  }, [visible, prefillAddress]);

  const handleBack = () => {
    if (screenState === 'FORM') {
      setScreenState('LIST');
    } else {
      onClose();
    }
  };

  const handleAddAddress = (values: { label: string; address: string }, { resetForm }: any) => {
    addEntry({ ...values, network: 'Stellar' });
    resetForm();
    setScreenState('LIST');
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      keyboardBehavior="extend"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={
        <SheetHeader
          title="Address Book"
          onBack={handleBack}
          right={
            screenState === 'LIST' && addresses.length > 0 ? (
              <TouchableOpacity
                onPress={() => setScreenState('FORM')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="add" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            ) : undefined
          }
        />
      }
      contentContainerStyle={{ flex: 1 }}
    >
      {screenState === 'LIST' ? (
        addresses.length === 0 ? (
          <EmptyAddressBook onAdd={() => setScreenState('FORM')} />
        ) : (
          <Box flex={1}>
            <KeyboardAwareScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}
              bottomOffset={16}
            >
              {addresses.map((item) => (
                <AddressBookItem
                  key={item.id}
                  label={item.label}
                  address={item.address}
                  onDelete={() => removeEntry(item.id)}
                />
              ))}
            </KeyboardAwareScrollView>
          </Box>
        )
      ) : (
        <AddressBookForm onSubmit={handleAddAddress} initialAddress={prefillAddress} />
      )}
    </BottomSheet>
  );
};

export default AddressBookSheet;
