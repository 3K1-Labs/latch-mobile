import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { restoreStellarWallet } from '@/src/lib/seed-wallet';
import { useWalletStore } from '@/src/store/wallet';
import { Ionicons } from '@expo/vector-icons';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Keyboard,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { useSecureScreen } from '@/src/hooks/use-secure-screen';

const { width } = Dimensions.get('window');

const ImportPhrase = () => {
  // A recovery phrase or PIN on screen must not end up in the photo library.
  useSecureScreen();

  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setPendingWallet } = useWalletStore();

  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputsRef = useRef<(TextInput | null)[]>([]);
  const scrollRef = useRef<any>(null);

  const itemWidth = (width - theme.spacing.m * 2 - theme.spacing.m) / 2;

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
    <Box flex={1} backgroundColor="onboardingbg">
      <LinearGradient
        colors={['rgba(50, 60, 14, 0.74)', '#121212']}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.91 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />
      <KeyboardAwareScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.m,
          paddingBottom: 40,
          paddingTop: 60,
          flexGrow: 1,
        }}
        style={{ flex: 1 }}
        bottomOffset={16}
      >
          {/* Header */}
          <Box flexDirection="row" justifyContent="space-between" mb="m">
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Image
              source={require('@/src/assets/images/logoLoading.png')}
              style={{ width: 35, height: 35 }}
              resizeMode="contain"
            />
            <Box width={40} />
          </Box>

          <Box alignItems="center" mb="l">
            <Text variant="h7" fontSize={32} textAlign="center">
              Import Your Recovery Phrase
            </Text>
            <Text variant="p5" color="textSecondary" mt="xs" textAlign="center" width={'85%'}>
              Enter your 12-word recovery phrase in the correct order
            </Text>
          </Box>

          {/* Grid of inputs */}
          <Box gap="s">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s }}>
              {words.map((word, index) => (
                <View
                  key={index}
                  style={[
                    styles.item,
                    {
                      width: itemWidth,
                      backgroundColor:
                        statusBarStyle !== 'light' ? theme.colors.text50 : theme.colors.gray900,
                      borderRadius: 12,
                      borderColor: error ? theme.colors.danger900 : theme.colors.gray800,
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    fontFamily={'SFproSemibold'}
                    color="textSecondary"
                    style={{ marginRight: 8 }}
                  >
                    {index + 1}
                  </Text>
                  <TextInput
                    ref={(el) => {
                      inputsRef.current[index] = el;
                    }}
                    value={word}
                    onChangeText={(t) => handleChange(t, index)}
                    onFocus={() => handleFocus(index)}
                    placeholder={``}
                    placeholderTextColor={theme.colors.gray600}
                    style={{ color: theme.colors.textPrimary, flex: 1, padding: 0 }}
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
                </View>
              ))}
            </View>

            {error && (
              <Text variant="body" color="danger900" mt="s" textAlign="center">
                {error}
              </Text>
            )}
          </Box>
      </KeyboardAwareScrollView>

      {/* Import Button fixed at bottom */}
      <Box
        paddingHorizontal="m"
        paddingTop="m"
        backgroundColor="mainBackground"
        style={{ paddingBottom: Math.max(insets.bottom, 24) }}
      >
        <Button
          label="Import Wallet"
          variant={allFilled ? 'primary' : 'disabled'}
          onPress={handleImport}
          bg={allFilled ? 'primary700' : 'btnDisabled'}
          labelColor={allFilled ? 'black' : 'gray600'}
          disabled={!allFilled}
        />
      </Box>

      <LoadingBlur visible={isLoading} text="Verifying your phrase…" />
    </Box>
  );
};

const styles = StyleSheet.create({
  item: {
    height: 56,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default ImportPhrase;
