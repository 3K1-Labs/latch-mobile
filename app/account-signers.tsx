/**
 * account-signers.tsx — every signer on the active account: the primary
 * device plus any solo backup signers (src/lib/backup-signer-tx.ts), each
 * with its role and on-chain status. Mirrors the web extension's
 * AccountSignersScreen — mobile had no equivalent of this list before, only
 * an aggregate count in PoliciesSheet.
 *
 * A backup signer stuck in `pendingConfirm` (the on-chain call landed but
 * the backend confirm call failed or never got a response) is retried from
 * here, using the durable txHash/contextRuleId on the Device record — never
 * by redoing the on-chain call.
 */

import { fetchDefaultContextRule } from '@/src/api/account-admin';
import { confirmAddBackupSigner, confirmRemoveBackupSigner } from '@/src/api/backup-signer';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { removeBackupSignerOnChain } from '@/src/lib/backup-signer-tx';
import { createLogger } from '@/src/lib/logger';
import { Device, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const log = createLogger('account-signers');

// A chain failure's message can be a full Soroban diagnostic dump (hundreds
// of lines) — see add-backup-signer.tsx's summarizeError for why that must
// never go straight into a fixed-height error banner: it starves the rest of
// the screen of space and reads as an unresponsive app.
function summarizeError(message: string, max = 240): string {
  const firstLine = message.split('\n')[0]?.trim() || message.trim();
  return firstLine.length > max ? `${firstLine.slice(0, max).trimEnd()}…` : firstLine;
}

export default function AccountSigners() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, updateAccountDevices, syncSignersFromChain } =
    useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const devices = activeAccount?.devices ?? [];
  // This screen is reached via the "Backup Signers" setting — show only backup
  // signers, not the primary device. The primary can never be removed from here
  // anyway, so showing it only confuses the count.
  const backupDevices = devices.filter((d) => d.isBackupSigner);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(true);

  // The local `devices` cache only ever grows from THIS device's own actions
  // (add/remove flows here, or the original pairing flow). It's never
  // otherwise reconciled against chain, so a fresh install, a signer added
  // from elsewhere, or a stale local record would silently not show up.
  // Chain is the source of truth — reconcile it every time this screen opens.
  useEffect(() => {
    let cancelled = false;
    syncSignersFromChain(activeAccountIndex)
      .catch((err) => {
        log.warn('syncSignersFromChain failed — showing local cache as-is', err);
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountIndex]);

  const persist = (next: Device[]) => updateAccountDevices(activeAccount.index, next);

  const retryConfirmAdd = async (device: Device) => {
    const smartAccountAddress = activeAccount?.smartAccountAddress;
    if (!smartAccountAddress || !device.pendingConfirm) return;
    setBusyKey(device.signerKey);
    setError(null);
    try {
      const { signerId } = await confirmAddBackupSigner({
        smartAccountAddress,
        contextRuleId: device.pendingConfirm.contextRuleId,
        keyDataHex: device.keyDataHex,
        txHash: device.pendingConfirm.txHash,
        label: device.label,
        seq: devices.filter((d) => d.isBackupSigner).length,
      });
      await persist(
        devices.map((d) =>
          d.signerKey === device.signerKey
            ? { ...d, onChainSignerId: signerId, pendingConfirm: undefined }
            : d,
        ),
      );
    } catch (err) {
      log.error('retry confirm-add failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const retryConfirmRemove = async (device: Device) => {
    const smartAccountAddress = activeAccount?.smartAccountAddress;
    if (!smartAccountAddress || !device.pendingConfirm || device.onChainSignerId === null) return;
    setBusyKey(device.signerKey);
    setError(null);
    try {
      await confirmRemoveBackupSigner({
        smartAccountAddress,
        contextRuleId: device.pendingConfirm.contextRuleId,
        signerId: device.onChainSignerId,
        keyDataHex: device.keyDataHex,
        txHash: device.pendingConfirm.txHash,
      });
      await persist(devices.filter((d) => d.signerKey !== device.signerKey));
    } catch (err) {
      log.error('retry confirm-remove failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const startRemove = (device: Device) => {
    Alert.alert(
      'Remove this backup signer?',
      `"${device.label}" will no longer be able to sign for this wallet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void removeDevice(device),
        },
      ],
    );
  };

  const removeDevice = async (device: Device) => {
    const smartAccountAddress = activeAccount?.smartAccountAddress;
    const factoryAddress = STELLAR_FACTORY_ADDRESS;
    if (!smartAccountAddress || !factoryAddress) return;
    setBusyKey(device.signerKey);
    setError(null);
    try {
      const defaultRule = await fetchDefaultContextRule(
        { rpcUrl: STELLAR_RPC_URL, networkPassphrase: STELLAR_NETWORK_PASSPHRASE, factoryAddress },
        smartAccountAddress,
      );
      const signerId =
        device.onChainSignerId ??
        defaultRule.signers.find(
          (s) => s.keyDataHex.toLowerCase() === device.keyDataHex.toLowerCase(),
        )?.signerId ??
        null;
      if (signerId === null) {
        throw new Error('Could not find this signer on-chain.');
      }
      const { txHash } = await removeBackupSignerOnChain({
        smartAccountAddress,
        defaultRuleId: defaultRule.ruleId,
        signerId,
        keyDataHex: device.keyDataHex,
        initiatorListIndex: activeAccountIndex,
      });

      // Persist as pending-removal BEFORE confirming — durable across a kill,
      // same as the add path.
      const pendingRemoval: Device = {
        ...device,
        onChainSignerId: signerId,
        pendingConfirm: { txHash, contextRuleId: defaultRule.ruleId, action: 'remove' },
      };
      await persist(devices.map((d) => (d.signerKey === device.signerKey ? pendingRemoval : d)));

      await confirmRemoveBackupSigner({
        smartAccountAddress,
        contextRuleId: defaultRule.ruleId,
        signerId,
        keyDataHex: device.keyDataHex,
        txHash,
      });
      await persist(devices.filter((d) => d.signerKey !== device.signerKey));
    } catch (err) {
      log.error('remove backup signer failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: 30 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Box height={56} flexDirection="row" alignItems="center" paddingHorizontal="m">
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
          Signers
        </Text>
      </Box>

      {syncing && (
        <Box flexDirection="row" alignItems="center" paddingHorizontal="l" mb="s">
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          <Text variant="p7" color="textSecondary" ml="s">
            Syncing signers from chain…
          </Text>
        </Box>
      )}

      <Box paddingHorizontal="l" pt="s" flex={1}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          {error && (
            <Box backgroundColor="bg11" borderRadius={12} padding="m" mb="m">
              <Text variant="p7" color="inputError">
                {summarizeError(error)}
              </Text>
            </Box>
          )}

          {!syncing && backupDevices.length === 0 && (
            <Text variant="p7" color="textSecondary">
              No backup signers yet. Tap the button below to add one.
            </Text>
          )}

          {backupDevices.map((device) => {
            const isPendingAdd = device.pendingConfirm?.action === 'add';
            const isPendingRemove = device.pendingConfirm?.action === 'remove';
            const busy = busyKey === device.signerKey;
            const role = device.isBackupSigner ? 'Backup' : device.isLocal ? 'Primary' : 'Signer';
            const statusLabel = isPendingRemove
              ? 'Removing…'
              : isPendingAdd
                ? 'Pending confirmation'
                : 'Active';

            return (
              <Box
                key={device.signerKey}
                backgroundColor="bg11"
                borderRadius={16}
                padding="m"
                mb="m"
                flexDirection="row"
                alignItems="center"
              >
                <Box flex={1}>
                  <Text variant="h11" color="textPrimary" fontFamily="SFproSemibold">
                    {device.label}
                  </Text>
                  <Text variant="p7" color="textSecondary" mt="xs">
                    {role} · {statusLabel}
                  </Text>
                </Box>

                {busy && <ActivityIndicator color={theme.colors.textSecondary} />}

                {!busy && isPendingAdd && (
                  <TouchableOpacity onPress={() => retryConfirmAdd(device)} hitSlop={8}>
                    <Text variant="p6" color="primary" fontFamily="SFproSemibold">
                      Retry
                    </Text>
                  </TouchableOpacity>
                )}

                {!busy && isPendingRemove && (
                  <TouchableOpacity onPress={() => retryConfirmRemove(device)} hitSlop={8}>
                    <Text variant="p6" color="primary" fontFamily="SFproSemibold">
                      Retry
                    </Text>
                  </TouchableOpacity>
                )}

                {!busy && device.isBackupSigner && !device.pendingConfirm && (
                  <TouchableOpacity onPress={() => startRemove(device)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={20} color={theme.colors.inputError} />
                  </TouchableOpacity>
                )}
              </Box>
            );
          })}
        </ScrollView>

        <TouchableOpacity onPress={() => router.push('/add-backup-signer')} activeOpacity={0.7}>
          <Box
            height={56}
            backgroundColor="primary"
            borderRadius={32}
            justifyContent="center"
            alignItems="center"
            mb="l"
          >
            <Text variant="h10" color="black" fontWeight="700">
              Add a backup signer
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
});
