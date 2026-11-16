import { RoundBackButton, SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import TxAuthModal from '@/src/components/shared/TxAuthModal';
import SwapCard from '@/src/components/swap/SwapCard';
import { SummaryCard, SummaryRow, SummaryValue } from '@/src/components/swap/SwapSummary';
import { swapTokenImage } from '@/src/components/swap/token-image';
import { usePrices } from '@/src/hooks/use-prices';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { useSwapQuote } from '@/src/hooks/use-swap-quote';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { friendlyTxError, retryOnStaleFeeQuote } from '@/src/lib/tx-errors';
import type { NetworkFee } from '@/src/api/transaction-build';
import {
  estimateSwapFee,
  executeSwapFromPasskeyAccount,
  executeSwapFromSmartAccount,
} from '@/src/services/swap/execute-swap';
import { signingRaisesBiometricPrompt } from '@/src/lib/cosign-packet-flow';
import { createSwap } from '@/src/lib/cosign-transport';
import { getActiveSwapProvider } from '@/src/services/swap/registry';
import { useWalletStore } from '@/src/store/wallet';
import { maskAddress } from '@/src/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FLIP = require('@/src/assets/images/swap/flip.svg');

const ConfirmSwap = () => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const params = useLocalSearchParams<{
    fromSacId: string;
    fromCode: string;
    fromIssuer?: string;
    toSacId: string;
    toCode: string;
    toIssuer?: string;
    amountIn: string;
    slippageBps?: string;
    providerId?: string;
  }>();

  const { smartAccountAddress, accounts, activeAccountIndex, mnemonic } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { data: prices } = usePrices();
  const { formatToken } = useDisplayFiat();
  const provider = getActiveSwapProvider(params.providerId);

  // Real token logos from the Soroswap token list (fallback to local assets).
  const fromIconUrl = useTokenIcon(params.fromCode, params.fromIssuer || undefined);
  const toIconUrl = useTokenIcon(params.toCode, params.toIssuer || undefined);
  const fromIcon = fromIconUrl ? { uri: fromIconUrl } : swapTokenImage(params.fromCode);
  const toIcon = toIconUrl ? { uri: toIconUrl } : swapTokenImage(params.toCode);

  const slippageBps = parseInt(params.slippageBps ?? '50', 10);
  const { data: quote } = useSwapQuote({
    fromSacId: params.fromSacId,
    toSacId: params.toSacId,
    amountIn: params.amountIn,
    slippageBps,
    providerId: params.providerId,
    fromCode: params.fromCode,
    toCode: params.toCode,
  });

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPromptMessage, setAuthPromptMessage] = useState('');
  const authResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  // When signing raises its own OS prompt, TxAuthModal must not raise a second
  // one — see signingRaisesBiometricPrompt.
  const [signingPromptsForBiometrics, setSigningPromptsForBiometrics] = useState(false);
  useEffect(() => {
    signingRaisesBiometricPrompt()
      .then(setSigningPromptsForBiometrics)
      .catch(() => setSigningPromptsForBiometrics(false));
  }, [activeAccountIndex]);

  const requestAuth = (message: string): Promise<boolean> =>
    new Promise((resolve) => {
      authResolveRef.current = resolve;
      setAuthPromptMessage(message);
      setShowAuthModal(true);
    });

  const handleAuthResult = (confirmed: boolean) => {
    setShowAuthModal(false);
    authResolveRef.current?.(confirmed);
    authResolveRef.current = null;
  };

  const [feeEstimate, setFeeEstimate] = useState<NetworkFee | 'loading' | 'failed'>('loading');
  useEffect(() => {
    if (!quote || !smartAccountAddress) return;
    // Shared wallets go through cosign, not build-swap.
    if (activeAccount?.isMultisig) {
      setFeeEstimate('failed');
      return;
    }
    let cancelled = false;
    (async () => {
      const op = await provider.buildSwapOperation(quote, smartAccountAddress);
      const signer = activeAccount?.gAddress
        ? { keypair: (await import('@/src/lib/seed-wallet')).deriveWalletAtIndex(mnemonic!, activeAccount.index).keypair }
        : { listIndex: activeAccountIndex };
      return estimateSwapFee({ ...op, smartAccountAddress, signer });
    })()
      .then((fee) => !cancelled && setFeeEstimate(fee))
      .catch(() => !cancelled && setFeeEstimate('failed'));
    return () => {
      cancelled = true;
    };
  }, [quote, smartAccountAddress, activeAccount, activeAccountIndex, mnemonic, provider]);

  const feeLabel =
    feeEstimate === 'loading'
      ? 'Estimating…'
      : feeEstimate === 'failed'
        ? 'Calculated when signing'
        : `${feeEstimate.maxAmount} ${feeEstimate.symbol} (max)`;

  const spendFiat = formatToken(params.amountIn, prices?.[params.fromCode]?.price).text;
  const receiveFiat = formatToken(quote?.amountOut ?? '0', prices?.[params.toCode]?.price).text;
  const accountLabel = smartAccountAddress ? maskAddress(smartAccountAddress) : '—';

  const handleConfirm = async () => {
    if (!quote || !smartAccountAddress) return;

    const confirmed = await requestAuth(
      `Swap ${params.amountIn} ${params.fromCode} for ~${quote.amountOut} ${params.toCode}`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const { operation, swapChainXdr, effectiveQuote, tokenInContractId, amountInRaw, amountOutMinRaw, routerContractId } =
        await provider.buildSwapOperation(quote, smartAccountAddress);

      if (activeAccount?.isMultisig) {
        const packet = await createSwap({
          multisigAccount: activeAccount,
          operation,
          swapMeta: {
            fromCode: params.fromCode,
            toCode: params.toCode,
            amountIn: params.amountIn,
            amountOut: effectiveQuote.amountOut,
          },
        });
        router.replace({ pathname: '/cosign-review', params: { id: packet.id } });
        return;
      }

      const isPasskeyAccount = !activeAccount?.gAddress;
      if (__DEV__) console.log('[swap-exec] submitting', { isPasskeyAccount, smartAccountAddress });

      const attemptSwap = () =>
        isPasskeyAccount
          ? executeSwapFromPasskeyAccount({
              smartAccountAddress,
              listIndex: activeAccountIndex,
              operation,
              swapChainXdr,
              tokenInContractId,
              amountInRaw,
              amountOutMinRaw,
              routerContractId,
            })
          : (async () => {
              const { deriveWalletAtIndex } = await import('@/src/lib/seed-wallet');
              const wallet = deriveWalletAtIndex(mnemonic!, activeAccount!.index);
              return executeSwapFromSmartAccount({
                smartAccountAddress,
                keypair: wallet.keypair,
                operation,
                swapChainXdr,
                tokenInContractId,
                amountInRaw,
                amountOutMinRaw,
                routerContractId,
              });
            })();

      const result = await retryOnStaleFeeQuote(attemptSwap);

      if (__DEV__) console.log('[swap-exec] SUCCESS', result.hash);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      router.dismissTo({
        pathname: '/(auth)/thank-you',
        params: {
          title: 'Your swap was successful',
          subtext: `Swapped ${params.amountIn} ${params.fromCode} for ~${effectiveQuote.amountOut} ${params.toCode}. Network fee: ${result.networkFee.maxAmount} ${result.networkFee.symbol}. Tx ${result.hash.slice(0, 8)}…`,
          buttonLabel: 'Go to Dashboard',
          imageSource: 'tx-success',
        },
      });
    } catch (err) {
      if (__DEV__) {
        console.log('[swap-exec] FAILED:', err instanceof Error ? err.message : err);
      }
      router.dismissTo({
        pathname: '/(auth)/thank-you',
        params: {
          title: 'Swap failed',
          subtext: friendlyTxError(err),
          buttonLabel: 'Try Again',
          buttonFunctionRaw: `true`,
          imageSource: 'tx-failed',
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />

      <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} style={styles.backButton} />
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Confirm Swap
        </Text>
      </Box>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Box style={styles.cards}>
          <SwapCard
            label="You Pay"
            tokenCode={params.fromCode}
            tokenIcon={fromIcon}
            amount={params.amountIn}
            fiatValue={spendFiat}
          />
          <SwapCard
            label="You Receive (Estimated)"
            tokenCode={params.toCode}
            tokenIcon={toIcon}
            amount={quote?.amountOut ?? ''}
            fiatValue={receiveFiat}
          />
          <Box style={styles.flip}>
            <Image source={FLIP} tintColor="#121212" style={styles.flipIcon} />
          </Box>
        </Box>

        <Box height={1} backgroundColor="inputOutline" style={styles.divider} />

        <SummaryCard>
          <SummaryRow label="Min. Received">
            <SummaryValue>{quote ? `${quote.minReceived} ${params.toCode}` : '—'}</SummaryValue>
          </SummaryRow>
          <SummaryRow label="Network Fee">
            <SummaryValue>{feeLabel}</SummaryValue>
          </SummaryRow>
          <SummaryRow label="Provider">
            <Box flexDirection="row" alignItems="center" gap="s" flexShrink={1}>
              <Image source={provider.icon} style={styles.providerIcon} />
              <SummaryValue>{provider.name}</SummaryValue>
            </Box>
          </SummaryRow>
          <SummaryRow label="From">
            <SummaryValue>{accountLabel}</SummaryValue>
          </SummaryRow>
          <SummaryRow label="Receive Address">
            <SummaryValue>{accountLabel}</SummaryValue>
          </SummaryRow>
        </SummaryCard>
      </ScrollView>

      <Box style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <SetupButton
          label="Confirm Swap"
          busy={submitting}
          disabled={!quote}
          onPress={handleConfirm}
        />
      </Box>

      <TxAuthModal
        visible={showAuthModal}
        promptMessage={authPromptMessage}
        onResult={handleAuthResult}
        signingPromptsForBiometrics={signingPromptsForBiometrics}
      />

      <LoadingBlur
        visible={submitting}
        text={activeAccount?.isMultisig ? 'Preparing approval…' : 'Swapping…'}
        subText={activeAccount?.isMultisig ? 'Creating co-sign request' : 'Confirming on-chain'}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
  },
  backButton: {
    position: 'absolute',
    left: 24,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 40,
  },
  cards: {
    gap: 11,
  },
  flip: {
    position: 'absolute',
    alignSelf: 'center',
    top: 125,
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: '#FFC508',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipIcon: {
    width: 22,
    height: 22,
    transform: [{ rotate: '-90deg' }],
  },
  divider: {
    marginTop: 32,
    marginBottom: 16,
  },
  providerIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
});

export default ConfirmSwap;
