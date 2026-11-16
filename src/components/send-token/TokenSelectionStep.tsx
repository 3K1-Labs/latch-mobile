import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenBalanceRow from '@/src/components/shared/TokenBalanceRow';
import { usePrices } from '@/src/hooks/use-prices';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { SendToken } from './types';

const SEARCH = require('@/src/assets/images/swap/search.svg');

interface Props {
  tokens: SendToken[];
  onSelectToken: (token: SendToken) => void;
}

const TokenSelectionStep = ({ tokens, onSelectToken }: Props) => {
  const theme = useTheme<Theme>();
  const { data: prices } = usePrices();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? tokens.filter((t) => t.code.toUpperCase().includes(q)) : tokens;
  }, [tokens, query]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="inputBox"
        borderRadius={40}
        style={styles.search}
      >
        <Image source={SEARCH} contentFit="contain" style={styles.searchIcon} />
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
        <Text fontSize={14} lineHeight={22} color="textSubheading" textAlign="center" mt="xl">
          {tokens.length === 0 ? 'No tokens found. Fund your wallet first.' : 'No matching tokens.'}
        </Text>
      ) : (
        <Box style={styles.list}>
          {filtered.map((token) => (
            <TokenBalanceRow
              key={token.sacContractId}
              token={token}
              price={prices?.[token.code]}
              onPress={() => onSelectToken(token)}
            />
          ))}
        </Box>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
  },
  search: {
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
    // Keeps the bundled SF Pro vertically centred in an iOS TextInput.
    lineHeight: 18,
    fontFamily: 'SFproRegular',
    color: '#FFFFFF',
  },
  columns: {
    marginTop: 24,
    marginBottom: 12,
  },
  list: {
    gap: 10,
  },
});

export default TokenSelectionStep;
