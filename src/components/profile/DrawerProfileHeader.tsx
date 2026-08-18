import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { shortenAddress } from '@/src/utils';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { Image, TouchableOpacity } from 'react-native';

interface DrawerProfileHeaderProps {
  name: string;
  address: string;
  image: string | null;
  onCopyAddress: () => void;
  onPress: () => void;
}

const DrawerProfileHeader = ({
  name,
  address,
  image,
  onCopyAddress,
  onPress,
}: DrawerProfileHeaderProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box px="m" mb="xl">
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        <Box
          backgroundColor="bg11"
          borderRadius={24}
          paddingHorizontal="m"
          paddingVertical="m"
          flexDirection="row"
          alignItems="center"
          height={96}
        >
          {/* Avatar Container */}
          <Box width={56} height={56} borderRadius={16} overflow="hidden" backgroundColor="bg900">
            <Image
              source={image ? { uri: image } : require('@/src/assets/token/user.png')}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </Box>

          {/* User Info */}
          <Box flex={1} ml="m" justifyContent="center">
            <Text variant="h9" color="textPrimary" fontWeight="700">
              {name}
            </Text>
            <Box flexDirection="row" alignItems="center" mt="xs">
              <Text variant="h11" color="textSecondary" mr="xs">
                {shortenAddress(address)}
              </Text>
              <TouchableOpacity
                onPress={onCopyAddress}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="copy-outline" size={14} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </Box>
          </Box>

          {/* Dropdown Arrow */}
          <Box ml="s">
            <Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />
          </Box>
        </Box>
      </TouchableOpacity>
    </Box>
  );
};

export default DrawerProfileHeader;
