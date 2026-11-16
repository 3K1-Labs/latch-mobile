import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { useNow } from '@/src/hooks/use-now';
import type { PendingPacketView } from '@/src/hooks/use-pending-packets';
import { formatTimeRemaining, isExpiringSoon } from '@/src/lib/expiry';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

const EMPTY_MASCOT = require('@/src/assets/images/home/empty-mascot.svg');

interface Props {
  requests: PendingPacketView[];
  loading: boolean;
  onRefresh: () => Promise<unknown>;
  insetBottom: number;
  theme: Theme;
  isDark: boolean;
}

const truncate = (addr: string): string =>
  addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

const height = SHEET_HEIGHT / 1.6;

/**
 * History tab pending-filter content. Renders the cosign queue for the
 * active smart account: each row deep-links to /cosign-review for that
 * specific packet, where the user can decode, sign, or submit. Showing the
 * progress (sig count / threshold) inline so the user knows whether their tap
 * is required or whether the tx is waiting on others.
 */
const PendingCosignList: React.FC<Props> = ({
  requests,
  loading,
  onRefresh,
  insetBottom,
  theme,
  isDark,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !refreshing) {
    return (
      <Box flex={1} justifyContent="center" alignItems="center">
        <ActivityIndicator
          size="large"
          style={{ marginTop: '-40%' }}
          color={theme.colors.primary700}
        />
      </Box>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: insetBottom + 280 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary700}
        />
      }
    >
      {requests.length === 0 ? (
        <Box flex={1} justifyContent={'center'} height={height} paddingTop="xl" alignItems="center">
          <Image source={EMPTY_MASCOT} contentFit="contain" style={styles.emptyMascot} />
          <Text
            fontSize={18}
            lineHeight={26}
            fontFamily="SFproMedium"
            color="textPrimary"
            textAlign="center"
            mb="xs"
          >
            Nothing Pending
          </Text>
          <Text fontSize={14} lineHeight={22} color="textSubheading" textAlign="center">
            Transactions awaiting signature will appear here.
          </Text>
        </Box>
      ) : (
        requests.map((req) => {
          const ready = req.signatureCount >= req.threshold;
          return (
            <TouchableOpacity
              key={req.id}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: '/cosign-review', params: { id: req.id } })}
            >
              <Box
                backgroundColor="inputBox"
                borderColor="inputOutline"
                borderWidth={1}
                borderRadius={16}
                mb="s"
                style={styles.card}
              >
                <Box flexDirection="row" alignItems="center" justifyContent="space-between" mb="s">
                  <Box flexDirection="row" alignItems="center" flex={1}>
                    <Box
                      width={36}
                      height={36}
                      borderRadius={18}
                      backgroundColor={ready ? 'success50' : 'primary50'}
                      justifyContent="center"
                      alignItems="center"
                      mr="s"
                    >
                      <Ionicons
                        name={ready ? 'rocket-outline' : 'hourglass-outline'}
                        size={18}
                        color={ready ? theme.colors.success900 : theme.colors.primary}
                      />
                    </Box>
                    <Box flex={1}>
                      <Text variant="p6" color="textPrimary" numberOfLines={1}>
                        {ready ? 'Ready to broadcast' : 'Awaiting signatures'}
                      </Text>
                      <Text variant="p8" color="textSecondary" mt="xs" numberOfLines={1}>
                        {truncate(req.smartAccountAddress)} · {req.network}
                      </Text>
                    </Box>
                  </Box>
                  <Box
                    backgroundColor={ready ? 'success50' : 'bg200'}
                    justifyContent={'center'}
                    alignItems={'center'}
                    style={{ flexShrink: 0, width: 25, height: 25, borderRadius: 13 }}
                  >
                    <Text
                      variant="p8"
                      color={ready ? 'success900' : 'black'}
                      style={{ fontWeight: '600' }}
                    >
                      {req.signatureCount}/{req.threshold}
                    </Text>
                  </Box>
                </Box>
                <Box flexDirection="row" alignItems="center" justifyContent="space-between">
                  <Text
                    variant="p8"
                    color={isExpiringSoon(req.expiresAt, now) ? 'inputError' : 'textSecondary'}
                  >
                    expires {formatTimeRemaining(req.expiresAt, now)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                </Box>
              </Box>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  emptyMascot: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
});

export default PendingCosignList;
