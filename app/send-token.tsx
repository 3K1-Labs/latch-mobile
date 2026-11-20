import { RoundBackButton, SetupButton } from '@/src/components/onboarding/SetupChrome';
import AddressBookSheet from '@/src/components/profile/AddressBookSheet';
import AmountEntryStep from '@/src/components/send-token/AmountEntryStep';
import RecipientStep from '@/src/components/send-token/RecipientStep';
import SendSummarySheet from '@/src/components/send-token/SendSummarySheet';
import TokenSelectionStep from '@/src/components/send-token/TokenSelectionStep';
import {
  Recipient,
  SendStatus,
  SendToken as SendTokenType,
} from '@/src/components/send-token/types';
import Box from '@/src/components/shared/Box';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import TxAuthModal from '@/src/components/shared/TxAuthModal';
import { getNetworkId } from '@/src/constants/config';
import { useAddressBookStore } from '@/src/store/address-book';
import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { usePortfolio } from '@/src/hooks/use-portfolio';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { usePrices } from '@/src/hooks/use-prices';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { findDeployedNetwork } from '@/src/lib/account-network';
import { signingRaisesBiometricPrompt } from '@/src/lib/cosign-packet-flow';
import { createTransfer } from '@/src/lib/cosign-transport';
import { diagnoseAuthFailure, isAuthFailure } from '@/src/lib/tx-diagnostics';
import type { NetworkFee } from '@/src/api/transaction-build';
import { friendlyTxError, isWrongNetworkError, retryOnStaleFeeQuote } from '@/src/lib/tx-errors';
import {
  estimateSendFee,
  sendTokenFromPasskeyAccount,
  sendTokenFromSmartAccount,
} from '@/src/services/send-token';
import { getPasskeyStorageKeys, useWalletStore } from '@/src/store/wallet';
import { maskAddress, shortenAddress } from '@/src/utils';
import * as Sentry from '@sentry/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Image as SvgImage } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICONS = {
  qr: require('@/src/assets/images/send/qr-scan.svg'),
  check: require('@/src/assets/images/send/check.svg'),
  success: require('@/src/assets/images/result/tx-success.svg'),
  failed: require('@/src/assets/images/result/tx-failed.svg'),
};

const SendToken = () => {
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { address: scannedAddress } = useLocalSearchParams<{ address?: string }>();
  const { smartAccountAddress, accounts, activeAccountIndex, mnemonic } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { tokens: trackedTokens } = useTrackedTokens();
  const { data: prices } = usePrices();
  const { formatToken } = useDisplayFiat();
  const findAddressBookEntry = useAddressBookStore((s) => s.findByAddress);
  const rehydrateAddressBook = useAddressBookStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrateAddressBook();
  }, [rehydrateAddressBook]);

  const { data: portfolio, refetch: refetchPortfolio } = usePortfolio(
    smartAccountAddress,
    activeAccount?.gAddress,
    trackedTokens,
  );

  // usePortfolio can serve a persisted snapshot for instant paint (see
  // dashboard-snapshot.ts). That is fine for glancing at a balance; it is not
  // authority to spend. Force a live read when this screen opens so Max and the
  // insufficient-funds check are based on the chain, not on last launch.
  useEffect(() => {
    void refetchPortfolio();
  }, [refetchPortfolio]);

  const [selectedToken, setSelectedToken] = useState<SendTokenType | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState('0');
  const [status, setStatus] = useState<SendStatus>('initial');
  const [txHash, setTxHash] = useState<string | undefined>(undefined);
  const [networkFee, setNetworkFee] = useState<NetworkFee | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const [saveAddressVisible, setSaveAddressVisible] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPromptMessage, setAuthPromptMessage] = useState('');
  const authResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [isKeyMismatch, setIsKeyMismatch] = useState(false);
  const [isRedeploying, setIsRedeploying] = useState(false);

  const tokens = portfolio ?? [];

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

  const handleBack = () => {
    if (status === 'success' || status === 'error') {
      router.back();
      return;
    }
    if (reviewVisible) {
      setReviewVisible(false);
    } else if (selectedWallet) {
      setSelectedWallet(null);
      setAmount('0');
    } else if (selectedToken) {
      setSelectedToken(null);
    } else {
      router.back();
    }
  };

  const [feeEstimate, setFeeEstimate] = useState<NetworkFee | 'loading' | 'failed'>('loading');
  useEffect(() => {
    if (!reviewVisible || !selectedToken || !selectedWallet || !smartAccountAddress) return;
    // Shared wallets go through cosign, not build-send.
    if (activeAccount?.isMultisig) {
      setFeeEstimate('failed');
      return;
    }
    let cancelled = false;
    setFeeEstimate('loading');
    (async () => {
      const signer = activeAccount?.gAddress
        ? {
            keypair: (await import('@/src/lib/seed-wallet')).deriveWalletAtIndex(
              mnemonic!,
              activeAccount.index,
            ).keypair,
          }
        : { listIndex: activeAccountIndex };
      return estimateSendFee({
        smartAccountAddress,
        signer,
        sacContractId: selectedToken.sacContractId,
        destinationAddress: selectedWallet.address,
        amount,
      });
    })()
      .then((fee) => !cancelled && setFeeEstimate(fee))
      .catch(() => !cancelled && setFeeEstimate('failed'));
    return () => {
      cancelled = true;
    };
  }, [
    reviewVisible,
    selectedToken,
    selectedWallet,
    smartAccountAddress,
    amount,
    activeAccount,
    activeAccountIndex,
    mnemonic,
  ]);

  const shownFee = status === 'success' && networkFee ? networkFee : feeEstimate;
  const feeLabel =
    shownFee === 'loading'
      ? 'Estimating…'
      : shownFee === 'failed'
        ? 'Calculated when signing'
        : `${shownFee.maxAmount} ${shownFee.symbol} (max)`;

  // The design's token pill on the amount screen: pick another token without
  // losing the recipient.
  const handleChangeToken = () => {
    setSelectedToken(null);
    setAmount('0');
  };

  const handleMaxPress = () => {
    if (selectedToken) setAmount(selectedToken.amount);
  };

  const handlePresetUSD = (usdAmount: number) => {
    if (!selectedToken || !prices) return;
    const price = parseFloat(prices[selectedToken.code]?.price ?? '0');
    if (price <= 0) return;
    const tokenAmount = Math.min(usdAmount / price, parseFloat(selectedToken.amount));
    setAmount(tokenAmount.toFixed(7));
  };

  const isAmountValid = () => {
    if (!selectedToken) return false;
    const entered = parseFloat(amount);
    return entered > 0 && entered <= parseFloat(selectedToken.amount);
  };

  const recipientName = selectedWallet
    ? (selectedWallet.label ?? shortenAddress(selectedWallet.address))
    : '';

  const headerTitle = () => {
    if (status === 'error') return '';
    if (!selectedToken) return 'Select Token';
    if (!selectedWallet) return 'Recipient Details';
    return `Send to ${recipientName}`;
  };

  const handleSend = async () => {
    if (!selectedToken || !selectedWallet || !isAmountValid()) return;

    const confirmed = await requestAuth(
      `Send ${amount} ${selectedToken.code} to ${selectedWallet.address.slice(0, 8)}...`,
    );
    if (!confirmed) return;

    if (!smartAccountAddress) {
      setErrorMessage('No smart account found. Please complete wallet setup.');
      setStatus('error');
      return;
    }

    const activeAccount = accounts[activeAccountIndex];

    // A smart account is a contract on one specific network; on the other its
    // C-address resolves to nothing and the transfer dies deep in
    // re-simulation with an opaque Error(Auth, InvalidAction). Stop here —
    // before anything is signed or submitted — with a message that names the
    // fix. Only blocks on a known mismatch; a missing `network` (older
    // accounts) falls through and is recovered in the catch below.
    if (activeAccount?.network && activeAccount.network !== getNetworkId()) {
      const label = (n: string) => (n === 'testnet' ? 'Testnet' : 'Mainnet');
      setErrorMessage(
        `This account is on ${label(activeAccount.network)}, but the app is on ${label(getNetworkId())}. ` +
          'Switch networks under Profile → Network to use it.',
      );
      setStatus('error');
      return;
    }

    // Shared (multisig) wallets can't be signed from one device — their
    // signers are delegated member accounts with a threshold. Instead of
    // signing inline, open a cosign request that members approve, then any
    // member broadcasts (see src/lib/multisig-send.ts + /pending-approval).
    if (activeAccount?.isMultisig) {
      setStatus('sending');
      try {
        if (__DEV__) {
          console.log('[multisig-send] Send tapped on multisig', {
            multisig: smartAccountAddress,
            token: selectedToken.code,
            sac: selectedToken.sacContractId,
            to: selectedWallet.address,
            amount,
            threshold: activeAccount.multisigThreshold,
            signers: activeAccount.multisigSigners,
          });
        }
        // Backend-free P2P path: build an assembled transfer, sign our own
        // member entry, and open the review screen to collect the rest +
        // submit (docs/multisig-p2p-cosign.md).
        const packet = await createTransfer({
          multisigAccount: activeAccount,
          sacContractId: selectedToken.sacContractId,
          destinationAddress: selectedWallet.address,
          amount,
        });
        router.replace({ pathname: '/cosign-review', params: { id: packet.id } });
      } catch (err) {
        if (__DEV__) {
          console.log(
            '[multisig-send] send threw:',
            err instanceof Error ? (err.stack ?? err.message) : err,
          );
        }
        setErrorMessage(friendlyTxError(err));
        setStatus('error');
      }
      return;
    }

    const isPasskeyAccount = !activeAccount?.gAddress;

    const attemptSend = async () => {
      if (isPasskeyAccount) {
        return sendTokenFromPasskeyAccount({
          smartAccountAddress,
          listIndex: activeAccountIndex,
          sacContractId: selectedToken.sacContractId,
          destinationAddress: selectedWallet.address,
          amount,
        });
      }
      const { deriveWalletAtIndex } = await import('@/src/lib/seed-wallet');
      const wallet = deriveWalletAtIndex(mnemonic!, activeAccount!.index);
      return sendTokenFromSmartAccount({
        smartAccountAddress,
        keypair: wallet.keypair,
        sacContractId: selectedToken.sacContractId,
        destinationAddress: selectedWallet.address,
        amount,
      });
    };

    setStatus('sending');
    try {
      const result = await retryOnStaleFeeQuote(attemptSend);
      setTxHash(result.hash);
      setNetworkFee(result.networkFee);
      setStatus('success');
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';

      // The transfer trapped reading the account contract's own storage — the
      // account isn't deployed on the network the app is pointed at. Distinct
      // from a signer problem: check the chain for where it actually lives,
      // stamp that onto the account record so the pre-send guard catches it
      // next time, and say which way to switch.
      if (isWrongNetworkError(err)) {
        const here = getNetworkId();
        const label = (n: string) => (n === 'testnet' ? 'Testnet' : 'Mainnet');
        const deployedOn = await findDeployedNetwork(smartAccountAddress).catch(() => null);
        if (deployedOn) {
          void useWalletStore
            .getState()
            .setAccountNetwork(smartAccountAddress, deployedOn)
            .catch(() => {});
        }
        Sentry.captureMessage('send-token: account on wrong network', {
          level: 'warning',
          tags: {
            scope: 'send-token-wrong-network',
            appNetwork: here,
            accountNetwork: deployedOn ?? 'unknown',
            accountKind: isPasskeyAccount ? 'passkey' : 'mnemonic',
          },
          extra: {
            smartAccountAddress,
            activeAccountIndex,
            storedNetwork: activeAccount?.network ?? null,
          },
        });
        setErrorMessage(
          deployedOn
            ? `This account is on ${label(deployedOn)}, but the app is on ${label(here)}. ` +
                'Switch networks under Profile → Network to use it.'
            : `This account isn't deployed on ${label(here)}. If you created it on the other ` +
                'network, switch under Profile → Network.',
        );
        setStatus('error');
        return;
      }

      // On-chain auth rejection (Error(Auth, InvalidAction) / #3016) means the
      // device's signer isn't registered on the account. Read the account's
      // real signers to tell WHICH case it is, then guide the user.
      if (isAuthFailure(err) && !msg.startsWith('PASSKEY_KEY_MISMATCH')) {
        const presentedKeyDataHex = isPasskeyAccount
          ? await SecureStore.getItemAsync(getPasskeyStorageKeys(activeAccountIndex).keyDataHex)
          : (activeAccount?.publicKeyHex ?? null);
        const diag = await diagnoseAuthFailure(smartAccountAddress, presentedKeyDataHex);

        // The on-chain __check_auth rejected a locally-valid signature. This is
        // the failure that only reproduces on a shipped build, so capture the
        // full picture: which verdict diagnoseAuthFailure reached, whether the
        // device's key is even on the rule, the registered signer shapes and
        // their verifiers, and — for a passkey account — whether it's a synced
        // platform credential or a device-local key. No key material: signer
        // kinds, verifier contract addresses and booleans only.
        const passkeyKind = isPasskeyAccount
          ? ((await SecureStore.getItemAsync(getPasskeyStorageKeys(activeAccountIndex).kind)) ??
            'unset')
          : 'n/a';
        Sentry.captureException(err instanceof Error ? err : new Error(msg), {
          tags: {
            scope: 'send-token-auth-rejected',
            network: getNetworkId(),
            accountKind: isPasskeyAccount ? 'passkey' : 'mnemonic',
            passkeyKind,
            diagKind: diag.kind,
            presentedKeyRegistered: String(diag.presentedKeyRegistered),
          },
          extra: {
            smartAccountAddress,
            activeAccountIndex,
            sacContractId: selectedToken.sacContractId,
            ruleId: diag.ruleId ?? null,
            ruleReadError: diag.ruleReadError ?? null,
            registeredSigners: diag.registered.map((s) => ({
              kind: s.kind,
              verifierAddress: s.verifierAddress ?? null,
              foreignVerifier: Boolean(s.foreignVerifier),
              hasKeyData: Boolean(s.keyDataHex),
              delegatedAddress: s.address ?? null,
            })),
            rawError: msg,
          },
        });

        if (diag.kind === 'key-drift') {
          // The account expects a key this device no longer has — same remedy
          // as a passkey mismatch, so surface the "Re-initialize" CTA.
          setIsKeyMismatch(true);
          setErrorMessage(
            "This device's key isn't registered on this account anymore. Re-initialize the account to restore signing.",
          );
          setStatus('error');
          return;
        }
        if (diag.kind === 'multisig') {
          // On-chain truth: this account's rule holds delegated member signers,
          // so it's a shared wallet that was created before the isMultisig flag
          // (the passkey-credential heuristic mis-cleared it). Tag it from the
          // chain data and turn this Send into an approval request — which is
          // the pending/awaiting-signatures flow the user expects.
          const delegated = diag.registered
            .filter((s) => s.kind === 'delegated' && s.address)
            .map((s) => s.address as string);
          const threshold = delegated.length || 2;
          try {
            await useWalletStore
              .getState()
              .markAccountMultisig(activeAccountIndex, threshold, delegated);
            // Re-read the now-tagged account and open the backend-free flow.
            const tagged = useWalletStore.getState().accounts[activeAccountIndex];
            const packet = await createTransfer({
              multisigAccount: tagged,
              sacContractId: selectedToken.sacContractId,
              destinationAddress: selectedWallet.address,
              amount,
            });
            router.replace({ pathname: '/cosign-review', params: { id: packet.id } });
          } catch (e2) {
            setErrorMessage(friendlyTxError(e2));
            setStatus('error');
          }
          return;
        }
      }

      // Keep the key-mismatch branch so the "Re-initialize" CTA still shows.
      setIsKeyMismatch(msg.startsWith('PASSKEY_KEY_MISMATCH'));
      setErrorMessage(friendlyTxError(err));
      setStatus('error');
    }
  };

  const handleRedeploy = async () => {
    setIsRedeploying(true);
    try {
      const { redeployWithCurrentKey } = await import('@/src/lib/passkey-webauthn');
      const newAddress = await redeployWithCurrentKey(activeAccountIndex);
      const { useWalletStore: ws } = await import('@/src/store/wallet');
      ws.getState().setSmartAccountAddress(newAddress);
      setIsKeyMismatch(false);
      setStatus('initial');
    } catch (err) {
      setErrorMessage(friendlyTxError(err));
    } finally {
      setIsRedeploying(false);
    }
  };

  const onAmountStep = !!selectedToken && !!selectedWallet && status !== 'error';
  const canReview = onAmountStep && status === 'initial' && isAmountValid();
  const price = selectedToken ? prices?.[selectedToken.code]?.price : undefined;
  const networkLabel = getNetworkId() === 'testnet' ? 'Stellar Testnet' : 'Stellar Mainnet';
  const recipientRow = selectedWallet
    ? selectedWallet.label
      ? `${selectedWallet.label} (${shortenAddress(selectedWallet.address)})`
      : shortenAddress(selectedWallet.address)
    : '';
  const alreadySaved = !!selectedWallet && !!findAddressBookEntry(selectedWallet.address);

  const renderHeaderAction = () => {
    if (status !== 'initial') return <Box width={40} />;
    if (!selectedToken) return <Box width={40} />;
    if (!selectedWallet) {
      return (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Scan QR code"
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: '/qrcode-scan', params: { from: 'send' } })}
          style={[styles.headerButton, { backgroundColor: theme.colors.inputOutline }]}
        >
          <SvgImage
            source={ICONS.qr}
            contentFit="contain"
            tintColor={theme.colors.iconPrimary}
            style={styles.headerIcon}
          />
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Review transfer"
        activeOpacity={0.7}
        disabled={!canReview}
        onPress={() => setReviewVisible(true)}
        style={[
          styles.headerButton,
          { backgroundColor: theme.colors.inputOutline },
          styles.confirmButton,
          !canReview && styles.disabled,
        ]}
      >
        <SvgImage source={ICONS.check} contentFit="contain" style={styles.headerIcon} />
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (status === 'error') {
      return (
        <Box flex={1} paddingHorizontal="l" justifyContent="space-between" pb="xl">
          <Box flex={1} justifyContent="center" alignItems="center" px="m">
            <SvgImage
              source={ICONS.failed}
              contentFit="contain"
              style={styles.resultIllustration}
            />
            <Text
              fontSize={24}
              lineHeight={32}
              fontFamily="SFproMedium"
              color="textPrimary"
              mt="l"
              mb="s"
            >
              Transaction Failed
            </Text>
            <Text fontSize={14} lineHeight={22} color="textSubheading" textAlign="center">
              {errorMessage}
            </Text>
          </Box>
          {isKeyMismatch ? (
            <SetupButton
              label={isRedeploying ? 'Re-initializing…' : 'Re-initialize Account'}
              busy={isRedeploying}
              onPress={handleRedeploy}
            />
          ) : (
            <SetupButton
              label="Try Again"
              onPress={() => {
                setReviewVisible(false);
                setStatus('initial');
              }}
            />
          )}
        </Box>
      );
    }

    if (!selectedToken) {
      return <TokenSelectionStep tokens={tokens} onSelectToken={setSelectedToken} />;
    }

    if (!selectedWallet) {
      // Keyed on the scanned address so a scan returning here prefills the field.
      return (
        <RecipientStep
          key={scannedAddress ?? 'manual'}
          onSelectWallet={setSelectedWallet}
          initialAddress={scannedAddress}
        />
      );
    }

    return (
      <AmountEntryStep
        selectedToken={selectedToken}
        amount={amount}
        canUsePresets={parseFloat(price ?? '0') > 0}
        onChangeAmount={setAmount}
        onMaxPress={handleMaxPress}
        onPresetPress={handlePresetUSD}
        onChangeToken={handleChangeToken}
      />
    );
  };

  return (
    <Box
      flex={1}
      backgroundColor="surfaceBase"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <StatusBar style={statusBarStyle} />

      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        style={styles.header}
      >
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
          {headerTitle()}
        </Text>
        {renderHeaderAction()}
      </Box>

      {renderContent()}

      {selectedToken && selectedWallet && (
        <SendSummarySheet
          visible={status === 'success' || (reviewVisible && status !== 'error')}
          title={status === 'success' ? `Sent to ${recipientName}` : `Send to ${recipientName}`}
          token={selectedToken}
          amount={amount}
          fiatLabel={price ? formatToken(amount, price).text : undefined}
          rows={[
            { label: 'Recipient', value: recipientRow },
            { label: 'Network', value: networkLabel },
            { label: 'Network Fee', value: feeLabel },
            ...(status === 'success' && txHash
              ? [{ label: 'Transaction', value: shortenAddress(txHash) }]
              : []),
          ]}
          primaryLabel={status === 'success' ? 'Back to Home' : 'Send'}
          onPrimary={status === 'success' ? () => router.dismissTo('/(tabs)') : handleSend}
          onClose={status === 'success' ? undefined : () => setReviewVisible(false)}
          secondaryLabel={
            status === 'success' && !alreadySaved ? 'Save to Address Book' : undefined
          }
          onSecondary={() => setSaveAddressVisible(true)}
          illustration={status === 'success' ? ICONS.success : undefined}
        />
      )}

      <TxAuthModal
        visible={showAuthModal}
        promptMessage={authPromptMessage}
        onResult={handleAuthResult}
        signingPromptsForBiometrics={signingPromptsForBiometrics}
      />

      <AddressBookSheet
        visible={saveAddressVisible}
        onClose={() => setSaveAddressVisible(false)}
        prefillAddress={selectedWallet?.address}
      />

      <LoadingBlur
        visible={status === 'sending'}
        text="Sending..."
        subText={`Sending ${amount}${selectedToken?.code} to ${maskAddress(selectedWallet?.address || '')} `}
      />
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
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButton: {
    backgroundColor: '#76B101',
  },
  disabled: {
    opacity: 0.4,
  },
  resultIllustration: {
    width: 243,
    height: 243,
  },
  headerIcon: {
    width: 20,
    height: 20,
  },
});

export default SendToken;
