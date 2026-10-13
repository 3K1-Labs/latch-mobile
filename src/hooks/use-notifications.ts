import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import {
  listNotifications,
  markAllRead,
  markRead,
  type NotificationsPage,
} from '@/src/api/notifications';
import { useNotificationStore } from '@/src/store/notification-store';
import { getWalletSessionWithoutSignIn } from '@/src/lib/wallet-auth';

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;
export const UNREAD_COUNT_QUERY_KEY = ['notifications', 'unread'] as const;

type NotificationsData = InfiniteData<NotificationsPage, string | undefined>;

async function requireToken(): Promise<string> {
  const token = await getWalletSessionWithoutSignIn();
  if (!token) throw new Error('No wallet session');
  return token;
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, 'list'],
    queryFn: async ({ pageParam }) =>
      listNotifications(await requireToken(), { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  const listKey = [...NOTIFICATIONS_QUERY_KEY, 'list'];

  return useMutation({
    mutationFn: async (id: string) => markRead(await requireToken(), id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<NotificationsData>(listKey);
      const wasUnread = previous?.pages.some((p) =>
        p.notifications.some((n) => n.id === id && !n.read),
      );
      queryClient.setQueryData<NotificationsData>(listKey, (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            notifications: p.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
          })),
        },
      );
      if (wasUnread) {
        const { unreadCount, setUnreadCount } = useNotificationStore.getState();
        setUnreadCount(Math.max(0, unreadCount - 1));
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const listKey = [...NOTIFICATIONS_QUERY_KEY, 'list'];

  return useMutation({
    mutationFn: async () => markAllRead(await requireToken()),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<NotificationsData>(listKey);
      const previousCount = useNotificationStore.getState().unreadCount;
      queryClient.setQueryData<NotificationsData>(listKey, (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            notifications: p.notifications.map((n) => ({ ...n, read: true })),
          })),
        },
      );
      useNotificationStore.getState().setUnreadCount(0);
      return { previous, previousCount };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
      if (context) useNotificationStore.getState().setUnreadCount(context.previousCount);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    },
  });
}
