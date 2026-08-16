import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import type { SwapToken } from '@/src/services/swap/types';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useRef } from 'react';
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

interface RowProps {
  token: SwapToken;
  disabled: boolean;
  onPress: () => void;
}

function TokenRow({ token, disabled, onPress }: RowProps) {
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const amount = parseFloat(token.amount);
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: token.code === 'XLM' ? 7 : 2,
  });

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} disabled={disabled}>
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="bg11"
        borderRadius={16}
        padding="m"
        mb="s"
        height={72}
        opacity={disabled ? 0.4 : 1}
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
  title: string;
  tokens: SwapToken[];
  /** SAC id of the token selected on the other leg — shown disabled */
  excludeSacId?: string;
  onClose: () => void;
  onSelect: (token: SwapToken) => void;
}

const SwapTokenPickerSheet = ({ visible, title, tokens, excludeSacId, onClose, onSelect }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    } else {
      Animated.timing(translateY, {
        toValue: 600,
        duration: 250,
        useNativeDriver: true,
      }).start();
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
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
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
                  disabled={token.sacContractId === excludeSacId}
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

export default SwapTokenPickerSheet;
