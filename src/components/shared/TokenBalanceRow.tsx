import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import type { TokenBalance } from '@/src/hooks/use-portfolio';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  token: TokenBalance;
  price?: { price: string; change_24h: number };
  disabled?: boolean;
  onPress: () => void;
}

/** Token card used by the Select Token lists (swap and send). */
const TokenBalanceRow = ({ token, price, disabled = false, onPress }: Props) => {
  const theme = useTheme<Theme>();
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const { formatToken, formatUsdValue } = useDisplayFiat();
  const amount = parseFloat(token.amount).toLocaleString('en-US', {
    maximumFractionDigits: 7,
  });
  const unitPrice = parseFloat(price?.price ?? '');
  const change = price?.change_24h;

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} disabled={disabled}>
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="inputBox"
        borderColor="inputOutline"
        borderWidth={1}
        borderRadius={16}
        opacity={disabled ? 0.4 : 1}
        style={styles.row}
      >
        <Box width={40} height={40} borderRadius={20} overflow="hidden">
          <TokenIcon iconUrl={iconUrl} size={40} />
        </Box>
        <Box flex={1} style={styles.textCol}>
          <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary">
            {token.code}
          </Text>
          <Box flexDirection="row" alignItems="center" gap="s">
            <Text fontSize={12} lineHeight={24} letterSpacing={0.24} color="textSubheading">
              {unitPrice > 0 ? formatUsdValue(unitPrice).text : '—'}
            </Text>
            {change != null && (
              <Text
                fontSize={12}
                lineHeight={24}
                letterSpacing={0.24}
                fontFamily="SFproMedium"
                style={{ color: change >= 0 ? '#27C11F' : theme.colors.danger900 }}
              >
                {`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
              </Text>
            )}
          </Box>
        </Box>
        <Box alignItems="flex-end" style={styles.textCol}>
          <Text
            fontSize={16}
            lineHeight={24}
            letterSpacing={0.32}
            fontFamily="SFproMedium"
            color="textPrimary"
          >
            {formatToken(token.amount, price?.price).text}
          </Text>
          <Text fontSize={12} lineHeight={24} letterSpacing={0.24} color="textSubheading">
            {amount} {token.code}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  textCol: {
    gap: 2,
  },
});

export default TokenBalanceRow;
