import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const WORLD = require('@/src/assets/images/settings/world.svg');
const RADIO_ON = require('@/src/assets/images/settings/radio-on.svg');

interface NetworkItemProps {
  name: string;
  description: string;
  isSelected: boolean;
  /** Tile content; defaults to the globe. */
  icon?: React.ReactNode;
}

/** Single-choice row used by the Network, Currency and Appearance sheets. */
const NetworkItem = ({ name, description, isSelected, icon }: NetworkItemProps) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  return (
    <Box flexDirection="row" alignItems="center" gap="sm" style={styles.row}>
      <Box
        backgroundColor="inputOutline"
        justifyContent="center"
        alignItems="center"
        style={styles.tile}
      >
        {icon ?? (
          <Image
            source={WORLD}
            contentFit="contain"
            tintColor={theme.colors.tileGlyph}
            style={styles.glyph}
          />
        )}
      </Box>
      <Box flex={1} gap="xs">
        <Text
          fontSize={16}
          lineHeight={24}
          fontFamily="SFproMedium"
          color="textPrimary"
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text fontSize={14} lineHeight={19} color="textSubheading">
          {description}
        </Text>
      </Box>
      {isSelected ? (
        <Image source={RADIO_ON} contentFit="contain" style={styles.radio} />
      ) : (
        <Box
          style={[
            styles.radio,
            styles.radioOff,
            { borderColor: isDark ? theme.colors.inputOutline : theme.colors.textTertiary },
          ]}
        />
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    marginBottom: 11,
  },
  tile: {
    width: 49,
    height: 48,
    borderRadius: 12,
  },
  glyph: {
    width: 24,
    height: 24,
  },
  radio: {
    width: 20,
    height: 20,
  },
  radioOff: {
    borderRadius: 10,
    borderWidth: 1,
  },
});

export default NetworkItem;
