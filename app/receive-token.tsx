import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import AddressStage from '@/src/components/receive-token/AddressStage';
import TokenSelectionStep from '@/src/components/send-token/TokenSelectionStep';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { usePortfolio, type TokenBalance } from '@/src/hooks/use-portfolio';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { useWalletStore } from '@/src/store/wallet';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ReceiveToken = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { smartAccountAddress, accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { tokens: trackedTokens } = useTrackedTokens();

  const { data: portfolio } = usePortfolio(
    smartAccountAddress,
    activeAccount?.gAddress,
    trackedTokens,
  );

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);

  const handleBack = () => {
    if (selectedToken) setSelectedToken(null);
    else router.back();
  };

  return (
    <Box
      flex={1}
      backgroundColor="surfaceBase"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <StatusBar style="light" />

      <Box flexDirection="row" alignItems="center" style={styles.header}>
        <RoundBackButton onPress={handleBack} />
        <Text
          flex={1}
          textAlign="center"
          fontSize={18}
          lineHeight={26}
          fontFamily="SFproMedium"
          color="textPrimary"
          numberOfLines={1}
        >
          {selectedToken ? 'Receive Token' : 'Select Token'}
        </Text>
        <Box width={40} />
      </Box>

      {selectedToken && smartAccountAddress ? (
        <AddressStage
          token={selectedToken}
          address={smartAccountAddress}
          onCopy={() => copyToClipboard(smartAccountAddress)}
        />
      ) : (
        <TokenSelectionStep tokens={portfolio ?? []} onSelectToken={setSelectedToken} />
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
    paddingHorizontal: 24,
    gap: 12,
  },
});

export default ReceiveToken;
