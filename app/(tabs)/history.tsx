import HistoryItem from '@/src/components/history/HistoryItem';
import PendingCosignList from '@/src/components/history/PendingCosignList';
import SearchHeader from '@/src/components/history/SearchHeader';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useTabBarScroll } from '@/src/context/tab-bar-scroll';
import { usePendingPackets } from '@/src/hooks/use-pending-packets';
import { StellarPayment, useStellarTransactions } from '@/src/hooks/use-stellar-transactions';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  SectionList,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const height = Dimensions.get('window').height;

function dateSectionLabel(dateStr?: string): string {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function groupByDate(txs: StellarPayment[]): { title: string; data: StellarPayment[] }[] {
  const map = new Map<string, StellarPayment[]>();
  for (const tx of txs) {
    const label = dateSectionLabel(tx.createdAt);
    const group = map.get(label) ?? [];
    group.push(tx);
    map.set(label, group);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

const History = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const tabBarScroll = useTabBarScroll();
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [manualRefreshing, setManualRefreshing] = useState(false);

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
  }, [transactions, activeFilter, search, smartAccountAddress]);

  const sections = useMemo(() => groupByDate(filtered), [filtered]);

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
      />
    );
  };

  const renderSectionHeader = ({ section: { title } }: { section: { title: string } }) => (
    <Box paddingHorizontal="m" mt="l" mb="m" backgroundColor="mainBackground">
      <Text variant="p7" color="textSecondary">
        {title}
      </Text>
    </Box>
  );

  return (
    <Box flex={1} backgroundColor="onboardingbg" style={{ paddingTop: insets.top }}>
<StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <Box
        height={56}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        paddingHorizontal="m"
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold">
          History
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
          paddingHorizontal="m"
          paddingVertical="s"
          backgroundColor={isDark ? 'gray900' : 'gray100'}
          mx="m"
          borderRadius={12}
          mb="s"
        >
          <Text variant="p7" color="textSecondary">
            Could not load transactions.
          </Text>
          <TouchableOpacity onPress={refetch as any}>
            <Text variant="p7" color="primary700">
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
        <Box paddingHorizontal="m">
          <SectionList
            {...tabBarScroll}
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <Box
                flex={1}
                height={height / 2}
                justifyContent="center"
                alignItems="center"
                paddingHorizontal="xl"
              >
                <Box
                  width={64}
                  height={64}
                  borderRadius={32}
                  backgroundColor={isDark ? 'gray900' : 'gray100'}
                  justifyContent="center"
                  alignItems="center"
                  mb="m"
                >
                  <Ionicons name="receipt-outline" size={28} color={theme.colors.textSecondary} />
                </Box>
                <Text variant="h10" color="textPrimary" fontWeight="700" textAlign="center" mb="xs">
                  No transactions yet
                </Text>
                <Text variant="p7" color="textSecondary" textAlign="center">
                  {search
                    ? 'No results match your search.'
                    : 'Your transaction history will appear here.'}
                </Text>
              </Box>
            }
            renderSectionHeader={renderSectionHeader}
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
  backButton: {
    position: 'absolute',
    left: 16,
  },
});

export default History;
