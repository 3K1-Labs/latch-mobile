import type { SwapBuildResult, SwapProvider, SwapQuote, SwapQuoteParams } from '../types';
import {
  buildSwapApiOperation,
  fetchRawSwapQuote,
  mapSwapQuote,
} from './soroswap-api';

// Phoenix is queried through the same Soroswap API contract used by the app's
// existing provider, but the protocol filter keeps this route independent.
// That gives the picker a real Phoenix fallback without duplicating API auth,
// quote conversion, or Soroban operation parsing.
const PHOENIX_PROTOCOLS = ['phoenix'];

export const phoenixProvider: SwapProvider = {
  id: 'phoenix',
  name: 'Phoenix',
  icon: require('@/src/assets/images/phoenix.png'),

  async getQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    const rawQuote = await fetchRawSwapQuote(params, PHOENIX_PROTOCOLS);
    return mapSwapQuote(rawQuote, params, 'phoenix');
  },

  async buildSwapOperation(
    quote: SwapQuote,
    smartAccountAddress: string,
  ): Promise<SwapBuildResult> {
    const operation = await buildSwapApiOperation(quote.raw, smartAccountAddress);
    return { operation, effectiveQuote: quote };
  },
};
