import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { usePrices } from '@/src/hooks/use-prices';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import { SendToken } from './types';

interface TokenRowProps {
  token: SendToken;
  onPress: () => void;
  theme: Theme;
}

function TokenRow({ token, onPress, theme }: TokenRowProps) {
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const { data: prices } = usePrices();
  const { formatToken } = useDisplayFiat();
  const amount = parseFloat(token.amount);
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: token.code === 'XLM' ? 7 : 2,
  });

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="bg11"
        borderRadius={16}
        padding="m"
        mb="s"
        height={82}
      >
        <Box
          width={44}
          height={44}
          borderRadius={12}
          backgroundColor="black"
          justifyContent="center"
          alignItems="center"
          mr="m"
          overflow="hidden"
        >
          <TokenIcon iconUrl={iconUrl} size={44} />
        </Box>
        <Box flex={1}>
          <Text variant="h10" color="textPrimary" fontWeight="700" mb="xs">
            {token.code}
          </Text>
          <Box flexDirection="row" alignItems="center">
            <Text variant="captionSemibold" color="textSecondary" style={{ letterSpacing: 0.5 }}>
              BALANCE{' '}
            </Text>
            <Text variant="captionBold" color="textPrimary" style={{ letterSpacing: 0.5 }}>
              {formatted} {token.code}
            </Text>
          </Box>
          <Text variant="p8" color="textSecondary" mt="xs">
            {formatToken(token.amount, prices?.[token.code]?.price, { approx: false }).text}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
}

interface Props {
  tokens: SendToken[];
  onSelectToken: (token: SendToken) => void;
}

const TokenSelectionStep = ({ tokens, onSelectToken }: Props) => {
  const theme = useTheme<Theme>();

  if (tokens.length === 0) {
    return (
      <Box flex={1} justifyContent="center" alignItems="center" px="l">
        <Text variant="p7" color="textSecondary" textAlign="center">
          No tokens found. Fund your smart account first.
        </Text>
      </Box>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 }}
    >
      {tokens.map((token) => (
        <TokenRow
          key={token.sacContractId}
          token={token}
          onPress={() => onSelectToken(token)}
          theme={theme}
        />
      ))}
    </ScrollView>
  );
};

export default TokenSelectionStep;
