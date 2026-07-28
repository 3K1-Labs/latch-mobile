import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { usePrices } from '@/src/hooks/use-prices';
import { getActiveSwapProvider } from '@/src/services/swap/registry';
import type { SwapQuote } from '@/src/services/swap/types';

export interface UseSwapQuoteArgs {
  fromSacId?: string;
  toSacId?: string;
  /** Human-readable input amount; quote runs only when > 0 */
  amountIn: string;
  /** Slippage tolerance in basis points (default 50 = 0.5%) */
  slippageBps?: number;
  /** Provider id; defaults to the active (first) provider */
  providerId?: string;
  /** Token codes, used only to sanity-check the quoted rate against USD prices */
  fromCode?: string;
  toCode?: string;
}

/**
 * A quoted rate this far from the reference USD rate is not a real trade — it
 * means the provider routed through a broken or deliberately skewed pool.
 * Anyone can permissionlessly create an AMM pool at an arbitrary ratio, and
 * both of our providers pick routes by quoted output, so a skewed pool looks
 * like the best price to them.
 *
 * Verified live on mainnet: Soroswap's `aqua` route priced 5 XLM (~$0.85) at
 * 3.27 USDC — a 3.84x overpay — while soroswap/phoenix/sdex all independently
 * returned ~0.851 USDC for the same trade. That route is blocklisted by symbol
 * in providers/soroswap.ts, but a blocklist only catches the venue we already
 * know about; this bound catches the next one.
 *
 * Bounds are deliberately loose so they never fire on ordinary conditions:
 * real price impact on a large trade, a stale price feed, or the hardcoded
 * FALLBACK_PRICES all sit far inside 0.5x–1.5x.
 */
const MAX_RATE_DEVIATION = 1.5;
const MIN_RATE_DEVIATION = 0.5;

export class ImplausibleQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImplausibleQuoteError';
  }
}

/**
 * Throws when `quote.rate` can't be reconciled with the USD reference rate.
 * Silently passes when either price is unknown — an unpriced token is not
 * evidence of a bad quote, and blocking it would break swaps for every token
 * outside the price feed.
 */
function assertPlausibleRate(quote: SwapQuote, fromPrice: number, toPrice: number): void {
  if (!(fromPrice > 0) || !(toPrice > 0) || !(quote.rate > 0)) return;
  const referenceRate = fromPrice / toPrice;
  const deviation = quote.rate / referenceRate;
  if (deviation <= MAX_RATE_DEVIATION && deviation >= MIN_RATE_DEVIATION) return;
  throw new ImplausibleQuoteError(
    `Quoted rate ${quote.rate.toPrecision(6)} is ${deviation.toFixed(2)}x the reference rate ` +
      `${referenceRate.toPrecision(6)} (${quote.providerId}) — refusing to price this route`,
  );
}

/**
 * Fetches a live swap quote from the active liquidity provider. Debounce the
 * `amountIn` at the call site (the screen) so we don't quote on every keystroke.
 */
export function useSwapQuote({
  fromSacId,
  toSacId,
  amountIn,
  slippageBps = 50,
  providerId,
  fromCode,
  toCode,
}: UseSwapQuoteArgs) {
  const provider = getActiveSwapProvider(providerId);
  const { data: prices } = usePrices();
  const fromPrice = parseFloat(prices?.[fromCode ?? '']?.price ?? '0');
  const toPrice = parseFloat(prices?.[toCode ?? '']?.price ?? '0');
  const amountNum = parseFloat(amountIn);
  const enabled = !!fromSacId && !!toSacId && fromSacId !== toSacId && amountNum > 0;

  return useQuery<SwapQuote>({
    queryKey: ['swap-quote', provider.id, fromSacId, toSacId, amountIn, slippageBps],
    queryFn: async () => {
      if (__DEV__) {
        console.log('[swap-quote] → fetch', {
          provider: provider.id,
          fromSacId,
          toSacId,
          amountIn,
          slippageBps,
        });
      }
      try {
        const quote = await provider.getQuote({
          fromSacId: fromSacId!,
          toSacId: toSacId!,
          amountIn,
          slippageBps,
        });
        if (__DEV__) {
          console.log('[swap-quote] ✓ result', {
            amountOut: quote.amountOut,
            minReceived: quote.minReceived,
            rate: quote.rate,
            priceImpactPct: quote.priceImpactPct,
          });
        }
        assertPlausibleRate(quote, fromPrice, toPrice);
        return quote;
      } catch (err) {
        if (__DEV__) {
          console.log('[swap-quote] ✗ error', err instanceof Error ? err.message : err);
        }
        throw err;
      }
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // A quote is a live price. Nothing else re-triggers this query while the
    // screen sits mounted (RN has no window-focus refetch, and tab screens
    // never unmount), so without an interval a displayed quote — and the
    // `Approve` armed with it — can be arbitrarily old.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
