/**
 * use-push-notifications.ts — mounts push for the authenticated shell:
 * registers this device's token for its shared-wallet queues and for activity
 * notifications, shows a toast for activity pushes received in the foreground,
 * and routes notification taps.
 *
 * Cosign pushes are content-free ({data: {queueIndex}} only), so the rich
 * detail always comes from the local decrypt-and-poll path — the notification
 * is purely a "go look" signal. Activity pushes carry {data: {type}} and open
 * the notification center.
 */

import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import Toast from 'react-native-toast-message';

import { NOTIFICATIONS_QUERY_KEY } from '@/src/hooks/use-notifications';
import { registerDevicePushToken, registerPushToken } from '@/src/lib/push-registration';
import { useWalletStore } from '@/src/store/wallet';

function isActivityPush(data: Record<string, unknown> | undefined): boolean {
  return typeof data?.type === 'string' && !data?.queueIndex;
}

// Foreground presentation: cosign pushes show the OS banner (content-free);
// activity pushes are surfaced as an in-app toast instead, so skip the banner.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const activity = isActivityPush(notification.request.content.data);
    return {
      shouldShowBanner: !activity,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

export function usePushNotifications(): void {
  const queryClient = useQueryClient();
  const accounts = useWalletStore((s) => s.accounts);
  // Re-register when the set of shared wallets changes (e.g. a wallet was
  // added or created). Keyed on addresses, not array identity, so rehydrates
  // don't re-trigger. Also re-runs WCK pickup lag away: a wallet whose key
  // arrived after mount gets registered on the next set change / app start.
  const multisigKey = accounts
    .filter((a) => a.isMultisig && a.smartAccountAddress)
    .map((a) => a.smartAccountAddress)
    .join(',');

  // Shared-wallet discovery used to live here; it moved to
  // useSharedWalletDiscovery so it survives push being disabled. Wallets it adds
  // change `multisigKey`, so the effect below still registers their push queues.
  useEffect(() => {
    registerPushToken().catch((err) => {
      if (__DEV__) console.log('[push-registration] failed:', err?.message);
    });
  }, [multisigKey]);

  useEffect(() => {
    const register = () => {
      registerDevicePushToken().catch((err) => {
        if (__DEV__) console.log('[push-registration] device registration failed:', err?.message);
      });
    };
    register();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') register();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content;
      if (!isActivityPush(data)) return;
      Toast.show({ type: 'info', text1: title ?? undefined, text2: body ?? undefined });
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    });
    const response = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const queueIndex = data?.queueIndex;
      // Content-free payload: the queueIndex is only a hint that something is
      // pending — the screen lists and decrypts locally.
      if (typeof queueIndex === 'string' && queueIndex) {
        router.push('/pending-approval');
      } else if (isActivityPush(data)) {
        queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
        router.push('/notification');
      }
    });
    return () => {
      received.remove();
      response.remove();
    };
  }, [queryClient]);
}
