/**
 * SignInPasskey — restore access to an existing smart account on a device
 * that has never used it before, using a synced platform passkey (Google
 * Password Manager / iCloud Keychain).
 *
 * No local SecureStore state is required: the OS ceremony itself locates the
 * matching synced credential, and latch-api verifies the resulting assertion
 * against the account's on-chain webauthn signer — never against anything
 * this device claims locally. See signInToExistingWalletWithPlatformPasskey
 * in src/lib/wallet-auth.ts.
 */

import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Header from '@/src/components/shared/Header';
import Input from '@/src/components/shared/Input';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import * as Sentry from '@sentry/react-native';

import { getNetworkId, PASSKEY_RP_ID } from '@/src/constants/config';
import { storePlatformPasskeyCredentialAtIndex } from '@/src/lib/passkey-webauthn';
import { isPlatformPasskeySupported } from '@/src/lib/platform-passkey';
import { signInToExistingWalletWithPlatformPasskey } from '@/src/lib/wallet-auth';
import { useWalletStore } from '@/src/store/wallet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Keyboard, StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

const SignInPasskey = () => {
  const statusBarStyle = useStatusBarStyle();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accounts, appendAccount } = useWalletStore();

  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformSupported = isPlatformPasskeySupported();

  const handlePaste = async () => {
    // Trimmed because a copied address routinely carries a trailing newline,
    // and the field is the one thing the user is asked to get exactly right.
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) return;
    setAddress(text);
    setError(null);
  };

  const handleSignIn = async () => {
    Keyboard.dismiss();
    const trimmed = address.trim();
    if (!trimmed.startsWith('C') || trimmed.length < 20) {
      setError('Enter a valid smart account address (starts with "C").');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const result = await signInToExistingWalletWithPlatformPasskey(trimmed);

      const listIndex = accounts.length;
      // signInToExistingWalletWithPlatformPasskey ran its ceremony under
      // PASSKEY_RP_ID, so that is the RP this credential answers to.
      await storePlatformPasskeyCredentialAtIndex(
        { credentialId: result.credentialId, keyDataHex: result.keyDataHex },
        listIndex,
        PASSKEY_RP_ID,
      );

      await appendAccount(
        {
          index: -1,
          name: `Account ${listIndex + 1}`,
          gAddress: '',
          publicKeyHex: '',
          smartAccountAddress: trimmed,
          image: null,
          credentialId: result.credentialId,
          network: result.network,
        },
        true,
      );

      await AsyncStorage.setItem('latch_onboarding_complete', 'true');
      router.replace('/(tabs)');
    } catch (e: any) {
      // Same reasoning as deploy-account: this is where a passkey sign-in
      // failure stops. The address is a public C-address, and it is the one
      // thing that makes a report actionable — it says which account the OS
      // could not produce a credential for.
      Sentry.captureException(e instanceof Error ? e : new Error(String(e?.message ?? e)), {
        tags: { scope: 'sign-in-passkey', network: getNetworkId() },
        extra: { smartAccountAddress: trimmed },
      });
      setError(e?.message ?? 'Sign in failed. Please try again.');
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

      {/* Scrollable content. keyboardShouldPersistTaps="handled" is what makes a
          tap on empty space dismiss the keyboard while still letting a tap land
          on the button in one go — same as import-phrase.tsx and collect-email.tsx. */}
      <KeyboardAwareScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.m,
          paddingTop: insets.top,
          paddingBottom: 24,
          flexGrow: 1,
        }}
        style={{ flex: 1 }}
        bottomOffset={16}
      >
        <Box alignItems="center" mb="xxl">
          <Header />

          <Text variant="h7" mt="s" fontSize={30} textAlign="center">
            Sign In With Passkey
          </Text>
          <Text variant="p6" color="textSecondary" mt="xs" textAlign="center" width="95%">
            {platformSupported
              ? "Enter your wallet's address. We'll use the passkey synced to this device's Google Password Manager or iCloud Keychain to verify it's yours."
              : "This device doesn't support synced passkeys, so this option isn't available here."}
          </Text>
        </Box>

        {platformSupported && (
          <Box mb="l">
            <Text variant="p7" color="textPrimary" fontWeight="700" mb="xs">
              Smart Account Address
            </Text>
            <Input
              placeholder="C..."
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setError(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              status={error ? 'danger' : 'basic'}
              rightElement={
                address.length > 0 ? (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      setAddress('');
                      setError(null);
                    }}
                  >
                    <Ionicons name="close-circle" size={20} color={theme.colors.gray600} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity activeOpacity={0.7} onPress={handlePaste}>
                    <Box backgroundColor="primary" px="m" py="xs" borderRadius={8}>
                      <Text variant="p8" color="black" fontWeight="700">
                        Paste
                      </Text>
                    </Box>
                  </TouchableOpacity>
                )
              }
            />
            {error && (
              <Text variant="p7" color="danger900" mt="xs">
                {error}
              </Text>
            )}
          </Box>
        )}
      </KeyboardAwareScrollView>

      {/* Pinned outside the scroll view so the keyboard never covers it — the
          old <Box flex={1} /> spacer put it below the fold once the keyboard
          opened, leaving the address typed but unsubmittable. */}
      {platformSupported && (
        <Box
          paddingHorizontal="m"
          style={{ paddingBottom: Math.max(insets.bottom, 24), paddingTop: 8 }}
        >
          <Button
            label="Sign In"
            variant={address.trim() ? 'primary' : 'disabled'}
            onPress={handleSignIn}
            bg={address.trim() ? 'primary700' : 'btnDisabled'}
            labelColor={address.trim() ? 'black' : 'gray600'}
            disabled={!address.trim() || isLoading}
          />
        </Box>
      )}

      <LoadingBlur visible={isLoading} text="Verifying your passkey…" />
    </Box>
  );
};

export default SignInPasskey;
