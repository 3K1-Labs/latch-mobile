import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSecureScreen } from '@/src/hooks/use-secure-screen';

function hashPin(pin: string): string {
  return QuickCrypto.createHash('sha256').update(pin).digest('hex') as unknown as string;
}

const { width } = Dimensions.get('window');

const PIN_LENGTH = 4;
const PIN_KEY = 'latch_pin';

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

const SetPin = () => {
  // A PIN on screen must not end up in the photo library.
  useSecureScreen();

  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const { from } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pendingWallet, clearPendingWallet } = useWalletStore();

  const [phase, setPhase] = useState<'set' | 'confirm'>('set');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(false);

  const currentPin = phase === 'set' ? pin : confirmPin;

  const handleKey = useCallback(
    (key: string) => {
      if (key === 'del') {
        if (phase === 'set') {
          setPin((p) => p.slice(0, -1));
        } else {
          setConfirmPin((p) => p.slice(0, -1));
        }
        setError(false);
        return;
      }

      if (currentPin.length >= PIN_LENGTH) return;

      const next = currentPin + key;

      if (phase === 'set') {
        setPin(next);
        if (next.length === PIN_LENGTH) {
          setTimeout(() => setPhase('confirm'), 150);
        }
      } else {
        setConfirmPin(next);
        if (next.length === PIN_LENGTH) {
          setTimeout(async () => {
            if (next === pin) {
              await SecureStore.setItemAsync(PIN_KEY, hashPin(pin));

              if (from === 'import-phrase') {
                if (pendingWallet) {
                  await SecureStore.setItemAsync(SECURE_KEYS.MNEMONIC, pendingWallet.mnemonic);
                  clearPendingWallet();
                }
              }

              if (from === 'recovery') {
                // Credentials already restored from backup — skip deploy, go straight to app.
                router.replace('/(tabs)');
                return;
              }

              // Collect email for recovery backup before deploying. Carry the
              // shared marker so the rest of the chain ends at the multisig
              // build screens instead of the personal deploy.
              router.push({
                pathname: '/(onboarding)/collect-email',
                params: from === 'shared' ? { flow: 'shared' } : undefined,
              });
            } else {
              Vibration.vibrate(400);
              setError(true);
              setConfirmPin('');
            }
          }, 150);
        }
      }
    },
    [currentPin, phase, pin, router, from, pendingWallet, clearPendingWallet],
  );

  const handleBack = () => {
    if (phase === 'confirm') {
      setPhase('set');
      setConfirmPin('');
      setError(false);
    } else if (router.canGoBack()) {
      router.back();
    }
  };

  const keySize = (width - theme.spacing.m * 2 - theme.spacing.m * 2) / 3;

  return (
    <Box flex={1} backgroundColor="onboardingbg">
      <LinearGradient
        colors={[theme.colors.gradientLight, theme.colors.gradientDark]}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />
      <View style={{ flex: 1 }}>
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.m,
            paddingBottom: Math.max(insets.bottom, 20),
            paddingTop: 60,
            flexGrow: 1,
            justifyContent: 'space-between',
          }}
        >
          <View>
            {/* Header */}
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <TouchableOpacity
                onPress={handleBack}
                activeOpacity={0.7}
                hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
              >
                <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>

              <Image
                source={require('@/src/assets/images/logoLoading.png')}
                style={{ width: 35, height: 35 }}
                resizeMode="contain"
              />

              <Box width={24} />
            </Box>

            {/* Title */}
            <Box alignItems="center" mt="xxl" style={{ marginBottom: 60 }}>
              <Text
                variant="h8"
                fontSize={28}
                fontWeight="700"
                textAlign="center"
                color="textPrimary"
              >
                {phase === 'set' ? 'Set Your Access Pin' : 'Confirm Your Pin'}
              </Text>
              <Text color="textSecondary" mt="xs" textAlign="center">
                {phase === 'set' ? (
                  <Text variant="p4" color="textSecondary" textAlign="center">
                    This is used to secure your wallet on all your devices.
                    <Text variant="p4" color="primary7" textAlign="center">
                      {' '}
                      This cannot be recovered.
                    </Text>
                  </Text>
                ) : (
                  <Text variant="p4" color="primary7" textAlign="center">
                    If you forget this PIN you will not be able to recover your wallet on new
                    devices.
                  </Text>
                )}
              </Text>
              {error && (
                <Text
                  variant="body"
                  color="danger900"
                  mt="s"
                  textAlign="center"
                  style={{ position: 'absolute', bottom: -30 }}
                >
                  PINs don&apos;t match. Try again.
                </Text>
              )}
            </Box>

            {/* PIN Dots */}
            <Box
              flexDirection="row"
              justifyContent="center"
              alignItems="center"
              style={{ marginTop: 20, marginBottom: 40 }}
              gap="l"
            >
              {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                const filled = i < currentPin.length;
                return (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      filled
                        ? {
                            backgroundColor: error
                              ? theme.colors.danger900
                              : theme.colors.primary700,
                          }
                        : {
                            backgroundColor: theme.colors.gray900,
                            opacity: 0.8,
                          },
                    ]}
                  />
                );
              })}
            </Box>
          </View>

          {/* Keypad */}
          <Box justifyContent="flex-end" pb="m">
            {KEYPAD_ROWS.map((row, rIdx) => (
              <Box key={rIdx} flexDirection="row" justifyContent="space-between" mb="m">
                {row.map((key, kIdx) => {
                  if (key === '') {
                    return <Box key={kIdx} style={{ width: keySize, height: 64 }} />;
                  }

                  return (
                    <TouchableOpacity
                      key={kIdx}
                      activeOpacity={0.6}
                      onPress={() => handleKey(key)}
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
        </ScrollView>
      </View>
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

export default SetPin;
