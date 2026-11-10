/**
 * CollectEmail — two-phase screen for email-based auth and account recovery.
 *
 * mode=register (default): onboarding flow
 *   Phase 1 → POST /auth/register → Phase 2 → POST /auth/verify → set-recovery-password (set)
 *
 * mode=recovery: account recovery flow
 *   Phase 1 → POST /recovery/initiate → Phase 2 → POST /recovery/verify
 *           → set-recovery-password (enter) → client-side decrypt → set-pin
 */

import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import {
  checkEmailHasBackup,
  clearEmailSession,
  getBackupStatus,
  initiateRecovery,
  registerEmail,
  saveAuthTokens,
  verifyOTP,
  verifyRecoveryOTP,
} from '@/src/api/latch-auth';
import {
  RoundBackButton,
  SetupButton,
  SetupHeading,
} from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import { LATCH_PRIVACY_URL } from '@/src/constants/constants';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import {
  Linking,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Phase = 'email' | 'otp';

const CollectEmail = () => {
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { mode, flow } = useLocalSearchParams<{ mode?: string; flow?: string }>();
  const isRecovery = mode === 'recovery';
  const accounts = useWalletStore((s) => s.accounts);

  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpInputRef = useRef<TextInput>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendCooldown = () => {
    setResendCooldown(60);
    cooldownTimer.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      if (isRecovery) {
        await initiateRecovery(trimmed);
      } else {
        // Pre-OTP collision check: if this email already anchors a wallet,
        // tell the user up front rather than letting them go through OTP
        // and onboarding only to fail at upload time.
        const hasBackup = await checkEmailHasBackup(trimmed);
        if (hasBackup) {
          setError(
            'This email is already tied to another wallet. Use a different email, or recover the existing wallet from the previous screen.',
          );
          return;
        }
        await registerEmail(trimmed);
      }
      setEmail(trimmed);
      setPhase('otp');
      startResendCooldown();
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      if (isRecovery) {
        const recoveryToken = await verifyRecoveryOTP(email, otp.trim());
        // Navigate to set-recovery-password to collect the password needed to
        // decrypt the backup client-side. That screen calls fetchAndRestoreBackup.
        router.replace({
          pathname: '/(onboarding)/set-recovery-password',
          params: { mode: 'enter', recoveryToken },
        });
      } else {
        const { accessToken, refreshToken } = await verifyOTP(email, otp.trim());
        await saveAuthTokens(accessToken, refreshToken, email);
        // Each Latch email anchors at most one wallet. If foo@ already has a
        // backup, confirm it actually belongs to a wallet present on THIS
        // device — checking every local account's smartAccountAddress and
        // mnemonic-derived gAddress, not just the active/primary one — before
        // trusting the registration we just completed. If it doesn't match
        // any local wallet, clear the session and prompt for a different
        // email instead of letting the user invest in onboarding only to
        // fail at upload time (or silently overwrite a stranger's backup).
        const status = await getBackupStatus();
        if (status.exists) {
          const localAddresses = new Set<string>();
          accounts.forEach((a) => {
            if (a.smartAccountAddress) localAddresses.add(a.smartAccountAddress);
            if (a.gAddress) localAddresses.add(a.gAddress);
          });
          const matchesDevice =
            !!status.smartAccountAddress && localAddresses.has(status.smartAccountAddress);
          if (!matchesDevice) {
            await clearEmailSession();
            setPhase('email');
            setOtp('');
            setError(
              "This email's existing backup doesn't match any wallet on this device. Use a different email, or recover the existing wallet from the previous screen.",
            );
            return;
          }
        }
        // Navigate to set-recovery-password to collect the password that will
        // encrypt the backup before it is uploaded in deploy-account.
        router.replace({
          pathname: '/(onboarding)/set-recovery-password',
          params: { mode: 'set', flow },
        });
      }
    } catch (err: any) {
      setError(err?.message ?? 'Invalid or expired code. Please try again.');
      setOtp('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setOtp('');
    setError('');
    setIsLoading(true);
    try {
      if (isRecovery) {
        await initiateRecovery(email);
      } else {
        await registerEmail(email);
      }
      startResendCooldown();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to resend code.');
    } finally {
      setIsLoading(false);
    }
  };

  const title = isRecovery
    ? phase === 'email'
      ? 'Recover Your Account'
      : 'Check Your Email'
    : phase === 'email'
      ? 'Protect Your Wallet With 2FA'
      : 'Check Your Email';

  const subtitle = isRecovery
    ? phase === 'email'
      ? 'Enter the email you used when setting up Latch.'
      : `We sent a recovery code to ${email}`
    : phase === 'email'
      ? 'Secure your funds with 2FA.'
      : `We sent a verification code to ${email}`;

  return (
    <Box
      flex={1}
      backgroundColor="surfaceBase"
      paddingHorizontal="l"
      style={{ paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 24) }}
    >
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        bottomOffset={16}
        keyboardShouldPersistTaps="handled"
      >
        <StatusBar style={statusBarStyle} />

        {/* Header */}
        <Box mb="m">
          <RoundBackButton
            onPress={() => {
              if (phase === 'otp') {
                setPhase('email');
                setOtp('');
                setError('');
              } else {
                router.back();
              }
            }}
            disabled={isLoading}
          />
        </Box>

        {/* Title */}
        <Box mt="l" mb="xxl">
          <SetupHeading title={title} subtitle={subtitle} />
        </Box>

        {/* Input */}
        {phase === 'email' ? (
          <>
            <Text variant="h11" mb="xs">
              Email Address
            </Text>
            <Box
              backgroundColor="inputBox"
              borderWidth={1}
              borderColor="inputOutline"
              borderRadius={16}
              paddingHorizontal="m"
              height={56}
              justifyContent="center"
              mb="s"
            >
              <TextInput
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  setError('');
                }}
                placeholder="your@email.com"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={handleSendCode}
                style={[
                  styles.input,
                  {
                    flex: 1,
                    color: theme.colors.textPrimary,
                    fontFamily: 'SFproRegular',
                    fontSize: 16,
                    letterSpacing: -0.32,
                    padding: 0,
                  },
                ]}
              />
            </Box>
            <Text variant="caption" color="textSubheading" mb="m">
              We use email for security alerts, for unsubscribing, and other details. See our
              <Text
                variant="caption"
                color="primary700"
                fontWeight="600"
                onPress={() => LATCH_PRIVACY_URL && Linking.openURL(LATCH_PRIVACY_URL)}
              >
                {' '}
                privacy policy
              </Text>
            </Text>
          </>
        ) : (
          <Box
            backgroundColor="inputBox"
            borderWidth={1}
            borderColor="inputOutline"
            borderRadius={16}
            paddingHorizontal="m"
            height={56}
            justifyContent="center"
            mb="m"
          >
            <TextInput
              ref={otpInputRef}
              value={otp}
              onChangeText={(t) => {
                setOtp(t.replace(/\D/g, '').slice(0, 6));
                setError('');
              }}
              placeholder="6-digit code"
              placeholderTextColor={theme.colors.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
              // returnKeyType="done"
              onSubmitEditing={handleVerify}
              style={[styles.input, { color: theme.colors.textPrimary }]}
            />
          </Box>
        )}

        {/* Error */}
        {error !== '' && (
          <Text variant="body" color="danger900" textAlign="center" mb="m">
            {error}
          </Text>
        )}

        {/* Primary button */}
        <Box mt={'auto'}>
          <SetupButton
            label={
              isLoading
                ? ''
                : phase === 'email'
                  ? 'Send Code'
                  : isRecovery
                    ? 'Recover Account'
                    : 'Verify'
            }
            busy={isLoading}
            onPress={phase === 'email' ? handleSendCode : handleVerify}
            mt={'auto'}
          />
          {phase === 'otp' && (
            <Box alignItems="center" mt="l">
              <TouchableOpacity
                onPress={handleResend}
                disabled={resendCooldown > 0 || isLoading}
                activeOpacity={0.7}
              >
                <Text
                  variant="body"
                  color={resendCooldown > 0 ? 'textSecondary' : 'primary700'}
                  fontWeight="600"
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </Box>
          )}
          {phase === 'email' && !isRecovery && flow !== 're-anchor' && (
            <Box alignItems="center" mt="l">
              <TouchableOpacity
                onPress={() => router.replace('/(onboarding)/deploy-account')}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                <Text variant="body" color="textSubheading">
                  Skip for now
                </Text>
              </TouchableOpacity>
            </Box>
          )}
        </Box>

        {/* Loading indicator inside button area */}
        {/* {isLoading && (
          <Box position="absolute" alignSelf="center" style={{ top: '55%' }}>
            <ActivityIndicator color={theme.colors.primary700} />
          </Box>
        )} */}

        {/* Resend */}

        {/* Skip (register mode only) */}
      </KeyboardAwareScrollView>
      <LoadingBlur visible={isLoading} text="Submitting..." />
    </Box>
  );
};

const styles = StyleSheet.create({
  input: {
    fontSize: 16,
    flex: 1,
    padding: 0,
  },
});

export default CollectEmail;
