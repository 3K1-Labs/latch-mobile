import type { SwapBuildResult, SwapProvider, SwapQuote, SwapQuoteParams } from '../types';
import {
  buildSwapApiOperation,
  fetchRawSwapQuote,
  isPoolHashesError,
  mapSwapQuote,
} from './soroswap-api';

// Protocols the aggregator routes across. SDEX is the classic Stellar order
// book; the rest are Soroban AMMs.
//
// 'aqua' is deliberately excluded: verified live against mainnet that for
// XLM/USDC it routes through a specific thin pool
// (CCCRWH6Q3FNP3I2I57BDLM5AFAT7O6OF6GKQOC6SSJNDAVRZ57SPHGU2) that returns
// amountOut multiple times the real market value (e.g. 5 XLM ≈ $0.86 priced
// out at $3-7+ of USDC). soroswap, phoenix, and sdex all independently agree
// on the correct price for the same trade — only aqua's pool is broken, and
// the aggregator keeps picking it because it looks like the best price.
const PROTOCOLS = ['soroswap', 'phoenix', 'sdex'];

// A multi-hop `platform: 'aggregator'` route can return poolHashes that the
// /quote/build endpoint rejects with 400 "Invalid poolHashes string". When that
// happens we re-quote against a single AMM, which builds cleanly. The fallback
// route is built from its OWN fresh quote, so its on-chain amountOutMin (the
// slippage guard) is correct for the route actually executed.
const FALLBACK_PROTOCOLS = ['soroswap'];

export const soroswapProvider: SwapProvider = {
  id: 'soroswap',
  name: 'Soroswap',
  icon: require('@/src/assets/images/soroswap.png'),

  async getQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    return mapSwapQuote(await fetchRawSwapQuote(params, PROTOCOLS), params, 'soroswap');
  },

  async buildSwapOperation(
    quote: SwapQuote,
    smartAccountAddress: string,
  ): Promise<SwapBuildResult> {
    try {
      const operation = await buildSwapApiOperation(quote.raw, smartAccountAddress);
      return { operation, effectiveQuote: quote };
    } catch (err) {
      if (!isPoolHashesError(err)) throw err;
      // Aggregator route's poolHashes were rejected — rebuild via a single AMM.
      // The fallback quote is what actually executes, so return it as effective.
      if (__DEV__) {
        console.log('[swap] aggregator build rejected (poolHashes); retrying single-AMM route');
      }
      const params: SwapQuoteParams = {
        fromSacId: quote.fromSacId,
        toSacId: quote.toSacId,
        amountIn: quote.amountIn,
        slippageBps: quote.slippageBps,
      };
      const fallbackRaw = await fetchRawSwapQuote(params, FALLBACK_PROTOCOLS);
      const operation = await buildSwapApiOperation(fallbackRaw, smartAccountAddress);
      return { operation, effectiveQuote: mapSwapQuote(fallbackRaw, params, 'soroswap') };
    }
  },
};
