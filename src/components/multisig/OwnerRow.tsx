import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

const ICONS = {
  person: require('@/src/assets/images/multisig/person.svg'),
  close: require('@/src/assets/images/multisig/close-small.svg'),
};

export type OwnerTag = 'default' | 'added' | 'pending';

const TAGS: Record<OwnerTag, { label: string; color: string; bg: string }> = {
  default: { label: 'Default Owner', color: '#F68B07', bg: 'rgba(246,139,7,0.08)' },
  added: { label: 'Added', color: '#27C11F', bg: 'rgba(238,250,237,0.08)' },
  pending: { label: 'Pending', color: '#FFBB2C', bg: 'rgba(255,187,44,0.08)' },
};

export const OwnerTagPill = ({ tag }: { tag: OwnerTag }) => {
  const { label, color, bg } = TAGS[tag];
  return (
    <Box borderColor="inputOutline" borderWidth={1} style={[styles.tag, { backgroundColor: bg }]}>
      <Text fontSize={14} lineHeight={14} style={{ color }}>
        {label}
      </Text>
    </Box>
  );
};

interface OwnerRowProps {
  name: string;
  tag: OwnerTag;
  /** Omit for an owner that can't be removed (the creator). */
  onRemove?: () => void;
}

const OwnerRow = ({ name, tag, onRemove }: OwnerRowProps) => (
  <Box
    flexDirection="row"
    alignItems="center"
    justifyContent="space-between"
    backgroundColor="inputBox"
    borderColor="inputOutline"
    borderWidth={1}
    style={styles.row}
  >
    <Box flex={1} flexDirection="row" alignItems="center" gap="s">
      <Box
        alignItems="center"
        justifyContent="center"
        backgroundColor="avatarBg"
        style={styles.avatar}
      >
        <Image source={ICONS.person} contentFit="contain" style={styles.personIcon} />
      </Box>
      <Box flexShrink={1} flexDirection="row" alignItems="center" gap="xs">
        <Text flexShrink={1} fontSize={16} lineHeight={24} color="textPrimary" numberOfLines={1}>
          {name}
        </Text>
        <OwnerTagPill tag={tag} />
      </Box>
    </Box>
    {onRemove ? (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        hitSlop={10}
        onPress={onRemove}
        style={styles.remove}
      >
        <Image source={ICONS.close} contentFit="contain" style={styles.closeIcon} />
      </TouchableOpacity>
    ) : null}
  </Box>
);

const styles = StyleSheet.create({
  row: {
    height: 54,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  personIcon: {
    width: 13,
    height: 15,
  },
  tag: {
    borderRadius: 26,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  remove: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 11.5,
    height: 11.5,
  },
});

export default OwnerRow;
