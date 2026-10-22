import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useMemo, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Toast from 'react-native-toast-message';

import AddressBookForm from '@/src/components/address-book/AddressBookForm';
import AddressBookItem from '@/src/components/address-book/AddressBookItem';
import EmptyAddressBook from '@/src/components/address-book/EmptyAddressBook';
import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import { AddressBookEntry, useAddressBookStore } from '@/src/store/address-book';
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
  const [editingEntry, setEditingEntry] = useState<AddressBookEntry | undefined>(undefined);
  const entries = useAddressBookStore((s) => s.entries);
  const rehydrate = useAddressBookStore((s) => s.rehydrate);
  const addEntry = useAddressBookStore((s) => s.addEntry);
  const updateEntry = useAddressBookStore((s) => s.updateEntry);
  const removeEntry = useAddressBookStore((s) => s.removeEntry);
  const restoreEntry = useAddressBookStore((s) => s.restoreEntry);

  const addresses = useMemo(
    () => Object.values(entries).sort((a, b) => a.createdAt - b.createdAt),
    [entries],
  );

  useEffect(() => {
    if (visible) rehydrate();
  }, [visible, rehydrate]);

  useEffect(() => {
    if (visible) {
      setEditingEntry(undefined);
      setScreenState(prefillAddress ? 'FORM' : 'LIST');
    }
  }, [visible, prefillAddress]);

  const handleBack = () => {
    if (screenState === 'FORM') {
      setEditingEntry(undefined);
      setScreenState('LIST');
    } else {
      onClose();
    }
  };

  const handleStartEdit = (entry: AddressBookEntry) => {
    setEditingEntry(entry);
    setScreenState('FORM');
  };

  const handleDelete = (entry: AddressBookEntry) => {
    removeEntry(entry.id);
    Toast.show({
      type: 'info',
      text1: 'Address deleted',
      text2: entry.label,
      props: {
        actionLabel: 'Undo',
        onAction: () => {
          restoreEntry(entry);
          Toast.hide();
        },
      },
    });
  };

  const handleSubmit = (values: { label: string; address: string }, formikHelpers: any) => {
    const result = editingEntry
      ? updateEntry(editingEntry.id, values)
      : addEntry(values);

    if (!result.ok) {
      if (result.error === 'duplicate') {
        formikHelpers.setFieldError('address', `Already saved as "${result.existing.label}"`);
      }
      formikHelpers.setSubmitting(false);
      return;
    }

    formikHelpers.resetForm();
    setEditingEntry(undefined);
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
          title={screenState === 'FORM' && editingEntry ? 'Edit Address' : 'Address Book'}
          onBack={handleBack}
          right={
            screenState === 'LIST' && addresses.length > 0 ? (
              <TouchableOpacity
                onPress={() => {
                  setEditingEntry(undefined);
                  setScreenState('FORM');
                }}
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
                  onPress={() => handleStartEdit(item)}
                  onDelete={() => handleDelete(item)}
                />
              ))}
            </KeyboardAwareScrollView>
          </Box>
        )
      ) : (
        <AddressBookForm
          onSubmit={handleSubmit}
          initialAddress={editingEntry?.address ?? prefillAddress}
          initialLabel={editingEntry?.label}
          isEditing={!!editingEntry}
        />
      )}
    </BottomSheet>
  );
};

export default AddressBookSheet;
