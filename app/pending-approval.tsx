/**
 * pending-approval.tsx — full screen listing pending co-sign requests in the
 * active transport (P2P packets held locally, or the encrypted backend queue).
 * Each request can be Approved (sign with this device's key; auto-submits when
 * that approval meets the threshold), Broadcast (manual fallback once the
 * threshold is met), or Rejected (P2P: dropped locally; backend: global cancel).
 *
 * Threshold is enforced authoritatively on-chain at submit time (the transport's
 * submit re-reads fetchRuleThreshold); this screen only reflects progress.
 */

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useNow } from '@/src/hooks/use-now';
import {
  PENDING_PACKETS_QUERY_KEY,
  usePendingPackets,
  type PendingPacketView,
} from '@/src/hooks/use-pending-packets';
import {
  approveAndMaybeSubmit,
  cancel,
  getEntry,
  resetPendingFetchState,
  submit,
} from '@/src/lib/cosign-transport';
import { formatTimeRemaining, isExpiringSoon } from '@/src/lib/expiry';
import { friendlyTxError } from '@/src/lib/tx-errors';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function PendingApproval() {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { requests, isLoading, refetch } = usePendingPackets();
  const now = useNow();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: PENDING_PACKETS_QUERY_KEY });

  // The backend list endpoint only ever returns status='pending' requests, so a
  // request another signer just submitted simply disappears from `requests` on
  // the next poll — same as one that expired or was cancelled. Diff against the
  // previous poll and, for anything that vanished, check its actual status by id
  // (unfiltered by status) so a successful submit surfaces here instead of the
  // card just silently going away with no explanation.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const knownIds = knownIdsRef.current;
    const currentIds = new Set(requests.map((r) => r.id));
    const vanished = [...knownIds].filter((id) => !currentIds.has(id));
    knownIdsRef.current = currentIds;
    if (vanished.length === 0) return;
    (async () => {
      for (const id of vanished) {
        try {
          const p = await getEntry(id);
          if (p?.submittedTxHash) {
            Alert.alert('Transfer sent', `Submitted ${p.submittedTxHash.slice(0, 10)}…`);
          }
        } catch {
          // transient lookup failure — nothing to show, it just wasn't found
        }
      }
    })();
  }, [requests]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      resetPendingFetchState();
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const handleApprove = async (req: PendingPacketView) => {
    setBusyId(req.id);
    try {
      const outcome = await approveAndMaybeSubmit(req.id);
      await invalidate();
      if (outcome.submitted) {
        Alert.alert('Transfer sent', `Submitted ${outcome.submitted.hash.slice(0, 10)}…`);
      } else if (outcome.submitError) {
        // The approval landed; only the auto-submit failed. Manual Broadcast
        // remains available on the row.
        Alert.alert('Approved — broadcast failed', outcome.submitError);
      }
    } catch (err) {
      Alert.alert('Could not approve', friendlyTxError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleBroadcast = async (req: PendingPacketView) => {
    setBusyId(req.id);
    try {
      const { hash } = await submit(req.id);
      await invalidate();
      Alert.alert('Broadcast sent', `Submitted ${hash.slice(0, 10)}…`);
    } catch (err) {
      Alert.alert('Could not broadcast', friendlyTxError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: PendingPacketView) => {
    try {
      await cancel(req.id);
      await invalidate();
    } catch (err) {
      Alert.alert('Could not remove', friendlyTxError(err));
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Box height={56} flexDirection="row" alignItems="center" paddingHorizontal="m">
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/(tabs)'))}
          hitSlop={8}
          style={styles.backBtn}
        >
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
          Pending approvals
        </Text>
      </Box>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.textPrimary}
          />
        }
      >
        {isLoading && !refreshing && (
          <Box paddingTop="xl" alignItems="center">
            <ActivityIndicator color={theme.colors.textPrimary} />
          </Box>
        )}

        {!isLoading && requests.length === 0 && (
          <Box paddingTop="xl" alignItems="center">
            <Ionicons name="checkmark-done-outline" size={40} color={theme.colors.textSecondary} />
            <Text variant="p7" color="textSecondary" mt="m">
              Nothing waiting on your approval.
            </Text>
          </Box>
        )}

        {requests.map((req) => (
          <Box key={req.id} backgroundColor="bg11" borderRadius={20} padding="m" mb="m">
            <Text variant="h11" color="textPrimary" fontFamily="SFproSemibold">
              Co-sign request
            </Text>
            <Text variant="p7" color="textSecondary" mt="xs">
              {req.network} · threshold {req.signatureCount}/{req.threshold}
            </Text>
            <Text
              variant="p7"
              color="textSecondary"
              mt="s"
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {req.smartAccountAddress}
            </Text>
            <Text
              variant="p7"
              color={isExpiringSoon(req.expiresAt, now) ? 'inputError' : 'textSecondary'}
              mt="xs"
            >
              expires {formatTimeRemaining(req.expiresAt, now)}
            </Text>
            <Box flexDirection="row" mt="m">
              <TouchableOpacity
                onPress={() => handleReject(req)}
                disabled={busyId === req.id}
                style={[
                  styles.btn,
                  { backgroundColor: theme.colors.cardbg, flex: 1, marginRight: 8 },
                  busyId === req.id && { opacity: 0.5 },
                ]}
              >
                <Text variant="p7" color="textPrimary">
                  Reject
                </Text>
              </TouchableOpacity>
              {req.ready ? (
                <TouchableOpacity
                  onPress={() => handleBroadcast(req)}
                  disabled={busyId === req.id}
                  style={[
                    styles.btn,
                    { backgroundColor: theme.colors.primary700, flex: 1, marginLeft: 8 },
                    busyId === req.id && { opacity: 0.5 },
                  ]}
                >
                  {busyId === req.id ? (
                    <ActivityIndicator color={theme.colors.black} />
                  ) : (
                    <Text
                      variant="p7"
                      fontFamily="SFproSemibold"
                      style={{ color: theme.colors.black }}
                    >
                      Broadcast
                    </Text>
                  )}
                </TouchableOpacity>
              ) : req.canApprove ? (
                <TouchableOpacity
                  onPress={() => handleApprove(req)}
                  disabled={busyId === req.id}
                  style={[
                    styles.btn,
                    { backgroundColor: theme.colors.buttonBg, flex: 1, marginLeft: 8 },
                    busyId === req.id && { opacity: 0.5 },
                  ]}
                >
                  {busyId === req.id ? (
                    <ActivityIndicator color={theme.colors.buttonLabel} />
                  ) : (
                    <Text
                      variant="p7"
                      fontFamily="SFproSemibold"
                      style={{ color: theme.colors.buttonLabel }}
                    >
                      Approve
                    </Text>
                  )}
                </TouchableOpacity>
              ) : (
                <Box style={[styles.btn, { flex: 1, marginLeft: 8 }]}>
                  <Text variant="p7" color="textSecondary">
                    Waiting on others
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        ))}
      </ScrollView>
    </Box>
  );
}

const styles = StyleSheet.create({
  backBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  btn: {
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
  },
});
