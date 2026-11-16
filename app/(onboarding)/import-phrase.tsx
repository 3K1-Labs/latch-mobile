import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { requestDiscoveryAfterRestore } from '@/src/lib/membership';
import { restoreStellarWallet } from '@/src/lib/seed-wallet';
import { useWalletStore } from '@/src/store/wallet';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RoundBackButton, SetupButton, SetupTitle } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import { useSecureScreen } from '@/src/hooks/use-secure-screen';
import { Theme } from '@/src/theme/theme';

const ImportPhrase = () => {
  // A recovery phrase or PIN on screen must not end up in the photo library.
  useSecureScreen();

  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { setPendingWallet } = useWalletStore();

  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputsRef = useRef<(TextInput | null)[]>([]);
  const scrollRef = useRef<any>(null);

  const itemWidth = (width - theme.spacing.l * 2 - 8) / 2;

  const handleChange = (text: string, idx: number) => {
    setError(null);

    const trimmed = text.trim();
    if (trimmed.includes(' ')) {
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const next = [...words];
      let i = idx;
      for (const p of parts) {
        if (i >= next.length) break;
        next[i] = p.toLowerCase();
        i += 1;
      }
      setWords(next);
      const focusIdx = i < next.length ? i : next.length - 1;
      setTimeout(() => inputsRef.current[focusIdx]?.focus(), 50);
      return;
    }

    const next = [...words];
    next[idx] = text.toLowerCase();
    setWords(next);
  };

  const handleFocus = (idx: number) => {
    setTimeout(() => {
      const input = inputsRef.current[idx];
      if (!input || !scrollRef.current) return;
      try {
        // @ts-ignore
        input.measure((...args: number[]) => {
          const py = args[5] ?? 0;
          scrollRef.current?.scrollTo({ y: Math.max(0, py - 140), animated: true });
        });
      } catch {}
    }, 300);
  };

  const allFilled = words.every((w) => w.trim().length > 0);

  const handleImport = async () => {
    if (!allFilled) return;
    Keyboard.dismiss();

    const mnemonic = words.map((w) => w.trim().toLowerCase()).join(' ');

    if (!validateMnemonic(mnemonic, wordlist)) {
      setError('Invalid recovery phrase. Please check each word and try again.');
      return;
    }

    setIsLoading(true);
    try {
      // Small delay so the loading overlay renders before the sync crypto work
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const wallet = restoreStellarWallet(mnemonic);
      setPendingWallet(wallet);
      await requestDiscoveryAfterRestore();

      router.push({
        pathname: '/(auth)/biometric',
        params: { from: 'import-phrase' },
      });
    } catch {
      setError('Failed to restore wallet. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />
      <KeyboardAwareScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.l,
          paddingTop: insets.top + 12,
          paddingBottom: 24,
          flexGrow: 1,
        }}
        style={styles.fill}
        bottomOffset={16}
      >
        <RoundBackButton onPress={() => router.canGoBack() && router.back()} />

        <Box style={styles.title}>
          <SetupTitle title="Import your Recovery Phrase">
            Enter your 12-word recovery phrase in the correct order
          </SetupTitle>
        </Box>

        <Box style={styles.grid}>
          {words.map((word, index) => (
            <Box
              key={index}
              style={[styles.word, { width: itemWidth }]}
              backgroundColor="inputBox"
              borderColor={error ? 'danger900' : 'inputOutline'}
            >
              <Text variant="p8" lineHeight={20} letterSpacing={0} color="textSubheading" width={20}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <TextInput
                ref={(el) => {
                  inputsRef.current[index] = el;
                }}
                value={word}
                onChangeText={(t) => handleChange(t, index)}
                onFocus={() => handleFocus(index)}
                style={[styles.wordInput, { color: theme.colors.textPrimary }]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType={index === words.length - 1 ? 'done' : 'next'}
                onSubmitEditing={() => {
                  if (index === words.length - 1) {
                    handleImport();
                  } else {
                    inputsRef.current[index + 1]?.focus();
                  }
                }}
              />
            </Box>
          ))}
        </Box>

        {error && (
          <Text variant="p7" color="danger900" mt="m">
            {error}
          </Text>
        )}
      </KeyboardAwareScrollView>

      <Box px="l" pt="m" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
        <SetupButton label="Continue" disabled={!allFilled} onPress={handleImport} />
      </Box>

      <LoadingBlur visible={isLoading} text="Verifying your phrase…" />
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 10,
    marginTop: 48,
  },
  word: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 16,
  },
  wordInput: {
    flex: 1,
    padding: 0,
    fontFamily: 'SFproMedium',
    fontSize: 14,
    lineHeight: 18,
  },
});

export default ImportPhrase;
