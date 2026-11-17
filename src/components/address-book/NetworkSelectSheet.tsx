import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { Image, ScrollView, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

interface NetworkOption {
  name: string;
  icon: any;
}

interface NetworkSelectSheetProps {
  networks: NetworkOption[];
  selectedNetwork: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

const NetworkSelectSheet = ({
  networks,
  selectedNetwork,
  onSelect,
  onClose,
}: NetworkSelectSheetProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      backgroundColor="black"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      <Box
        backgroundColor="sheetBg"
        borderTopLeftRadius={32}
        borderTopRightRadius={32}
        paddingHorizontal="m"
        paddingBottom="xl"
        maxHeight="70%"
      >
        <Box alignItems="center" pt="m" mb="l">
          <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
          <Text variant="h10" color="textPrimary" fontWeight="700" mt="m">
            Select Network
          </Text>
        </Box>
        <ScrollView bounces={false}>
          {networks.map((network) => (
            <TouchableOpacity
              key={network.name}
              activeOpacity={0.7}
              onPress={() => onSelect(network.name)}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                paddingVertical="m"
                borderBottomWidth={1}
                borderBottomColor="gray900"
              >
                <Image
                  source={network.icon}
                  style={{ width: 32, height: 32, borderRadius: 16, marginRight: 12 }}
                />
                <Text variant="p6" color="textPrimary" flex={1}>
                  {network.name}
                </Text>
                {selectedNetwork === network.name && (
                  <Ionicons name="checkmark-circle" size={24} color={theme.colors.primary} />
                )}
              </Box>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Box>
    </Box>
  );
};

export default NetworkSelectSheet;
