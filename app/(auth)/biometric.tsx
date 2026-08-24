import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import {
  createPasskeyCredential,
  storePasskeyCredential,
  storePlatformPasskeyCredentialAtIndex,
} from '@/src/lib/passkey-webauthn';
import { createPlatformPasskeyCredential, isPlatformPasskeySupported } from '@/src/lib/platform-passkey';
import { PASSKEY_RP_ID } from '@/src/constants/config';
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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Linking,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function hashPin(pin: string): string {
  return QuickCrypto.createHash('sha256').update(pin).digest('hex') as unknown as string;
}

/**
 * Provision the primary passkey credential (account list index 0).
 *
 * Prefers a real platform passkey — synced via Google Password Manager
 * (Android) or iCloud Keychain (iOS), whichever the OS's own passkey sheet
 * offers — over today's SecureStore-only key. Falls back to the local key on
 * any failure (unsupported OS version, user cancels the system sheet, no
 * credential provider available), so setup never dead-ends.
 */
async function provisionPrimaryPasskey(requireBiometric: boolean): Promise<void> {
  if (isPlatformPasskeySupported()) {
    try {
      const credential = await createPlatformPasskeyCredential({
        rpId: PASSKEY_RP_ID,
        rpName: 'Latch',
        userId: new Uint8Array(QuickCrypto.randomBytes(16)),
        userName: 'latch-wallet',
        userDisplayName: 'Latch Wallet',
        challenge: new Uint8Array(QuickCrypto.randomBytes(32)),
      });
      await storePlatformPasskeyCredentialAtIndex(credential, 0);
      return;
    } catch (err) {
      if (__DEV__) console.log('[passkey] platform passkey unavailable, falling back to local key:', err);
    }
  }

  const credential = createPasskeyCredential();
  await storePasskeyCredential(credential, requireBiometric);
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
  const [showModal, setShowModal] = useState(false);
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

  const [biometricLabel, setBiometricLabel] = useState('Biometrics');
  const [biometricIcon, setBiometricIcon] = useState<'scan' | 'finger-print'>('scan');
  const [biometricEnabledForUnlock, setBiometricEnabledForUnlock] = useState(false);

  const keySize = (width - theme.spacing.m * 2 - theme.spacing.m * 2) / 3;

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

      // If the device can't do biometrics, skip this screen and go straight to
      // PIN setup. proceedToPin handles the device-passcode gate + navigation;
      // if it returns without navigating, fall through and reveal the screen.
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        await proceedToPin();
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

  // ─── Setup helpers ────────────────────────────────────────────────────────

  const proceedToPin = async () => {
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
        await provisionPrimaryPasskey(false);
      }
      router.replace(
        from ? { pathname: '/(onboarding)/set-pin', params: { from } } : '/(onboarding)/set-pin',
      );
    } catch {
      Alert.alert('Setup Failed', 'Could not save your secure credential. Please try again.', [
        { text: 'OK' },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAllow = async () => {
    setShowModal(false);

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      Alert.alert(
        'Biometrics Not Available',
        "Your device doesn't support biometrics or none are enrolled.",
        [{ text: 'OK', onPress: proceedToPin }],
      );
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Register passkey with ${biometricLabel}`,
      disableDeviceFallback: true,
      cancelLabel: 'Cancel',
    });

    if (!result.success) {
      return;
    }

    setIsProcessing(true);
    try {
      // Generate credential first — only write the biometric flag after it's
      // safely stored. If storePasskeyCredential throws, the flag stays unset
      // and the user is not left in a broken state on next launch.
      const existingCredId = await SecureStore.getItemAsync(SECURE_KEYS.CREDENTIAL_ID);
      if (!existingCredId) {
        await provisionPrimaryPasskey(true);
      }
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');

      // Navigate to PIN setup so biometric users have a PIN as emergency fallback.
      // set-pin will forward to deploy-account once the PIN is confirmed.
      router.replace(
        from ? { pathname: '/(onboarding)/set-pin', params: { from } } : '/(onboarding)/set-pin',
      );
    } catch {
      Alert.alert('Setup Failed', 'Could not save your biometric credential. Please try again.', [
        { text: 'OK' },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

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
          <Box alignItems="center" mt="xxl" mb="m" style={{ paddingTop: insets.top }}>
            <Image
              source={require('@/src/assets/images/logoLoading.png')}
              style={{ width: 35, height: 35 }}
              resizeMode="contain"
            />
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
                  Welcome Back
                </Text>
                {lockedUntil ? (
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
              <Box flexDirection="row" justifyContent="center" mt="xl" mb="xxl" gap="l">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      i < pin.length
                        ? {
                            backgroundColor: pinError
                              ? theme.colors.danger900
                              : theme.colors.primary700,
                          }
                        : { backgroundColor: theme.colors.gray900, opacity: 0.8 },
                    ]}
                  />
                ))}
              </Box>

              {/* Keypad */}
              <Box flex={1} justifyContent="flex-end" paddingHorizontal="m" pb="m">
                {KEYPAD_ROWS.map((row, rIdx) => (
                  <Box key={rIdx} flexDirection="row" justifyContent="space-between" mb="m">
                    {row.map((key, kIdx) => {
                      if (key === '') {
                        // Show biometric shortcut only when biometric unlock is enabled
                        return biometricEnabledForUnlock ? (
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
                          onPress={() => handlePinKey(key)}
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
        <Text variant="p5" color="textSecondary" mt="m" textAlign="center" style={{ width: '80%' }}>
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
          label="Enable Biometrics"
          variant="primary"
          onPress={() => setShowModal(true)}
          bg="primary700"
          labelColor="black"
          // shadowColor="gradientDark"
          disabled={isProcessing}
        />
        <Button
          label="Maybe Later"
          onPress={proceedToPin}
          // mt="s"
          bg={'btnDisabled'}
          shadowOffset={{ width: 0, height: 4 }}
          shadowColor="gradientDark"
          shadowRadius={15}
          shadowOpacity={0.12}
          labelColor={statusBarStyle === 'light' ? 'textWhite' : 'black'}
          disabled={isProcessing}
        />
      </Box>

      {/* iOS-style permission modal */}
      <Modal visible={showModal} transparent animationType="fade">
        <Box
          flex={1}
          justifyContent="center"
          alignItems="center"
          paddingHorizontal="m"
          style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
        >
          <Box
            backgroundColor="bg900"
            py="xl"
            px="l"
            borderRadius={32}
            width="100%"
            style={{ borderWidth: 1, borderColor: theme.colors.bg800 }}
          >
            <Image
              source={require('@/src/assets/images/face_id_green.png')}
              style={{ width: 80, height: 80 }}
              resizeMode="contain"
            />
            <Text variant="h8" color="text200" fontSize={24} mt="l">
              Do you want to allow &quot;Latch&quot; to use biometric?
            </Text>
            <Text variant="p5" color="textTertiary" mt="xs">
              Allow Latch to access your biometric data..
            </Text>
            <Box flexDirection="row" gap="m" mt="xl" width="100%">
              <Button
                flex={1}
                height={52}
                label="Don't Allow"
                bg="bg800"
                labelColor="white"
                variant="secondary"
                onPress={() => {
                  setShowModal(false);
                  proceedToPin();
                }}
              />
              <Button
                flex={1}
                height={52}
                label="Allow"
                variant="secondary"
                bg="blue"
                labelColor="white"
                onPress={handleAllow}
              />
            </Box>
          </Box>
        </Box>
      </Modal>
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
