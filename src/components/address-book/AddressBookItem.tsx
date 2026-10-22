import React from 'react';
import { Image, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import SwipeableRow from '@/src/components/shared/SwipeableRow';
import Text from '@/src/components/shared/Text';

interface AddressBookItemProps {
  label: string;
  address: string;
  onPress?: () => void;
  onDelete?: () => void;
}

const AddressBookItem = ({ label, address, onPress, onDelete }: AddressBookItemProps) => {
  return (
    <SwipeableRow onDelete={onDelete}>
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} disabled={!onPress}>
        <Box
          flexDirection="row"
          alignItems="center"
          backgroundColor="bg11"
          borderRadius={16}
          padding="m"
          mb="s"
        >
          <Box width={40} height={40} borderRadius={10} mr="m" overflow="hidden">
            <Image
              source={require('@/src/assets/icon/yellow-user.png')}
              style={{ width: 40, height: 40, borderRadius: 10 }}
            />
          </Box>
          <Box flex={1}>
            <Text variant="h11" color="textPrimary" fontWeight="700">
              {label}
            </Text>
            <Text variant="p8" color="textSecondary" mt="xs">
              {address.slice(0, 8)}...{address.slice(-4)}
            </Text>
          </Box>
        </Box>
      </TouchableOpacity>
    </SwipeableRow>
  );
};

export default AddressBookItem;
