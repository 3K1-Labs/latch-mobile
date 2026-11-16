import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { ImageSourcePropType, StyleSheet, TouchableOpacity } from 'react-native';

interface MethodOptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  image?: ImageSourcePropType;
  /** Non-interactive + dimmed (e.g. a method that isn't available yet). */
  disabled?: boolean;
  /** Small chip on the right (e.g. "Soon"). */
  badge?: string;
}

const MethodOptionCard: React.FC<MethodOptionCardProps> = ({
  icon,
  title,
  subtitle,
  onPress,
  image,
  disabled,
  badge,
}) => (
  <TouchableOpacity
    accessibilityRole="button"
    onPress={onPress}
    activeOpacity={0.7}
    disabled={disabled}
    style={disabled ? styles.disabled : undefined}
  >
    <Box
      flexDirection="row"
      alignItems="center"
      gap="sm"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      style={styles.card}
    >
      <Box alignItems="center" justifyContent="center" style={styles.iconBox}>
        {image ? (
          <Image source={image} contentFit="contain" style={styles.image} />
        ) : (
          <Ionicons name={icon} size={18} color="#FFC508" />
        )}
      </Box>
      <Box flex={1}>
        <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
          {title}
        </Text>
        <Text fontSize={12} lineHeight={18} color="textSubheading">
          {subtitle}
        </Text>
      </Box>
      {badge ? (
        <Box borderColor="inputOutline" borderWidth={1} style={styles.badge}>
          <Text fontSize={12} lineHeight={14} color="textSubheading">
            {badge}
          </Text>
        </Box>
      ) : null}
    </Box>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.5,
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
  },
  image: {
    width: 18,
    height: 18,
  },
  badge: {
    borderRadius: 26,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});

export default MethodOptionCard;
