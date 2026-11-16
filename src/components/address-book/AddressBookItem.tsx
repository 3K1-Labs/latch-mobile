import Box from '@/src/components/shared/Box';
import SwipeableRow from '@/src/components/shared/SwipeableRow';
import Text from '@/src/components/shared/Text';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

const ICONS = {
  chevron: require('@/src/assets/images/settings/card-chevron.svg'),
  copy: require('@/src/assets/images/settings/copy.svg'),
};

export const initials = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

interface AddressBookItemProps {
  label: string;
  address: string;
  onPress?: () => void;
  onDelete?: () => void;
}

const AddressBookItem = ({ label, address, onPress, onDelete }: AddressBookItemProps) => (
  <SwipeableRow onDelete={onDelete}>
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Edit ${label}`}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={!onPress}
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
        <Box justifyContent="center" alignItems="center" style={styles.avatar}>
          <Text fontSize={14} lineHeight={22} fontFamily="SFproSemibold" color="textPrimary">
            {initials(label)}
          </Text>
        </Box>
        <Box flex={1} style={styles.info}>
          <Text
            fontSize={18}
            lineHeight={26}
            fontFamily="SFproMedium"
            color="textPrimary"
            numberOfLines={1}
          >
            {label}
          </Text>
          <Box flexDirection="row" alignItems="center" gap="s">
            <Text fontSize={14} lineHeight={22} color="textSubheading">
              {shortenAddress(address)}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Copy ${label} address`}
              onPress={() => copyToClipboard(address)}
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
  </SwipeableRow>
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
    backgroundColor: '#413F3F',
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

export default AddressBookItem;
