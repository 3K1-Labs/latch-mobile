/**
 * sac-asset-code.ts — best-effort resolution of a SAC contract id to its asset
 * code (e.g. "USDC", "XLM") for display on the approval screen. A transfer
 * packet only carries the SAC C-address, so we map it back through the
 * well-known token list (computing each token's SAC id from its issuer) plus the
 * native XLM SAC and the pinned Circle USDC contract.
 *
 * Returns null when the SAC isn't recognised — callers then show the amount
 * without a (potentially wrong) code rather than guessing.
 */

import { Asset } from '@stellar/stellar-sdk';

import { STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';
import { CIRCLE_USDC_CONTRACT, USDC_CODE } from '@/src/constants/constants';
import { getWellKnownTokens } from '@/src/constants/known-tokens';

let cache: Record<string, string> | null = null;

// Contract ids are network-specific — a switch (src/lib/network-switch.ts)
// must drop this memoized cache or it keeps resolving the old network's ids.
export function resetSacAssetCodeCache(): void {
  cache = null;
}

function buildMap(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    map[Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE)] = 'XLM';
  } catch {
    /* SDK contractId unavailable — skip native */
  }
  for (const t of getWellKnownTokens()) {
    try {
      const cid =
        t.sacContractId ??
        (t.issuer ? new Asset(t.code, t.issuer).contractId(STELLAR_NETWORK_PASSPHRASE) : null);
      if (cid) map[cid] = t.code;
    } catch {
      /* malformed entry — skip */
    }
  }
  map[CIRCLE_USDC_CONTRACT] = USDC_CODE;
  return map;
}

export function assetCodeForSac(sacContractId: string): string | null {
  if (!cache) cache = buildMap();
  return cache[sacContractId] ?? null;
}
