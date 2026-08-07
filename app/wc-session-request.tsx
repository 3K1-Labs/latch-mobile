import DappHeader from '@/src/components/walletconnect/DappHeader';
import RequestWarnings from '@/src/components/walletconnect/RequestWarnings';
import TransactionSummary from '@/src/components/walletconnect/TransactionSummary';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import {
  approveSignRequest,
  getWcChain,
  rejectSignRequest,
  walletKit,
} from '@/src/lib/walletconnect';
import { reviewSessionRequest } from '@/src/lib/wc-request-review';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';
import { useWalletConnectStore } from '@/src/store/walletconnect';
import { confirmAuth } from '@/src/utils/confirm-auth';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WCSessionRequestScreen() {
  const insets = useSafeAreaInsets();
  const { pendingRequest, setPendingRequest } = useWalletConnectStore();
  const { activeAccountIndex } = useWalletStore();
  const [loading, setLoading] = useState(false);

  // router.back() updates NavigationContainer's state — doing it inline during
  // render (instead of an effect) trips React's "Cannot update a component
  // while rendering a different component" warning.
  useEffect(() => {
    if (!pendingRequest || !walletKit) {
      router.back();
    }
  }, [pendingRequest]);

  if (!pendingRequest || !walletKit) {
    return null;
  }

  const sessions = walletKit.getActiveSessions();
  const session = sessions[pendingRequest.topic];
  const meta = session?.peer.metadata;
  const method = pendingRequest.params.request.method;

  // The account the dApp session was approved against — taken from the session
  // namespace rather than the store so it reflects what was actually connected.
  const accountAddress =
    session?.namespaces?.stellar?.accounts?.[0]?.split(':')[2] ?? null;

  const reviewResult = reviewSessionRequest({
    method,
    chainId: pendingRequest.params.chainId,
    activeChain: getWcChain(),
    requestParams: pendingRequest.params.request.params,
    accountAddress,
  });

  const handleApprove = async () => {
    const authed = await confirmAuth('Authenticate to sign transaction');
    if (!authed) return;

    setLoading(true);
    try {
      const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
      if (!mnemonic) throw new Error('No mnemonic found');
      await approveSignRequest(pendingRequest, mnemonic, activeAccountIndex);
      // Don't also call router.back() here — the effect above does it when
      // pendingRequest flips to null. Calling it in both places double-pops
      // the modal (second pop races the first mid-transition — the "presenting
      // a screen whose view is not in the window hierarchy" freeze).
      setPendingRequest(null);
    } catch (e: any) {
      Alert.alert('Signing failed', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      await rejectSignRequest(pendingRequest);
    } catch {
      // best-effort
    }
    setPendingRequest(null);
  };

  return (
    <Box
      flex={1}
      backgroundColor="mainBackground"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
    >
      <StatusBar style="light" />

      <Box flex={1} paddingHorizontal="xl">
        <Box alignItems="center" mt="xl" mb="l">
          {meta && (
            <DappHeader name={meta.name} url={meta.url} icon={meta.icons?.[0]} />
          )}
          <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold" textAlign="center">
            {method === 'stellar_signAndSubmitXDR' ? 'Sign & Submit' : 'Sign Transaction'}
          </Text>
          <Text variant="p7" color="textSecondary" textAlign="center" mt="xs">
            {method === 'stellar_signAndSubmitXDR'
              ? 'This dApp wants to sign and submit a transaction on your behalf.'
              : 'This dApp wants you to sign a transaction.'}
          </Text>
        </Box>

        <ScrollView showsVerticalScrollIndicator={false}>
          {reviewResult.ok ? (
            <>
              <RequestWarnings warnings={reviewResult.review.warnings} />
              <TransactionSummary review={reviewResult.review} accountAddress={accountAddress} />
            </>
          ) : (
            // Reaching this means the request is structurally invalid. Approving
            // would be rejected by approveSignRequest anyway, so say why and
            // leave Reject as the only sensible action.
            <Box backgroundColor="cardBackground" borderRadius={16} padding="m">
              <Text variant="p7" color="textPrimary" fontFamily="SFproSemibold" mb="xs">
                This request can&apos;t be signed
              </Text>
              <Text variant="p7" color="textSecondary">
                {reviewResult.rejection.message}
              </Text>
            </Box>
          )}
        </ScrollView>
      </Box>

      <Box paddingHorizontal="xl" gap="s">
        {/* Disabled only for a structurally invalid request — warnings never
            gate the button, they inform. */}
        <Button
          label="Approve"
          onPress={handleApprove}
          loading={loading}
          disabled={!reviewResult.ok}
        />
        <Button
          label="Reject"
          onPress={handleReject}
          variant="outline"
          disabled={loading}
        />
      </Box>
    </Box>
  );
}
