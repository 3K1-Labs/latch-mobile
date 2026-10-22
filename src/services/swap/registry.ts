import { ACTIVE_NETWORK } from '@/src/constants/config';
import { aquariusProvider } from './providers/aquarius';
import { mockSwapProvider } from './providers/mock';
import type { SwapProvider, SwapProviderMeta } from './types';

// Aquarius only, on both networks. Soroswap is temporarily disabled: its
// aggregator contract has no swap_chained-compatible call shape, so it can't
// produce build-swap's swap_chain_xdr (latch-api reconstructs swap_chained
// itself and wraps it in FeeForwarder.forward() — see providers/aquarius.ts
// and BuildSwap in internal/service/webapp/build_swap_transaction.go,
// latch-api repo). providers/soroswap.ts is left as-is for when a compatible
// route lands; see git history here for the never-the-default rationale that
// applied while it was selectable.
//
// Set EXPO_PUBLIC_SWAP_USE_MOCK=true to force the dev mock on testnet (e.g. if
// Aquarius's testnet deployment is mid-reset). See providers/*.ts.
const USE_MOCK = process.env.EXPO_PUBLIC_SWAP_USE_MOCK === 'true';

const TESTNET_PROVIDER = USE_MOCK ? mockSwapProvider : aquariusProvider;

// First entry is the default. The SwapProvider interface keeps the UI +
// execution generic across providers. A function, not a frozen module-level
// const, so a live network switch (src/lib/network-switch.ts) picks the right
// provider on the next call instead of only after a fresh app launch.
function getProviders(): SwapProvider[] {
  return ACTIVE_NETWORK.network === 'TESTNET' ? [TESTNET_PROVIDER] : [aquariusProvider];
}

export function listSwapProviders(): SwapProviderMeta[] {
  return getProviders().map(({ id, name, icon }) => ({ id, name, icon }));
}

/** Returns the provider with `id`, or the default (first) provider. */
export function getActiveSwapProvider(id?: string): SwapProvider {
  const providers = getProviders();
  return providers.find((p) => p.id === id) ?? providers[0];
}
