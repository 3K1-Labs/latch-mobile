/**
 * pair-show-qr.tsx — initiator side of the QR (P2P) pairing flow.
 *
 * No backend involvement. The initiator generates a 32-byte challenge in
 * memory and shows {accountAddress, initiatorPubkey, challengeB64} as a
 * QR. The joiner scans, signs the challenge, and shows the signed
 * response as a return QR. The initiator scans that, verifies the
 * signature, and drives the on-chain admin tx (same as link-code mode).
 */

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { fetchDefaultContextRule } from '@/src/api/account-admin';
import { completePairing } from '@/src/lib/admin-tx';
import {
  buildPairingContext,
  deviceFromPairingResponse,
} from '@/src/lib/pairing-context';
import {
  decodeSignedChallenge,
  encodeChallengeB64,
  SignedPairingChallenge,
  verifySignedChallenge,
} from '@/src/lib/pairing-payload';
import {
  STELLAR_BUNDLER_SECRET,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { restoreStellarWallet } from '@/src/lib/seed-wallet';
import { AccountSigner } from '@/src/lib/account-signers';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';

type Stage =
  | { kind: 'showQR' }
  | { kind: 'scanReply' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export default function PairShowQR() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, updateAccountDevices } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];

  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>({ kind: 'showQR' });

  // Generate a fresh 32-byte challenge on mount. Stays the same for the
  // life of this screen so a re-scan of the showQR view produces the same
  // signed-payload requirement.
  const challenge = useMemo(() => {
    const buf = new Uint8Array(32);
    // crypto.getRandomValues polyfilled by react-native-get-random-values.
    crypto.getRandomValues(buf);
    return buf;
  }, []);

  const payload = useMemo(() => {
    if (!activeAccount?.smartAccountAddress) return null;
    return JSON.stringify({
      v: 1,
      kind: 'latch-pair-init',
      accountAddress: activeAccount.smartAccountAddress,
      initiatorPubkey: activeAccount.publicKeyHex,
      challenge: encodeChallengeB64(challenge),
    });
  }, [activeAccount, challenge]);

  const handleScannedReply = async (scanned: string) => {
    if (stage.kind !== 'scanReply') return;
    setStage({ kind: 'submitting' });
    try {
      // Reply payload: { responsePubkey, responseSignatureB64 } JSON.
      const parsed = JSON.parse(scanned) as {
        responsePubkey?: string;
        responseSignatureB64?: string;
      };
      if (!parsed.responsePubkey || !parsed.responseSignatureB64) {
        throw new Error('scanned QR is missing pairing response fields');
      }
      const signed = decodeSignedChallenge(parsed.responsePubkey, parsed.responseSignatureB64);
      if (!verifySignedChallenge(challenge, signed)) {
        throw new Error('joiner signature did not verify');
      }
      const ctx = await buildPairingContext(activeAccount!, activeAccountIndex);
      const newSigner = accountSignerFromSigned(signed);
      await runAdminTx(activeAccount!, ctx, newSigner, updateAccountDevices);
      setStage({ kind: 'done' });
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Box height={56} flexDirection="row" alignItems="center" paddingHorizontal="m">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold" flex={1} textAlign="center" mr="xl">
          Pairing QR
        </Text>
      </Box>

      {stage.kind === 'showQR' && payload && (
        <Box flex={1} justifyContent="center" alignItems="center" paddingHorizontal="l">
          <Box backgroundColor="mainBackground" padding="m" borderRadius={16} mb="l">
            <QRCode value={payload} size={240} color={theme.colors.textPrimary} backgroundColor={theme.colors.mainBackground} />
          </Box>
          <Text variant="p7" color="textSecondary" textAlign="center" lineHeight={22} mb="l">
            Scan this QR with the other device. After it shows you a response QR, tap below to read it.
          </Text>
          <TouchableOpacity
            onPress={async () => {
              if (!permission?.granted) {
                const res = await requestPermission();
                if (!res.granted) return;
              }
              setStage({ kind: 'scanReply' });
            }}
            style={[styles.cta, { backgroundColor: theme.colors.textPrimary }]}
          >
            <Text variant="p6" fontFamily="SFproSemibold" style={{ color: theme.colors.mainBackground }}>
              Scan response
            </Text>
          </TouchableOpacity>
        </Box>
      )}

      {stage.kind === 'scanReply' && (
        <Box flex={1} backgroundColor="black">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(e) => handleScannedReply(e.data)}
          />
          <Box position="absolute" bottom={insets.bottom + 32} left={0} right={0} alignItems="center">
            <Text variant="p7" style={{ color: 'white' }} textAlign="center">
              Point the camera at the response QR
            </Text>
          </Box>
        </Box>
      )}

      {stage.kind === 'submitting' && (
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator color={theme.colors.textPrimary} />
          <Text variant="p7" color="textSecondary" mt="m">
            Adding device on-chain…
          </Text>
        </Box>
      )}

      {stage.kind === 'done' && (
        <Box flex={1} justifyContent="center" alignItems="center">
          <Ionicons name="checkmark-circle" size={48} color={theme.colors.textPrimary} />
          <Text variant="h11" color="textPrimary" mt="m" fontFamily="SFproSemibold">
            Device paired
          </Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={[styles.cta, { marginTop: 24 }]}>
            <Text variant="p6" color="textPrimary" fontFamily="SFproSemibold">
              Done
            </Text>
          </TouchableOpacity>
        </Box>
      )}

      {stage.kind === 'error' && (
        <Box flex={1} justifyContent="center" alignItems="center" paddingHorizontal="l">
          <Ionicons name="alert-circle" size={40} color={theme.colors.inputError} />
          <Text variant="p7" color="textPrimary" mt="m" textAlign="center">
            {stage.message}
          </Text>
          <TouchableOpacity onPress={() => setStage({ kind: 'showQR' })} style={[styles.cta, { marginTop: 24 }]}>
            <Text variant="p6" color="textPrimary">
              Try again
            </Text>
          </TouchableOpacity>
        </Box>
      )}
    </Box>
  );
}

function accountSignerFromSigned(signed: SignedPairingChallenge): AccountSigner {
  switch (signed.kind) {
    case 'ed25519':
      return { kind: 'ed25519', publicKeyHex: signed.publicKeyHex };
    case 'webauthn':
      return { kind: 'webauthn', keyDataHex: signed.keyDataHex };
    case 'delegated':
      return { kind: 'delegated', address: signed.address };
  }
}

async function runAdminTx(
  activeAccount: NonNullable<ReturnType<typeof useWalletStore.getState>['accounts']>[number],
  ctx: Awaited<ReturnType<typeof buildPairingContext>>,
  newSigner: AccountSigner,
  updateAccountDevices: ReturnType<typeof useWalletStore.getState>['updateAccountDevices'],
) {
  const rpcUrl = STELLAR_RPC_URL;
  const networkPassphrase = STELLAR_NETWORK_PASSPHRASE;
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  const bundlerSecret = STELLAR_BUNDLER_SECRET;
  if (!factoryAddress || !bundlerSecret) {
    throw new Error('Factory/bundler secret is not configured for the active network');
  }

  const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
  if (!mnemonic) throw new Error('Passkey-initiator pairing not yet supported (P2.6 TODO)');
  const wallet = restoreStellarWallet(mnemonic);

  const existingSigners = [ctx.localSigner];
  const adminRuleInstalled = (activeAccount.adminRuleId ?? null) !== null;

  // Read the Default rule id from chain rather than assuming it: the admin
  // rule installed on the first pairing occupies its own id, so a hardcoded
  // value would add the new signer to the wrong rule.
  const defaultRule = await fetchDefaultContextRule(
    { rpcUrl, networkPassphrase, factoryAddress },
    activeAccount.smartAccountAddress!,
  );

  const result = await completePairing(
    { rpcUrl, networkPassphrase, factoryAddress, bundlerSecret },
    wallet.keypair,
    {
      smartAccountAddress: activeAccount.smartAccountAddress!,
      defaultRuleId: defaultRule.ruleId,
      existingSigners,
      newSigner,
      adminRuleInstalled,
    },
  );

  const newDevice = deviceFromPairingResponse(
    newSigner,
    `Paired ${new Date().toLocaleDateString()}`,
    result.newSignerOnChainId ?? null,
  );

  const existingDevices = activeAccount.devices ?? [];
  const localDevice = existingDevices.find((d) => d.isLocal);
  const devices = localDevice
    ? [localDevice, ...existingDevices.filter((d) => !d.isLocal), newDevice]
    : [...existingDevices, newDevice];
  await updateAccountDevices(
    activeAccount.index,
    devices,
    result.newAdminRuleId ?? activeAccount.adminRuleId ?? null,
  );
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  cta: { paddingVertical: 16, paddingHorizontal: 32, borderRadius: 32, alignItems: 'center' },
});
