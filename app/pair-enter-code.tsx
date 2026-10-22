/**
 * pair-enter-code.tsx — joiner side of the link-code pairing flow.
 *
 * Flow:
 *   1. User types the 6-digit code shown by the initiator device.
 *   2. GET /v1/pair-codes/{code} → read initiator pubkey + challenge.
 *   3. Sign challenge with the local device's key.
 *   4. POST /v1/pair-codes/{code}/response.
 *   5. Show "waiting for the other device to confirm" — the on-chain
 *      add_signer tx is the initiator's responsibility.
 */

import { ApiError } from '@/src/api/api-error';
import { getPairCodeMeta, submitPairCodeResponse } from '@/src/api/pair-code';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { PASSKEY_RP_ID } from '@/src/constants/config';
import { fetchAnyAccessToken } from '@/src/lib/pairing-context';
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
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Stage =
  | { kind: 'input' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export default function PairEnterCode() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];

  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'input' });

  const submit = async () => {
    if (code.length !== 6 || !activeAccount) return;
    setStage({ kind: 'submitting' });
    try {
      const token = await fetchAnyAccessToken();
      if (!token) throw new Error('Not signed in');
      const meta = await getPairCodeMeta(token, code);
      const challenge = decodeChallengeB64(meta.challengeB64);

      // Sign the challenge with whichever key kind matches this account.
      const signed =
        activeAccount.publicKeyHex && activeAccount.gAddress
          ? await signWithMnemonic(challenge)
          : await signWithLocalPasskey(activeAccount, activeAccountIndex, challenge);

      const { responsePubkey, responseSignatureB64 } = encodeSignedChallenge(signed);
      await submitPairCodeResponse(token, code, responsePubkey, responseSignatureB64);

      setStage({ kind: 'success' });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setStage({ kind: 'error', message: msg });
    }
  };

  return (
    <Box flex={1} backgroundColor="onboardingbg" style={{ paddingTop: insets.top }}>
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
          Enter pairing code
        </Text>
      </Box>

      <Box flex={1} justifyContent="center" paddingHorizontal="l">
        {stage.kind === 'input' && (
          <>
            <Text variant="p7" color="textSecondary" mb="l" lineHeight={22}>
              Type the 6-digit code shown on your other device. Codes expire after 10 minutes.
            </Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              placeholder="000000"
              placeholderTextColor={theme.colors.textSecondary}
              style={[
                styles.input,
                {
                  color: theme.colors.textPrimary,
                  backgroundColor: theme.colors.bg11,
                  borderColor: theme.colors.bg11,
                },
              ]}
            />
            <TouchableOpacity
              onPress={submit}
              disabled={code.length !== 6}
              style={[
                styles.cta,
                {
                  backgroundColor: code.length === 6 ? theme.colors.textPrimary : theme.colors.bg11,
                },
              ]}
            >
              <Text
                variant="p6"
                fontFamily="SFproSemibold"
                style={{
                  color:
                    code.length === 6 ? theme.colors.mainBackground : theme.colors.textSecondary,
                }}
              >
                Continue
              </Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'submitting' && (
          <Box alignItems="center">
            <ActivityIndicator color={theme.colors.textPrimary} />
            <Text variant="p7" color="textSecondary" mt="m">
              Signing pairing challenge…
            </Text>
          </Box>
        )}

        {stage.kind === 'success' && (
          <Box alignItems="center">
            <Ionicons name="checkmark-circle" size={48} color={theme.colors.textPrimary} />
            <Text
              variant="h11"
              color="textPrimary"
              mt="m"
              fontFamily="SFproSemibold"
              textAlign="center"
            >
              Sent. Confirm on the other device.
            </Text>
            <Text variant="p7" color="textSecondary" mt="s" textAlign="center" lineHeight={22}>
              The other device will finish the pairing on-chain. You can close this screen.
            </Text>
            <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.cta}>
              <Text variant="p6" color="textPrimary" fontFamily="SFproSemibold">
                Done
              </Text>
            </TouchableOpacity>
          </Box>
        )}

        {stage.kind === 'error' && (
          <Box alignItems="center">
            <Ionicons name="alert-circle" size={40} color={theme.colors.inputError} />
            <Text variant="p7" color="textPrimary" mt="m" textAlign="center">
              {stage.message}
            </Text>
            <TouchableOpacity onPress={() => setStage({ kind: 'input' })} style={styles.cta}>
              <Text variant="p6" color="textPrimary">
                Try again
              </Text>
            </TouchableOpacity>
          </Box>
        )}
      </Box>
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
  account: ReturnType<typeof useWalletStore.getState>['accounts'][number],
  _activeAccountIndex: number,
  challenge: Uint8Array,
) {
  // For passkey accounts we need the key_data hex that maps to the on-chain
  // signer. The wallet store mirrors this in account.publicKeyHex for
  // passkey accounts (see addPasskeyAccount in store/wallet.ts).
  if (!account.publicKeyHex) {
    throw new Error('passkey account is missing public key material');
  }
  return signChallengePasskey(challenge, account.publicKeyHex, PASSKEY_RP_ID);
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  input: {
    fontSize: 36,
    letterSpacing: 8,
    textAlign: 'center',
    fontFamily: 'SFproSemibold',
    paddingVertical: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  cta: {
    paddingVertical: 16,
    borderRadius: 32,
    alignItems: 'center',
    marginTop: 24,
  },
});
