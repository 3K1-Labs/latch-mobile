import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

const CHEVRON = require('@/src/assets/images/settings/card-chevron.svg');

interface SupportItemProps {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}

const SupportItem = ({ title, description, icon, onPress }: SupportItemProps) => (
  <TouchableOpacity accessibilityRole="button" activeOpacity={0.7} onPress={onPress}>
    <Box
      flexDirection="row"
      alignItems="center"
      gap="sm"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      style={styles.card}
    >
      <Box alignItems="center" justifyContent="center" style={styles.iconTile}>
        <Ionicons name={icon} size={18} color="#FFC508" />
      </Box>
      <Box flex={1} gap="xs">
        <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
          {title}
        </Text>
        <Text fontSize={14} lineHeight={20} color="textSubheading">
          {description}
        </Text>
      </Box>
      <Image source={CHEVRON} contentFit="contain" style={styles.chevron} />
    </Box>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
  },
  chevron: {
    width: 20,
    height: 20,
    transform: [{ rotate: '-90deg' }],
  },
});

export default SupportItem;
