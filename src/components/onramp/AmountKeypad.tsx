import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'backspace'],
];

/** Digits before the decimal point are capped so the display never wraps. */
const MAX_DIGITS = 9;

/**
 * Applies a keypad press to the current raw amount string.
 *
 * Kept pure and separate from the view so the field's owner (Formik) stays the
 * single source of truth for the value.
 */
export function applyAmountKey(current: string, key: string, maxDecimals = 2): string {
  if (key === 'backspace') return current.slice(0, -1);

  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }

  if (current === '0') return key === '0' ? current : key;

  const decimals = current.split('.')[1];
  if (decimals !== undefined && decimals.length >= maxDecimals) return current;
  if (current.replace('.', '').length >= MAX_DIGITS) return current;

  return `${current}${key}`;
}

/** Groups the integer part with thousands separators, leaving decimals as typed. */
export function formatAmountDisplay(raw: string): string {
  if (!raw) return '0';
  const [int, dec] = raw.split('.');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return raw.includes('.') ? `${grouped}.${dec ?? ''}` : grouped;
}

interface Props {
  onKeyPress: (key: string) => void;
  disabled?: boolean;
}

const AmountKeypad = ({ onKeyPress, disabled }: Props) => {
  const theme = useTheme<Theme>();

  return (
    <Box>
      {ROWS.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row">
          {row.map((key) => (
            <TouchableOpacity
              key={key}
              activeOpacity={0.6}
              disabled={disabled}
              onPress={() => onKeyPress(key)}
              style={{ flex: 1, height: 58, justifyContent: 'center', alignItems: 'center' }}
            >
              {key === 'backspace' ? (
                <Ionicons name="backspace-outline" size={24} color={theme.colors.textPrimary} />
              ) : (
                <Text variant="h8" color="textPrimary" fontWeight="400">
                  {key}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </Box>
      ))}
    </Box>
  );
};

export default AmountKeypad;
