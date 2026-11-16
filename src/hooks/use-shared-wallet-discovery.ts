/**
 * use-shared-wallet-discovery.ts — finds shared wallets this device's keys are
 * members of and queues them for SharedWalletNamingModal. This is what brings a
 * user's shared wallets back after a logout/restore, so it must stay mounted
 * independently of push notifications.
 */

import { useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';

import {
  clearDiscoveryAfterRestore,
  discoverSharedWallets,
  isDiscoveryAfterRestorePending,
  retryPendingAnnouncements,
} from '@/src/lib/membership';
import { useWalletStore } from '@/src/store/wallet';

// Each sweep is up to 3 latch-api calls. A biometric prompt briefly backgrounds
// the app, so without a throttle the `active` re-fire collides with an
// in-flight multisig send and trips the rate limiter.
const SWEEP_THROTTLE_MS = 30_000;

export function useSharedWalletDiscovery(): void {
  const lastSweepRef = useRef(0);
  const hasAccounts = useWalletStore((s) => s.accounts.length > 0);

  // Background sweep on mount and on every return to the foreground. Never
  // signs in: an unprompted Face ID sheet is worse than a deferred sweep, and
  // dismissing it would re-fire the `active` handler.
  useEffect(() => {
    const run = () => {
      const now = Date.now();
      if (now - lastSweepRef.current < SWEEP_THROTTLE_MS) return;
      lastSweepRef.current = now;
      retryPendingAnnouncements({ allowSignIn: false }).catch((err) => {
        if (__DEV__) console.log('[membership] re-announce sweep failed:', err?.message);
      });
      discoverSharedWallets({ allowSignIn: false }).catch((err) => {
        if (__DEV__) console.log('[membership] discovery failed:', err?.message);
      });
    };
    // Deferred past first paint: discovery can end in a synchronous P-256
    // signature that would freeze the JS thread as the dashboard lands.
    const interaction = InteractionManager.runAfterInteractions(run);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      interaction.cancel();
      sub.remove();
    };
  }, []);

  // One sign-in-allowed run after a restore. Waits for the store to hydrate —
  // discovery with no accounts finds nothing and would burn the flag. The flag
  // is cleared only on success; the session it signs in leaves cached also lets
  // the background sweep above work from then on.
  useEffect(() => {
    if (!hasAccounts) return;
    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(async () => {
      if (!(await isDiscoveryAfterRestorePending()) || cancelled) return;
      lastSweepRef.current = Date.now();
      try {
        const queued = await discoverSharedWallets();
        await clearDiscoveryAfterRestore();
        if (__DEV__) console.log('[membership] post-restore discovery queued', queued);
      } catch (err: any) {
        if (__DEV__) console.log('[membership] post-restore discovery failed:', err?.message);
      }
    });
    return () => {
      cancelled = true;
      interaction.cancel();
    };
  }, [hasAccounts]);
}
