import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { ImageSourcePropType, StyleSheet, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

const CHEVRON = require('@/src/assets/images/settings/chevron.svg');
const ICON_GREY = '#8E8E8E';

interface SettingItemProps {
  /** Figma glyph; falls back to `icon` for rows the design has no glyph for. */
  svg?: ImageSourcePropType;
  /** Some Figma glyphs are drawn smaller than the 16pt default. */
  svgSize?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
}

const SettingItem = ({
  svg,
  svgSize = 16,
  icon,
  label,
  value,
  onPress,
  showChevron = true,
  rightElement,
}: SettingItemProps) => (
  <TouchableOpacity accessibilityRole="button" onPress={onPress} activeOpacity={0.7}>
    <Box flexDirection="row" alignItems="center" gap="sm">
      <Box
        width={32}
        height={32}
        borderRadius={16}
        backgroundColor="inputOutline"
        justifyContent="center"
        alignItems="center"
      >
        {svg ? (
          <Image source={svg} contentFit="contain" style={{ width: svgSize, height: svgSize }} />
        ) : icon ? (
          <Ionicons name={icon} size={16} color={ICON_GREY} />
        ) : null}
      </Box>
      <Text
        flex={1}
        fontSize={16}
        lineHeight={24}
        numberOfLines={1}
        color="textPrimary"
      >
        {label}
      </Text>
      {value && (
        <Text fontSize={16} lineHeight={24} color="textSubheading" numberOfLines={1}>
          {value}
        </Text>
      )}
      {rightElement}
      {showChevron && <Image source={CHEVRON} contentFit="contain" style={styles.chevron} />}
    </Box>
  </TouchableOpacity>
);

/** Current settings search text; groups hide rows whose label doesn't match. */
export const SettingsSearchContext = React.createContext('');

export const SettingsGroup = ({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) => {
  const query = React.useContext(SettingsSearchContext).trim().toLowerCase();
  const rows = React.Children.toArray(children).filter(
    (child) =>
      !query ||
      (React.isValidElement<{ label?: string }>(child) &&
        child.props.label?.toLowerCase().includes(query)),
  );
  if (rows.length === 0) return null;

  return (
    <Box style={styles.group}>
      {title && (
        <Text fontSize={12} lineHeight={20} fontFamily="SFproMedium" color="textSubheading">
          {title}
        </Text>
      )}
      <Box backgroundColor="inputBox" borderRadius={16} style={styles.card}>
        {rows}
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  chevron: {
    width: 20,
    height: 20,
    transform: [{ rotate: '-90deg' }],
  },
  group: {
    gap: 12,
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
});

export default SettingItem;
