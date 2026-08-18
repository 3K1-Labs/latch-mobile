/**
 * pair-show-code.tsx — initiator side of the link-code pairing flow.
 *
 * On mount:
 *   1. Resolve the pairing context (auth token + local signer).
 *   2. POST /v1/pair-codes → get a 6-digit code + base64 challenge.
 *   3. Display the code; poll /response every 2s for the joiner's reply.
 *   4. On reply: verify the signature locally, then hand off to the
 *      admin-tx orchestrator to add the new device on-chain.
 *   5. Persist the resulting Device + adminRuleId to the wallet store.
 */

import { createPairCode, pollPairCodeResponse } from '@/src/api/pair-code';
import { ApiError } from '@/src/api/api-error';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { fetchDefaultContextRule } from '@/src/api/account-admin';
import { completePairing } from '@/src/lib/admin-tx';
import {
  buildPairingContext,
  deviceFromPairingResponse,
} from '@/src/lib/pairing-context';
import {
  decodeChallengeB64,
  decodeSignedChallenge,
  verifySignedChallenge,
} from '@/src/lib/pairing-payload';
import { restoreStellarWallet } from '@/src/lib/seed-wallet';
import { AccountSigner } from '@/src/lib/account-signers';
import {
  STELLAR_BUNDLER_SECRET,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';

type Stage =
  | { kind: 'loading' }
  | { kind: 'awaiting'; code: string; challengeB64: string }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export default function PairShowCode() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, updateAccountDevices } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];

  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Stage 1: ask backend for a pair code ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!activeAccount) throw new Error('no active account');
        const ctx = await buildPairingContext(activeAccount, activeAccountIndex);
        const localPubkey =
          ctx.localSigner.kind === 'ed25519'
            ? ctx.localSigner.publicKeyHex
            : ctx.localSigner.kind === 'webauthn'
              ? ctx.localSigner.keyDataHex
              : '';
        const meta = await createPairCode(ctx.accessToken, ctx.smartAccountAddress, localPubkey);
        if (cancelled) return;
        setStage({ kind: 'awaiting', code: meta.code, challengeB64: meta.challengeB64 });
      } catch (err) {
        if (cancelled) return;
        setStage({ kind: 'error', message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Stage 2: poll for joiner's response ──────────────────────────────
  useEffect(() => {
    if (stage.kind !== 'awaiting') return;
    const { code, challengeB64 } = stage;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const ctx = await buildPairingContext(activeAccount!, activeAccountIndex);
        const resp = await pollPairCodeResponse(ctx.accessToken, code);

        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (cancelled) return;
        setStage({ kind: 'submitting' });

        // Verify the joiner's signature locally before doing anything on-chain.
        const signed = decodeSignedChallenge(resp.responsePubkey, resp.responseSignatureB64);
        const challenge = decodeChallengeB64(challengeB64);
        if (!verifySignedChallenge(challenge, signed)) {
          throw new Error('joiner signature did not verify');
        }

        const newSigner = accountSignerFromSigned(signed);
        await runAdminTx(activeAccount!, activeAccountIndex, ctx, newSigner, updateAccountDevices);

        if (cancelled) return;
        setStage({ kind: 'done' });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'NOT_READY') {
          // Joiner hasn't submitted yet — keep polling.
          return;
        }
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (cancelled) return;
        setStage({ kind: 'error', message: errorMessage(err) });
      }
    };

    void tick();
    pollIntervalRef.current = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind === 'awaiting' ? stage.code : null]);

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Box height={56} flexDirection="row" alignItems="center" paddingHorizontal="m">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold" flex={1} textAlign="center" mr="xl">
          Pairing code
        </Text>
      </Box>

      <Box flex={1} justifyContent="center" alignItems="center" paddingHorizontal="l">
        {stage.kind === 'loading' && <ActivityIndicator color={theme.colors.textPrimary} />}

        {stage.kind === 'awaiting' && (
          <>
            <Text variant="h8" color="textPrimary" fontFamily="SFproSemibold" mb="m">
              {formatCode(stage.code)}
            </Text>
            <Box backgroundColor="mainBackground" padding="m" borderRadius={16} mb="m">
              <QRCode
                value={JSON.stringify({ code: stage.code, challenge: stage.challengeB64 })}
                size={180}
                backgroundColor={theme.colors.mainBackground}
                color={theme.colors.textPrimary}
              />
            </Box>
            <Text variant="p7" color="textSecondary" textAlign="center" lineHeight={22}>
              On the other device, choose &ldquo;Enter a pairing code&rdquo; and type the digits above. The QR is a shortcut for the same code.
            </Text>
            <Box mt="m" flexDirection="row" alignItems="center">
              <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              <Text variant="p7" color="textSecondary" ml="s">
                Waiting for response…
              </Text>
            </Box>
          </>
        )}

        {stage.kind === 'submitting' && (
          <>
            <ActivityIndicator color={theme.colors.textPrimary} />
            <Text variant="p7" color="textSecondary" mt="m">
              Adding device on-chain…
            </Text>
          </>
        )}

        {stage.kind === 'done' && (
          <>
            <Ionicons name="checkmark-circle" size={48} color={theme.colors.textPrimary} />
            <Text variant="h11" color="textPrimary" mt="m" fontFamily="SFproSemibold">
              Device paired
            </Text>
            <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.cta}>
              <Text variant="p6" color="textPrimary" fontFamily="SFproSemibold">
                Done
              </Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'error' && (
          <>
            <Ionicons name="alert-circle" size={40} color={theme.colors.inputError} />
            <Text variant="p7" color="textPrimary" mt="m" textAlign="center">
              {stage.message}
            </Text>
            <TouchableOpacity onPress={() => router.back()} style={styles.cta}>
              <Text variant="p6" color="textPrimary">
                Back
              </Text>
            </TouchableOpacity>
          </>
        )}
      </Box>
    </Box>
  );
}

function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function accountSignerFromSigned(
  signed: ReturnType<typeof decodeSignedChallenge>,
): AccountSigner {
  switch (signed.kind) {
    case 'ed25519':
      return { kind: 'ed25519', publicKeyHex: signed.publicKeyHex };
    case 'webauthn':
      return { kind: 'webauthn', keyDataHex: signed.keyDataHex };
    case 'delegated':
      return { kind: 'delegated', address: signed.address };
  }
}

/**
 * Drive the on-chain pairing transaction and persist the resulting device
 * to the wallet store. Extracted from the component to keep the render
 * function focused on UX.
 */
async function runAdminTx(
  activeAccount: NonNullable<ReturnType<typeof useWalletStore.getState>['accounts']>[number],
  activeAccountIndex: number,
  ctx: Awaited<ReturnType<typeof buildPairingContext>>,
  newSigner: AccountSigner,
  updateAccountDevices: ReturnType<typeof useWalletStore.getState>['updateAccountDevices'],
): Promise<void> {
  const rpcUrl = STELLAR_RPC_URL;
  const networkPassphrase = STELLAR_NETWORK_PASSPHRASE;
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  const bundlerSecret = STELLAR_BUNDLER_SECRET;
  if (!factoryAddress || !bundlerSecret) {
    throw new Error('Factory/bundler secret is not configured for the active network');
  }

  // Need a Keypair for the initiator (mnemonic users only). Passkey
  // initiators land here too but their signing path is different — admin
  // tx orchestration for passkey initiators is TODO and falls through to
  // an error here intentionally rather than silently producing a broken tx.
  const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
  if (!mnemonic) {
    throw new Error('Passkey-initiator pairing not yet supported (P2.6 TODO)');
  }
  const wallet = restoreStellarWallet(mnemonic);

  // Existing signers: just the local one until we extend Device to carry
  // its full AccountSigner shape (TODO when 3rd-device pairing lands).
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
    {
      rpcUrl,
      networkPassphrase,
      factoryAddress,
      bundlerSecret,
    },
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
  const localDevice = existingDevices.find((d) => d.isLocal) ?? {
    signerKey:
      ctx.localSigner.kind === 'ed25519'
        ? `ed25519:${ctx.localSigner.publicKeyHex}`
        : ctx.localSigner.kind === 'webauthn'
          ? `webauthn:${ctx.localSigner.keyDataHex}`
          : '',
    label: ctx.localDeviceLabel,
    kind: ctx.localSigner.kind,
    keyDataHex:
      ctx.localSigner.kind === 'ed25519'
        ? ctx.localSigner.publicKeyHex
        : ctx.localSigner.kind === 'webauthn'
          ? ctx.localSigner.keyDataHex
          : '',
    onChainSignerId: null,
    isLocal: true,
    pairedAt: new Date().toISOString(),
  };

  const devices = [localDevice, ...existingDevices.filter((d) => !d.isLocal), newDevice];
  await updateAccountDevices(
    activeAccount.index,
    devices,
    result.newAdminRuleId ?? activeAccount.adminRuleId ?? null,
  );
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  cta: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 24 },
});
