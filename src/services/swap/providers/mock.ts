import { Address, Asset, Contract, nativeToScVal } from '@stellar/stellar-sdk';

import { STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';
import { getWellKnownTokens } from '@/src/constants/known-tokens';
import { toBaseUnits } from '@/src/services/send-token';
import type { SwapBuildResult, SwapProvider, SwapQuote, SwapQuoteParams } from '../types';

// ─── DEV/TESTNET MOCK PROVIDER ────────────────────────────────────────────────
// Soroswap has no liquidity pools on Stellar testnet, so a real quote always
// fails. This mock lets the full swap UX (quote → details → confirm → biometric
// → on-chain submit) be exercised on testnet. It is selected by the registry
// only when __DEV__ && ACTIVE_NETWORK is testnet.
//
// IMPORTANT: buildSwapOperation does NOT perform a real swap — there is no pool.
// It self-transfers the input token (smart account → itself), which is a real,
// smart-account-authorized Soroban tx that succeeds on-chain and proves the
// sign/submit pipeline, but it does NOT deliver the output token.

// Synthetic USD prices for the well-known testnet tokens (cosmetic only).
const MOCK_USD: Record<string, number> = {
  XLM: 0.12,
  USDC: 1,
  USDT: 1,
  BTC: 65000,
  ETH: 3500,
  SOL: 150,
  XRP: 0.5,
  ADA: 0.4,
};

// SAC contract id → token code, so the synthetic quote can price by symbol.
// Lazily built/memoized — contract ids are network-specific, so a network
// switch (src/lib/network-switch.ts) must drop this cache via resetMockSwapCache().
let sacToCodeCache: Map<string, string> | null = null;

export function resetMockSwapCache(): void {
  sacToCodeCache = null;
}

function getSacToCode(): Map<string, string> {
  if (sacToCodeCache) return sacToCodeCache;

  const map = new Map<string, string>();
  try {
    map.set(Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE), 'XLM');
  } catch {
    // ignore — native SAC resolution should never fail
  }
  for (const t of getWellKnownTokens()) {
    try {
      const sac = t.sacContractId ?? new Asset(t.code, t.issuer!).contractId(STELLAR_NETWORK_PASSPHRASE);
      map.set(sac, t.code.toUpperCase());
    } catch {
      // skip tokens we can't resolve a SAC id for
    }
  }

  sacToCodeCache = map;
  return map;
}

function usdFor(sacId: string): number {
  const code = getSacToCode().get(sacId);
  return (code && MOCK_USD[code]) || 0;
}

// Trim a number to ≤7 dp without trailing zeros.
function fmt(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  return n.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}

export const mockSwapProvider: SwapProvider = {
  id: 'mock',
  name: 'Mock (testnet)',
  icon: require('@/src/assets/images/LiquidMesh.png'),

  async getQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    const inNum = parseFloat(params.amountIn) || 0;
    const priceFrom = usdFor(params.fromSacId);
    const priceTo = usdFor(params.toSacId);
    // USD-based rate when both prices are known, else fall back to 1:1.
    const rate = priceFrom > 0 && priceTo > 0 ? priceFrom / priceTo : 1;
    const priceImpactPct = 0.3;
    const amountOut = inNum * rate * (1 - priceImpactPct / 100);
    const minReceived = amountOut * (1 - params.slippageBps / 10000);

    // Simulate network latency so the loading states are visible.
    await new Promise((r) => setTimeout(r, 300));

    return {
      providerId: 'mock',
      amountIn: params.amountIn,
      amountOut: fmt(amountOut),
      minReceived: fmt(minReceived),
      rate: inNum > 0 ? amountOut / inNum : 0,
      priceImpactPct,
      fromSacId: params.fromSacId,
      toSacId: params.toSacId,
      slippageBps: params.slippageBps,
      raw: { mock: true },
    };
  },

  async buildSwapOperation(quote: SwapQuote, smartAccountAddress: string): Promise<SwapBuildResult> {
    // Self-transfer of the input token — real on-chain, smart-account authorized,
    // but delivers no output token (see file header).
    const contract = new Contract(quote.fromSacId);
    const operation = contract.call(
      'transfer',
      new Address(smartAccountAddress).toScVal(),
      new Address(smartAccountAddress).toScVal(),
      nativeToScVal(toBaseUnits(quote.amountIn), { type: 'i128' }),
    );
    return { operation, effectiveQuote: quote };
  },
};
