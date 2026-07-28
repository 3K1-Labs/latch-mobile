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
  queryClient.clear();
  resetSacAssetCodeCache();
  resetSacContractInfoCache();
  resetAquariusPoolCache();
  resetMockSwapCache();
}
