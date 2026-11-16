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
import { RoundBackButton, SetupButton, SetupTitle } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
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
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestDiscoveryAfterRestore } from '@/src/lib/membership';
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
      await requestDiscoveryAfterRestore();
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

  const features: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
    {
      icon: 'sparkles',
      title: 'Zero Typing',
      body: 'No seed phrases, passwords, or contract addresses to enter.',
    },
    {
      icon: 'shield-checkmark',
      title: 'Hardware Protected',
      body: "Your signing key never leaves your device's Secure Enclave.",
    },
    {
      icon: 'cloud-done',
      title: 'Synced Across Devices',
      body: 'Backed up with Google Password Manager or iCloud Keychain.',
    },
  ];

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 24) },
        ]}
      >
        <RoundBackButton
          onPress={() => router.canGoBack() && router.back()}
          disabled={isBusy}
        />

        <Box style={styles.title}>
          <SetupTitle title="Sign In with Passkey">
            {platformSupported
              ? 'Restore your wallet using the passkey synced to Google Password Manager or iCloud Keychain.'
              : "This device doesn't support synced passkeys. Use another recovery method below."}
          </SetupTitle>
        </Box>

        {error && (
          <Box
            flexDirection="row"
            alignItems="flex-start"
            gap="s"
            borderWidth={1}
            borderColor="danger900"
            style={styles.errorBox}
          >
            <Ionicons name="alert-circle" size={20} color={theme.colors.danger900} />
            <Text flex={1} fontSize={14} lineHeight={20} color="danger900">
              {error}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              onPress={() => setError(null)}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={theme.colors.danger900} />
            </TouchableOpacity>
          </Box>
        )}

        {platformSupported ? (
          <Box
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            style={styles.card}
          >
            {features.map((f, i) => (
              <Box key={f.title}>
                {i > 0 && <Box height={1} backgroundColor="inputOutline" style={styles.divider} />}
                <Box flexDirection="row" alignItems="center" gap="m">
                  <Box alignItems="center" justifyContent="center" style={styles.iconTile}>
                    <Ionicons name={f.icon} size={18} color="#FFC508" />
                  </Box>
                  <Box flex={1}>
                    <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
                      {f.title}
                    </Text>
                    <Text fontSize={14} lineHeight={20} color="textSubheading">
                      {f.body}
                    </Text>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box
            alignItems="center"
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            style={styles.card}
          >
            <Box alignItems="center" justifyContent="center" style={styles.unsupportedIcon}>
              <Ionicons name="hardware-chip-outline" size={28} color="#706F6F" />
            </Box>
            <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary" textAlign="center">
              Passkeys Not Supported
            </Text>
            <Text fontSize={14} lineHeight={20} color="textSubheading" textAlign="center" mt="xs">
              This device or operating system does not support synced platform passkeys. You can
              still access your wallet another way.
            </Text>
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

        <Box flex={1} />

        {platformSupported ? (
          <Box gap="sm" style={styles.actions}>
            <SetupButton
              label={isDiscovering ? 'Looking for your passkey…' : 'Find My Wallet'}
              onPress={handleUseSyncedPasskey}
              busy={isBusy}
            />
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={() => router.push('/(onboarding)/import-phrase')}
              disabled={isBusy}
              style={styles.link}
            >
              <Text fontSize={14} lineHeight={22} color="textSubheading">
                Don&apos;t have a passkey?{' '}
                <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textPrimary">
                  Import Recovery Phrase
                </Text>
              </Text>
            </TouchableOpacity>
          </Box>
        ) : (
          <Box gap="sm" style={styles.actions}>
            <SetupButton
              label="Import Recovery Phrase"
              onPress={() => router.push('/(onboarding)/import-phrase')}
            />
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              onPress={() =>
                router.push({
                  pathname: '/(onboarding)/collect-email',
                  params: { mode: 'recovery' },
                })
              }
              style={styles.secondaryButton}
            >
              <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
                Recover with Email
              </Text>
            </TouchableOpacity>
          </Box>
        )}
      </ScrollView>

      <LoadingBlur
        visible={isBusy}
        text={isDiscovering ? 'Looking for your wallet…' : 'Verifying your passkey…'}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 56,
  },
  errorBox: {
    marginTop: 24,
    borderRadius: 16,
    padding: 16,
    backgroundColor: 'rgba(254,95,56,0.08)',
  },
  card: {
    marginTop: 32,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  divider: {
    marginVertical: 16,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
  },
  unsupportedIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#1A1A1A',
    marginBottom: 16,
  },
  actions: {
    marginTop: 32,
  },
  link: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryButton: {
    height: 48,
    borderRadius: 100,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SignInPasskey;
