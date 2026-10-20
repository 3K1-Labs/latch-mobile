import type { ImageSourcePropType } from 'react-native';
import type { xdr } from '@stellar/stellar-sdk';
import type { TokenBalance } from '@/src/hooks/use-portfolio';

/** A token the user can swap from/to — same shape as a portfolio balance. */
export type SwapToken = TokenBalance;

export interface SwapQuoteParams {
  /** SAC contract ID of the input token */
  fromSacId: string;
  /** SAC contract ID of the output token */
  toSacId: string;
  /** Human-readable input amount, e.g. "1.5" (EXACT_IN) */
  amountIn: string;
  /** Slippage tolerance in basis points (50 = 0.5%) */
  slippageBps: number;
}

export interface SwapQuote {
  providerId: string;
  /** Human-readable input amount (echoes the request) */
  amountIn: string;
  /** Human-readable estimated output amount */
  amountOut: string;
  /** Human-readable minimum received after slippage */
  minReceived: string;
  /** amountOut / amountIn — display rate for "1 X ≈ Y" */
  rate: number;
  /** Price impact percentage (e.g. 0.25 for 0.25%) */
  priceImpactPct: number;
  fromSacId: string;
  toSacId: string;
  slippageBps: number;
  /**
   * Provider-opaque payload reused by buildSwapOperation. For Soroswap this is
   * the raw /quote response object passed straight back to /quote/build.
   */
  raw: unknown;
}

/** Lightweight provider descriptor for the Route selector UI. */
export interface SwapProviderMeta {
  id: string;
  name: string;
  icon: ImageSourcePropType;
}

export interface SwapBuildResult {
  /**
   * Soroban operation that performs the swap, with NO auth attached. Its XDR
   * is handed to POST /v1/transaction/build-swap as swap_chain_xdr — latch-api
   * wraps it in FeeForwarder.forward(...), simulates, and returns the auth
   * entries for executeSwapFromSmartAccount to sign.
   */
  operation: xdr.Operation;
  /**
   * The quote the operation was actually built from. Equals the input quote
   * unless the provider had to re-route at build time (e.g. Soroswap's
   * single-AMM fallback), in which case amountOut/minReceived reflect the route
   * that will execute — show these, not the original estimate.
   */
  effectiveQuote: SwapQuote;
  /** SAC contract id of the input token — build-swap's token_in_contract_id. */
  tokenInContractId: string;
  /** Input amount in SAC base units — build-swap's amount_in_raw. */
  amountInRaw: string;
  /** Minimum output in SAC base units — build-swap's amount_out_min_raw. */
  amountOutMinRaw: string;
  /** Router/aggregator contract the operation calls, if build-swap needs it named explicitly. */
  routerContractId?: string;
}

export interface SwapProvider extends SwapProviderMeta {
  getQuote(params: SwapQuoteParams): Promise<SwapQuote>;
  buildSwapOperation(quote: SwapQuote, smartAccountAddress: string): Promise<SwapBuildResult>;
}
