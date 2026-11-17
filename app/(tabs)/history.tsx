import HistoryItem from '@/src/components/history/HistoryItem';
import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import PendingCosignList from '@/src/components/history/PendingCosignList';
import HistoryEmptyState from '@/src/components/history/HistoryEmptyState';
import SearchHeader from '@/src/components/history/SearchHeader';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { usePendingPackets } from '@/src/hooks/use-pending-packets';
import { StellarPayment, useStellarTransactions } from '@/src/hooks/use-stellar-transactions';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { useHistoryFilterStore } from '@/src/store/history-filter';
import { groupByDate } from '@/src/utils/group-by-date';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RowGap = () => <Box height={4} />;

const History = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const tabBarScroll = useTabBarScroll();
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const range = useHistoryFilterStore((s) => s.range);

  const { smartAccountAddress } = useWalletStore();

  const {
    data: transactions,
    isLoading,
    isError,
    refetch,
    // fetchNextPage,
    // hasNextPage,
    // isFetchingNextPage,
  } = useStellarTransactions(smartAccountAddress);

  const {
    requests: pendingCosign,
    count: pendingCount,
    isLoading: pendingLoading,
    refetch: refetchPending,
  } = usePendingPackets();

  const filtered = useMemo(() => {
    const all = transactions ?? [];

    let result = all;

    if (activeFilter === 'Sent') {
      result = result.filter(
        (tx) =>
          tx.txType === 'send' || (tx.txType === 'unknown' && tx.from === smartAccountAddress),
      );
    } else if (activeFilter === 'Received') {
      result = result.filter(
        (tx) =>
          tx.txType === 'receive' || (tx.txType === 'unknown' && tx.to === smartAccountAddress),
      );
    } else if (activeFilter === 'Swap') {
      result = result.filter((tx) => tx.txType === 'swap');
    }

    if (range) {
      const from = new Date(range.start);
      from.setHours(0, 0, 0, 0);
      const to = new Date(range.end);
      to.setHours(23, 59, 59, 999);
      result = result.filter((tx) => {
        const t = new Date(tx.createdAt).getTime();
        return t >= from.getTime() && t <= to.getTime();
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (tx) =>
          (tx.assetCode ?? 'XLM').toLowerCase().includes(q) ||
          tx.from.toLowerCase().includes(q) ||
          tx.to.toLowerCase().includes(q),
      );
    }

    return result;
  }, [transactions, activeFilter, search, smartAccountAddress, range]);

  const sections = useMemo(() => groupByDate(filtered, (tx) => tx.createdAt), [filtered]);

  const handleRowPress = (tx: StellarPayment) => {
    const isSent = tx.from === smartAccountAddress;
    const direction = isSent ? 'sent' : 'received';

    router.push({
      pathname: '/transaction/[id]',
      params: {
        id: tx.id,
        hash: tx.transactionHash,
        type: tx.type,
        from: tx.from,
        to: tx.to,
        amount: tx.amount,
        assetType: tx.assetType,
        assetCode: tx.assetCode ?? 'XLM',
        createdAt: tx.createdAt,
        direction,
        gAddress: tx.from,
      },
    });
  };

  const renderItem = ({ item }: { item: StellarPayment }) => {
    return (
      <HistoryItem
        item={item}
        smartAccountAddress={smartAccountAddress}
        handleRowPress={handleRowPress}
        showDirection
      />
    );
  };

  const renderSectionHeader = ({ section: { title } }: { section: { title: string } }) => (
    <Box style={styles.section}>
      <Text fontSize={12} lineHeight={20} fontFamily="SFproMedium" color="textSubheading">
        {title.toUpperCase()}
      </Text>
    </Box>
  );

  return (
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} style={styles.backButton} />
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Transaction History
        </Text>
      </Box>

      <SearchHeader
        search={search}
        setSearch={setSearch}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        theme={theme}
        pendingCount={pendingCount}
      />

      {isError && !isLoading && (
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          borderRadius={16}
          style={styles.errorBanner}
        >
          <Text fontSize={14} lineHeight={22} color="textMuted">
            Could not load transactions.
          </Text>
          <TouchableOpacity onPress={() => refetch()} hitSlop={8}>
            <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" style={styles.retry}>
              Retry
            </Text>
          </TouchableOpacity>
        </Box>
      )}

      {activeFilter === 'Pending' ? (
        <PendingCosignList
          requests={pendingCosign}
          loading={pendingLoading}
          onRefresh={refetchPending}
          insetBottom={insets.bottom}
          theme={theme}
          isDark={isDark}
        />
      ) : isLoading ? (
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator
            size="large"
            style={{ marginTop: '-40%' }}
            color={theme.colors.primary700}
          />
        </Box>
      ) : (
        <Box flex={1} paddingHorizontal="l">
          <SectionList
            {...tabBarScroll}
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <HistoryEmptyState
                title={search || range || activeFilter !== 'All' ? 'No Matching Activity' : 'No Activity Yet'}
                subtitle={
                  search || range || activeFilter !== 'All'
                    ? 'Try a different search or filter.'
                    : 'Fund your wallet & get started!'
                }
              />
            }
            renderSectionHeader={renderSectionHeader}
            ItemSeparatorComponent={RowGap}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 280 }}
            onEndReached={() => {
              // if (hasNextPage && !isFetchingNextPage) fetchNextPage();
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              // isFetchingNextPage ? (
              //   <Box paddingVertical="m" alignItems="center">
              //     <ActivityIndicator color={theme.colors.primary700} />
              //   </Box>
              // ) : null
              null
            }
            refreshControl={
              <RefreshControl
                refreshing={manualRefreshing}
                onRefresh={async () => {
                  setManualRefreshing(true);
                  await refetch();
                  setManualRefreshing(false);
                }}
                tintColor={theme.colors.primary700}
              />
            }
          />
        </Box>
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
  },
  backButton: {
    position: 'absolute',
    left: 24,
  },
  section: {
    marginTop: 40,
    marginBottom: 16,
  },
  errorBanner: {
    marginHorizontal: 24,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retry: {
    color: '#FFC508',
  },
});

export default History;
