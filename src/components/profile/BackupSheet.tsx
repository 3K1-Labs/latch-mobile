import {
  checkBackupExists,
  clearEmailSession,
  LatchAPIError,
  registerEmail,
  saveAuthTokens,
  uploadBackup,
  verifyOTP,
} from '@/src/api/latch-auth';
import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { SECURE_KEYS } from '@/src/store/wallet';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as SecureStore from 'expo-secure-store';
import { Formik } from 'formik';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Yup from 'yup';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const schema = Yup.object({
  password: Yup.string().min(8, 'Must be at least 8 characters').required('Required'),
  confirm: Yup.string()
    .oneOf([Yup.ref('password')], 'Passwords do not match')
    .required('Required'),
});

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Phase = 'checking' | 'add-email' | 'backup';
type EmailSubPhase = 'email' | 'otp';

const BackupSheet = ({ visible, onClose }: Props) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const [backupExists, setBackupExists] = useState<boolean | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  // Determined fresh on every open: a session with no ACCESS_TOKEN has no
  // email attached at all, distinct from "email attached, no backup yet" —
  // getBackupStatus() collapses both to `false`, which is why this can't
  // reuse backupExists alone (see BackupSheet email-collection fix).
  const [phase, setPhase] = useState<Phase>('checking');
  const [emailSubPhase, setEmailSubPhase] = useState<EmailSubPhase>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  // True when we land on add-email because a previously-valid session died
  // (401 that survived latchFetch's refresh attempt), not because there was
  // never one — lets the copy say "session expired" instead of "no email".
  const [sessionExpired, setSessionExpired] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const enterAddEmailPhase = (expired: boolean) => {
    setPhase('add-email');
    setEmailSubPhase('email');
    setEmail('');
    setOtp('');
    setEmailError('');
    setSessionExpired(expired);
    setRegisteredEmail(null);
  };

  useEffect(() => {
    if (visible) {
      // Reset synchronously so a stale phase/backupExists from the sheet's
      // previous open never renders while this open's check is in flight —
      // the component stays mounted across opens (Modal visibility toggle,
      // not conditional render), so without this the old result would show
      // until the new check resolves and overwrites it.
      let cancelled = false;
      setPhase('checking');
      setBackupExists(null);

      SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN).then((accessToken) => {
        if (cancelled) return;
        if (!accessToken) {
          enterAddEmailPhase(false);
          return;
        }
        SecureStore.getItemAsync(SECURE_KEYS.USER_EMAIL).then((storedEmail) => {
          if (!cancelled) setRegisteredEmail(storedEmail);
        });
        checkBackupExists()
          .then((exists) => {
            if (cancelled) return;
            setBackupExists(exists);
            setPhase('backup');
          })
          .catch((err) => {
            if (cancelled) return;
            if (err instanceof LatchAPIError && err.status === 401) {
              // Both access and refresh tokens are dead. Clear the stale
              // session so we don't keep retrying against it, and prompt
              // for email again instead of showing a password form that
              // can only fail with "Not authenticated".
              clearEmailSession().catch(() => {});
              enterAddEmailPhase(true);
              return;
            }
            // Ambiguous failure (network blip, 500) — fall back to today's
            // behavior rather than forcing a re-login over a flaky connection.
            setBackupExists(false);
            setPhase('backup');
          });
      });

      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 25,
        mass: 1,
        stiffness: 150,
      }).start();

      return () => {
        cancelled = true;
      };
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

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
      setEmailError('Please enter a valid email address.');
      return;
    }
    setIsEmailSubmitting(true);
    setEmailError('');
    try {
      await registerEmail(trimmed);
      setEmail(trimmed);
      setEmailSubPhase('otp');
      startResendCooldown();
    } catch (err: any) {
      setEmailError(err?.message ?? 'Failed to send code. Please try again.');
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handleVerifyCode = async () => {
    if (otp.trim().length !== 6) {
      setEmailError('Enter the 6-digit code from your email.');
      return;
    }
    setIsEmailSubmitting(true);
    setEmailError('');
    try {
      const { accessToken, refreshToken } = await verifyOTP(email, otp.trim());
      await saveAuthTokens(accessToken, refreshToken, email);
      setRegisteredEmail(email);
      setPhase('backup');
      checkBackupExists()
        .then(setBackupExists)
        .catch(() => setBackupExists(false));
    } catch (err: any) {
      setEmailError(err?.message ?? 'Invalid or expired code. Please try again.');
      setOtp('');
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0) return;
    setOtp('');
    setEmailError('');
    setIsEmailSubmitting(true);
    try {
      await registerEmail(email);
      startResendCooldown();
    } catch (err: any) {
      setEmailError(err?.message ?? 'Failed to resend code.');
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handleSubmit = async (
    values: { password: string; confirm: string },
    { setSubmitting, setFieldError, resetForm }: any,
  ) => {
    try {
      await SecureStore.setItemAsync(SECURE_KEYS.RECOVERY_PASSWORD_SESSION, values.password);
      await uploadBackup();
      setBackupExists(true);
      resetForm();
      Toast.show({
        type: 'success',
        text1: 'Backup saved',
        text2: 'Your wallet is now backed up.',
      });
      onClose();
    } catch (err: any) {
      await SecureStore.deleteItemAsync(SECURE_KEYS.RECOVERY_PASSWORD_SESSION).catch(() => {});
      // 409 ADDRESS_MISMATCH means foo@ already anchors a different wallet.
      // Surface a friendly directive — the user's only path forward is a
      // different email since they can't change the wallet on this device.
      const isMismatch =
        err instanceof LatchAPIError && (err.status === 409 || err.code === 'ADDRESS_MISMATCH');
      setFieldError(
        'password',
        isMismatch
          ? 'This email is already linked to a different wallet. Use a different email to back up this one.'
          : (err?.message ?? 'Backup failed. Please try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveEmail = () => {
    Alert.alert(
      'Remove email?',
      'This removes the registered email from this device only — it does not sign you out. Your existing backup stays on the server; you can re-register the same or a different email anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearEmailSession();
            setBackupExists(false);
            enterAddEmailPhase(false);
          },
        },
      ],
    );
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
              height: SHEET_HEIGHT,
            },
          ]}
        >
          <BottomSheetHandle />

          {/* Header */}
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="m"
            py="m"
            mb="s"
          >
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text variant="h8" color="textPrimary" fontWeight="700">
              Wallet Backup
            </Text>
            <Box width={40} />
          </Box>

          <KeyboardAwareScrollView
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16 }}
            bottomOffset={16}
            showsVerticalScrollIndicator={false}
          >
            {phase === 'checking' ? (
              <Box flex={1} justifyContent="center" alignItems="center">
                <ActivityIndicator color={theme.colors.primary700} />
              </Box>
            ) : phase === 'add-email' ? (
              <Box flex={1}>
                <Box
                  backgroundColor="bg11"
                  borderRadius={16}
                  padding="m"
                  flexDirection="row"
                  alignItems="center"
                  mb="l"
                >
                  <Box
                    width={36}
                    height={36}
                    borderRadius={10}
                    style={{ backgroundColor: isDark ? '#1E1E1E' : theme.colors.gray200 }}
                    justifyContent="center"
                    alignItems="center"
                    mr="m"
                  >
                    <Ionicons
                      name="mail-outline"
                      size={20}
                      color={theme.colors.textSecondary}
                    />
                  </Box>
                  <Box flex={1}>
                    <Text variant="p7" color="textPrimary" fontWeight="600">
                      {sessionExpired ? 'Your session expired' : 'No email on this session'}
                    </Text>
                    <Text variant="p8" color="textSecondary" mt="xs">
                      {sessionExpired
                        ? 'Re-enter your email to continue backing up your wallet.'
                        : 'Add an email to enable wallet backup.'}
                    </Text>
                  </Box>
                </Box>

                {emailSubPhase === 'email' ? (
                  <Input
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      setEmailError('');
                    }}
                    placeholder="your@email.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="send"
                    onSubmitEditing={handleSendCode}
                  />
                ) : (
                  <>
                    <Text variant="p8" color="textSecondary" mb="s">
                      We sent a code to {email}
                    </Text>
                    <Input
                      value={otp}
                      onChangeText={(t) => {
                        setOtp(t.replace(/\D/g, '').slice(0, 6));
                        setEmailError('');
                      }}
                      placeholder="6-digit code"
                      keyboardType="number-pad"
                      maxLength={6}
                      onSubmitEditing={handleVerifyCode}
                    />
                  </>
                )}

                {emailError !== '' ? (
                  <Text variant="p8" color="danger900" mt="xs" mb="s" ml="xs">
                    {emailError}
                  </Text>
                ) : (
                  <Box mb="s" />
                )}

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={emailSubPhase === 'email' ? handleSendCode : handleVerifyCode}
                  disabled={isEmailSubmitting}
                  style={{ marginTop: 'auto' }}
                >
                  <Box
                    height={64}
                    backgroundColor={isEmailSubmitting ? 'btnDisabled' : 'primary700'}
                    borderRadius={32}
                    justifyContent="center"
                    alignItems="center"
                  >
                    {isEmailSubmitting ? (
                      <ActivityIndicator color={theme.colors.gray600} />
                    ) : (
                      <Text variant="h10" color="black" fontWeight="700">
                        {emailSubPhase === 'email' ? 'Send Code' : 'Verify'}
                      </Text>
                    )}
                  </Box>
                </TouchableOpacity>

                {emailSubPhase === 'otp' && (
                  <Box alignItems="center" mt="l">
                    <TouchableOpacity
                      onPress={handleResendCode}
                      disabled={resendCooldown > 0 || isEmailSubmitting}
                      activeOpacity={0.7}
                    >
                      <Text
                        variant="p8"
                        color={resendCooldown > 0 ? 'textSecondary' : 'primary700'}
                        fontWeight="600"
                      >
                        {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                      </Text>
                    </TouchableOpacity>
                  </Box>
                )}
              </Box>
            ) : (
              <>
                {/* Status row */}
                <Box
                  backgroundColor="bg11"
                  borderRadius={16}
                  padding="m"
                  flexDirection="row"
                  alignItems="center"
                  mb="l"
                >
                  <Box
                    width={36}
                    height={36}
                    borderRadius={10}
                    style={{ backgroundColor: isDark ? '#1E1E1E' : theme.colors.gray200 }}
                    justifyContent="center"
                    alignItems="center"
                    mr="m"
                  >
                    <Ionicons
                      name={backupExists ? 'cloud-done-outline' : 'cloud-offline-outline'}
                      size={20}
                      color={backupExists ? theme.colors.primary700 : theme.colors.textSecondary}
                    />
                  </Box>
                  <Box flex={1}>
                    <Text variant="p7" color="textPrimary" fontWeight="600">
                      {backupExists === null
                        ? 'Checking status…'
                        : backupExists
                          ? 'Backup exists'
                          : 'No backup found'}
                    </Text>
                    <Text variant="p8" color="textSecondary" mt="xs">
                      {backupExists
                        ? 'Enter your recovery password to update it.'
                        : 'Set a recovery password to back up your wallet.'}
                    </Text>
                    {registeredEmail ? (
                      <Box flexDirection="row" alignItems="center" mt="xs">
                        <Text variant="p8" color="textSecondary">
                          Registered email: {registeredEmail}
                        </Text>
                      </Box>
                    ) : null}
                  </Box>
                  {registeredEmail ? (
                    <TouchableOpacity onPress={handleRemoveEmail} hitSlop={8}>
                      <Text variant="p8" color="danger900" fontWeight="600">
                        Remove
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </Box>

                <Formik
                  initialValues={{ password: '', confirm: '' }}
                  validationSchema={schema}
                  onSubmit={handleSubmit}
                >
                  {({
                    handleChange,
                    handleBlur,
                    handleSubmit: submit,
                    values,
                    errors,
                    touched,
                    isSubmitting,
                  }) => (
                    <Box flex={1}>
                      <Input
                        value={values.password}
                        onChangeText={handleChange('password')}
                        onBlur={handleBlur('password')}
                        placeholder="Recovery password"
                        secureTextEntry
                        showPasswordToggle
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        status={touched.password && errors.password ? 'danger' : 'basic'}
                      />
                      {touched.password && errors.password ? (
                        <Text variant="p8" color="danger900" mt="xs" mb="s" ml="xs">
                          {errors.password}
                        </Text>
                      ) : (
                        <Box mb="s" />
                      )}

                      <Input
                        value={values.confirm}
                        onChangeText={handleChange('confirm')}
                        onBlur={handleBlur('confirm')}
                        placeholder="Confirm password"
                        secureTextEntry
                        showPasswordToggle
                        autoCapitalize="none"
                        autoCorrect={false}
                        // returnKeyType="done"
                        onSubmitEditing={() => submit()}
                        status={touched.confirm && errors.confirm ? 'danger' : 'basic'}
                      />
                      {touched.confirm && errors.confirm ? (
                        <Text variant="p8" color="danger900" mt="xs" mb="m" ml="xs">
                          {errors.confirm}
                        </Text>
                      ) : (
                        <Box mb="m" />
                      )}

                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => submit()}
                        disabled={isSubmitting}
                        style={{ marginTop: 'auto' }}
                      >
                        <Box
                          height={64}
                          backgroundColor={isSubmitting ? 'btnDisabled' : 'primary700'}
                          borderRadius={32}
                          justifyContent="center"
                          alignItems="center"
                        >
                          {isSubmitting ? (
                            <ActivityIndicator color={theme.colors.gray600} />
                          ) : (
                            <Text
                              variant="h10"
                              color="black"
                              fontWeight="700"
                            >
                              {backupExists ? 'Update Backup' : 'Back Up Now'}
                            </Text>
                          )}
                        </Box>
                      </TouchableOpacity>
                    </Box>
                  )}
                </Formik>
              </>
            )}
          </KeyboardAwareScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default BackupSheet;
