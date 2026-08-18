import Box from '@/src/components/shared/Box';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import TxAuthModal from '@/src/components/shared/TxAuthModal';
import { swapTokenImage } from '@/src/components/swap/token-image';
import { usePrices } from '@/src/hooks/use-prices';
import { useSwapQuote } from '@/src/hooks/use-swap-quote';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { friendlyTxError } from '@/src/lib/tx-errors';
import {
  executeSwapFromPasskeyAccount,
  executeSwapFromSmartAccount,
} from '@/src/services/swap/execute-swap';
import { signingRaisesBiometricPrompt } from '@/src/lib/cosign-packet-flow';
import { createSwap } from '@/src/lib/cosign-transport';
import { getActiveSwapProvider } from '@/src/services/swap/registry';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { maskAddress } from '@/src/utils';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const formatUsd = (amountStr: string, price?: string) => {
  const amount = parseFloat(amountStr || '0');
  const p = parseFloat(price ?? '0');
  if (!amount || !p) return '≈$0.00';
  return `≈$${(amount * p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const ConfirmSwap = () => {
  const theme = useTheme<Theme>();
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

  const spendUsd = formatUsd(params.amountIn, prices?.[params.fromCode]?.price);
  const receiveUsd = formatUsd(quote?.amountOut ?? '0', prices?.[params.toCode]?.price);
  const accountLabel = smartAccountAddress ? maskAddress(smartAccountAddress) : '—';

  const handleConfirm = async () => {
    if (!quote || !smartAccountAddress) return;

    const confirmed = await requestAuth(
      `Swap ${params.amountIn} ${params.fromCode} for ~${quote.amountOut} ${params.toCode}`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const { operation, effectiveQuote } = await provider.buildSwapOperation(
        quote,
        smartAccountAddress,
      );

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

      const result = isPasskeyAccount
        ? await executeSwapFromPasskeyAccount({
            smartAccountAddress,
            listIndex: activeAccountIndex,
            operation,
          })
        : await (async () => {
            const { deriveWalletAtIndex } = await import('@/src/lib/seed-wallet');
            const wallet = deriveWalletAtIndex(mnemonic!, activeAccount!.index);
            return executeSwapFromSmartAccount({
              smartAccountAddress,
              keypair: wallet.keypair,
              operation,
            });
          })();

      if (__DEV__) console.log('[swap-exec] SUCCESS', result.hash);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      router.dismissTo({
        pathname: '/(auth)/thank-you',
        params: {
          title: 'Your swap was successful',
          subtext: `Swapped ${params.amountIn} ${params.fromCode} for ~${effectiveQuote.amountOut} ${params.toCode}. Tx ${result.hash.slice(0, 8)}…`,
          buttonLabel: 'Go to Dashboard',
          imageSource: 'success',
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
          imageSource: 'error',
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />

      {/* Header */}
      <Box
        height={56}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        paddingHorizontal="m"
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold">
          Confirm Swap
        </Text>
      </Box>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* From Section */}
        <Box mt="m">
          <Text variant="p7" color="textSecondary" mb="s">
            From
          </Text>
          <Box
            backgroundColor="bg900"
            borderRadius={18}
            padding="m"
            flexDirection="row"
            alignItems="center"
          >
            <Box
              width={44}
              height={44}
              borderRadius={12}
              backgroundColor="bg800"
              justifyContent="center"
              alignItems="center"
              mr="m"
            >
              <Image source={fromIcon} style={{ width: 44, height: 44 }} />
            </Box>
            <Box flex={1}>
              <Text variant="h10" color="textPrimary">
                {params.fromCode} on Stellar
              </Text>
              <Text variant="p8" color="textSecondary">
                From: {accountLabel}
              </Text>
            </Box>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="pencil-outline" size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </Box>
        </Box>

        {/* Spend Section */}
        <Box mt="m">
          <Text variant="p7" color="textSecondary" mb="s">
            Spend
          </Text>
          <Box
            backgroundColor="bg900"
            borderRadius={18}
            padding="m"
            flexDirection="row"
            alignItems="center"
          >
            <Box
              width={44}
              height={44}
              borderRadius={12}
              backgroundColor="bg800"
              justifyContent="center"
              alignItems="center"
              mr="m"
            >
              <Image source={fromIcon} style={{ width: 44, height: 44 }} />
            </Box>
            <Box flex={1}>
              <Text variant="h9" color="textPrimary">
                -{params.amountIn} {params.fromCode}
              </Text>
              <Text variant="p8" color="textSecondary">
                {spendUsd}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Receive Section */}
        <Box mt="m">
          <Text variant="p7" color="textSecondary" mb="s">
            Receive (Estimated)
          </Text>
          <Box
            backgroundColor="bg900"
            borderRadius={18}
            padding="m"
            flexDirection="row"
            alignItems="center"
          >
            <Box
              width={44}
              height={44}
              borderRadius={12}
              backgroundColor="bg800"
              justifyContent="center"
              alignItems="center"
              mr="m"
            >
              <Image source={toIcon} style={{ width: 44, height: 44, resizeMode: 'cover' }} />
            </Box>
            <Box flex={1}>
              <Text variant="h9" color="textPrimary">
                +{quote?.amountOut ?? '—'} {params.toCode}
              </Text>
              <Text variant="p8" color="textSecondary">
                {receiveUsd}
              </Text>
            </Box>
            <Box>
              {/* <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.textSecondary} /> */}
            </Box>
          </Box>
        </Box>

        {/* Details Section */}
        <Box mt="xl">
          {/* <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="p7" color="textSecondary">
              MEV Protection
            </Text>
            <Switch value={mevProtection} onValueChange={setMevProtection} />
          </Box> */}

          <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="p7" color="textSecondary">
              Gas Account
            </Text>
            <Box flexDirection="row" alignItems="center">
              <Text variant="p7" color="textPrimary" mr="xs">
                Sponsored
              </Text>
            </Box>
          </Box>

          <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="p7" color="textSecondary">
              Network Fee
            </Text>
            <Box flexDirection="row" alignItems="center">
              <Text variant="p7" color="textPrimary" mr="xs">
                Sponsored by Latch
              </Text>
            </Box>
          </Box>

          <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="p7" color="textSecondary">
              Min. Received
            </Text>
            <Text variant="p7" color="textPrimary">
              {quote ? `${quote.minReceived} ${params.toCode}` : '—'}
            </Text>
          </Box>

          <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="p7" color="textSecondary">
              Provider
            </Text>
            <Box flexDirection="row" alignItems="center">
              <Image
                source={provider.icon}
                style={{ width: 18, height: 18, borderRadius: 4, marginRight: 6 }}
              />
              <Text variant="p7" color="textPrimary">
                {provider.name}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
            <Text variant="p7" color="textSecondary">
              Receive Address
            </Text>
            <Text variant="p7" color="textPrimary">
              {accountLabel}
            </Text>
          </Box>
        </Box>
      </ScrollView>

      {/* Footer Buttons */}
      <Box
        paddingHorizontal="m"
        paddingBottom="m"
        flexDirection="row"
        justifyContent="space-between"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <TouchableOpacity
          style={[styles.footerButton, styles.cancelButton]}
          onPress={() => router.back()}
        >
          <Text variant="h10" color="textPrimary">
            Cancel
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleConfirm}
          disabled={!quote || submitting}
          style={[
            styles.footerButton,
            styles.confirmButton,
            (!quote || submitting) && styles.disabled,
          ]}
        >
          <Text variant="h10" color="bgDark900" style={{ fontWeight: '600' }}>
            Confirm Swap
          </Text>
        </TouchableOpacity>
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
  backButton: {
    position: 'absolute',
    left: 16,
  },
  footerButton: {
    height: 48,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    flex: 0.48,
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#e1e1e1',
  },
  confirmButton: {
    backgroundColor: '#FFAD00',
  },
  disabled: {
    opacity: 0.5,
  },
});

export default ConfirmSwap;
