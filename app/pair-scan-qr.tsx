/**
 * pair-scan-qr.tsx — joiner side of the QR (P2P) pairing flow.
 *
 * Scan the initiator's QR (`{accountAddress, initiatorPubkey, challenge}`),
 * sign the challenge locally, and show a return QR carrying the
 * `{responsePubkey, responseSignatureB64}` pair the initiator scans.
 */

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  decodeChallengeB64,
  encodeSignedChallenge,
  signChallengeEd25519,
  signChallengePasskey,
} from '@/src/lib/pairing-payload';
import { restoreStellarWallet } from '@/src/lib/seed-wallet';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Stage =
  | { kind: 'scan' }
  | { kind: 'signing' }
  | { kind: 'showReply'; payload: string }
  | { kind: 'error'; message: string };

const RP_ID = process.env.EXPO_PUBLIC_PASSKEY_RP_ID || 'https://latch.finance';

export default function PairScanQR() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>({ kind: 'scan' });
  const { accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];

  const handleScan = async (data: string) => {
    if (stage.kind !== 'scan') return;
    setStage({ kind: 'signing' });
    try {
      const parsed = JSON.parse(data) as {
        v?: number;
        kind?: string;
        accountAddress?: string;
        initiatorPubkey?: string;
        challenge?: string;
      };
      if (parsed.kind !== 'latch-pair-init' || !parsed.challenge) {
        throw new Error('not a Latch pairing QR');
      }
      const challenge = decodeChallengeB64(parsed.challenge);

      const signed = activeAccount?.gAddress
        ? await signWithMnemonic(challenge)
        : await signWithLocalPasskey(activeAccount, challenge);

      const { responsePubkey, responseSignatureB64 } = encodeSignedChallenge(signed);
      const reply = JSON.stringify({ responsePubkey, responseSignatureB64 });
      setStage({ kind: 'showReply', payload: reply });
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!permission) {
    return (
      <Box flex={1} backgroundColor="mainBackground" justifyContent="center" alignItems="center">
        <ActivityIndicator color={theme.colors.textPrimary} />
      </Box>
    );
  }
  if (!permission.granted && stage.kind === 'scan') {
    return (
      <Box
        flex={1}
        backgroundColor="mainBackground"
        justifyContent="center"
        alignItems="center"
        paddingHorizontal="l"
      >
        <Text variant="p7" color="textPrimary" textAlign="center" mb="l">
          Camera access is required to scan a pairing QR.
        </Text>
        <TouchableOpacity
          onPress={() => requestPermission()}
          style={[styles.cta, { backgroundColor: theme.colors.textPrimary }]}
        >
          <Text
            variant="p6"
            fontFamily="SFproSemibold"
            style={{ color: theme.colors.mainBackground }}
          >
            Allow camera
          </Text>
        </TouchableOpacity>
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Box height={56} flexDirection="row" alignItems="center" paddingHorizontal="m">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text
          variant="h10"
          color="textPrimary"
          fontFamily="SFproSemibold"
          flex={1}
          textAlign="center"
          mr="xl"
        >
          Scan pairing QR
        </Text>
      </Box>

      {stage.kind === 'scan' && (
        <Box flex={1} backgroundColor="black">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(e) => handleScan(e.data)}
          />
        </Box>
      )}

      {stage.kind === 'signing' && (
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator color={theme.colors.textPrimary} />
          <Text variant="p7" color="textSecondary" mt="m">
            Signing pairing challenge…
          </Text>
        </Box>
      )}

      {stage.kind === 'showReply' && (
        <Box flex={1} justifyContent="center" alignItems="center" paddingHorizontal="l">
          <Box backgroundColor="mainBackground" padding="m" borderRadius={16} mb="l">
            <QRCode
              value={stage.payload}
              size={240}
              color={theme.colors.textPrimary}
              backgroundColor={theme.colors.mainBackground}
            />
          </Box>
          <Text variant="p7" color="textSecondary" textAlign="center" lineHeight={22}>
            Show this QR to the other device to finish pairing. You can close this screen once it
            confirms.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)')}
            style={[styles.cta, { marginTop: 24 }]}
          >
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
          <TouchableOpacity
            onPress={() => setStage({ kind: 'scan' })}
            style={[styles.cta, { marginTop: 24 }]}
          >
            <Text variant="p6" color="textPrimary">
              Try again
            </Text>
          </TouchableOpacity>
        </Box>
      )}
    </Box>
  );
}

async function signWithMnemonic(challenge: Uint8Array) {
  const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
  if (!mnemonic) throw new Error('mnemonic not found in SecureStore');
  const wallet = restoreStellarWallet(mnemonic);
  return signChallengeEd25519(challenge, wallet.keypair);
}

async function signWithLocalPasskey(
  account: ReturnType<typeof useWalletStore.getState>['accounts'][number] | undefined,
  challenge: Uint8Array,
) {
  if (!account?.publicKeyHex) throw new Error('passkey account is missing public key material');
  return signChallengePasskey(challenge, account.publicKeyHex, RP_ID);
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  cta: { paddingVertical: 16, paddingHorizontal: 32, borderRadius: 32, alignItems: 'center' },
});
