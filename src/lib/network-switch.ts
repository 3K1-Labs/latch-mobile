import { queryClient } from '@/src/api/client';
import { type NetworkDetails, setActiveNetworkDetails } from '@/src/constants/config';
import { resetSacAssetCodeCache } from '@/src/lib/sac-asset-code';
import { disconnectAllSessions } from '@/src/lib/walletconnect';
import { resetSacContractInfoCache } from '@/src/hooks/use-stellar-transactions';
import { resetAquariusPoolCache } from '@/src/services/swap/providers/aquarius';
import { resetMockSwapCache } from '@/src/services/swap/providers/mock';

/**
 * Live network switch — no app restart. Reassigns every network-derived
 * config value in place, then clears everything that memoized a value under
 * the old network: WalletConnect sessions (chain-scoped, e.g.
 * stellar:testnet:G...), React Query's cache (balances/transactions aren't
 * keyed by network), and the SAC-contract-id lookup caches.
 *
 * Does NOT touch the wallet store (accounts/smartAccountAddress) — a smart
 * account is deployed via a network-specific factory and isn't automatically
 * valid on the other network. Callers accept that switching may leave the UI
 * pointed at an address that doesn't exist there.
 */
export async function switchActiveNetwork(details: NetworkDetails): Promise<void> {
  await setActiveNetworkDetails(details);
  await disconnectAllSessions();

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
