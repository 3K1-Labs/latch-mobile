import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { TokenBalance, usePortfolio } from '@/src/hooks/use-portfolio';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

/** Held tokens for the active account, sorted by USD value (largest first). */
export function useHeldTokens(): TokenBalance[] {
  const { accounts, activeAccountIndex } = useWalletStore();
  const account = accounts[activeAccountIndex];
  const { tokens: tracked } = useTrackedTokens();
  const { data } = usePortfolio(account?.smartAccountAddress ?? null, account?.gAddress, tracked);
  return useMemo(() => [...(data ?? [])].sort((a, b) => b.usdValue - a.usdValue), [data]);
}

/** Code of the largest-balance held token, or 'USDC' as a fallback. */
export function largestBalanceCode(tokens: TokenBalance[]): string {
  return tokens[0]?.code ?? 'USDC';
}

function TokenRow({ token, onPress }: { token: TokenBalance; onPress: () => void }) {
  const iconUrl = useTokenIcon(token.code, token.issuer);
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
        height={72}
      >
        <Box
          width={40}
          height={40}
          borderRadius={12}
          backgroundColor="black"
          justifyContent="center"
          alignItems="center"
          mr="m"
          overflow="hidden"
        >
          <TokenIcon iconUrl={iconUrl} size={40} />
        </Box>
        <Box flex={1}>
          <Text variant="h10" color="textPrimary" fontWeight="700">
            {token.code}
          </Text>
          <Text variant="p8" color="textSecondary">
            {formatted} {token.code}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
}

interface Props {
  visible: boolean;
  tokens: TokenBalance[];
  onClose: () => void;
  onSelect: (token: TokenBalance) => void;
}

const SessionKeyTokenPicker = ({ visible, tokens, onClose, onSelect }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    } else {
      Animated.timing(translateY, { toValue: 600, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible, translateY]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? theme.colors.gray900 : theme.colors.white,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateY }],
            },
          ]}
        >
          <Box alignItems="center" pt="m" pb="s">
            <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
          </Box>

          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="m"
            mb="m"
          >
            <Text variant="h10" color="textPrimary" fontWeight="700">
              Select Token
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </Box>

          {tokens.length === 0 ? (
            <Box justifyContent="center" alignItems="center" py="xl" px="l">
              <Text variant="p7" color="textSecondary" textAlign="center">
                No tokens found. Fund your wallet first.
              </Text>
            </Box>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
              style={styles.scroll}
            >
              {tokens.map((token) => (
                <TokenRow
                  key={token.sacContractId}
                  token={token}
                  onPress={() => onSelect(token)}
                />
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  scroll: {
    flexGrow: 0,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});

export default SessionKeyTokenPicker;
