import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getUnreadCount } from '@/src/api/notifications';
import { UNREAD_COUNT_QUERY_KEY } from '@/src/hooks/use-notifications';
import { getWalletSessionWithoutSignIn } from '@/src/lib/wallet-auth';
import { useNotificationStore } from '@/src/store/notification-store';

export function useUnreadCount(): number {
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

  const { data } = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const token = await getWalletSessionWithoutSignIn();
      if (!token) return null;
      return getUnreadCount(token);
    },
  });

  useEffect(() => {
    if (typeof data === 'number') setUnreadCount(data);
  }, [data, setUnreadCount]);

  return useNotificationStore((s) => s.unreadCount);
}
