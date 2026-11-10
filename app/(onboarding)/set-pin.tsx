import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { RoundBackButton, SetupButton, SetupTitle } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useSecureScreen } from '@/src/hooks/use-secure-screen';
import { hashPin } from '@/src/lib/hash-pin';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, Vibration } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PIN_LENGTH = 4;
const PIN_KEY = 'latch_pin';

const SetPin = () => {
  // A PIN on screen must not end up in the photo library.
  useSecureScreen();

  const statusBarStyle = useStatusBarStyle();
  const { from } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pendingWallet, clearPendingWallet } = useWalletStore();
  const inputRef = useRef<TextInput>(null);

  const [phase, setPhase] = useState<'set' | 'confirm'>('set');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentPin = phase === 'set' ? pin : confirmPin;

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setError(false);
    if (phase === 'set') {
      setPin(digits);
    } else {
      setConfirmPin(digits);
    }
  };

  const finish = async () => {
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
  };

  const handleContinue = async () => {
    if (currentPin.length < PIN_LENGTH || saving) return;

    if (phase === 'set') {
      setPhase('confirm');
      return;
    }

    if (confirmPin !== pin) {
      Vibration.vibrate(400);
      setError(true);
      setConfirmPin('');
      return;
    }

    setSaving(true);
    try {
      await finish();
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (phase === 'confirm') {
      setPhase('set');
      setConfirmPin('');
      setError(false);
    } else if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Box flex={1} px="l" style={{ paddingTop: insets.top + 12 }}>
          <RoundBackButton onPress={handleBack} />

          <Box style={styles.title}>
            {phase === 'set' ? (
              <SetupTitle title="Create your 4-Digit PIN">
                This is used to secure your wallet on all your devices.{' '}
                <Text variant="p6" lineHeight={24} letterSpacing={0} color="textPrimary">
                  This cannot be recovered.
                </Text>
              </SetupTitle>
            ) : (
              <SetupTitle title="Confirm your 4-Digit PIN">
                Enter your PIN again to confirm it.
              </SetupTitle>
            )}
          </Box>

          <Pressable
            accessibilityLabel="PIN entry"
            onPress={() => inputRef.current?.focus()}
            style={styles.boxes}
          >
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <Box
                key={i}
                width={48}
                height={48}
                borderRadius={16}
                borderWidth={1}
                alignItems="center"
                justifyContent="center"
                backgroundColor="inputBox"
                borderColor={error ? 'danger900' : 'inputOutline'}
              >
                {i < currentPin.length && <Box style={styles.mask} backgroundColor="textPrimary" />}
              </Box>
            ))}
            <TextInput
              ref={inputRef}
              key={phase}
              autoFocus
              value={currentPin}
              onChangeText={handleChange}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_LENGTH}
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              contextMenuHidden
              caretHidden
              style={styles.hiddenInput}
            />
          </Pressable>

          {error && (
            <Text variant="p7" color="danger900" mt="sm">
              PINs don&apos;t match. Try again.
            </Text>
          )}
        </Box>

        <Box px="l" style={{ paddingBottom: Math.max(insets.bottom, 32) }}>
          <SetupButton label="Continue" busy={saving} onPress={handleContinue} />
        </Box>
      </KeyboardAvoidingView>
    </Box>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  title: {
    marginTop: 56,
  },
  boxes: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 48,
    alignSelf: 'flex-start',
  },
  mask: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
  },
});

export default SetPin;
