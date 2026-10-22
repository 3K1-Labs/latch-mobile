import { Address, Contract, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';

import { bundlerAddress } from '@/src/api/transaction-relay';
import { sorobanCall, txToBase64 } from '@/src/api/smart-account';
import {
  SOROSWAP_AGGREGATOR_ADDRESS,
  SOROSWAP_API_KEY,
  SOROSWAP_API_URL,
  SOROSWAP_NETWORK,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { loadAccount, toBaseUnits } from '@/src/services/send-token';
import type { SwapBuildResult, SwapProvider, SwapQuote, SwapQuoteParams } from '../types';
import {
  buildDexDistributionScVal,
  extractAggregatorAmountOut,
  parseSoroswapDistribution,
} from './soroswap-distribution';

// Protocols the aggregator quotes across. SDEX is the classic Stellar order
// book; the rest are Soroban AMMs.
//
// 'aqua' is deliberately excluded: verified live against mainnet that for
// XLM/USDC it routes through a specific thin pool
// (CCCRWH6Q3FNP3I2I57BDLM5AFAT7O6OF6GKQOC6SSJNDAVRZ57SPHGU2) that returns
// amountOut multiple times the real market value (e.g. 5 XLM ≈ $0.86 priced
// out at $3-7+ of USDC). soroswap, phoenix, and sdex all independently agree
// on the correct price for the same trade — only aqua's pool is broken, and
// the aggregator keeps picking it because it looks like the best price.
//
// 'sdex' stays in the set for price discovery even though we can't build a
// route across it (see buildAggregatorOperation) — soroswapProtocolIdToU32
// has no DexDistribution encoding for the classic order book. If the
// aggregator picks an sdex leg, buildSwapOperation falls back to a
// single-AMM route rather than failing the swap outright.
const PROTOCOLS = ['soroswap', 'phoenix', 'sdex'];

// A multi-hop route can name a protocol or poolHashes shape the local
// DexDistribution encoder can't build (an sdex leg, or an aqua poolHashes
// format we haven't seen). When that happens we re-quote against a single
// AMM, which always builds cleanly. The fallback route is built from its OWN
// fresh quote, so its on-chain amountOutMin (the slippage guard) is correct
// for the route actually executed.
const FALLBACK_PROTOCOLS = ['soroswap'];

// Convert SAC base units (7 decimals, integer string) → human-readable string.
// String arithmetic avoids float precision loss on large i128 amounts.
function fromBaseUnits(base: string): string {
  const neg = base.startsWith('-');
  const digits = (neg ? base.slice(1) : base).padStart(8, '0');
  const intPart = digits.slice(0, -7).replace(/^0+(?=\d)/, '');
  const fracPart = digits.slice(-7).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
}

async function soroswapPost(path: string, body: object): Promise<any> {
  const url = `${SOROSWAP_API_URL}${path}?network=${SOROSWAP_NETWORK}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${SOROSWAP_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Soroswap ${path} ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

// Raw /quote response for a pair + protocol set. Its rawTrade.distribution is
// what we encode into the on-chain call, so it's treated as opaque and stored
// verbatim on SwapQuote.raw.
function fetchRawQuote(params: SwapQuoteParams, protocols: string[]): Promise<any> {
  return soroswapPost('/quote', {
    assetIn: params.fromSacId,
    assetOut: params.toSacId,
    // i128 base units serialized as a string (JSON has no bigint).
    amount: toBaseUnits(params.amountIn).toString(),
    tradeType: 'EXACT_IN',
    protocols,
    slippageBps: params.slippageBps,
  });
}

// Map a raw /quote response to a SwapQuote against the originating params.
function mapQuote(rawQuote: any, params: SwapQuoteParams): SwapQuote {
  const amountOut = fromBaseUnits(String(rawQuote.amountOut ?? '0'));
  const minReceived = fromBaseUnits(String(rawQuote.otherAmountThreshold ?? '0'));
  const inNum = parseFloat(params.amountIn);
  return {
    providerId: 'soroswap',
    amountIn: params.amountIn,
    amountOut,
    minReceived,
    rate: inNum > 0 ? parseFloat(amountOut) / inNum : 0,
    priceImpactPct: parseFloat(String(rawQuote.priceImpactPct ?? '0')),
    fromSacId: params.fromSacId,
    toSacId: params.toSacId,
    slippageBps: params.slippageBps,
    raw: rawQuote,
  };
}

function friendlyAggregatorSimError(raw: string): string {
  if (raw.includes('#608') || /InsufficientOutputAmount/i.test(raw)) {
    return 'Swap would fail on-chain: output below minimum (price moved or quote was stale). Try again.';
  }
  if (raw.includes('#505') || /DeadlineExpired/i.test(raw)) {
    return 'Swap quote expired before it could be prepared. Try again.';
  }
  if (raw.includes('#406') || /MissingPoolHashes/i.test(raw)) {
    return 'Soroswap route is missing pool hashes.';
  }
  if (raw.includes('#610') || /ProtocolPaused/i.test(raw)) {
    return 'Soroswap reports this DEX protocol is paused.';
  }
  return `Soroswap simulation failed: ${raw.split('\n')[0]?.trim().slice(0, 240) || raw.slice(0, 240)}`;
}

// Build the aggregator's `swap_exact_tokens_for_tokens` invocation. No auth is
// attached — buildSwapOperation's caller (execute-swap.ts) re-derives the
// smart-account auth during its own simulate pass, exactly like a SAC transfer.
function buildAggregatorOperation(args: {
  tokenIn: string;
  tokenOut: string;
  amountInBase: bigint;
  amountOutMinBase: bigint;
  distributionScVal: xdr.ScVal;
  smartAccountAddress: string;
  deadlineSec: number;
}): xdr.Operation {
  const aggregator = new Contract(SOROSWAP_AGGREGATOR_ADDRESS);
  return aggregator.call(
    'swap_exact_tokens_for_tokens',
    new Address(args.tokenIn).toScVal(),
    new Address(args.tokenOut).toScVal(),
    nativeToScVal(args.amountInBase, { type: 'i128' }),
    nativeToScVal(args.amountOutMinBase, { type: 'i128' }),
    args.distributionScVal,
    new Address(args.smartAccountAddress).toScVal(),
    nativeToScVal(args.deadlineSec, { type: 'u64' }),
  );
}

/**
 * Encode the aggregator call locally from the raw /quote and return the
 * operation to plug into the bundler-sourced tx.
 *
 * We used to POST the raw quote to Soroswap's /quote/build and take the
 * invokeHostFunction op out of the XDR it returned. That endpoint expects
 * `from` to be a classic G wallet — handed our smart account's C-address, it
 * either 400s or builds an operation that doesn't match what we simulate and
 * sign, so mainnet swaps stopped completing. Building the DexDistribution
 * ourselves (same approach the extension's providers/soroswap.ts landed on)
 * removes the dependency on that endpoint understanding smart accounts at all.
 *
 * Soroswap's /quote amountOut can also disagree with what the aggregator
 * actually returns on-chain (observed InsufficientOutputAmount #608 on
 * prepare-sign). We probe-simulate with amountOutMin=0 first, read the real
 * output, and rebuild with a slippage-adjusted minimum — the stricter of that
 * and the quote's own minimum — before returning the operation.
 */
async function buildOpFromRawQuote(
  rawQuote: unknown,
  quote: SwapQuote,
  smartAccountAddress: string,
): Promise<xdr.Operation> {
  const distribution = parseSoroswapDistribution(rawQuote as Record<string, unknown>);
  const distributionScVal = buildDexDistributionScVal(distribution);
  const deadlineSec = Math.floor(Date.now() / 1000) + 600;
  const common = {
    tokenIn: quote.fromSacId,
    tokenOut: quote.toSacId,
    amountInBase: toBaseUnits(quote.amountIn),
    distributionScVal,
    smartAccountAddress,
    deadlineSec,
  };

  // Bundler is the outer tx source for the probe too — simulation needs a
  // real, funded account to build against, even though nothing here submits.
  const bundlerG = await bundlerAddress();
  const account = await loadAccount(bundlerG);

  const probeOp = buildAggregatorOperation({ ...common, amountOutMinBase: 0n });
  const probeTx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(probeOp)
    .setTimeout(60)
    .build();

  const probeSim = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(probeTx),
  });
  if (probeSim.error) throw new Error(friendlyAggregatorSimError(String(probeSim.error)));
  // The return value is in results[0].xdr, not a `.retval` field on the raw
  // RPC response — see the same note in providers/aquarius.ts.
  const retvalXdr = probeSim.results?.[0]?.xdr;
  if (!retvalXdr) throw new Error('Soroswap probe simulation returned no result');

  const simulatedOut = extractAggregatorAmountOut(xdr.ScVal.fromXDR(retvalXdr, 'base64'));
  const calibratedMin = (simulatedOut * BigInt(10_000 - quote.slippageBps)) / 10_000n;
  const quoteMin = toBaseUnits(quote.minReceived);
  // Prefer the stricter (lower) of the quote's minimum vs the on-chain calibrated minimum.
  const amountOutMinBase = quoteMin > 0n && quoteMin < calibratedMin ? quoteMin : calibratedMin;

  return buildAggregatorOperation({ ...common, amountOutMinBase });
}

function isUnbuildableRouteError(err: unknown): boolean {
  return err instanceof Error && /poolhashes|unknown soroswap protocol_id/i.test(err.message);
}

export const soroswapProvider: SwapProvider = {
  id: 'soroswap',
  name: 'Soroswap',
  icon: require('@/src/assets/images/soroswap.png'),

  async getQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    return mapQuote(await fetchRawQuote(params, PROTOCOLS), params);
  },

  async buildSwapOperation(
    quote: SwapQuote,
    smartAccountAddress: string,
  ): Promise<SwapBuildResult> {
    try {
      const operation = await buildOpFromRawQuote(quote.raw, quote, smartAccountAddress);
      return { operation, effectiveQuote: quote };
    } catch (err) {
      if (!isUnbuildableRouteError(err)) throw err;
      // Aggregator route can't be locally encoded (an sdex leg, or a
      // poolHashes shape we don't recognize) — rebuild via a single AMM.
      // The fallback quote is what actually executes, so return it as effective.
      if (__DEV__) {
        console.log('[swap] aggregator route unbuildable; retrying single-AMM route');
      }
      const params: SwapQuoteParams = {
        fromSacId: quote.fromSacId,
        toSacId: quote.toSacId,
        amountIn: quote.amountIn,
        slippageBps: quote.slippageBps,
      };
      const fallbackRaw = await fetchRawQuote(params, FALLBACK_PROTOCOLS);
      const fallbackQuote = mapQuote(fallbackRaw, params);
      const operation = await buildOpFromRawQuote(fallbackRaw, fallbackQuote, smartAccountAddress);
      return { operation, effectiveQuote: fallbackQuote };
    }
  },
};
