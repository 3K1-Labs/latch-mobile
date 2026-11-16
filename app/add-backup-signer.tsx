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

import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Formik } from 'formik';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Yup from 'yup';

import { confirmAddBackupSigner } from '@/src/api/backup-signer';
import { RoundBackButton, SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import { PillField, PillInput } from '@/src/components/shared/PillField';
import Text from '@/src/components/shared/Text';
import { STELLAR_FACTORY_ADDRESS } from '@/src/constants/config';
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
import { summarizeError } from '@/src/utils/summarize-error';

const log = createLogger('add-backup-signer');

const ART = {
  success: require('@/src/assets/images/result/tx-success.svg'),
  failed: require('@/src/assets/images/result/tx-failed.svg'),
};

type Step =
  | { kind: 'name' }
  | { kind: 'ceremony'; busyLabel: string }
  /** Nothing landed on-chain yet — safe to just try the whole thing again. */
  | { kind: 'error'; message: string }
  /** The chain call already succeeded before this failed — sends the user to the Signers list to retry confirm, not back to the name step. */
  | { kind: 'confirmError'; message: string }
  | { kind: 'success' };

const NameSchema = Yup.object().shape({
  label: Yup.string().trim().min(1, 'Give this signer a name').required('Give this signer a name'),
});

export default function AddBackupSigner() {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, updateAccountDevicesAt } = useWalletStore();
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
      const newSigner = { kind: 'webauthn' as const, keyDataHex: credential.keyDataHex };
      const chainResult = await addBackupSignerOnChain({
        smartAccountAddress,
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
          contextRuleId: chainResult.ruleId,
          action: 'add',
        },
      };
      // By array position, not activeAccount.index — passkey/deployed/shared
      // accounts all share index: -1, so updating by that index would also
      // overwrite every other such account's device list.
      await updateAccountDevicesAt(activeAccountIndex, [...existingDevices, pendingDevice]);

      setStep({ kind: 'ceremony', busyLabel: 'Confirming with Latch…' });
      const backupCount = existingDevices.filter((d) => d.isBackupSigner).length;
      try {
        const { signerId } = await confirmAddBackupSigner({
          smartAccountAddress,
          contextRuleId: chainResult.ruleId,
          keyDataHex: chainResult.keyDataHex,
          txHash: chainResult.txHash,
          label,
          seq: backupCount + 1,
        });
        await updateAccountDevicesAt(activeAccountIndex, [
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

  const busy = step.kind === 'ceremony';

  return (
    <Box
      flex={1}
      backgroundColor="surfaceBase"
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 20) }}
    >
      <StatusBar style="light" />

      <Box flexDirection="row" alignItems="center" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} disabled={busy} />
        <Text flex={1} textAlign="center" fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Add Signer
        </Text>
        <Box width={40} />
      </Box>

      {step.kind === 'name' && (
        <Formik
          initialValues={{ label: '' }}
          validationSchema={NameSchema}
          onSubmit={(v) => runCeremony(v.label.trim())}
        >
          {({ values, errors, touched, handleChange, handleBlur, handleSubmit, isValid, dirty }) => (
            <Box flex={1} style={styles.body}>
              <Box gap="m">
                <PillField label="Signer Name" error={touched.label ? errors.label : undefined}>
                  <PillInput
                    value={values.label}
                    onChangeText={handleChange('label')}
                    onBlur={handleBlur('label')}
                    placeholder="e.g iPad, etc"
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={() => handleSubmit()}
                    autoFocus
                  />
                </PillField>
                <Text fontSize={14} lineHeight={20} letterSpacing={0.14} color="textSubheading">
                  This creates a passkey that can sign for this wallet on its own. Either signer
                  works alone, so it never raises the bar for spending.
                </Text>
              </Box>
              <SetupButton
                label="Add Signer"
                onPress={() => handleSubmit()}
                disabled={!(isValid && dirty)}
              />
            </Box>
          )}
        </Formik>
      )}

      {step.kind === 'ceremony' && (
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator color={theme.colors.textPrimary} />
          <Text fontSize={14} lineHeight={22} color="textSubheading" mt="m">
            {step.busyLabel}
          </Text>
        </Box>
      )}

      {step.kind === 'success' && (
        <Result
          art={ART.success}
          artSize={229}
          title="Signer Added!"
          message="Your new signer can now authorize transactions for this wallet."
          action="Back to Signers"
          onAction={() => router.replace('/account-signers')}
        />
      )}

      {step.kind === 'error' && (
        <Result
          art={ART.failed}
          artSize={243}
          title="Failed to add Signer"
          message={summarizeError(step.message)}
          action="Try Again"
          onAction={() => setStep({ kind: 'name' })}
        />
      )}

      {step.kind === 'confirmError' && (
        <Result
          art={ART.failed}
          artSize={243}
          title="Signer Not Confirmed Yet"
          message={`The signer was added on-chain, but Latch couldn't confirm it yet: ${summarizeError(step.message)} It's saved as unconfirmed — retry from the Signers list.`}
          action="View Signers"
          onAction={() => router.replace('/account-signers')}
        />
      )}
    </Box>
  );
}

const Result = ({
  art,
  artSize,
  title,
  message,
  action,
  onAction,
}: {
  art: number;
  artSize: number;
  title: string;
  message: string;
  action: string;
  onAction: () => void;
}) => (
  <Box flex={1} style={styles.body}>
    <ScrollView bounces={false} contentContainerStyle={styles.resultScroll}>
      <Image source={art} contentFit="contain" style={{ width: artSize, height: artSize }} />
      <Box alignItems="center" style={styles.resultCopy}>
        <Text fontSize={20} lineHeight={28} fontFamily="SFproSemibold" color="textPrimary" textAlign="center">
          {title}
        </Text>
        <Text fontSize={16} lineHeight={24} color="textSubheading" textAlign="center">
          {message}
        </Text>
      </Box>
    </ScrollView>
    <SetupButton label={action} onPress={onAction} />
  </Box>
);

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
    paddingHorizontal: 24,
    gap: 12,
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 30,
    justifyContent: 'space-between',
  },
  resultScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  resultCopy: {
    width: 281,
    gap: 2,
    marginTop: 4,
  },
});
