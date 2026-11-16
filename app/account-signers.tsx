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

import { confirmAddBackupSigner, confirmRemoveBackupSigner } from '@/src/api/backup-signer';
import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { removeBackupSignerOnChain } from '@/src/lib/backup-signer-tx';
import { createLogger } from '@/src/lib/logger';
import { Device, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { shortenAddress } from '@/src/utils';
import { summarizeError } from '@/src/utils/summarize-error';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const log = createLogger('account-signers');

const ICONS = {
  plus: require('@/src/assets/images/address-book/plus.svg'),
  phone: require('@/src/assets/images/signers/phone.svg'),
  more: require('@/src/assets/images/signers/more.svg'),
};

export default function AccountSigners() {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, updateAccountDevicesAt, syncSignersFromChain } =
    useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const devices = activeAccount?.devices ?? [];
  // The primary device is listed (as in the design) but can never be removed here.
  const primaryDevice = devices.find((d) => d.isLocal && !d.isBackupSigner);
  const otherDevices = devices.filter((d) => d !== primaryDevice);

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

  // By array position, not activeAccount.index — passkey/deployed/shared
  // accounts all share index: -1, so updating by that index would also
  // overwrite every other such account's device list.
  const persist = (next: Device[]) => updateAccountDevicesAt(activeAccountIndex, next);

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
    if (!smartAccountAddress) return;
    setBusyKey(device.signerKey);
    setError(null);
    try {
      // removeBackupSignerOnChain resolves the signer id itself from
      // keyDataHex (one fetch, shared with its own safety checks) — fetching
      // the rule here too would just be a second round-trip for the same id.
      const { txHash, ruleId, signerId } = await removeBackupSignerOnChain({
        smartAccountAddress,
        keyDataHex: device.keyDataHex,
        fallbackSignerId: device.onChainSignerId ?? undefined,
        initiatorListIndex: activeAccountIndex,
      });

      // Persist as pending-removal BEFORE confirming — durable across a kill,
      // same as the add path.
      const pendingRemoval: Device = {
        ...device,
        onChainSignerId: signerId,
        pendingConfirm: { txHash, contextRuleId: ruleId, action: 'remove' },
      };
      await persist(devices.map((d) => (d.signerKey === device.signerKey ? pendingRemoval : d)));

      await confirmRemoveBackupSigner({
        smartAccountAddress,
        contextRuleId: ruleId,
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

  const renderDevice = (device: Device, primary: boolean) => {
    const isPendingAdd = device.pendingConfirm?.action === 'add';
    const isPendingRemove = device.pendingConfirm?.action === 'remove';
    const busy = busyKey === device.signerKey;
    const status = isPendingRemove ? 'Removing…' : isPendingAdd ? 'Pending confirmation' : null;

    return (
      <Box
        key={device.signerKey}
        backgroundColor="inputBox"
        borderColor="inputOutline"
        borderWidth={1}
        style={styles.card}
      >
        {primary && (
          <Box alignSelf="flex-start" backgroundColor="inputOutline" style={styles.pill}>
            <Text fontSize={12} lineHeight={12} style={styles.pillText}>
              Primary Device
            </Text>
          </Box>
        )}
        <Box flexDirection="row" alignItems="center" justifyContent="space-between">
          <Box flex={1} flexDirection="row" alignItems="center" gap="m">
            <Image
              source={ICONS.phone}
              contentFit="contain"
              style={[styles.deviceIcon, !device.isLocal && styles.tabletIcon]}
            />
            <Box flex={1} gap="xs">
              <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary" numberOfLines={1}>
                {device.isLocal && !device.isBackupSigner ? `${device.label} (This Device)` : device.label}
              </Text>
              <Text fontSize={12} lineHeight={14} letterSpacing={0.12} color="textSubheading">
                {status ?? shortenAddress(device.signerKey)}
              </Text>
            </Box>
          </Box>

          {busy && <ActivityIndicator color={theme.colors.textSubheading} />}

          {!busy && (isPendingAdd || isPendingRemove) && (
            <TouchableOpacity
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => (isPendingAdd ? retryConfirmAdd(device) : retryConfirmRemove(device))}
            >
              <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="accentGreen">
                Retry
              </Text>
            </TouchableOpacity>
          )}

          {!busy && device.isBackupSigner && !device.pendingConfirm && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Options for ${device.label}`}
              hitSlop={8}
              onPress={() => startRemove(device)}
            >
              <Image source={ICONS.more} contentFit="contain" style={styles.moreIcon} />
            </TouchableOpacity>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />

      <Box flexDirection="row" alignItems="center" justifyContent="space-between" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} />
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Signers
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Add signer"
          activeOpacity={0.7}
          hitSlop={8}
          onPress={() => router.push('/add-backup-signer')}
          style={styles.addButton}
        >
          <Image source={ICONS.plus} contentFit="contain" style={styles.addIcon} />
        </TouchableOpacity>
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <Box gap="s">
          <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
            Signer Management
          </Text>
          <Text fontSize={14} lineHeight={20} letterSpacing={0.14} color="textSubheading">
            Signers are devices or accounts allowed to authorize transactions. Requiring multiple
            signers adds extra security.
          </Text>
        </Box>

        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          style={styles.summary}
        >
          <Text fontSize={16} lineHeight={24} color="textPrimary">
            Active Signers
          </Text>
          {syncing ? (
            <ActivityIndicator size="small" color={theme.colors.textSubheading} />
          ) : (
            <Text fontSize={16} lineHeight={24} fontFamily="SFproSemibold" color="textPrimary">
              {devices.length}
            </Text>
          )}
        </Box>

        {error && (
          <Box
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            style={styles.errorBox}
          >
            <Text fontSize={14} lineHeight={20} color="inputError">
              {summarizeError(error)}
            </Text>
          </Box>
        )}

        <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading" style={styles.sectionTitle}>
          Active Signers
        </Text>

        {!syncing && devices.length === 0 ? (
          <Text fontSize={14} lineHeight={22} color="textSubheading">
            No signers yet. Tap + to add a backup signer.
          </Text>
        ) : (
          <Box style={styles.list}>
            {primaryDevice && renderDevice(primaryDevice, true)}
            {otherDevices.map((d) => renderDevice(d, false))}
          </Box>
        )}
      </ScrollView>
    </Box>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
    paddingHorizontal: 24,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    width: 20,
    height: 20,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 30,
  },
  summary: {
    height: 48,
    marginTop: 20,
    borderRadius: 40,
    paddingHorizontal: 20,
  },
  errorBox: {
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: {
    marginTop: 47,
    marginBottom: 35,
  },
  list: {
    gap: 10,
  },
  card: {
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  pill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pillText: {
    color: '#413F3F',
  },
  deviceIcon: {
    width: 13.71,
    height: 20.57,
  },
  // The design draws non-primary devices as a tablet: the same glyph on its side.
  tabletIcon: {
    transform: [{ rotate: '90deg' }],
  },
  moreIcon: {
    width: 24,
    height: 24,
  },
});
