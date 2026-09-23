/**
 * add-backup-signer.tsx — mint and authorize a solo backup signer.
 *
 * No pairing code, no QR, no second device present. A platform passkey
 * (src/lib/platform-passkey.ts) is a synced, discoverable credential, so
 * this device can create one and authorize it in a single sitting; if the
 * user wants it to live on a genuinely separate physical device, the OS's
 * own "use another device" ceremony (Bluetooth/QR hybrid transport) handles
 * that without any app-level pairing protocol. See
 * src/lib/backup-signer-tx.ts's module doc for why the first version of this
 * screen (a 6-digit pairing code relayed through a backend route that
 * doesn't exist) was the wrong model, borrowed from the unrelated
 * device-pairing feature.
 *
 * Three steps, mirroring the web extension's AddBackupPasskeyFlow: name the
 * backup → run the ceremony (create, authorize on-chain, confirm) → success.
 */

import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Formik } from 'formik';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Yup from 'yup';

import { fetchDefaultContextRule } from '@/src/api/account-admin';
import { confirmAddBackupSigner } from '@/src/api/backup-signer';
import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import {
  addBackupSignerOnChain,
  BackupSignerAlreadyPresentError,
  createBackupSignerPasskey,
} from '@/src/lib/backup-signer-tx';
import { createLogger } from '@/src/lib/logger';
import { deviceFromPairingResponse } from '@/src/lib/pairing-context';
import { PasskeyProvisionError } from '@/src/lib/provision-passkey';
import { Device, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const log = createLogger('add-backup-signer');

type Step =
  | { kind: 'name' }
  | { kind: 'ceremony'; busyLabel: string }
  /** Nothing landed on-chain yet — safe to just try the whole thing again. */
  | { kind: 'error'; message: string }
  /** The chain call already succeeded before this failed — sends the user to the Signers list to retry confirm, not back to the name step. */
  | { kind: 'confirmError'; message: string }
  | { kind: 'success' };

const NameSchema = Yup.object().shape({
  label: Yup.string().trim().min(1, 'Give this backup a name').required('Give this backup a name'),
});

/**
 * A chain failure's message can be a full Soroban diagnostic dump (event log,
 * contract addresses, hex payloads — hundreds of lines). That's for the log,
 * not the screen: shown raw, it pushes the CTA button off-screen with no way
 * to scroll to it (see the ScrollView below, which is the other half of this
 * fix) and reads as an unresponsive app. Show a short summary; the full
 * message still reaches the logger/Sentry via `log.error` at the call site.
 */
function summarizeError(message: string, max = 240): string {
  const firstLine = message.split('\n')[0]?.trim() || message.trim();
  return firstLine.length > max ? `${firstLine.slice(0, max).trimEnd()}…` : firstLine;
}

export default function AddBackupSigner() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, updateAccountDevices } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];

  const [step, setStep] = useState<Step>({ kind: 'name' });

  const runCeremony = async (label: string) => {
    setStep({ kind: 'ceremony', busyLabel: 'Creating passkey…' });
    try {
      const smartAccountAddress = activeAccount?.smartAccountAddress;
      if (!smartAccountAddress) throw new Error('No deployed smart account.');
      const factoryAddress = STELLAR_FACTORY_ADDRESS;
      if (!factoryAddress)
        throw new Error('Factory address is not configured for the active network.');

      const credential = await createBackupSignerPasskey(label);

      setStep({ kind: 'ceremony', busyLabel: 'Authorizing on-chain…' });
      const defaultRule = await fetchDefaultContextRule(
        { rpcUrl: STELLAR_RPC_URL, networkPassphrase: STELLAR_NETWORK_PASSPHRASE, factoryAddress },
        smartAccountAddress,
      );

      const newSigner = { kind: 'webauthn' as const, keyDataHex: credential.keyDataHex };
      const chainResult = await addBackupSignerOnChain({
        smartAccountAddress,
        defaultRuleId: defaultRule.ruleId,
        newSigner,
        initiatorListIndex: activeAccountIndex,
      });

      // Persist as pending BEFORE calling confirm — durable across the app
      // being killed mid-flow (see Device.pendingConfirm's doc comment).
      const existingDevices = activeAccount.devices ?? [];
      const pendingDevice: Device = {
        ...deviceFromPairingResponse(newSigner, label, chainResult.signerId ?? null),
        isBackupSigner: true,
        pendingConfirm: {
          txHash: chainResult.txHash,
          contextRuleId: defaultRule.ruleId,
          action: 'add',
        },
      };
      await updateAccountDevices(activeAccount.index, [...existingDevices, pendingDevice]);

      setStep({ kind: 'ceremony', busyLabel: 'Confirming with Latch…' });
      const backupCount = existingDevices.filter((d) => d.isBackupSigner).length;
      try {
        const { signerId } = await confirmAddBackupSigner({
          smartAccountAddress,
          contextRuleId: defaultRule.ruleId,
          keyDataHex: chainResult.keyDataHex,
          txHash: chainResult.txHash,
          label,
          seq: backupCount + 1,
        });
        await updateAccountDevices(activeAccount.index, [
          ...existingDevices,
          { ...pendingDevice, onChainSignerId: signerId, pendingConfirm: undefined },
        ]);
        setStep({ kind: 'success' });
      } catch (confirmErr) {
        // The signer is already live on-chain — this is not retryable from
        // scratch. The pending Device above is already saved; direct the
        // user to the Signers list, which can retry confirm alone.
        log.error('confirm-add failed after a successful on-chain add', confirmErr);
        setStep({
          kind: 'confirmError',
          message:
            confirmErr instanceof Error
              ? confirmErr.message
              : 'Latch could not confirm this backup signer yet.',
        });
      }
    } catch (err) {
      if (err instanceof BackupSignerAlreadyPresentError) {
        setStep({
          kind: 'error',
          message: 'This backup passkey is already a signer on this account.',
        });
        return;
      }
      if (err instanceof PasskeyProvisionError && err.kind === 'cancelled') {
        setStep({ kind: 'name' }); // the user backed out of the OS sheet — not an error worth showing
        return;
      }
      setStep({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Box flexDirection="row" alignItems="center" paddingHorizontal="m">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text
          variant="h10"
          color="textPrimary"
          fontFamily="SFproSemibold"
          flex={1}
          textAlign="center"
          mr="xl"
        >
          Add a backup signer
        </Text>
      </Box>

      {step.kind === 'name' && (
        <Formik
          initialValues={{ label: 'Backup' }}
          validationSchema={NameSchema}
          onSubmit={(v) => runCeremony(v.label.trim())}
        >
          {({ values, errors, touched, handleChange, handleBlur, handleSubmit }) => (
            <Box flex={1} paddingHorizontal="l" pt="m">
              <Text variant="p7" color="textSecondary" mb="l" lineHeight={22}>
                This creates a second passkey that can sign for this wallet on its own, either one
                works alone, so this never raises the bar for spending. Name it so you can tell it
                apart later.
              </Text>
              <Text variant="h11" color="textPrimary" mb="s" fontWeight="700">
                Name
              </Text>
              <Input
                value={values.label}
                onChangeText={handleChange('label')}
                onBlur={handleBlur('label')}
                placeholder="Backup"
                autoFocus
                status={touched.label && errors.label ? 'danger' : 'basic'}
              />
              {touched.label && errors.label && (
                <Text variant="h12" color="inputError" mt="xs">
                  {errors.label}
                </Text>
              )}
              <Box flex={1} />
              <TouchableOpacity onPress={() => handleSubmit()} activeOpacity={0.7}>
                <Box
                  height={56}
                  backgroundColor="primary"
                  borderRadius={32}
                  justifyContent="center"
                  alignItems="center"
                  mb="l"
                >
                  <Text variant="h10" color="black" fontWeight="700">
                    Continue
                  </Text>
                </Box>
              </TouchableOpacity>
            </Box>
          )}
        </Formik>
      )}

      {step.kind === 'ceremony' && (
        <Box flex={1} justifyContent="center" alignItems="center" paddingHorizontal="l">
          <ActivityIndicator color={theme.colors.textPrimary} />
          <Text variant="p7" color="textSecondary" mt="m">
            {step.busyLabel}
          </Text>
        </Box>
      )}

      {step.kind === 'success' && (
        <Box flex={1} justifyContent="center" alignItems="center" paddingHorizontal="l">
          <Ionicons name="checkmark-circle" size={48} color={theme.colors.textPrimary} />
          <Text variant="h11" color="textPrimary" mt="m" fontFamily="SFproSemibold">
            Backup signer added
          </Text>
          <TouchableOpacity onPress={() => router.replace('/account-signers')} style={styles.cta}>
            <Text variant="p6" color="textPrimary" fontFamily="SFproSemibold">
              View signers
            </Text>
          </TouchableOpacity>
        </Box>
      )}

      {step.kind === 'error' && (
        <ScrollView style={styles.errorScrollOuter} contentContainerStyle={styles.errorScroll}>
          <Ionicons name="alert-circle" size={40} color={theme.colors.inputError} />
          <Text variant="p7" color="textPrimary" mt="m" textAlign="center">
            {summarizeError(step.message)}
          </Text>
          <TouchableOpacity onPress={() => setStep({ kind: 'name' })} style={styles.cta}>
            <Text variant="p6" color="textPrimary">
              Try again
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {step.kind === 'confirmError' && (
        <ScrollView style={styles.errorScrollOuter} contentContainerStyle={styles.errorScroll}>
          <Ionicons name="alert-circle" size={40} color={theme.colors.inputError} />
          <Text variant="p7" color="textPrimary" mt="m" textAlign="center">
            Backup signer was added on-chain, but Latch couldn&apos;t confirm it yet:{' '}
            {summarizeError(step.message)}
          </Text>
          <Text variant="p7" color="textSecondary" mt="s" textAlign="center" lineHeight={20}>
            It&apos;s saved locally as unconfirmed. Retry from the Signers list.
          </Text>
          <TouchableOpacity onPress={() => router.replace('/account-signers')} style={styles.cta}>
            <Text variant="p6" color="textPrimary">
              View signers
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </Box>
  );
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  cta: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 24 },
  errorScrollOuter: { flex: 1 },
  errorScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
});
