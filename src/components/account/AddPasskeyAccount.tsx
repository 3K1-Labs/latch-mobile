import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

interface Props {
  onBack: () => void;
  onFind: () => void;
  isSubmitting: boolean;
  errorMessage?: string | null;
  /** False when the device/OS has no synced-passkey support. */
  platformSupported: boolean;
}

/**
 * "Add an account you already have a passkey for" — the in-app twin of the
 * onboarding sign-in-passkey screen. One WebAuthn ceremony with no address
 * and no allowCredentials discovers whichever synced Latch passkey answers,
 * the wallet is resolved server-side, and it joins the account list. See
 * handleAddPasskeyAccount in AccountSwitcherSheet.
 */
const AddPasskeyAccount = ({
  onBack,
  onFind,
  isSubmitting,
  errorMessage,
  platformSupported,
}: Props) => {
  const theme = useTheme<Theme>();

  return (
    <Box flex={1} paddingHorizontal="m" paddingBottom="xl">
      {/* Header */}
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" py="xs" mb="m">
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontWeight="800">
          Add Passkey Account
        </Text>
        <Box width={40} />
      </Box>

      <Box flex={1} justifyContent="space-between">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          <Text variant="p7" color="textSecondary" mb="l" lineHeight={22}>
            {platformSupported
              ? 'Add another Latch account you already have a passkey for. Your passkey is synced through Google Password Manager or iCloud Keychain — no address or recovery phrase to type.'
              : "This device doesn't support synced passkeys, so an existing passkey account can't be added here."}
          </Text>

          {platformSupported && (
            <Box
              backgroundColor="bg11"
              borderRadius={20}
              borderWidth={1}
              borderColor="gray800"
              padding="m"
              gap="m"
            >
              <Box flexDirection="row" alignItems="center" gap="m">
                <Box
                  width={40}
                  height={40}
                  borderRadius={12}
                  alignItems="center"
                  justifyContent="center"
                  style={{ backgroundColor: 'rgba(255, 173, 0, 0.12)' }}
                >
                  <Ionicons name="finger-print" size={20} color={theme.colors.primary700} />
                </Box>
                <Box flex={1}>
                  <Text variant="h10" color="textPrimary" fontWeight="700">
                    Zero Typing
                  </Text>
                  <Text variant="p8" color="textSecondary" mt="xs">
                    Pick the passkey and we resolve the wallet for you
                  </Text>
                </Box>
              </Box>

              <Box height={1} backgroundColor="gray800" />

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
                    Verified On-Chain
                  </Text>
                  <Text variant="p8" color="textSecondary" mt="xs">
                    The account is only trusted from its on-chain signer, never this device
                  </Text>
                </Box>
              </Box>
            </Box>
          )}

          {errorMessage && (
            <Box
              borderWidth={1}
              borderColor="danger900"
              borderRadius={14}
              padding="m"
              mt="l"
              flexDirection="row"
              alignItems="flex-start"
              gap="s"
              style={{ backgroundColor: 'rgba(254, 95, 56, 0.08)' }}
            >
              <Ionicons
                name="alert-circle"
                size={18}
                color={theme.colors.danger900}
                style={{ marginTop: 1 }}
              />
              <Text variant="p8" color="danger900" style={{ flex: 1 }} lineHeight={18}>
                {errorMessage}
              </Text>
            </Box>
          )}
        </ScrollView>

        {platformSupported && (
          <Box>
            <Button
              label={isSubmitting ? 'Looking for your passkey…' : 'Find Account'}
              variant="primary"
              onPress={onFind}
              bg="primary700"
              labelColor="black"
              disabled={isSubmitting}
              loading={isSubmitting}
              leftIcon={
                !isSubmitting ? (
                  <Ionicons name="finger-print" size={20} color="black" />
                ) : undefined
              }
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AddPasskeyAccount;
