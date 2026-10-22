import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import { hashPin } from '@/src/lib/hash-pin';
import {
  confirmDeviceOnlyFallback,
  createDeviceOnlyPasskeyAtIndex,
  notifyIfDeviceOnly,
  notifyIfWeakBiometricGate,
  PasskeyProvisionError,
  provisionPasskeyAtIndex,
  shouldOfferDeviceOnlyFallback,
} from '@/src/lib/provision-passkey';
import { SECURE_KEYS } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@shopify/restyle';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Linking,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Provision the primary passkey credential (account list index 0) — the real
 * OS ceremony (Google Password Manager / iCloud Keychain), always. Throws
 * PasskeyProvisionError on any failure; it never falls back on its own — see
 * provisionAndContinue for what the screen does with that. See provision-passkey.ts.
 */
async function provisionPrimaryPasskey(requireBiometric: boolean): Promise<void> {
  await provisionPasskeyAtIndex(0, { requireBiometric });
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

export const BIOMETRIC_ENABLED_KEY = 'latch_biometric_enabled';
const PIN_KEY = 'latch_pin';
const PIN_LENGTH = 4;

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

const { width } = Dimensions.get('window');

const Biometrics = () => {
  const router = useRouter();
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();

  const { mode, from } = useLocalSearchParams<{ mode?: string; from?: string }>();
  const isUnlockMode = mode === 'unlock';

  // setup mode state
  const [isProcessing, setIsProcessing] = useState(false);
  // Gate setup rendering until we know whether the device has biometrics. Avoids
  // flashing the biometric screen on devices that will be redirected to PIN.
  const [checkingSetup, setCheckingSetup] = useState(!isUnlockMode);

  // unlock mode state
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Forgot-PIN reset: 'idle' is the normal unlock keypad; 'set'/'confirm' are
  // the same two-step "type it twice" flow set-pin.tsx uses during onboarding,
  // reimplemented locally rather than navigated to — set-pin.tsx's `from`
  // branches (import-phrase / recovery / default) all lead into (re-)deploying
  // an account, which is wrong for a device that already has one and just
  // needs a new local PIN. Reaching 'set' at all requires having already
  // passed a LocalAuthentication.authenticateAsync check — see handleForgotPin.
  const [pinResetPhase, setPinResetPhase] = useState<'idle' | 'set' | 'confirm'>('idle');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [newPinError, setNewPinError] = useState(false);

  const [biometricLabel, setBiometricLabel] = useState('Biometrics');
  const [biometricIcon, setBiometricIcon] = useState<'scan' | 'finger-print'>('scan');
  const [biometricEnabledForUnlock, setBiometricEnabledForUnlock] = useState(false);

  const keySize = (width - theme.spacing.m * 2 - theme.spacing.m * 2) / 3;

  // Consecutive non-cancelled failures for the primary passkey ceremony —
  // what shouldOfferDeviceOnlyFallback uses to decide when "Try Again" also
  // needs a "Continue with Device-Only Key" option next to it. A ref, not
  // state: it only has to be current inside the catch handler below, never
  // needs to trigger a re-render.
  const failedAttemptsRef = useRef(0);

  // ─── Setup helpers ────────────────────────────────────────────────────────

  /** Record biometric-unlock capability (if any) and move on to PIN setup. */
  const finishPasskeySetup = useCallback(async () => {
    // Recorded, not gated on: biometric unlock is offered on device
    // capability alone. Written only when the device actually has enrolled
    // biometrics so the flag stays meaningful.
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHardware && isEnrolled) {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
    }
    // set-pin will forward through the rest of onboarding once confirmed.
    router.replace(
      from ? { pathname: '/(onboarding)/set-pin', params: { from } } : '/(onboarding)/set-pin',
    );
  }, [from, router]);

  /**
   * Creates the device-only key and continues — only ever called after
   * confirmDeviceOnlyFallback has already warned the user what that means and
   * they chose to continue anyway. Never called automatically.
   */
  const continueWithDeviceOnlyKey = useCallback(async () => {
    setIsProcessing(true);
    try {
      const provisioned = await createDeviceOnlyPasskeyAtIndex(0, { requireBiometric: true });
      notifyIfDeviceOnly(provisioned);
      notifyIfWeakBiometricGate(provisioned);
      await finishPasskeySetup();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      Alert.alert('Setup Failed', reason, [{ text: 'OK' }]);
    } finally {
      setIsProcessing(false);
    }
  }, [finishPasskeySetup]);

  /**
   * Provision the primary passkey and move on to PIN setup.
   *
   * The passkey ceremony inside provisionPrimaryPasskey runs the OS sheet,
   * which does its own user verification (userVerification: 'required'). That
   * single system prompt is the whole gate — there is deliberately no separate
   * LocalAuthentication step, and no app-level "allow biometrics" dialog,
   * ahead of it.
   *
   * A dismissed sheet is never shown as a failure — see
   * PasskeyProvisionError.kind === 'cancelled' below — Continue just sits
   * there ready to tap again. Any other failure shows "Try Again", and only
   * once the device is confirmed unsupported, or enough attempts have failed
   * in a row (shouldOfferDeviceOnlyFallback), also offers "Continue with
   * Device-Only Key" — which still warns before doing anything
   * (confirmDeviceOnlyFallback). Never an automatic fallback.
   */
  const provisionAndContinue = useCallback(async () => {
    // Block setup on devices with no lock screen at all. Without a device passcode
    // the private key cannot be stored with WHEN_PASSCODE_SET_THIS_DEVICE_ONLY on
    // iOS, and there is no hardware-backed auth boundary on either platform.
    const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
    if (securityLevel === LocalAuthentication.SecurityLevel.NONE) {
      Alert.alert(
        'Device Passcode Required',
        'To keep your wallet secure, please set a PIN, password, or pattern on your device first, then return to Latch.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }

    setIsProcessing(true);
    try {
      const existingCredId = await SecureStore.getItemAsync(SECURE_KEYS.CREDENTIAL_ID);
      if (!existingCredId) {
        await provisionPrimaryPasskey(true);
        failedAttemptsRef.current = 0;
      }
      await finishPasskeySetup();
    } catch (err) {
      if (err instanceof PasskeyProvisionError && err.kind === 'cancelled') {
        // The user backed out of the OS sheet. Nothing went wrong — nothing
        // to say. Continue is still right there to tap again.
        return;
      }

      failedAttemptsRef.current += 1;
      const kind = err instanceof PasskeyProvisionError ? err.kind : 'other';
      // Bound, not discarded. A swallowed error here produced a bare "try
      // again" with no trace anywhere: metro strips console.* from release
      // builds and EXPO_PUBLIC_SENTRY_DSN is unset, so Sentry.init is a no-op.
      // The message is the diagnosis.
      const reason = err instanceof Error ? err.message : String(err);

      if (shouldOfferDeviceOnlyFallback(kind, failedAttemptsRef.current)) {
        Alert.alert("Couldn't Create Passkey", reason, [
          { text: 'Try Again', style: 'cancel' },
          {
            text: 'Continue with Device-Only Key',
            style: 'destructive',
            onPress: async () => {
              if (await confirmDeviceOnlyFallback()) await continueWithDeviceOnlyKey();
            },
          },
        ]);
      } else {
        Alert.alert('Setup Failed', reason, [{ text: 'Try Again' }]);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [finishPasskeySetup, continueWithDeviceOnlyKey]);

  // Detect biometric type — runs on mount for setup mode; for unlock mode the
  // sequential init effect below handles detection before triggering auth.
  useEffect(() => {
    if (isUnlockMode) return; // handled inside init
    const detectType = async () => {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricLabel('Face ID');
        setBiometricIcon('scan');
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricLabel('Touch ID');
        setBiometricIcon('finger-print');
      }

      // If the device can't do biometrics, skip this screen and go straight
      // ahead. provisionAndContinue handles the device-passcode gate +
      // navigation; if it returns without navigating, fall through and reveal
      // the screen.
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        await provisionAndContinue();
      }
      setCheckingSetup(false);
    };
    detectType();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlockMode]);

  // ─── Lockout countdown ────────────────────────────────────────────────────

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockedUntil(null);
        setLockoutSecondsLeft(0);
        setAttempts(0);
        if (lockoutTimer.current) clearInterval(lockoutTimer.current);
      } else {
        setLockoutSecondsLeft(left);
      }
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
    return () => {
      if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    };
  }, [lockedUntil]);

  // ─── Unlock helpers ───────────────────────────────────────────────────────

  const unlockSuccess = useCallback(async () => {
    // Cold-open routing: if the active smart account has any pending
    // cosign requests waiting on this device, surface them immediately
    // instead of landing on the home tab. The banner on (tabs)/index.tsx
    // covers the warm-foreground case.
    // try {
    //   const smart = await SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT);
    //   if (smart) {
    //     const pending = await fetchPendingPacketsOnce(smart);
    //     if (pending.length > 0) {
    //       router.replace('/pending-approval');
    //       return;
    //     }
    //   }
    // } catch {
    //   // Network blip — fall through to the normal landing.
    // }
    router.replace('/(tabs)');
  }, [router]);

  const triggerBiometrics = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Latch',
      disableDeviceFallback: true,
      cancelLabel: 'Use PIN',
    });
    if (result.success) {
      unlockSuccess();
    } else {
      setShowPin(true);
    }
  }, [unlockSuccess]);

  // Sequential init for unlock mode: detect biometric type first, then decide flow.
  // This prevents the race where triggerBiometrics fires before labels are set.
  useEffect(() => {
    if (!isUnlockMode) return;

    const init = async () => {
      // 1. Detect biometric type so labels/icons are correct before any prompt.
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricLabel('Face ID');
        setBiometricIcon('scan');
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricLabel('Touch ID');
        setBiometricIcon('finger-print');
      }

      // 2. Use biometrics if the device has them enrolled; PIN is always the fallback.
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const biometricAvailable = hasHardware && isEnrolled;
      setBiometricEnabledForUnlock(biometricAvailable);

      if (biometricAvailable) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock Latch',
          disableDeviceFallback: true,
          cancelLabel: 'Use PIN',
        });
        if (result.success) {
          unlockSuccess();
        } else {
          setShowPin(true);
        }
      } else {
        setShowPin(true);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlockMode]);

  const handlePinKey = useCallback(
    async (key: string) => {
      // Reject all input while locked out
      if (lockedUntil && Date.now() < lockedUntil) return;

      if (key === 'del') {
        setPin((p) => p.slice(0, -1));
        setPinError(false);
        return;
      }
      if (pin.length >= PIN_LENGTH) return;

      const next = pin + key;
      setPin(next);

      if (next.length === PIN_LENGTH) {
        const stored = await SecureStore.getItemAsync(PIN_KEY);
        if (hashPin(next) === stored) {
          setAttempts(0);
          unlockSuccess();
        } else {
          Vibration.vibrate(400);
          setPinError(true);
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          if (newAttempts >= MAX_ATTEMPTS) {
            setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          }
          setTimeout(() => {
            setPin('');
            setPinError(false);
          }, 500);
        }
      }
    },
    [pin, attempts, lockedUntil, unlockSuccess],
  );

  // Back out of PIN entry to the biometric prompt — only offered when
  // biometrics are actually available as the alternative; a device with no
  // biometric unlock has nothing to cancel back to, since PIN is the only
  // way in. Clears whatever was typed so the keypad's next open is fresh, but
  // never touches lockedUntil — cancelling isn't a way to dodge a lockout
  // started on a previous attempt, it just switches which method you're
  // using while it counts down. Also aborts an in-progress PIN reset, so a
  // half-typed new PIN never lingers into the next visit.
  const handleCancelPin = useCallback(() => {
    setPin('');
    setPinError(false);
    setPinResetPhase('idle');
    setNewPin('');
    setNewPinConfirm('');
    setNewPinError(false);
    setShowPin(false);
  }, []);

  /**
   * Forgot PIN. The PIN is a local app-lock, not the wallet's actual signing
   * credential — device biometrics already unlock the app on their own (see
   * triggerBiometrics), so a fresh biometric check here is exactly as strong
   * a proof of "this is the device owner" and is enough to let them set a new
   * one. No biometrics enrolled means there is no local factor left to prove
   * identity with at all — the honest answer is to recover the wallet itself
   * (passkey sign-in elsewhere resolves the account from the chain), not a
   * local bypass.
   */
  // const handleForgotPin = useCallback(async () => {
  //   if (!biometricEnabledForUnlock) {
  //     Alert.alert(
  //       "Can't Reset PIN Here",
  //       "This device has no biometric unlock enrolled, so there's no other way to confirm it's you locally. Recover your wallet instead, then set a new PIN from there.",
  //       [
  //         { text: 'Cancel', style: 'cancel' },
  //         {
  //           text: 'Recover Wallet',
  //           onPress: () => router.push('/(onboarding)/sign-in-passkey'),
  //         },
  //       ],
  //     );
  //     return;
  //   }

  //   const result = await LocalAuthentication.authenticateAsync({
  //     promptMessage: "Verify it's you to reset your PIN",
  //     disableDeviceFallback: true,
  //     cancelLabel: 'Cancel',
  //   });
  //   if (!result.success) return;

  //   setPin('');
  //   setPinError(false);
  //   setNewPin('');
  //   setNewPinConfirm('');
  //   setNewPinError(false);
  //   setPinResetPhase('set');
  // }, [biometricEnabledForUnlock, router]);

  /**
   * Keypad handler for the reset flow's two steps (set, then confirm) — the
   * same "type it twice" shape as set-pin.tsx, reimplemented locally rather
   * than shared: set-pin.tsx's PIN_LENGTH/handleKey are private to that
   * module and its confirm step always continues into onboarding
   * (collect-email → deploy), which is wrong here.
   */
  const handleResetPinKey = useCallback(
    async (key: string) => {
      const current = pinResetPhase === 'set' ? newPin : newPinConfirm;
      const setCurrent = pinResetPhase === 'set' ? setNewPin : setNewPinConfirm;

      if (key === 'del') {
        setCurrent((p) => p.slice(0, -1));
        setNewPinError(false);
        return;
      }
      if (current.length >= PIN_LENGTH) return;

      const next = current + key;
      setCurrent(next);
      if (next.length !== PIN_LENGTH) return;

      if (pinResetPhase === 'set') {
        setTimeout(() => setPinResetPhase('confirm'), 150);
        return;
      }

      // Confirm step.
      if (next === newPin) {
        await SecureStore.setItemAsync(PIN_KEY, hashPin(newPin));
        setAttempts(0);
        setLockedUntil(null);
        setPinResetPhase('idle');
        unlockSuccess();
      } else {
        Vibration.vibrate(400);
        setNewPinError(true);
        setTimeout(() => {
          setNewPinConfirm('');
          setNewPinError(false);
        }, 500);
      }
    },
    [pinResetPhase, newPin, newPinConfirm, unlockSuccess],
  );

  // ─── Unlock UI ────────────────────────────────────────────────────────────

  if (isUnlockMode) {
    return (
      <Box flex={1} backgroundColor="onboardingbg">
        <LinearGradient
          colors={['rgba(50, 60, 14, 0.74)', '#121212']}
          locations={[0, 0.2772]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.91 }}
          style={StyleSheet.absoluteFill}
        />
        <StatusBar style={statusBarStyle} />
        <View style={{ flex: 1 }}>
          {/* Header */}
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            mt="xxl"
            mb="m"
            paddingHorizontal="m"
            style={{ paddingTop: insets.top }}
          >
            {showPin && biometricEnabledForUnlock ? (
              <TouchableOpacity onPress={handleCancelPin} hitSlop={12}>
                <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            ) : (
              <Box width={24} />
            )}
            <Image
              source={require('@/src/assets/images/logoLoading.png')}
              style={{ width: 35, height: 35 }}
              resizeMode="contain"
            />
            <Box width={24} />
          </Box>

          {showPin ? (
            <>
              {/* PIN title */}
              <Box alignItems="center" mt="xl" paddingHorizontal="m">
                <Text
                  variant="h8"
                  fontSize={28}
                  fontWeight="700"
                  textAlign="center"
                  color="textPrimary"
                >
                  {pinResetPhase === 'set'
                    ? 'Set a New PIN'
                    : pinResetPhase === 'confirm'
                      ? 'Confirm New PIN'
                      : 'Welcome Back'}
                </Text>
                {pinResetPhase !== 'idle' ? (
                  <Text
                    variant="body"
                    color={newPinError ? 'danger900' : 'textSecondary'}
                    mt="s"
                    textAlign="center"
                  >
                    {newPinError
                      ? "PINs don't match. Try again."
                      : pinResetPhase === 'set'
                        ? 'Choose a new 4-digit PIN'
                        : 'Enter it once more to confirm'}
                  </Text>
                ) : lockedUntil ? (
                  <Text variant="body" color="danger900" mt="s" textAlign="center">
                    Too many attempts. Try again in {lockoutSecondsLeft}s
                  </Text>
                ) : (
                  <Text variant="body" color="textSecondary" mt="s" textAlign="center">
                    Enter your PIN to unlock
                  </Text>
                )}
              </Box>

              {/* PIN dots */}
              <Box flexDirection="row" justifyContent="center" mt="xl" mb="l" gap="l">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                  const activeLen =
                    pinResetPhase === 'idle'
                      ? pin.length
                      : (pinResetPhase === 'set' ? newPin : newPinConfirm).length;
                  const activeError = pinResetPhase === 'idle' ? pinError : newPinError;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        i < activeLen
                          ? {
                              backgroundColor: activeError
                                ? theme.colors.danger900
                                : theme.colors.primary700,
                            }
                          : { backgroundColor: theme.colors.gray900, opacity: 0.8 },
                      ]}
                    />
                  );
                })}
              </Box>

              {/* {pinResetPhase === 'idle' && (
                <TouchableOpacity
                  onPress={handleForgotPin}
                  hitSlop={12}
                  style={{ alignItems: 'center', marginBottom: theme.spacing.l }}
                >
                  <Text variant="p7" color="primary700">
                    Forgot PIN?
                  </Text>
                </TouchableOpacity>
              )} */}

              {/* Keypad */}
              <Box flex={1} justifyContent="flex-end" paddingHorizontal="m" pb="m">
                {KEYPAD_ROWS.map((row, rIdx) => (
                  <Box key={rIdx} flexDirection="row" justifyContent="space-between" mb="m">
                    {row.map((key, kIdx) => {
                      if (key === '') {
                        // Biometric shortcut — only on the normal unlock keypad. Reset
                        // entry got here BY biometric auth already succeeding, so
                        // there's nothing to shortcut to.
                        return pinResetPhase === 'idle' && biometricEnabledForUnlock ? (
                          <TouchableOpacity
                            key={kIdx}
                            activeOpacity={0.6}
                            onPress={triggerBiometrics}
                            style={{ width: keySize, height: 64 }}
                          >
                            <Box
                              flex={1}
                              backgroundColor={statusBarStyle !== 'light' ? 'text50' : 'gray900'}
                              borderRadius={16}
                              justifyContent="center"
                              alignItems="center"
                            >
                              <Ionicons
                                name={biometricIcon}
                                size={28}
                                color={theme.colors.primary700}
                              />
                            </Box>
                          </TouchableOpacity>
                        ) : (
                          <Box key={kIdx} style={{ width: keySize, height: 64 }} />
                        );
                      }

                      return (
                        <TouchableOpacity
                          key={kIdx}
                          activeOpacity={0.6}
                          onPress={() =>
                            pinResetPhase === 'idle' ? handlePinKey(key) : handleResetPinKey(key)
                          }
                          style={{ width: keySize, height: 64 }}
                        >
                          <Box
                            flex={1}
                            backgroundColor={statusBarStyle !== 'light' ? 'text50' : 'gray900'}
                            borderRadius={16}
                            justifyContent="center"
                            alignItems="center"
                          >
                            {key === 'del' ? (
                              <Ionicons
                                name="backspace-outline"
                                size={28}
                                color={theme.colors.textPrimary}
                              />
                            ) : (
                              <Text
                                variant="h8"
                                fontSize={24}
                                fontWeight="600"
                                color={statusBarStyle === 'light' ? 'textPrimary' : 'gray900'}
                              >
                                {key}
                              </Text>
                            )}
                          </Box>
                        </TouchableOpacity>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </>
          ) : (
            <>
              {/* Waiting for biometrics */}
              <Box flex={1} justifyContent="center" alignItems="center" gap="xl">
                <Box
                  backgroundColor="bg800"
                  borderRadius={16}
                  height={115}
                  width={115}
                  alignItems="center"
                  justifyContent="center"
                >
                  {biometricIcon === 'finger-print' ? (
                    <Ionicons name="finger-print" size={80} color={theme.colors.primary700} />
                  ) : (
                    <Image
                      source={require('@/src/assets/images/face_id.png')}
                      style={{ width: 80, height: 80, tintColor: theme.colors.primary700 }}
                      resizeMode="contain"
                    />
                  )}
                </Box>
                <Text variant="h8" fontSize={24} textAlign="center" color="textPrimary">
                  Unlock with {biometricLabel}
                </Text>
              </Box>

              <Box paddingHorizontal="m" pb="xl">
                <Button
                  label={`Use ${biometricLabel}`}
                  variant="primary"
                  onPress={triggerBiometrics}
                  bg="primary700"
                  labelColor="black"
                />
                <Button
                  label="Use PIN instead"
                  variant="outline"
                  onPress={() => setShowPin(true)}
                  mt="m"
                  borderColor={statusBarStyle === 'light' ? 'textWhite' : 'textDark900'}
                  labelColor={statusBarStyle === 'light' ? 'textWhite' : 'black'}
                />
              </Box>
            </>
          )}
        </View>
      </Box>
    );
  }

  // ─── Setup UI ─────────────────────────────────────────────────────────────

  // Don't render anything until the biometric-availability check resolves;
  // devices without biometrics are redirected to PIN setup before this point.
  if (checkingSetup) {
    return <Box flex={1} backgroundColor="onboardingbg" />;
  }

  return (
    <Box
      flex={1}
      backgroundColor="onboardingbg"
      paddingHorizontal="m"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <LinearGradient
        colors={['rgba(50, 60, 14, 0.74)', '#121212']}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />

      {/* Header */}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="m">
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
          }}
          disabled={isProcessing}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={isProcessing ? theme.colors.textSecondary : theme.colors.textPrimary}
          />
        </TouchableOpacity>
        <Image
          source={require('@/src/assets/images/logoLoading.png')}
          style={{ width: 35, height: 35 }}
          resizeMode="contain"
        />
        <Box width={24} />
      </Box>

      {/* Title */}
      <Box alignItems="center" mt="l">
        <Text variant="h7" fontSize={32} textAlign="center">
          Secure Your Account
        </Text>
        <Text
          variant="p5"
          color="textSecondary"
          mt="xs"
          textAlign="center"
          style={{ width: '80%' }}
        >
          Gain quick and secure access to your account using biometrics.
        </Text>
      </Box>

      {/* Biometric Icon */}
      <Box flex={1} justifyContent="center" alignItems="center">
        <Box
          backgroundColor="bg800"
          borderRadius={16}
          height={115}
          width={115}
          alignItems="center"
          justifyContent="center"
        >
          {biometricIcon === 'finger-print' ? (
            <Ionicons name="finger-print" size={80} color={theme.colors.primary700} />
          ) : (
            <Image
              source={require('@/src/assets/images/face_id.png')}
              style={{ width: 80, height: 80, tintColor: theme.colors.primary700 }}
              resizeMode="contain"
            />
          )}
        </Box>
      </Box>

      {/* Buttons */}
      <Box pb="xl" gap={'m'}>
        <Button
          label="Continue"
          variant="primary"
          onPress={provisionAndContinue}
          bg="primary700"
          labelColor="black"
          disabled={isProcessing}
        />
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
});

export default Biometrics;
