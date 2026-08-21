/**
 * Recover an account with guardians, from a device that has never seen it.
 *
 * This is the screen social recovery exists for. Everything else in the feature
 * runs inside an unlocked wallet — but the person recovering has lost exactly
 * that, so this path starts from a fresh install with nothing but the account
 * address, which a guardian can tell them.
 *
 * What happens here:
 *
 *   1. A new key is generated on this device. Recovery does not retrieve the
 *      old one — nothing can, it was on the lost phone. It puts a NEW key on
 *      the account, which is why the old device losing access is survivable.
 *   2. Its address goes to the guardians, who propose the change and, after the
 *      account's waiting period, complete it.
 *   3. This screen watches the account until that key appears on a rule that can
 *      spend, then registers the account locally.
 *
 * Nothing here signs or submits anything on chain: this device has no authority
 * over the account until the guardians give it some. It generates a key, shows
 * an address, and waits.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StrKey } from '@stellar/stellar-sdk';
import { useTheme } from '@shopify/restyle';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Header from '@/src/components/shared/Header';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { getNetworkId } from '@/src/constants/config';
import {
  generateStellarWallet,
  restoreStellarWallet,
  type StellarWallet,
} from '@/src/lib/seed-wallet';
import { checkRecoveryProgress, humanLedgers, pendingPhase } from '@/src/services/social-recovery';
import { SECURE_KEYS, useWalletStore, type WalletAccount } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { encodeStartRecovery } from '@/src/services/guardian-invite';
import { shareOrCopy } from '@/src/utils/share-or-copy';

/**
 * How often to re-read the account. Recovery completes on a human timescale —
 * hours or days — so this only has to be fast enough to feel live while the
 * screen is open, not fast enough to catch the ledger it lands in.
 */
const POLL_INTERVAL_MS = 15_000;

type Step = 'account' | 'waiting' | 'done';

export default function RecoverWithGuardians() {
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { appendAccount, setActiveWallet } = useWalletStore();

  const [step, setStep] = useState<Step>('account');
  const [accountInput, setAccountInput] = useState('');
  const [account, setAccount] = useState('');
  const [wallet, setWallet] = useState<StellarWallet | null>(null);
  const [status, setStatus] = useState<string>('Waiting for your guardians…');
  const [busy, setBusy] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The new key is generated once, when the screen opens. Regenerating it after
  // the address has been sent to guardians would silently invalidate whatever
  // they are in the middle of approving.
  /** Put the recovered account on this device and go to the wallet. */
  const finish = useCallback(
    async (recovered: StellarWallet, smartAccountAddress: string) => {
      await SecureStore.setItemAsync(SECURE_KEYS.MNEMONIC, recovered.mnemonic);

      const entry: WalletAccount = {
        index: 0,
        name: 'Recovered Account',
        gAddress: recovered.gAddress,
        publicKeyHex: recovered.publicKeyHex,
        smartAccountAddress,
        network: getNetworkId(),
        image: null,
      };
      await appendAccount(entry, true);
      await SecureStore.deleteItemAsync(SECURE_KEYS.GUARDIAN_RECOVERY_SESSION);
      setActiveWallet(recovered);
      await AsyncStorage.setItem('latch_onboarding_complete', 'true');

      setStep('done');
      // Straight into the PIN/biometric setup the other onboarding paths use,
      // so a recovered wallet is protected the same as a fresh one.
      router.replace({ pathname: '/(auth)/biometric', params: { from: 'recover-guardians' } });
    },
    [appendAccount, setActiveWallet, router],
  );

  useEffect(() => {
    if (step !== 'waiting' || !wallet || !account) return;

    let stopped = false;

    const tick = async () => {
      try {
        const progress = await checkRecoveryProgress(account, wallet.publicKeyHex);

        if (progress.keyInstalled) {
          await finish(wallet, account);
          return;
        }

        if (progress.pending) {
          const phase = pendingPhase(progress.pending, progress.currentLedger);
          setStatus(
            phase === 'veto'
              ? `Your guardians have started the recovery. It can be completed in about ${humanLedgers(
                  progress.pending.readyAt - progress.currentLedger,
                )}.`
              : phase === 'enforceable'
                ? 'The waiting period is over. Ask your guardians to complete the recovery.'
                : 'The last request ran out of time. Ask your guardians to start it again.',
          );
        } else {
          setStatus('Waiting for your guardians to start the recovery.');
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Could not read that account.');
      }

      if (!stopped) timer.current = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [step, wallet, account, finish]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await SecureStore.getItemAsync(SECURE_KEYS.GUARDIAN_RECOVERY_SESSION);
      if (cancelled) return;

      if (raw) {
        const saved = JSON.parse(raw) as { mnemonic: string; account?: string };
        setWallet(restoreStellarWallet(saved.mnemonic));
        if (saved.account) {
          setAccount(saved.account);
          setAccountInput(saved.account);
          setStep('waiting');
        }
        return;
      }

      const fresh = generateStellarWallet();
      await SecureStore.setItemAsync(
        SECURE_KEYS.GUARDIAN_RECOVERY_SESSION,
        JSON.stringify({ mnemonic: fresh.mnemonic }),
      );
      if (!cancelled) setWallet(fresh);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const begin = async () => {
    const address = accountInput.trim();
    if (!StrKey.isValidContract(address)) {
      Toast.show({
        type: 'error',
        text1: 'That is not an account address',
        text2: 'Ask a guardian for it — it starts with C.',
      });
      return;
    }
    if (!wallet) return;

    setBusy(true);
    try {
      // One read before committing to the waiting screen, so a wrong address or
      // wrong network is caught here rather than looking like silence.
      await checkRecoveryProgress(address, wallet.publicKeyHex);
      await SecureStore.setItemAsync(
        SECURE_KEYS.GUARDIAN_RECOVERY_SESSION,
        JSON.stringify({ mnemonic: wallet.mnemonic, account: address }),
      );
      setAccount(address);
      setStep('waiting');
      // Continue used to only save state and switch screens — sending the
      // request was a SEPARATE button above this one. Someone who just fills
      // in the address and taps the obvious primary action never sent
      // anything, and the waiting screen gave no sign that nothing had gone
      // out: it just looks like waiting, indistinguishable from working.
      // Firing the share here, once, on the actual address rather than
      // whatever `account` state has settled to, closes that gap.
      await shareMyAddress(address);
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not find that account',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Abandon the in-progress attempt and start clean.
   *
   * Without this, the saved session (SECURE_KEYS.GUARDIAN_RECOVERY_SESSION)
   * had exactly one way out: a successful recovery. It survives closing the
   * app, and it survived logout too — clearAll() never deleted it — so
   * whoever hit this screen again always resumed the SAME account and key,
   * with no way to reach the 'account' step and try a different one. A fresh
   * key on cancel, not just a fresh account slot: reusing the old one across
   * two different recovery attempts is exactly the kind of "which key is
   * this, actually" confusion that costs someone their new device.
   */
  const startOver = () => {
    Alert.alert(
      'Cancel this recovery?',
      account
        ? 'This abandons the request for that account. If a guardian already started it, their approval still goes through if they complete it — this device just stops waiting on it.'
        : 'This generates a new device key. Use this if you want to recover a different account.',
      [
        { text: 'Keep waiting', style: 'cancel' },
        {
          text: 'Start over',
          style: 'destructive',
          onPress: async () => {
            // This device's key may already have been installed on chain — by a
            // guardian who finished between the last poll and this tap, or by a
            // duplicate request nobody realised had already gone through.
            // Wiping it here would be silent, permanent, and unrecoverable: it
            // was generated only for this attempt and backed up nowhere else.
            // One more read confirms which case this actually is.
            if (wallet && account) {
              try {
                const progress = await checkRecoveryProgress(account, wallet.publicKeyHex);
                if (progress.keyInstalled) {
                  await finish(wallet, account);
                  return;
                }
              } catch {
                // Unreadable — fall through to the normal abandon-and-reset path
                // rather than blocking on a network blip.
              }
            }

            const fresh = generateStellarWallet();
            await SecureStore.setItemAsync(
              SECURE_KEYS.GUARDIAN_RECOVERY_SESSION,
              JSON.stringify({ mnemonic: fresh.mnemonic }),
            );
            setWallet(fresh);
            setAccount('');
            setAccountInput('');
            setStatus('Waiting for your guardians…');
            setStep('account');
          },
        },
      ],
    );
  };

  const shareMyAddress = async (targetOverride?: string) => {
    if (!wallet) return;
    const target = (targetOverride ?? (account || accountInput)).trim();

    if (!StrKey.isValidContract(target)) {
      await shareOrCopy({
        title: 'My new device',
        message:
          'I am recovering my Latch wallet on a new device. Please add this address as the new device:',
        payload: wallet.gAddress,
      });
      return;
    }

    await shareOrCopy({
      title: 'Recovery request',
      message:
        'I have lost my device and am recovering my Latch wallet. Tap to start the recovery for me:',
      payload: encodeStartRecovery({ account: target, newDeviceAddress: wallet.gAddress }),
      asLink: true,
    });
  };

  return (
    <Box flex={1} backgroundColor="onboardingbg">
      <LinearGradient
        colors={['rgba(50, 60, 14, 0.74)', '#121212']}
        locations={[0, 0.2772]}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />

      <Box style={{ paddingTop: insets.top }}>
        <Header onBackPress={() => router.back()} />
        <Text variant="h10" color="textPrimary" fontWeight="700" px="m" mb="m">
          Recover with guardians
        </Text>
      </Box>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'account' ? (
          <>
            <Text variant="p6" color="textSecondary" mb="m">
              Your guardians can put this device on your account. They cannot
              recover your old key — nothing can — so this device gets a new one.
            </Text>

            <Text variant="p7" color="textPrimary" fontWeight="700" mb="xs">
              Your account address
            </Text>
            <Text variant="p8" color="textSecondary" mb="m">
              A guardian can tell you this. It starts with C.
            </Text>
            <Box mb="l">
              <Input
                placeholder="C…"
                autoCapitalize="characters"
                autoCorrect={false}
                value={accountInput}
                onChangeText={setAccountInput}
              />
            </Box>

            <Box borderRadius={12} p="m" mb="l" style={{ backgroundColor: theme.colors.cardbg }}>
              <Text variant="p8" color="textSecondary" mb="xs">
                This device&apos;s new address
              </Text>
              <Text variant="p7" color="textPrimary" mb="m" numberOfLines={2}>
                {wallet?.gAddress ?? 'Generating…'}
              </Text>
              <Button
                label="Send recovery request"
                variant="outline"
                disabled={!wallet}
                onPress={() => shareMyAddress()}
              />
              <Text variant="p8" color="textSecondary" mt="m">
                Sends your guardians a link that opens straight to the request,
                with both addresses filled in. Nothing happens until one of them
                starts it.
              </Text>
            </Box>

            <Button
              label="Continue"
              loading={busy}
              disabled={busy || !wallet}
              onPress={begin}
            />
          </>
        ) : (
          <Box alignItems="center" pt="xl">
            <ActivityIndicator color={theme.colors.textPrimary} />
            <Text variant="p6" color="textPrimary" fontWeight="700" mt="l" mb="s">
              Waiting for your guardians
            </Text>
            <Text variant="p7" color="textSecondary" textAlign="center" mb="l">
              {status}
            </Text>
            <Text variant="p8" color="textSecondary" textAlign="center" mb="l">
              You can close the app — this keeps working. Come back and open this
              screen again to check.
            </Text>
            <Text variant="p8" color="textSecondary" textAlign="center">
              Recovering {account.slice(0, 8)}…{account.slice(-6)}
            </Text>
            <Box mt="xl" width="100%" gap="s">
              <Button
                label="Send the request again"
                variant="outline"
                onPress={() => shareMyAddress()}
              />
              <Button label="Cancel and start over" variant="ghost" onPress={startOver} />
            </Box>
          </Box>
        )}
      </ScrollView>
    </Box>
  );
}
