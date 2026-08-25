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
import Input from '@/src/components/shared/Input';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import { storePlatformPasskeyCredentialAtIndex } from '@/src/lib/passkey-webauthn';
import { isPlatformPasskeySupported } from '@/src/lib/platform-passkey';
import { signInToExistingWalletWithPlatformPasskey } from '@/src/lib/wallet-auth';
import { useWalletStore } from '@/src/store/wallet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SignInPasskey = () => {
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accounts, appendAccount } = useWalletStore();

  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformSupported = isPlatformPasskeySupported();

  const handleSignIn = async () => {
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
      await storePlatformPasskeyCredentialAtIndex(
        { credentialId: result.credentialId, keyDataHex: result.keyDataHex },
        listIndex,
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

      <Box
        flex={1}
        paddingHorizontal="m"
        style={{ paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) }}
      >
        <Box alignItems="center" mb="xxl">
          <Text variant="h7" fontSize={30} textAlign="center">
            Sign In With Passkey
          </Text>
          <Text variant="p4" color="textSecondary" mt="m" textAlign="center" width="90%">
            {platformSupported
              ? "Enter your wallet's address. We'll use the passkey synced to this device's Google Password Manager or iCloud Keychain to verify it's yours."
              : "This device doesn't support synced passkeys, so this option isn't available here."}
          </Text>
        </Box>

        {platformSupported && (
          <>
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
              />
              {error && (
                <Text variant="p7" color="danger900" mt="xs">
                  {error}
                </Text>
              )}
            </Box>

            <Box flex={1} />

            <Button
              label="Sign In"
              variant={address.trim() ? 'primary' : 'disabled'}
              onPress={handleSignIn}
              bg={address.trim() ? 'primary700' : 'btnDisabled'}
              labelColor={address.trim() ? 'black' : 'gray600'}
              disabled={!address.trim() || isLoading}
            />
          </>
        )}
      </Box>

      <LoadingBlur visible={isLoading} text="Verifying your passkey…" />
    </Box>
  );
};

export default SignInPasskey;
