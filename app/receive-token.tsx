import AddressStage from '@/src/components/receive-token/AddressStage';
import TokenRow from '@/src/components/receive-token/TokenRow';
import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { usePortfolio, type TokenBalance } from '@/src/hooks/use-portfolio';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import AppToast from '@/src/components/toast/AppToast';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';

type Stage = 'SELECT' | 'ADDRESS';

const ReceiveToken = () => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { smartAccountAddress, accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { tokens: trackedTokens } = useTrackedTokens();

  const { data: portfolio } = usePortfolio(
    smartAccountAddress,
    activeAccount?.gAddress,
    trackedTokens,
  );

  const [stage, setStage] = useState<Stage>('SELECT');
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const tokens = portfolio ?? [];
  const filteredTokens = tokens.filter((t) =>
    t.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleBack = () => {
    if (stage === 'ADDRESS') {
      setStage('SELECT');
    } else {
      router.back();
    }
  };

  const handleSelectToken = (token: TokenBalance) => {
    setSelectedToken(token);
    setStage('ADDRESS');
  };

  const handleCopyAddress = async () => {
    if (smartAccountAddress) {
      await copyToClipboard(smartAccountAddress);
    }
  };

  return (
    <Box
      flex={1}
      backgroundColor="cardbg"
      style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
    >
      <StatusBar style="light" />

      <Box alignItems="center" pt="m">
        <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
      </Box>

      <Box
        height={56}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="m"
      >
        <TouchableOpacity onPress={handleBack} style={{ padding: 8, marginLeft: -8 }}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.white} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontWeight="700">
          {stage === 'SELECT' ? 'Select Token' : `Receive ${selectedToken?.code}`}
        </Text>
        <Box width={24} />
      </Box>

      {stage === 'SELECT' ? (
        <>
          <Box paddingHorizontal="m" mt="s" mb="m">
            <Input
              placeholder="Search for tokens..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              rightElement={<Ionicons name="search" size={18} color={theme.colors.textSecondary} />}
            />
          </Box>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          >
            {filteredTokens.length === 0 ? (
              <Box py="xl" alignItems="center">
                <Text variant="p7" color="textSecondary">
                  {tokens.length === 0
                    ? 'No tokens found. Fund your account first.'
                    : 'No matches.'}
                </Text>
              </Box>
            ) : (
              filteredTokens.map((token) => (
                <TokenRow
                  key={token.sacContractId}
                  token={token}
                  onPress={() => handleSelectToken(token)}
                />
              ))
            )}
          </ScrollView>
        </>
      ) : selectedToken && smartAccountAddress ? (
        <AddressStage
          token={selectedToken}
          address={smartAccountAddress}
          onCopy={handleCopyAddress}
        />
      ) : null}

      {/* This screen is presented with `presentation: 'modal'`, which puts it in
          its own native container above the root view — so the <Toast/> mounted
          in app/_layout.tsx renders behind it. The library keeps a stack of
          refs and shows on the most recently mounted one, restoring the
          previous when this unmounts, so a second instance here is safe. */}
      <AppToast />
    </Box>
  );
};

export default ReceiveToken;
