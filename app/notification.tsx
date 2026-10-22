import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, TouchableOpacity } from 'react-native';

import type { AppNotification } from '@/src/api/notifications';
import NotificationRow from '@/src/components/notifications/NotificationRow';
import NotificationsEmptyState from '@/src/components/notifications/NotificationsEmptyState';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import {
  NOTIFICATIONS_QUERY_KEY,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from '@/src/hooks/use-notifications';
import { useNotificationStore } from '@/src/store/notification-store';
import { Theme } from '@/src/theme/theme';
import { groupByDate } from '@/src/utils/group-by-date';

const NotificationsScreen = () => {
  const router = useRouter();
  const theme = useTheme<Theme>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotifications();
  const { mutate: markRead } = useMarkRead();
  const { mutate: markAllRead } = useMarkAllRead();

  const sections = useMemo(
    () =>
      groupByDate(
        data?.pages.flatMap((p) => p.notifications) ?? [],
        (n) => n.created_at,
      ),
    [data],
  );

  const handlePress = useCallback(
    (item: AppNotification) => {
      if (!item.read) markRead(item.id);
    },
    [markRead],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    setRefreshing(false);
  };

  return (
    <Box
      flex={1}
      backgroundColor="cardbg"
      style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
    >
      <StatusBar style="light" />

      <UtilityHeader
        title="Notifications"
        onBack={router.back}
        rightElement={
          unreadCount > 0 ? (
            <TouchableOpacity onPress={() => markAllRead()} hitSlop={8}>
              <Ionicons name="checkmark-done" size={22} color={theme.colors.primary700} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {isError && !isLoading && (
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="m"
          paddingVertical="s"
          mx="m"
          mb="s"
        >
          <Text variant="p7" color="textSecondary">
            Could not load notifications.
          </Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text variant="p7" color="primary700">
              Retry
            </Text>
          </TouchableOpacity>
        </Box>
      )}

      {isLoading ? (
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator size="large" color={theme.colors.primary700} />
        </Box>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <NotificationRow item={item} onPress={handlePress} />}
          renderSectionHeader={({ section: { title } }) => (
            <Box mt="l" mb="m">
              <Text variant="p7" color="textSecondary">
                {title}
              </Text>
            </Box>
          )}
          ListEmptyComponent={isError ? null : <NotificationsEmptyState />}
          ListFooterComponent={
            isFetchingNextPage ? (
              <Box paddingVertical="m" alignItems="center">
                <ActivityIndicator color={theme.colors.primary700} />
              </Box>
            ) : null
          }
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.primary700}
            />
          }
        />
      )}
    </Box>
  );
};

export default NotificationsScreen;
