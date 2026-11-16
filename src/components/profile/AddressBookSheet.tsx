import { Image } from 'expo-image';
import { FormikHelpers } from 'formik';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Toast from 'react-native-toast-message';

import AddressBookForm, { AddressBookValues } from '@/src/components/address-book/AddressBookForm';
import AddressBookItem from '@/src/components/address-book/AddressBookItem';
import EmptyAddressBook from '@/src/components/address-book/EmptyAddressBook';
import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { AddressBookEntry, useAddressBookStore } from '@/src/store/address-book';

const PLUS = require('@/src/assets/images/address-book/plus.svg');

type ScreenState = 'LIST' | 'FORM';

interface Props {
  visible: boolean;
  onClose: () => void;
  prefillAddress?: string;
}

const AddressBookSheet = ({ visible, onClose, prefillAddress }: Props) => {
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

  const handleSubmit = (
    values: AddressBookValues,
    formikHelpers: FormikHelpers<AddressBookValues>,
  ) => {
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
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.grabber}
      header={
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          style={styles.header}
        >
          <RoundBackButton onPress={handleBack} />
          <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
            {screenState === 'FORM' && editingEntry ? 'Edit Address' : 'Address Book'}
          </Text>
          {screenState === 'LIST' ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Add address"
              activeOpacity={0.7}
              hitSlop={8}
              onPress={() => {
                setEditingEntry(undefined);
                setScreenState('FORM');
              }}
              style={styles.addButton}
            >
              <Image source={PLUS} contentFit="contain" style={styles.addIcon} />
            </TouchableOpacity>
          ) : (
            <Box width={40} />
          )}
        </Box>
      }
      contentContainerStyle={{ flex: 1 }}
    >
      {screenState === 'LIST' ? (
        addresses.length === 0 ? (
          <EmptyAddressBook />
        ) : (
          <Box flex={1}>
            <KeyboardAwareScrollView
              contentContainerStyle={styles.list}
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

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#020202',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
  },
  grabber: {
    width: 126,
    height: 8,
    borderRadius: 69,
    backgroundColor: '#1A1A1A',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    width: 20,
    height: 20,
  },
  list: {
    paddingHorizontal: 24,
    paddingTop: 42,
    gap: 12,
  },
});

export default AddressBookSheet;
