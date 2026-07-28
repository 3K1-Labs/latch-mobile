/**
 * use-push-notifications.ts — mounts push for the authenticated shell:
 * registers this device's token for its shared-wallet queues, and routes
 * notification taps to the pending-approvals screen.
 *
 * The push payload is content-free ({data: {queueIndex}} only), so the rich
 * detail always comes from the local decrypt-and-poll path — the notification
 * is purely a "go look" signal.
 */

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';

import { discoverSharedWallets, retryPendingAnnouncements } from '@/src/lib/membership';
import { registerPushToken } from '@/src/lib/push-registration';
import { useWalletStore } from '@/src/store/wallet';

// Foreground presentation: show the banner (it's content-free), no sound/badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications(): void {
  const accounts = useWalletStore((s) => s.accounts);
  // Re-register when the set of shared wallets changes (e.g. a wallet was
  // added or created). Keyed on addresses, not array identity, so rehydrates
  // don't re-trigger. Also re-runs WCK pickup lag away: a wallet whose key
  // arrived after mount gets registered on the next set change / app start.
  const multisigKey = accounts
    .filter((a) => a.isMultisig && a.smartAccountAddress)
    .map((a) => a.smartAccountAddress)
    .join(',');

  // Discover shared wallets this device was added to (on a second signer's
  // device). Runs on mount AND when the app returns to the foreground — the
  // announcing device may have created the wallet while this app was
  // backgrounded, and a `[]`-dep effect alone never re-runs on resume. Newly
  // added wallets change `multisigKey`, so the effect below registers their push
  // queues. Non-fatal.
  //
  // Throttled: each sweep fires up to 3 latch-api calls (auth challenge +
  // sign-in + listMemberships). A biometric/auth prompt briefly backgrounds the
  // app, so without a throttle the `active` re-fire collides with an in-flight
  // multisig send (createCosignRequest) and trips the rate limiter. Skipping
  // re-runs within the window keeps the burst off the send path; genuine
  // returns-from-background after the window still pick up new wallets.
  const lastSweepRef = useRef(0);
  useEffect(() => {
    const SWEEP_THROTTLE_MS = 30_000;
    const run = () => {
      const now = Date.now();
      if (now - lastSweepRef.current < SWEEP_THROTTLE_MS) return;
      lastSweepRef.current = now;
      // Re-fire any announce a transient failure (e.g. 429) dropped, then poll
      // for wallets this device was added to. Both are non-fatal.
      // allowSignIn: false — this sweep runs on mount and on app-foreground, so
      // it must never sign in. Sign-in reads the device passkey, and a
      // biometric-gated key raises Face ID on read: an unexplained prompt the
      // user didn't ask for, which also backgrounds the app and re-fires the
      // `active` handler below. Both calls defer instead when there's no cached
      // session; the throttle alone only bounded that, it didn't prevent it.
      retryPendingAnnouncements({ allowSignIn: false }).catch((err) => {
        if (__DEV__) console.log('[membership] re-announce sweep failed:', err?.message);
      });
      discoverSharedWallets({ allowSignIn: false }).catch((err) => {
        if (__DEV__) console.log('[membership] discovery failed:', err?.message);
      });
    };
    // Defer the initial sweep until after the dashboard's first paint and any
    // in-flight touch/gesture settle. discoverSharedWallets() ends in a
    // synchronous pure-JS P-256 signature (signWithPasskey) for passkey
    // accounts signing in for the first time — running it on the mount tick
    // froze the JS thread right as the user landed on the dashboard.
    const interaction = InteractionManager.runAfterInteractions(run);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      interaction.cancel();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    registerPushToken().catch((err) => {
      if (__DEV__) console.log('[push-registration] failed:', err?.message);
    });
  }, [multisigKey]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const queueIndex = response.notification.request.content.data?.queueIndex;
      // Content-free payload: the queueIndex is only a hint that something is
      // pending — the screen lists and decrypts locally.
      if (typeof queueIndex === 'string' && queueIndex) {
        router.push('/pending-approval');
      }
    });
    return () => sub.remove();
  }, []);
}
