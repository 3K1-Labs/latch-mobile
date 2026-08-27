import type { PriceData } from '../api/latch-auth';

/**
 * Everything `/v1/prices` resolves, one entry per code the app displays.
 *
 * The backend accepts 34 symbols; the long-form aliases (`stellar`, `bitcoin`,
 * `ethereum`, `solana`, `ripple`) are deliberately absent — they return the
 * same price as the short code and would only add a duplicate response key.
 * A symbol the backend does not know comes back as an explicit `null`, so the
 * cost of a wrong entry here is a dropped key, not an error.
 */
export const DEFAULT_PRICE_TOKENS: readonly string[] = [
  'native',
  'yxlm',
  'usdc',
  'yusdc',
  'usdt',
  'pyusd',
  'usdy',
  'usdm',
  'eurc',
  'btc',
  'ybtc',
  'btcln',
  'eth',
  'yeth',
  'sol',
  'xrp',
  'dot',
  'doge',
  'ltc',
  'bnb',
  'ada',
  'avax',
  'matic',
  'pol',
  'aqua',
  'shx',
  'velo',
  'tft',
];

// All three resolve to the same upstream price, and the app displays that price
// under a single code, XLM.
const XLM_ALIASES = new Set(['native', 'xlm', 'stellar']);

/**
 * Turns asset codes into the symbol list to send. Aliases of XLM collapse to
 * one symbol, and the result is sorted so two screens asking for the same set
 * hit the same React Query cache entry rather than each firing a request.
 */
export function resolvePriceTokens(codes?: string[] | null): string[] {
  const tokens = new Set<string>();
  for (const code of codes ?? []) {
    const symbol = code?.trim().toLowerCase();
    if (!symbol) continue;
    tokens.add(XLM_ALIASES.has(symbol) ? 'native' : symbol);
  }
  if (tokens.size === 0) return [...DEFAULT_PRICE_TOKENS];
  return [...tokens].sort();
}

/**
 * Re-keys a `/v1/prices` payload to the uppercase codes used across the app.
 *
 * A `null` entry is dropped rather than defaulted: it means the symbol is
 * unknown *or* the upstream feed missed, and the two are indistinguishable in
 * the response. Callers render an unpriced token as `—`, never as `$0.00`.
 */
export function normalizePriceMap(
  raw: Record<string, PriceData | null> | null | undefined,
): Record<string, PriceData> {
  const out: Record<string, PriceData> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value == null) continue;
    out[XLM_ALIASES.has(key.toLowerCase()) ? 'XLM' : key.toUpperCase()] = value;
  }
  return out;
}
