import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SendToken } from './types';

const CHEVRON = require('@/src/assets/images/swap/chevron-down.svg');
const PRESETS = [100, 500, 1000];
const MAX_DECIMALS = 7;

/** Keeps the field a plain decimal: digits, one point, at most 7 places, no leading zeros. */
export const sanitizeAmount = (raw: string): string => {
  let s = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s =
      s.slice(0, dot + 1) +
      s
        .slice(dot + 1)
        .replace(/\./g, '')
        .slice(0, MAX_DECIMALS);
  }
  if (s.startsWith('.')) s = `0${s}`;
  s = s.replace(/^0+(?=\d)/, '');
  return s === '' ? '0' : s;
};

interface Props {
  selectedToken: SendToken;
  amount: string;
  canUsePresets: boolean;
  onChangeAmount: (amount: string) => void;
  onMaxPress: () => void;
  onPresetPress: (usdAmount: number) => void;
  onChangeToken: () => void;
}

const AmountEntryStep = ({
  selectedToken,
  amount,
  canUsePresets,
  onChangeAmount,
  onMaxPress,
  onPresetPress,
  onChangeToken,
}: Props) => {
  const theme = useTheme<Theme>();
  const inputRef = useRef<TextInput>(null);
  const iconUrl = useTokenIcon(selectedToken.code, selectedToken.issuer);
  const isEmpty = amount === '0';
  const isOverBalance = (parseFloat(amount) || 0) > parseFloat(selectedToken.amount);
  const balance = parseFloat(selectedToken.amount).toLocaleString('en-US', {
    maximumFractionDigits: MAX_DECIMALS,
  });
  const big = amount.length < 9;

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Pressable style={styles.display} onPress={() => inputRef.current?.focus()}>
        <Box flexDirection="row" alignItems="flex-end">
          <Text
            fontFamily="SFproSemibold"
            fontSize={big ? 56 : 40}
            lineHeight={big ? 72 : 52}
            letterSpacing={-1.4}
            numberOfLines={1}
            adjustsFontSizeToFit
            color={isOverBalance ? 'inputError' : isEmpty ? 'textSubheading' : 'textPrimary'}
          >
            {amount}
          </Text>
          <Box
            style={[
              styles.caret,
              {
                backgroundColor: theme.colors.textPrimary,
                height: big ? 57 : 41,
                marginBottom: big ? 7 : 5,
              },
            ]}
          />
          <Text
            fontFamily="SFproSemibold"
            fontSize={16}
            lineHeight={24}
            color="textSubheading"
            style={{ marginBottom: big ? 12 : 8 }}
          >
            {selectedToken.code}
          </Text>
        </Box>
        {isOverBalance && (
          <Text fontSize={12} lineHeight={20} color="inputError" mt="s">
            Exceeds available balance
          </Text>
        )}
        {/* The visible amount is plain text; this hidden field drives the system keypad. */}
        <TextInput
          ref={inputRef}
          value={isEmpty ? '' : amount}
          onChangeText={(t) => onChangeAmount(sanitizeAmount(t))}
          keyboardType="decimal-pad"
          autoFocus
          caretHidden
          style={styles.hiddenInput}
        />
      </Pressable>

      <Box flexDirection="row" justifyContent="center" alignItems="center" gap="m">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Change token"
          activeOpacity={0.7}
          onPress={onChangeToken}
        >
          <Box
            flexDirection="row"
            alignItems="center"
            style={[
              styles.pill,
              { borderColor: theme.colors.inputOutline, backgroundColor: theme.colors.inputBox },
              styles.tokenPill,
            ]}
          >
            <Box
              width={20}
              height={20}
              borderRadius={10}
              overflow="hidden"
              style={[styles.tokenBg, { backgroundColor: theme.colors.badgeBg }]}
            >
              <TokenIcon iconUrl={iconUrl} size={20} />
            </Box>
            <Text fontSize={12} lineHeight={20} color="textSubheading">
              {balance} {selectedToken.code}
            </Text>
            <Image source={CHEVRON} contentFit="contain" style={styles.chevron} />
          </Box>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.7} onPress={onMaxPress}>
          <Box
            style={[
              styles.pill,
              { borderColor: theme.colors.inputOutline, backgroundColor: theme.colors.inputBox },
            ]}
          >
            <Text fontSize={12} lineHeight={20} color="textSubheading">
              Max
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>

      <Box style={[styles.divider, { backgroundColor: theme.colors.inputOutline }]} />

      <Box flexDirection="row" gap="sm" style={styles.presets}>
        {PRESETS.map((usd) => (
          <TouchableOpacity
            key={usd}
            accessibilityRole="button"
            activeOpacity={0.7}
            disabled={!canUsePresets}
            onPress={() => onPresetPress(usd)}
            style={styles.flex}
          >
            <Box
              style={[
                styles.preset,
                { borderColor: theme.colors.inputOutline, backgroundColor: theme.colors.inputBox },
                !canUsePresets && styles.disabled,
              ]}
            >
              <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary">
                ${usd}
              </Text>
            </Box>
          </TouchableOpacity>
        ))}
      </Box>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  display: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  caret: {
    width: 2,
    borderRadius: 2,
    marginLeft: 2,
    marginRight: 2,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 40,
    borderWidth: 1,
  },
  tokenPill: {
    gap: 8,
  },
  tokenBg: {},
  chevron: {
    width: 16,
    height: 16,
  },
  divider: {
    height: 1,
    marginHorizontal: 24,
    marginTop: 18,
    marginBottom: 18,
  },
  presets: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  preset: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 40,
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.4,
  },
});

export default AmountEntryStep;
