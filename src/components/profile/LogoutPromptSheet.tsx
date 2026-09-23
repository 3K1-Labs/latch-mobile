import React from 'react';
import { TouchableOpacity } from 'react-native';

import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const LogoutPromptSheet = ({ visible, onClose, onConfirm }: Props) => {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Box paddingVertical="m" px="m" alignItems="center">
        <Text variant="h7" color="textPrimary" fontWeight="700" mb="m" textAlign="center">
          Log Out!
        </Text>

        <Text variant="p5" color="textSecondary" textAlign="center" mb="xl" lineHeight={24}>
          Are you sure you want to log out{'\n'}from{' '}
          <Text color="textPrimary" fontFamily={'SFproBold'} fontWeight="700">
            Latch
          </Text>
          ?
        </Text>

        <Box flexDirection="row" width="100%" justifyContent="space-between">
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onClose}
            style={{ flex: 1, marginRight: 12 }}
          >
            <Box
              height={48}
              borderRadius={32}
              borderWidth={1}
              borderColor="textSecondary"
              justifyContent="center"
              alignItems="center"
              style={{ opacity: 0.8 }}
            >
              <Text variant="h10" color="textPrimary" fontWeight="700">
                No, Cancel
              </Text>
            </Box>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.7} onPress={onConfirm} style={{ flex: 1 }}>
            <Box
              height={48}
              backgroundColor="primary"
              borderRadius={32}
              justifyContent="center"
              alignItems="center"
              style={{ backgroundColor: '#FF5722' }} // Specifically using the orange-red from the design
            >
              <Text variant="h10" color="black" fontWeight="700">
                Yes, Go Ahead
              </Text>
            </Box>
          </TouchableOpacity>
        </Box>
      </Box>
    </BottomSheet>
  );
};

export default LogoutPromptSheet;
