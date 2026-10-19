import * as SecureStore from 'expo-secure-store';
import { queryClient } from '@/src/api/client';
import { getNetworkId, type NetworkDetails, setActiveNetworkDetails } from '@/src/constants/config';
import { SECURE_KEYS, useWalletStore } from '@/src/store/wallet';
import { resetSacAssetCodeCache } from '@/src/lib/sac-asset-code';
import { disconnectAllSessions } from '@/src/lib/walletconnect';
import { resetSacContractInfoCache } from '@/src/hooks/use-stellar-transactions';
import { resetAquariusPoolCache } from '@/src/services/swap/providers/aquarius';
import { resetMockSwapCache } from '@/src/services/swap/providers/mock';

/**
 * Live network switch — no app restart. Reassigns every network-derived
 * config value in place, then clears everything that memoized a value under
 * the old network: React Query's cache (balances/transactions aren't keyed by
 * network), the SAC-contract-id lookup caches, and the cached wallet-scope JWT
 * (see wallet-auth.ts), which is keyed globally rather than per network and
 * so can't just be left for a cross-network 401 to catch. Chain-scoped
 * WalletConnect sessions are also torn down, but in the background
 * (time-boxed) — the relay publish that does it can stall indefinitely and
 * must never block the switch.
 *
 * Re-points the wallet store's active account at one that lives on the new
 * network (see reconcileActiveAccountForNetwork) — a smart account is deployed
 * via a network-specific factory and isn't valid on the other network. Does
 * not add, remove, or re-derive accounts; if the user has none on the target
 * network the active selection is left as-is and the switcher surfaces that.
 */
export async function switchActiveNetwork(details: NetworkDetails): Promise<void> {
  await setActiveNetworkDetails(details);

  // The wallet-scope JWT (wallet-auth.ts) is cached under a single global
  // SecureStore key, not one per network — it has no record of which
  // network's backend issued it. Left in place, getWalletSessionWithoutSignIn
  // happily hands a mainnet-issued token to the testnet backend (or vice
  // versa) because it only checks expiry, and wck-bundle.ts's endpoints don't
  // refresh on the 401 that follows. Every caller treats that as non-fatal,
  // so the failure is silent: a shared wallet's cosign key just never
  // publishes/picks up on the network just switched to. Clearing both tokens
  // here forces a fresh, correctly-network-scoped sign-in on next use.
  //
  // Caught, not awaited-to-throw: a rare Keychain/Keystore failure here must
  // not abort the switch partway through, the way the WalletConnect teardown
  // below is also shielded — setActiveNetworkDetails has already committed,
  // and skipping the reconciliation/cache-reset steps that follow would leave
  // the app on the new network with stale accounts and caches from the old one.
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN).catch(() => {}),
    SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN).catch(() => {}),
  ]);

  // Coherence first, before the query reset below refetches balances/history:
  // this updates activeNetwork + the active account synchronously in the store
  // so every screen reads the right account for the network. The background
  // network probe it kicks off is not awaited.
  await useWalletStore.getState().reconcileActiveAccountForNetwork(getNetworkId());

  // Tearing down chain-scoped WalletConnect sessions is correctness
  // housekeeping, not part of the switch itself. disconnectSession publishes
  // over the relay socket, which routinely stalls on a simulator or a flaky
  // connection — and a stalled publish neither resolves nor rejects. Awaiting
  // it directly wedged the whole switch: setActiveNetworkDetails had already
  // applied, but the caller's `await switchActiveNetwork(...)` never returned,
  // so the query reset below never ran and the UI (Profile's network label,
  // the switching spinner) stayed on the old value. Time-box it and let it
  // finish in the background; an incoming request on a stale session is
  // already rejected for the wrong chain (see disconnectAllSessions).
  void Promise.race([
    disconnectAllSessions(),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]).catch(() => {});

  // resetQueries, NOT clear(). clear() removes each query via query.destroy(),
  // which cancels in-flight fetches but never dispatches a state change — so
  // every mounted observer keeps rendering the result it last saw, and the old
  // network's balances stay on screen until some unrelated re-render happens to
  // rebuild the query. reset() destroys AND setStates back to initial, which
  // notifies observers, so the UI drops to its loading state at once.
  //
  // Deliberately not awaited: the reset + notify runs synchronously inside
  // resetQueries' batch, and the returned promise only settles once every
  // active query has refetched. Awaiting it would hold the switching spinner
  // for the length of the slowest refetch instead of handing straight back to
  // the screens, which have loading states of their own. It never rejects —
  // refetchQueries catches per-query errors unless throwOnError is set.
  void queryClient.resetQueries();

  resetSacAssetCodeCache();
  resetSacContractInfoCache();
  resetAquariusPoolCache();
  resetMockSwapCache();
}
