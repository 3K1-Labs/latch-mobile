import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import { SECURE_KEYS } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';

function hashPin(pin: string): string {
  return QuickCrypto.createHash('sha256').update(pin).digest('hex') as unknown as string;
}

const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['back', '0', 'del'],
];

interface Props {
  visible: boolean;
  promptMessage: string;
  onResult: (confirmed: boolean) => void;
  /**
   * True when signing will itself raise an OS biometric prompt — passkey
   * accounts read their private key from SecureStore with
   * requireAuthentication: true, which the Secure Enclave / Keystore gates on
   * every read. Prompting here as well shows Face ID twice for one action, the
   * second landing immediately after the first succeeds. When set, this modal
   * is confirmation only and the single prompt comes from the keychain read.
   */
  signingPromptsForBiometrics?: boolean;
}

export default function TxAuthModal({
  visible,
  promptMessage,
  onResult,
  signingPromptsForBiometrics = false,
}: Props) {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { width } = Dimensions.get('window');

  const [mode, setMode] = useState<'choice' | 'pin'>('choice');
  const [biometricLabel, setBiometricLabel] = useState('Biometrics');
  const [biometricIcon, setBiometricIcon] = useState<'scan' | 'finger-print'>('scan');
  const [hasBiometrics, setHasBiometrics] = useState(false);

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const keySize = (width - theme.spacing.m * 4) / 3;

  useEffect(() => {
    if (!visible) return;
    setPin('');
    setPinError(false);
    setAttempts(0);
    setLockedUntil(null);

    const detect = async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const available = hasHardware && isEnrolled;
      setHasBiometrics(available);

      if (available) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricLabel('Face ID');
          setBiometricIcon('scan');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricLabel('Touch ID');
          setBiometricIcon('finger-print');
        }
        setMode('choice');
      } else {
        setMode('pin');
      }
    };
    detect();
  }, [visible]);

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

  const handleBiometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: true,
      cancelLabel: 'Use PIN',
    });
    if (result.success) {
      onResult(true);
    } else {
      setMode('pin');
    }
  };

  const handlePinKey = useCallback(
    async (key: string) => {
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
        const stored = await SecureStore.getItemAsync(SECURE_KEYS.PIN);
        if (hashPin(next) === stored) {
          setAttempts(0);
          onResult(true);
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
    [pin, attempts, lockedUntil, onResult],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <Box flex={1} justifyContent="flex-end" style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => onResult(false)}
        />

        <Box
          backgroundColor="cardbg"
          borderTopLeftRadius={32}
          borderTopRightRadius={32}
          paddingHorizontal="m"
          pb="xxl"
        >
          <Box alignItems="center" pt="m" mb="l">
            <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
          </Box>

          {mode === 'choice' ? (
            <>
              <Text variant="h8" color="textPrimary" fontWeight="700" textAlign="center" mb="s">
                Confirm Transaction
              </Text>
              <Text variant="p7" color="textSecondary" textAlign="center" mb="xl">
                {promptMessage}
              </Text>

              {hasBiometrics && (
                <Button
                  label={signingPromptsForBiometrics ? 'Confirm' : `Use ${biometricLabel}`}
                  variant="primary"
                  leftIcon={
                    <Ionicons
                      name={signingPromptsForBiometrics ? 'checkmark' : biometricIcon}
                      size={20}
                      color={theme.colors.black}
                    />
                  }
                  onPress={signingPromptsForBiometrics ? () => onResult(true) : handleBiometric}
                  mb="m"
                />
              )}
              <Button
                label="Use PIN"
                variant="outline"
                leftIcon={
                  <Ionicons name="keypad-outline" size={20} color={theme.colors.textPrimary} />
                }
                onPress={() => setMode('pin')}
                mb="s"
              />
              <Button label="Cancel" variant="ghost" onPress={() => onResult(false)} />
            </>
          ) : (
            <>
              <Text variant="h8" color="textPrimary" fontWeight="700" textAlign="center" mb="s">
                Enter PIN
              </Text>
              {lockedUntil ? (
                <Text variant="p7" color="danger900" textAlign="center" mb="xl">
                  Too many attempts. Try again in {lockoutSecondsLeft}s
                </Text>
              ) : (
                <Text variant="p7" color="textSecondary" textAlign="center" mb="xl">
                  Enter your 4-digit PIN to confirm
                </Text>
              )}

              <Box flexDirection="row" justifyContent="center" mb="xl" gap="l">
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
                        : {
                            backgroundColor: isDark
                              ? theme.colors.gray900
                              : theme.colors.btnDisabled,
                            opacity: 0.8,
                          },
                    ]}
                  />
                ))}
              </Box>

              <Box paddingHorizontal="xs">
                {KEYPAD_ROWS.map((row, rIdx) => (
                  <Box key={rIdx} flexDirection="row" justifyContent="space-between" mb="m">
                    {row.map((key, kIdx) => {
                      if (key === 'back') {
                        return hasBiometrics ? (
                          <TouchableOpacity
                            key={kIdx}
                            activeOpacity={0.6}
                            onPress={() => setMode('choice')}
                            style={{ width: keySize, height: 64 }}
                          >
                            <Box
                              flex={1}
                              backgroundColor={'gray900'}
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
                            backgroundColor={isDark ? 'gray900' : 'btnDisabled'}
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
                              <Text variant="h8" fontSize={24} fontWeight="600" color="textPrimary">
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
          )}
        </Box>
      </Box>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdrop: {
    flex: 1,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
});
