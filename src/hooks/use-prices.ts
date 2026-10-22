import { useQuery } from '@tanstack/react-query';
import { getPrices, type PriceData } from '../api/latch-auth';
import { normalizePriceMap, resolvePriceTokens } from '../lib/prices';

/**
 * Shown until the first response lands, and nothing else — the dollar-pegged
 * stablecoins only. A hardcoded XLM price would keep rendering as a live quote
 * through a price-feed outage, indistinguishable from the real thing.
 */
export const FALLBACK_PRICES: Record<string, PriceData> = {
  USDC: { price: '1.0', change_24h: 0 },
  USDT: { price: '1.0', change_24h: 0 },
};

/**
 * Live USD prices keyed by the uppercase asset codes used across the app
 * (`native` folds to `XLM`).
 *
 * `codes` narrows the request to a specific set of holdings. The default covers
 * every symbol the backend resolves, so screens that call this with no argument
 * share one cached request instead of firing one apiece. Either way the backend
 * batches the whole list into a single round trip and caches it for 60s.
 *
 * A token with no quote is absent from the result rather than zero — see
 * normalizePriceMap.
 */
export function usePrices(codes?: string[]) {
  const tokens = resolvePriceTokens(codes);
  return useQuery({
    queryKey: ['prices', tokens.join(',')],
    queryFn: async () => normalizePriceMap(await getPrices(tokens)),
    staleTime: 60_000,
    placeholderData: FALLBACK_PRICES,
  });
}
