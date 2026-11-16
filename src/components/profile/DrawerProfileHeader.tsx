import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { shortenAddress } from '@/src/utils';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

const ICONS = {
  chevron: require('@/src/assets/images/settings/card-chevron.svg'),
  copy: require('@/src/assets/images/settings/copy.svg'),
  fallbackAvatar: require('@/src/assets/token/user.png'),
};

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
}: DrawerProfileHeaderProps) => (
  <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel="Switch account"
    activeOpacity={0.85}
    onPress={onPress}
  >
    <Box
      flexDirection="row"
      alignItems="center"
      gap="sm"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      borderRadius={20}
      style={styles.card}
    >
      <Image
        source={image ? { uri: image } : ICONS.fallbackAvatar}
        contentFit="cover"
        style={styles.avatar}
      />
      <Box flex={1} style={styles.info}>
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary" numberOfLines={1}>
          {name}
        </Text>
        <Box flexDirection="row" alignItems="center" gap="s">
          <Text fontSize={14} lineHeight={22} color="textSubheading">
            {shortenAddress(address)}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Copy address"
            onPress={onCopyAddress}
            hitSlop={10}
            style={styles.copyChip}
          >
            <Image source={ICONS.copy} contentFit="contain" style={styles.copyIcon} />
          </TouchableOpacity>
        </Box>
      </Box>
      <Image source={ICONS.chevron} contentFit="contain" style={styles.chevron} />
    </Box>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  info: {
    gap: 4,
  },
  copyChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(241,246,225,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyIcon: {
    width: 13.5,
    height: 13.5,
  },
  chevron: {
    width: 20,
    height: 20,
    transform: [{ rotate: '-90deg' }],
  },
});

export default DrawerProfileHeader;
