import { ACTIVE_NETWORK } from '@/src/constants/config';
import { aquariusProvider } from './providers/aquarius';
import { mockSwapProvider } from './providers/mock';
import { soroswapProvider } from './providers/soroswap';
import type { SwapProvider, SwapProviderMeta } from './types';

// Mainnet offers both routes; testnet only has Aquarius (Soroswap has no
// testnet pools). The FIRST entry is the default and is labelled "Recommend"
// in the UI.
//
// Aquarius leads on mainnet because the Soroswap aggregator produced badly
// mispriced XLM/USDC quotes: it kept selecting a multi-hop 'aqua' route
// through a thin intermediate pool, quoting several times the real market
// value (5 XLM ≈ $0.85 came back as $3–7 of USDC). Querying Aquarius directly
// avoids the aggregator's route choice — verified live on mainnet that the
// deep XLM/USDC pool prices 5 XLM at 0.8528 USDC (spot 0.17073 USDC/XLM),
// matching the real market rate. Soroswap stays selectable since it
// aggregates across venues Aquarius alone doesn't cover, and prices other
// pairs fine — but it is not the default.
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
  return ACTIVE_NETWORK.network === 'TESTNET'
    ? [TESTNET_PROVIDER]
    : [aquariusProvider, soroswapProvider];
}

export function listSwapProviders(): SwapProviderMeta[] {
  return getProviders().map(({ id, name, icon }) => ({ id, name, icon }));
}

/** Returns the provider with `id`, or the default (first) provider. */
export function getActiveSwapProvider(id?: string): SwapProvider {
  const providers = getProviders();
  return providers.find((p) => p.id === id) ?? providers[0];
}
