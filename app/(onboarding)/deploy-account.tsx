/**
 * DeployAccount — deploys the user's passkey-backed Soroban smart account.
 *
 * Primary path (passkey): credentials were created on the biometric screen;
 * this screen retrieves them from SecureStore and deploys via the factory contract.
 *
 * Legacy path (import-phrase): mnemonic was saved to SecureStore by set-pin.tsx;
 * this screen reads it from there — no route params needed.
 */

import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { logout, uploadBackup } from '@/src/api/latch-auth';
import { deploySmartAccount as deploySmartAccountPasskey } from '@/src/api/passkey';
import { deploySmartAccount as deploySmartAccountEd25519 } from '@/src/api/smart-account';
import { discoverMigration } from '@/src/lib/migration';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import DeployTimeline, { type DeployStep, type StepStatus } from '@/src/components/deploy/DeployTimeline';
import { createPasskeyCredential, storePasskeyCredential } from '@/src/lib/passkey-webauthn';
import { restoreStellarWallet } from '@/src/lib/seed-wallet';
import { ASYNC_KEYS, SECURE_KEYS, useWalletStore, type WalletAccount } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Stage =
  | 'auth' // verifying credentials / passkey gate
  | 'deploying' // waiting on Soroban RPC
  | 'success' // all done
  | 'error'; // deployment failed

/**
 * Attempt biometric authentication. Returns true if successful, false if unavailable or declined.
 * Never throws — PIN (already verified at unlock) is the fallback.
 */
async function tryBiometricAuth(promptMessage: string): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (!hasHardware || !isEnrolled) {
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    disableDeviceFallback: false,
    cancelLabel: 'Use PIN',
  });

  return result.success;
}

/**
 * Return passkey credentials from SecureStore.
 * Credentials are created on the biometric setup screen, so by the time we reach
 * this screen they should always exist.
 * If for some reason they are missing (e.g. direct deep-link or retry after wipe),
 * we re-create them with the appropriate auth gate for this device:
 *   - Biometric devices  → require Face ID / Touch ID before re-creating
 *   - PIN-only devices   → no extra prompt (device passcode is the boundary;
 *                          the user's app PIN was already verified at unlock)
 * keyDataHex = uncompressed P-256 pubkey (65 bytes, 130 hex) + credentialId (16 bytes, 32 hex)
 */
async function getOrCreatePasskeyCredentials(): Promise<{
  credentialId: string;
  keyDataHex: string;
}> {
  const existingCredId = await SecureStore.getItemAsync(SECURE_KEYS.CREDENTIAL_ID);
  const existingKeyData = await SecureStore.getItemAsync(SECURE_KEYS.KEY_DATA_HEX);

  if (existingCredId && existingKeyData) {
    return { credentialId: existingCredId, keyDataHex: existingKeyData };
  }

  // Credentials missing — re-create, preferring biometrics if the device supports them.
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const useBiometric = hasHardware && isEnrolled;

  if (useBiometric) {
    await tryBiometricAuth('Authenticate to create your secure passkey');
  }

  const credential = createPasskeyCredential();
  await storePasskeyCredential(credential, useBiometric);

  return { credentialId: credential.credentialId, keyDataHex: credential.keyDataHex };
}

const DeployAccount = () => {
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `flow === 'shared'` means this is a multisig onboarding: deploy the creator's
  // personal account here, then continue into the shared-wallet build screens
  // (create-shared) rather than landing on the dashboard.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const { setActiveWallet, setSmartAccountAddress, accounts } = useWalletStore();

  const [stage, setStage] = useState<Stage>('auth');
  const [errorMsg, setErrorMsg] = useState('');
  //  const [smartAccountAddress, setLocalSmartAccount] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [isMnemonicPath, setIsMnemonicPath] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Track the last in-progress stage so an error can point the timeline at the
  // step that actually failed (auth vs deploying). UI-only — does not touch the
  // deploy flow in the effect below.
  const lastActiveRef = useRef<Stage>('auth');
  useEffect(() => {
    if (stage === 'auth' || stage === 'deploying') lastActiveRef.current = stage;
  }, [stage]);

  // Respect the system reduced-motion setting for the active-step indicator.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  // Run deployment on mount and on each retry
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // ── Step 1: determine deploy path from SecureStore ────────────────────
        const storedMnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);

        if (cancelled) return;

        // ── Step 2: deploy smart account ──────────────────────────────────────
        let deployedAddress: string;

        if (storedMnemonic) {
          // Import-wallet path: derive Ed25519 pubkey from mnemonic and deploy.
          // No biometric auth needed — the mnemonic itself proves ownership.
          setIsMnemonicPath(true);
          setStage('deploying');
          const wallet = restoreStellarWallet(storedMnemonic);
          const result = await deploySmartAccountEd25519(wallet.publicKeyHex);
          deployedAddress = result.smartAccountAddress;
        } else {
          // New-wallet path: passkey / biometric credential created on the
          // biometric setup screen; retrieve it and deploy with WebAuthn signer.
          setStage('auth');
          const { credentialId, keyDataHex } = await getOrCreatePasskeyCredentials();
          if (cancelled) return;
          setStage('deploying');
          const result = await deploySmartAccountPasskey(credentialId, keyDataHex);
          if (result.error) throw new Error(result.error);
          deployedAddress = result.smartAccountAddress;
        }

        if (cancelled) return;

        // ── Step 2.5: clear any stale session before this wallet takes over ────
        // A previous session's tokens can still be sitting in SecureStore here
        // (e.g. iCloud Keychain persistence after reinstall — same class of
        // staleness Step 4 below already handles for wallet data). Left alone,
        // the backup upload a few lines down would silently run under a
        // previous identity's access token.
        const staleRefreshToken = await SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);
        if (staleRefreshToken) {
          await logout();
          await Promise.all([
            SecureStore.deleteItemAsync(SECURE_KEYS.ACCESS_TOKEN),
            SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN),
            SecureStore.deleteItemAsync(SECURE_KEYS.USER_EMAIL),
            SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN),
            SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN),
          ]);
        }

        if (cancelled) return;

        // ── Step 3: persist smart account address ─────────────────────────────
        await SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, deployedAddress);

        // ── Step 4: unconditionally write/overwrite account 0 and reset active index.
        // Stale SecureStore data (e.g. iCloud Keychain persistence after reinstall) can
        // leave accounts and activeAccountIndex pointing at a previous session. Always
        // anchoring to index 0 here prevents the signing key from drifting out of sync
        // with the deployed contract.
        let account0: WalletAccount;
        if (storedMnemonic) {
          const wallet = restoreStellarWallet(storedMnemonic);
          account0 = {
            index: 0,
            name: accounts[0]?.name ?? 'Account 1',
            gAddress: wallet.gAddress,
            publicKeyHex: wallet.publicKeyHex,
            smartAccountAddress: deployedAddress,
            image: accounts[0]?.image ?? null,
          };
        } else {
          account0 = {
            index: -1,
            name: accounts[0]?.name ?? 'Account 1',
            gAddress: '',
            publicKeyHex: '',
            smartAccountAddress: deployedAddress,
            image: accounts[0]?.image ?? null,
          };
        }
        // Preserve any additional accounts beyond slot 0 (edge case: re-onboarding
        // with existing multi-account data). Account 0 is always the onboarding account.
        const freshAccounts = [account0, ...accounts.slice(1)];
        await SecureStore.setItemAsync(SECURE_KEYS.ACCOUNTS, JSON.stringify(freshAccounts));
        await SecureStore.setItemAsync(SECURE_KEYS.ACTIVE_ACCOUNT_INDEX, '0');

        // ── Step 5: mark onboarding complete and hydrate store ────────────────
        await AsyncStorage.setItem('latch_onboarding_complete', 'true');
        if (storedMnemonic) {
          const wallet = restoreStellarWallet(storedMnemonic);
          setActiveWallet(wallet);
        }
        setSmartAccountAddress(deployedAddress);

        // ── Step 5: upload encrypted backup ───────────────────────────────────
        // Skip for the shared flow: uploadBackup consumes and deletes the
        // recovery-password session, and the multisig doesn't exist yet. The
        // single backup is deferred to shared-wallet-review, which runs once
        // both the personal and multisig accounts are in ACCOUNTS.
        //
        // Awaited (not fire-and-forget): the user is about to be told setup
        // succeeded, so a failed upload must be known before that happens.
        // We still let them proceed to the dashboard either way — the wallet
        // itself deployed fine — but a failure here leaves a durable flag so
        // the dashboard can prompt a retry via BackupSheet, since this screen
        // navigates away and can't show a retry action itself. See BACKUP_PENDING.
        if (flow !== 'shared') {
          try {
            await uploadBackup();
          } catch (err: any) {
            __DEV__ && console.log('[backup] upload failed:', err?.message);
            await AsyncStorage.setItem(ASYNC_KEYS.BACKUP_PENDING, 'true');
          }
        }

        if (!cancelled) {
          // Surface success — user explicitly taps "Go to Dashboard" to proceed.
          setStage('success');
          setTimeout(() => goToDashboard(deployedAddress), 1500);
        }
      } catch (err: any) {
        __DEV__ && console.log(err);
        if (!cancelled) {
          setErrorMsg(err?.message ?? 'Deployment failed. Please try again.');
          setStage('error');
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // retryCount is the only trigger that changes — all other deps are stable route params/store setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  const goToDashboard = async (address: string) => {
    // Shared-wallet onboarding: the personal account is now deployed and backed
    // up. Continue into the multisig build screens instead of the dashboard; the
    // shared wallet will be appended as a second account in shared-wallet-review.
    if (flow === 'shared') {
      router.replace('/(onboarding)/create-shared');
      return;
    }

    // Mnemonic users: check if their G-address has assets to sweep before going to dashboard.
    if (isMnemonicPath) {
      try {
        const storedMnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
        if (storedMnemonic) {
          const wallet = restoreStellarWallet(storedMnemonic);
          const account = {
            index: 0,
            name: 'Account 1',
            gAddress: wallet.gAddress,
            publicKeyHex: wallet.publicKeyHex,
            smartAccountAddress: address,
          };
          const discovery = await discoverMigration(account as WalletAccount);
          if (discovery.state === 'not_started') {
            router.replace('/(migration)');
            return;
          }
        }
      } catch {
        // If discovery fails, proceed normally — migration banner will show on home
      }
    }

    router.replace({
      pathname: '/(auth)/thank-you',
      params: {
        title: 'Your Smart Account is Ready',
        subtext: 'Start using your secure Stellar wallet today',
        buttonLabel: 'Go to Dashboard',
        imageSource: 'success',
        accountAddress: address,
      },
    });
  };

  const retry = () => {
    setErrorMsg('');
    setStage('auth');
    setRetryCount((c) => c + 1);
  };

  // Derive per-step status from the current stage. On error, point at the step
  // that was in progress when it failed (auth vs deploying).
  const stepStatuses = (): [StepStatus, StepStatus, StepStatus] => {
    if (stage === 'success') return ['done', 'done', 'done'];
    if (stage === 'error') {
      return lastActiveRef.current === 'auth'
        ? ['error', 'pending', 'pending']
        : ['done', 'error', 'pending'];
    }
    // Mnemonic path skips the auth stage entirely (goes straight to deploying),
    // so step 1 reads as done once we're deploying.
    if (stage === 'deploying') return ['done', 'active', 'pending'];
    return ['active', 'pending', 'pending'];
  };

  const statuses = stepStatuses();
  const steps: DeployStep[] = [
    { label: isMnemonicPath ? 'Wallet imported' : 'Identity verified', status: statuses[0] },
    {
      label: 'Deploying on Stellar',
      status: statuses[1],
      caption: statuses[1] === 'active' ? 'This can take up to 30 seconds' : undefined,
    },
    { label: 'Finalizing', status: statuses[2] },
  ];

  const heading =
    stage === 'success'
      ? 'You’re all set'
      : stage === 'error'
        ? 'Setup failed'
        : 'Setting up your\nsmart account';
  const subheading =
    stage === 'success'
      ? 'Your smart account is ready.'
      : stage === 'error'
        ? errorMsg
        : 'This usually takes a few moments. Keep the app open.';

  return (
    <Box flex={1} backgroundColor="mainBackground">
      <LinearGradient
        colors={[theme.colors.gradientLight, theme.colors.gradientDark]}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />

      <Box
        flex={1}
        paddingHorizontal="xl"
        style={{ paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) }}
      >
        {/* Logo */}
        <Image
          source={require('@/src/assets/images/logoLoading.png')}
          style={{ width: 56, height: 56 }}
          resizeMode="contain"
        />

        {/* Hero */}
        <Box mt="xxl">
          <Text variant="h7" fontSize={30} fontWeight="700" color="textPrimary" lineHeight={38}>
            {heading}
          </Text>
          <Text variant="body" color="textSecondary" mt="s" lineHeight={22}>
            {subheading}
          </Text>
        </Box>

        {/* Timeline */}
        <Box mt="xxl">
          <DeployTimeline steps={steps} reduceMotion={reduceMotion} />
        </Box>

        <Box flex={1} />

        {/* Error recovery — bottom anchored */}
        {stage === 'error' && (
          <Button
            label="Try Again"
            variant="primary"
            onPress={retry}
            bg="primary700"
            labelColor="black"
          />
        )}
      </Box>
    </Box>
  );
};

export default DeployAccount;
