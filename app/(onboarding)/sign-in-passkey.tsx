/**
 * SignInPasskey — restore access to an existing smart account on a device
 * that has never used it before, using a synced platform passkey (Google
 * Password Manager / iCloud Keychain).
 *
 * Primary path:
 *   Discovery (handleUseSyncedPasskey) — one WebAuthn ceremony with no
 *   address and no allowCredentials, resolved server-side via
 *   lookupWalletByPasskey (latch-api's passkey-credentials index). No
 *   local SecureStore state is required and nothing is typed.
 *
 * Manual entry fallback:
 *   Commented out per user request; preserved below in comments for reference.
 *
 * Either way, the account itself is only ever trusted from the chain: the
 * OS ceremony locates the credential, and latch-api verifies the resulting
 * assertion against the account's on-chain webauthn signer — never against
 * anything this device claims locally.
 */

import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Header from '@/src/components/shared/Header';
// import Input from '@/src/components/shared/Input';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import * as Sentry from '@sentry/react-native';

import { lookupWalletByPasskey } from '@/src/api/passkey-credential';
import { getNetworkId, PASSKEY_RP_ID } from '@/src/constants/config';
import { storePlatformPasskeyCredentialAtIndex } from '@/src/lib/passkey-webauthn';
import { isPlatformPasskeySupported } from '@/src/lib/platform-passkey';
import { storePasskeyLabel } from '@/src/lib/provision-passkey';
import { signInToExistingWalletWithPlatformPasskey } from '@/src/lib/wallet-auth';
import { getPasskeyStorageKeys, useWalletStore } from '@/src/store/wallet';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
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

  const [isLoading, setIsLoading] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformSupported = isPlatformPasskeySupported();
  const isBusy = isLoading || isDiscovering;

  /*
  // ─── Manual Address Entry (Disabled per request — kept for reference) ────
  const [address, setAddress] = useState('');
  const trimmedAddress = address.trim();
  const isAddressValid = trimmedAddress.startsWith('C') && trimmedAddress.length >= 20;

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
    await completeSignIn(trimmed);
  };
  */

  /**
   * Runs the actual sign-in ceremony once an address is known, however it
   * was found. `discovered` is only present on the no-address path — it's
   * what the passkey-credentials index returned, and gets persisted locally
   * the same way provisionPasskeyAtIndex would have, so the account's name
   * survives past this one sign-in rather than starting over as "Account N".
   */
  const completeSignIn = async (
    smartAccountAddress: string,
    discovered?: { label: string; seq: number },
  ) => {
    setError(null);
    setIsLoading(true);
    try {
      const result = await signInToExistingWalletWithPlatformPasskey(smartAccountAddress);

      const listIndex = accounts.length;
      // signInToExistingWalletWithPlatformPasskey ran its ceremony under
      // PASSKEY_RP_ID, so that is the RP this credential answers to.
      await storePlatformPasskeyCredentialAtIndex(
        { credentialId: result.credentialId, keyDataHex: result.keyDataHex },
        listIndex,
        PASSKEY_RP_ID,
      );
      if (discovered?.label) {
        await storePasskeyLabel(getPasskeyStorageKeys(listIndex), discovered.label, discovered.seq);
      }

      await appendAccount(
        {
          index: -1,
          name: discovered?.label || `Account ${listIndex + 1}`,
          gAddress: '',
          publicKeyHex: '',
          smartAccountAddress,
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
        extra: { smartAccountAddress },
      });
      setError(e?.message ?? 'Sign in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * The no-address path: one WebAuthn ceremony, no allowCredentials, resolved
   * against latch-api's passkey-credentials index. Every way this can fail —
   * no synced credential for this app, an expired nonce, a bad signature —
   * is reported by the backend identically on purpose (see
   * PasskeyCredentialService in latch-api), so the message here stays
   * generic too.
   */
  const handleUseSyncedPasskey = async () => {
    Keyboard.dismiss();
    setError(null);
    setIsDiscovering(true);
    try {
      const found = await lookupWalletByPasskey();
      // Discovery is done — the loading text below should say "Verifying"
      // for the second ceremony completeSignIn is about to run, not still
      // "Looking for your wallet".
      setIsDiscovering(false);
      await completeSignIn(found.smartAccountAddress, { label: found.label, seq: found.seq });
    } catch (e: any) {
      Sentry.captureException(e instanceof Error ? e : new Error(String(e?.message ?? e)), {
        tags: { scope: 'sign-in-passkey-discovery', network: getNetworkId() },
      });
      setError(
        "Couldn't find a wallet with a passkey on this device. Make sure you're using the same Google or iCloud account.",
      );
      setIsDiscovering(false);
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

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.m,
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 24) + 16,
          flexGrow: 1,
        }}
        style={{ flex: 1 }}
      >
        {/* Navigation Header */}
        <Box mb="s">
          <Header />
        </Box>

        {/* Title Section */}
        <Box alignItems="center" mt="s" mb="l">
          <Text variant="h7" fontSize={30} fontWeight="700" textAlign="center" color="textPrimary">
            Sign In with Passkey
          </Text>
          <Text
            variant="p6"
            color="textSecondary"
            mt="s"
            textAlign="center"
            style={{ maxWidth: 330, lineHeight: 22 }}
          >
            {platformSupported
              ? 'Restore your wallet seamlessly using your passkey synced to Google Password Manager or iCloud Keychain.'
              : "This device doesn't support synced passkeys. Try another recovery method below."}
          </Text>
        </Box>

        {/* Alert / Error Banner */}
        {error && (
          <Box
            borderWidth={1}
            borderColor="danger900"
            borderRadius={14}
            padding="m"
            mb="l"
            flexDirection="row"
            alignItems="flex-start"
            gap="s"
            style={{ backgroundColor: 'rgba(254, 95, 56, 0.08)' }}
          >
            <Ionicons
              name="alert-circle"
              size={20}
              color={theme.colors.danger900}
              style={{ marginTop: 2 }}
            />
            <Text variant="p7" color="danger900" style={{ flex: 1, lineHeight: 20 }}>
              {error}
            </Text>
            <TouchableOpacity
              onPress={() => setError(null)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={theme.colors.danger900} />
            </TouchableOpacity>
          </Box>
        )}

        {platformSupported ? (
          <Box flex={1} justifyContent="space-between">
            {/* Center Visual & Feature Highlight */}
            <Box alignItems="center" my="m">
              {/* Passkey Graphic Badge */}
              <Box
                width={100}
                height={100}
                borderRadius={30}
                backgroundColor="bg11"
                borderWidth={1.5}
                alignItems="center"
                justifyContent="center"
                mb="l"
                style={{
                  borderColor: 'rgba(255, 173, 0, 0.35)',
                  shadowColor: theme.colors.primary700,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 16,
                  elevation: 5,
                }}
              >
                <Ionicons name="finger-print" size={58} color={theme.colors.primary700} />
              </Box>

              {/* Benefits Card */}
              <Box
                backgroundColor="bg11"
                borderRadius={20}
                borderWidth={1}
                borderColor="gray800"
                padding="m"
                width="100%"
                gap="m"
              >
                {/* Feature 1 */}
                <Box flexDirection="row" alignItems="center" gap="m">
                  <Box
                    width={40}
                    height={40}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                    style={{ backgroundColor: 'rgba(255, 173, 0, 0.12)' }}
                  >
                    <Ionicons name="sparkles" size={20} color={theme.colors.primary700} />
                  </Box>
                  <Box flex={1}>
                    <Text variant="h10" color="textPrimary" fontWeight="700">
                      Zero Typing
                    </Text>
                    <Text variant="p8" color="textSecondary" mt="xs">
                      No seed phrases, passwords, or contract addresses to enter
                    </Text>
                  </Box>
                </Box>

                <Box height={1} backgroundColor="gray800" />

                {/* Feature 2 */}
                <Box flexDirection="row" alignItems="center" gap="m">
                  <Box
                    width={40}
                    height={40}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                    style={{ backgroundColor: 'rgba(255, 173, 0, 0.12)' }}
                  >
                    <Ionicons name="shield-checkmark" size={20} color={theme.colors.primary700} />
                  </Box>
                  <Box flex={1}>
                    <Text variant="h10" color="textPrimary" fontWeight="700">
                      Hardware Protected
                    </Text>
                    <Text variant="p8" color="textSecondary" mt="xs">
                      Your signing key never leaves your device&apos;s Secure Enclave
                    </Text>
                  </Box>
                </Box>

                <Box height={1} backgroundColor="gray800" />

                {/* Feature 3 */}
                <Box flexDirection="row" alignItems="center" gap="m">
                  <Box
                    width={40}
                    height={40}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                    style={{ backgroundColor: 'rgba(255, 173, 0, 0.12)' }}
                  >
                    <Ionicons name="cloud-done" size={20} color={theme.colors.primary700} />
                  </Box>
                  <Box flex={1}>
                    <Text variant="h10" color="textPrimary" fontWeight="700">
                      Synced Across Devices
                    </Text>
                    <Text variant="p8" color="textSecondary" mt="xs">
                      Backed up with Google Password Manager or iCloud Keychain
                    </Text>
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* Bottom Actions */}
            <Box mt="l" gap="m">
              <Button
                label={isDiscovering ? 'Looking for your passkey…' : 'Find My Wallet'}
                variant="primary"
                onPress={handleUseSyncedPasskey}
                bg="primary700"
                labelColor="black"
                disabled={isBusy}
                loading={isDiscovering}
                leftIcon={
                  !isDiscovering ? (
                    <Ionicons name="finger-print" size={20} color="black" />
                  ) : undefined
                }
              />

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => router.push('/(onboarding)/import-phrase')}
                disabled={isBusy}
                style={{ alignItems: 'center', paddingVertical: 8 }}
              >
                <Text variant="p7" color="textSecondary">
                  Don&apos;t have a passkey?{' '}
                  <Text variant="p7" color="primary700" fontWeight="600">
                    Import Recovery Phrase
                  </Text>
                </Text>
              </TouchableOpacity>
            </Box>
          </Box>
        ) : (
          /* Unsupported Platform State */
          <Box
            backgroundColor="bg11"
            borderRadius={18}
            borderWidth={1}
            borderColor="gray800"
            padding="l"
            alignItems="center"
            mb="m"
          >
            <Box
              width={64}
              height={64}
              borderRadius={20}
              alignItems="center"
              justifyContent="center"
              mb="m"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
            >
              <Ionicons name="hardware-chip-outline" size={32} color={theme.colors.gray500} />
            </Box>
            <Text variant="h10" color="textPrimary" fontWeight="700" textAlign="center" mb="xs">
              Passkeys Not Supported
            </Text>
            <Text
              variant="p7"
              color="textSecondary"
              textAlign="center"
              lineHeight={20}
              mb="l"
              style={{ maxWidth: 280 }}
            >
              This device or operating system does not support synced platform passkeys. You can
              still access your wallet using another method.
            </Text>

            <Box width="100%" gap="s">
              <Button
                label="Import Recovery Phrase"
                variant="primary"
                onPress={() => router.push('/(onboarding)/import-phrase')}
                bg="primary700"
                labelColor="black"
              />
              <Button
                label="Recover with Email"
                variant="outline"
                onPress={() =>
                  router.push({
                    pathname: '/(onboarding)/collect-email',
                    params: { mode: 'recovery' },
                  })
                }
                labelColor="textWhite"
                borderColor="gray800"
              />
            </Box>
          </Box>
        )}

        {/*
        // ─── Manual Address Entry UI (Disabled per request — kept for reference) ────
        // {platformSupported && (
        //   <Box
        //     backgroundColor="bg11"
        //     borderRadius={18}
        //     borderWidth={1}
        //     borderColor="gray800"
        //     padding="m"
        //     mb="m"
        //   >
        //     <Box flexDirection="row" alignItems="center" gap="s" mb="xs">
        //       <Box
        //         width={36}
        //         height={36}
        //         borderRadius={10}
        //         alignItems="center"
        //         justifyContent="center"
        //         style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
        //       >
        //         <Ionicons name="wallet-outline" size={18} color={theme.colors.textPrimary} />
        //       </Box>
        //       <Box flex={1}>
        //         <Text variant="h10" color="textPrimary" fontWeight="700">
        //           Smart Account Address
        //         </Text>
        //         <Text variant="p8" color="textSecondary">
        //           Enter the contract address starting with "C"
        //         </Text>
        //       </Box>
        //     </Box>
        //     <Box mt="s">
        //       <Input
        //         placeholder="C..."
        //         value={address}
        //         onChangeText={(t) => {
        //           setAddress(t);
        //           setError(null);
        //         }}
        //         autoCapitalize="characters"
        //         autoCorrect={false}
        //         status={error ? 'danger' : 'basic'}
        //         rightElement={
        //           address.length > 0 ? (
        //             <TouchableOpacity
        //               activeOpacity={0.7}
        //               onPress={() => {
        //                 setAddress('');
        //                 setError(null);
        //               }}
        //               hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        //             >
        //               <Ionicons name="close-circle" size={20} color={theme.colors.gray600} />
        //             </TouchableOpacity>
        //           ) : (
        //             <TouchableOpacity activeOpacity={0.7} onPress={handlePaste}>
        //               <Box
        //                 backgroundColor="primary"
        //                 paddingHorizontal="m"
        //                 paddingVertical="xs"
        //                 borderRadius={8}
        //               >
        //                 <Text variant="p8" color="black" fontWeight="700">
        //                   Paste
        //                 </Text>
        //               </Box>
        //             </TouchableOpacity>
        //           )
        //         }
        //       />
        //     </Box>
        //     {trimmedAddress.length > 0 && (
        //       <Box flexDirection="row" alignItems="center" gap="xs" mt="s">
        //         <Ionicons
        //           name={isAddressValid ? 'checkmark-circle' : 'information-circle-outline'}
        //           size={14}
        //           color={isAddressValid ? theme.colors.primary700 : theme.colors.gray500}
        //         />
        //         <Text
        //           variant="caption"
        //           fontSize={12}
        //           color={isAddressValid ? 'primary700' : 'textSecondary'}
        //         >
        //           {isAddressValid
        //             ? 'Valid contract address format'
        //             : 'Must be a valid Soroban address starting with C'}
        //         </Text>
        //       </Box>
        //     )}
        //     <Box mt="m">
        //       <Button
        //         label={isLoading ? 'Verifying Passkey…' : 'Sign In With Address'}
        //         variant={isAddressValid ? 'primary' : 'disabled'}
        //         onPress={handleSignIn}
        //         bg={isAddressValid ? 'primary700' : 'btnDisabled'}
        //         labelColor={isAddressValid ? 'black' : 'gray600'}
        //         disabled={!isAddressValid || isBusy}
        //         loading={isLoading}
        //         leftIcon={
        //           isAddressValid && !isLoading ? (
        //             <Ionicons name="key-outline" size={18} color="black" />
        //           ) : undefined
        //         }
        //       />
        //     </Box>
        //   </Box>
        // )}
        */}
      </ScrollView>

      <LoadingBlur
        visible={isBusy}
        text={isDiscovering ? 'Looking for your wallet…' : 'Verifying your passkey…'}
      />
    </Box>
  );
};

export default SignInPasskey;
