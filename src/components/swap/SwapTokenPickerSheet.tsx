import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenBalanceRow from '@/src/components/shared/TokenBalanceRow';
import { usePrices } from '@/src/hooks/use-prices';
import type { SwapToken } from '@/src/services/swap/types';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICONS = {
  close: require('@/src/assets/images/swap/close.svg'),
  search: require('@/src/assets/images/swap/search.svg'),
};

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
  const insets = useSafeAreaInsets();
  const { data: prices } = usePrices();
  const translateY = useRef(new Animated.Value(600)).current;
  const [query, setQuery] = useState('');

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

  const close = () => {
    setQuery('');
    onClose();
  };
  const select = (token: SwapToken) => {
    setQuery('');
    onSelect(token);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? tokens.filter((t) => t.code.toUpperCase().includes(q)) : tokens;
  }, [tokens, query]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.root}>
        <TouchableWithoutFeedback onPress={close}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surfaceBase,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateY }],
            },
          ]}
        >
          <Box alignItems="center" style={styles.grabberWrap}>
            <Box width={126} height={8} borderRadius={69} backgroundColor="inputOutline" />
          </Box>

          <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
            <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
              {title}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              hitSlop={8}
              style={styles.close}
            >
              <Image source={ICONS.close} contentFit="contain" style={styles.closeIcon} />
            </TouchableOpacity>
          </Box>

          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            borderRadius={40}
            style={styles.search}
          >
            <Image source={ICONS.search} contentFit="contain" style={styles.searchIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search for Token..."
              placeholderTextColor={theme.colors.textSubheading}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </Box>

          <Box flexDirection="row" justifyContent="space-between" style={styles.columns}>
            <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textMuted">
              Assets
            </Text>
            <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textMuted">
              Wallet Balance
            </Text>
          </Box>

          {filtered.length === 0 ? (
            <Box justifyContent="center" alignItems="center" py="xl" px="l">
              <Text fontSize={14} lineHeight={22} color="textSubheading" textAlign="center">
                {tokens.length === 0 ? 'No tokens found. Fund your wallet first.' : 'No matching tokens.'}
              </Text>
            </Box>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              style={styles.scroll}
            >
              {filtered.map((token) => (
                <TokenBalanceRow
                  key={token.sacContractId}
                  token={token}
                  price={prices?.[token.code]}
                  disabled={token.sacContractId === excludeSacId}
                  onPress={() => select(token)}
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
    backgroundColor: 'rgba(18,18,18,0.9)',
  },
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    maxHeight: '80%',
  },
  grabberWrap: {
    paddingTop: 10,
  },
  header: {
    marginTop: 20,
    paddingHorizontal: 24,
    height: 40,
  },
  close: {
    position: 'absolute',
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
  search: {
    marginTop: 37,
    marginHorizontal: 24,
    height: 48,
    paddingHorizontal: 21,
    gap: 10,
  },
  searchIcon: {
    width: 13,
    height: 15,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'SFproRegular',
    color: '#FFFFFF',
  },
  columns: {
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  scroll: {
    flexGrow: 0,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 10,
  },
});

export default SwapTokenPickerSheet;
