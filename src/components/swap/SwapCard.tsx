import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React from 'react';
import { ImageSourcePropType, StyleSheet, TextInput, TouchableOpacity } from 'react-native';

const CHEVRON = require('@/src/assets/images/swap/chevron-down.svg');

interface SwapCardProps {
  label: string;
  tokenCode: string;
  tokenIcon: ImageSourcePropType;
  amount: string;
  fiatValue: string;
  balance?: string;
  editable?: boolean;
  onAmountChange?: (text: string) => void;
  onTokenSelect?: () => void;
  onFocusChange?: (focused: boolean) => void;
}

const formatDisplayAmount = (value: string) => {
  if (!value) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  // Up to 7 dp (Stellar token precision) so small outputs aren't shown as 0.
  return num.toLocaleString('en-US', { maximumFractionDigits: 7 });
};

const SwapCard = ({
  label,
  tokenCode,
  tokenIcon,
  amount,
  fiatValue,
  balance,
  editable = false,
  onAmountChange,
  onTokenSelect,
  onFocusChange,
}: SwapCardProps) => {
  const theme = useTheme<Theme>();
  const [isFocused, setIsFocused] = React.useState(false);
  const setFocus = (focused: boolean) => {
    setIsFocused(focused);
    onFocusChange?.(focused);
  };

  return (
    <Box
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      borderRadius={20}
      style={styles.card}
    >
      <Text fontSize={12} lineHeight={12} letterSpacing={0.12} color="textSubheading">
        {label}
      </Text>

      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="sm">
        <TextInput
          style={[styles.amount, { color: theme.colors.textPrimary }]}
          value={isFocused ? amount : formatDisplayAmount(amount)}
          onChangeText={onAmountChange}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          editable={editable}
          placeholder="0"
          placeholderTextColor={theme.colors.textPrimary}
          keyboardType="decimal-pad"
          numberOfLines={1}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Select token, ${tokenCode} selected`}
          activeOpacity={0.7}
          onPress={onTokenSelect}
          disabled={!onTokenSelect}
          style={[styles.chip, { backgroundColor: theme.colors.chipBg }]}
        >
          <Image source={tokenIcon} style={styles.tokenIcon} />
          <Text fontSize={16} lineHeight={24} letterSpacing={0} color="textPrimary">
            {tokenCode}
          </Text>
          {onTokenSelect && <Image source={CHEVRON} contentFit="contain" style={styles.chevron} />}
        </TouchableOpacity>
      </Box>

      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="sm">
        <Text fontSize={10} lineHeight={12} letterSpacing={0.1} color="textSubheading" numberOfLines={1}>
          {fiatValue}
        </Text>
        {balance != null && (
          <Text fontSize={10} lineHeight={12} letterSpacing={0.1} color="textSubheading" numberOfLines={1}>
            Balance: {balance}
          </Text>
        )}
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 19,
    paddingVertical: 20,
    gap: 13,
  },
  amount: {
    flex: 1,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.5,
    fontFamily: 'SFproMedium',
    padding: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tokenIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: -2,
  },
  chevron: {
    width: 18,
    height: 18,
  },
});

export default SwapCard;
