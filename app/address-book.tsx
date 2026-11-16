import AddressBookForm from '@/src/components/address-book/AddressBookForm';
import AddressBookItem from '@/src/components/address-book/AddressBookItem';
import EmptyAddressBook from '@/src/components/address-book/EmptyAddressBook';
import Box from '@/src/components/shared/Box';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';

interface AddressEntry {
  id: string;
  network: string;
  label: string;
  address: string;
}

type ScreenState = 'LIST' | 'FORM';

const AddressBook = () => {
  const router = useRouter();
  const [screenState, setScreenState] = React.useState<ScreenState>('LIST');
  const [addresses, setAddresses] = React.useState<AddressEntry[]>([]);

  const handleBack = () => {
    if (screenState === 'FORM') {
      setScreenState('LIST');
    } else {
      router.back();
    }
  };

  const handleAddAddress = (values: any, { resetForm }: any) => {
    const newAddress: AddressEntry = {
      id: Math.random().toString(),
      ...values,
    };
    setAddresses([...addresses, newAddress]);
    resetForm();
    setScreenState('LIST');
  };

  return (
    <Box
      flex={1}
      backgroundColor="cardbg"
      style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
    >
      <StatusBar style="light" />

      <UtilityHeader
        title="Address Book"
        onBack={handleBack}
        rightElement={
          screenState === 'LIST' &&
          addresses.length > 0 && (
            <TouchableOpacity onPress={() => setScreenState('FORM')}>
              <Ionicons name="add" size={24} color="white" />
            </TouchableOpacity>
          )
        }
      />

      {screenState === 'LIST' ? (
        addresses.length === 0 ? (
          <EmptyAddressBook />
        ) : (
          <Box flex={1}>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}>
              {addresses.map((item) => (
                <AddressBookItem key={item.id} label={item.label} address={item.address} />
              ))}
            </ScrollView>
          </Box>
        )
      ) : (
        <AddressBookForm onSubmit={handleAddAddress} />
      )}
    </Box>
  );
};

export default AddressBook;
