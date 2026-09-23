import AddressBookSheet from '@/src/components/profile/AddressBookSheet';
import AmountEntryStep from '@/src/components/send-token/AmountEntryStep';
import RecipientStep from '@/src/components/send-token/RecipientStep';
import SuccessStep from '@/src/components/send-token/SuccessStep';
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
import { useAddressBook } from '@/src/hooks/use-address-book';
import { usePortfolio } from '@/src/hooks/use-portfolio';
import { usePrices } from '@/src/hooks/use-prices';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { useTrackedTokens } from '@/src/hooks/use-tracked-tokens';
import { findDeployedNetwork } from '@/src/lib/account-network';
import { signingRaisesBiometricPrompt } from '@/src/lib/cosign-packet-flow';
import { createTransfer } from '@/src/lib/cosign-transport';
import { diagnoseAuthFailure, isAuthFailure } from '@/src/lib/tx-diagnostics';
import { friendlyTxError, isWrongNetworkError } from '@/src/lib/tx-errors';
import { sendTokenFromPasskeyAccount, sendTokenFromSmartAccount } from '@/src/services/send-token';
import { getPasskeyStorageKeys, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { maskAddress } from '@/src/utils';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Image, TouchableOpacity } from 'react-native';

const { width } = Dimensions.get('window');

const SendToken = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  const queryClient = useQueryClient();
  const { address: scannedAddress } = useLocalSearchParams<{ address?: string }>();
  const { smartAccountAddress, accounts, activeAccountIndex, mnemonic } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const { tokens: trackedTokens } = useTrackedTokens();
  const { data: prices } = usePrices();
  const { formatToken } = useDisplayFiat();
  const { entries: addressBookEntries } = useAddressBook();

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
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const [saveAddressVisible, setSaveAddressVisible] = useState(false);

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
    if (selectedWallet) {
      setSelectedWallet(null);
      setAmount('0');
    } else if (selectedToken) {
      setSelectedToken(null);
    } else {
      router.back();
    }
  };

  const handleKeyPress = (key: string) => {
    if (key === 'backspace') {
      setAmount((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
    } else if (key === '.') {
      if (!amount.includes('.')) setAmount((prev) => prev + '.');
    } else {
      setAmount((prev) => (prev === '0' ? key : prev + key));
    }
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

  const headerTitle = () => {
    if (status === 'success' || status === 'error') return '';
    if (!selectedToken) return 'Select Token';
    if (!selectedWallet) return 'Recipient';
    return `Send ${selectedToken.code}`;
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

    setStatus('sending');
    try {
      let result;
      if (isPasskeyAccount) {
        result = await sendTokenFromPasskeyAccount({
          smartAccountAddress,
          listIndex: activeAccountIndex,
          sacContractId: selectedToken.sacContractId,
          destinationAddress: selectedWallet.address,
          amount,
        });
      } else {
        const { deriveWalletAtIndex } = await import('@/src/lib/seed-wallet');
        const wallet = deriveWalletAtIndex(mnemonic!, activeAccount!.index);
        result = await sendTokenFromSmartAccount({
          smartAccountAddress,
          keypair: wallet.keypair,
          sacContractId: selectedToken.sacContractId,
          destinationAddress: selectedWallet.address,
          amount,
        });
      }
      setTxHash(result.hash);
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
          extra: { smartAccountAddress, activeAccountIndex, storedNetwork: activeAccount?.network ?? null },
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
          ? ((await SecureStore.getItemAsync(
              getPasskeyStorageKeys(activeAccountIndex).kind,
            )) ?? 'unset')
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

  const showNextButton = selectedWallet && status === 'initial';

  const renderContent = () => {
    if (status === 'success') {
      const recipientAddress = selectedWallet?.address ?? '';
      const alreadySaved = addressBookEntries.some((e) => e.address === recipientAddress);
      return (
        <SuccessStep
          amount={amount}
          tokenCode={selectedToken?.code ?? ''}
          recipient={recipientAddress}
          txHash={txHash}
          onContinue={() => router.back()}
          onSaveAddress={!alreadySaved ? () => setSaveAddressVisible(true) : undefined}
        />
      );
    }

    if (status === 'error') {
      return (
        <Box flex={1} paddingHorizontal="l" justifyContent="space-between" pb="xl">
          <Box flex={1} justifyContent="center" alignItems="center" px="m">
            <Image
              source={require('@/src/assets/images/error.png')}
              style={{ width: width, height: width * 0.55 }}
              resizeMode="contain"
            />
            <Text variant="h8" color="textPrimary" fontWeight="700" mt="l" mb="s">
              Transaction Failed
            </Text>
            <Text variant="p7" color="textSecondary" textAlign="center">
              {errorMessage}
            </Text>
          </Box>
          {isKeyMismatch ? (
            <TouchableOpacity activeOpacity={0.8} onPress={handleRedeploy} disabled={isRedeploying}>
              <Box
                height={56}
                backgroundColor="primary"
                borderRadius={28}
                justifyContent="center"
                alignItems="center"
              >
                <Text variant="p6" color="black" fontWeight="700">
                  {isRedeploying ? 'Re-initializing…' : 'Re-initialize Account'}
                </Text>
              </Box>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity activeOpacity={0.8} onPress={() => setStatus('initial')}>
              <Box
                height={56}
                backgroundColor="primary"
                borderRadius={28}
                justifyContent="center"
                alignItems="center"
              >
                <Text variant="p6" color="black" fontWeight="700">
                  Try Again
                </Text>
              </Box>
            </TouchableOpacity>
          )}
        </Box>
      );
    }

    if (!selectedToken) {
      return <TokenSelectionStep tokens={tokens} onSelectToken={setSelectedToken} />;
    }

    if (!selectedWallet) {
      return <RecipientStep onSelectWallet={setSelectedWallet} initialAddress={scannedAddress} />;
    }

    return (
      <AmountEntryStep
        selectedToken={selectedToken}
        selectedWallet={selectedWallet}
        amount={amount}
        fiatLabel={formatToken(amount, prices?.[selectedToken.code]?.price).text}
        onKeyPress={handleKeyPress}
        onMaxPress={handleMaxPress}
        onPresetPress={handlePresetUSD}
      />
    );
  };
  // yes, wire pending-approval to the delegated signer
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
        <TouchableOpacity onPress={handleBack}>
          <Ionicons
            name="chevron-back"
            size={24}
            color={isDark ? theme.colors.white : theme.colors.black}
          />
        </TouchableOpacity>

        {status === 'initial' && (
          <Text variant="h10" color="textPrimary" fontWeight="700">
            {headerTitle()}
          </Text>
        )}

        {showNextButton ? (
          <TouchableOpacity onPress={handleSend} disabled={!isAmountValid()}>
            <Text
              variant="p7"
              color={isAmountValid() ? 'primary700' : 'textSecondary'}
              fontWeight="700"
            >
              Send
            </Text>
          </TouchableOpacity>
        ) : (
          <Box width={40} />
        )}
      </Box>

      {renderContent()}

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

export default SendToken;
