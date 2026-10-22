import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

/**
 * Encode/decode helpers for the Soroswap aggregator's on-chain `DexDistribution`
 * argument. Split out from soroswap.ts because they're pure — no RPC — so they
 * can be tested directly (see soroswap-distribution.test.ts).
 *
 * We used to hand the raw /quote response straight to Soroswap's POST
 * /quote/build and get an already-encoded invocation XDR back. That endpoint
 * expects `from` to be a classic G wallet; it silently mis-builds (or 400s)
 * when handed our smart account's C-address, which is why mainnet swaps
 * stopped completing. Ported from latch-web-extension's
 * packages/swap/src/providers/{soroswapQuote,soroswapBuild}.ts (commit
 * 15d60ea), which hit the same wall and encodes the distribution locally
 * instead of asking the API to.
 */

/** Aggregator Protocol enum (#[repr(u32)]) — the venues a DexDistribution leg can name. */
export function soroswapProtocolIdToU32(protocolId: string): number {
  switch (protocolId.toLowerCase()) {
    case 'soroswap':
      return 0;
    case 'phoenix':
      return 1;
    case 'aqua':
    case 'aquarius':
      return 2;
    case 'comet':
      return 3;
    default:
      // Notably absent: 'sdex'. The classic order book isn't a leg the
      // aggregator's DexDistribution can name — soroswap.ts's PROTOCOLS list
      // must not request it as a route candidate, only soroswap/phoenix (aqua
      // is separately blocklisted there for mispricing a specific pool).
      throw new Error(`Unknown Soroswap protocol_id: ${protocolId}`);
  }
}

/** A quote's `poolHashes` arrive as 64-char hex or, on some shapes, base64 — both mean 32 bytes. */
export function poolHashToBytes(hash: string): Buffer {
  const trimmed = hash.trim();
  if (!trimmed) throw new Error('Invalid poolHashes string: empty');

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length !== 32) throw new Error(`Invalid poolHashes string: ${trimmed}`);
    return buf;
  }

  throw new Error(`Invalid poolHashes string: ${trimmed}`);
}

export interface SoroswapDistributionEntry {
  protocolId: string;
  path: string[];
  parts: number;
  poolHashes?: string[];
}

/** Reads the aggregator route out of a raw /quote response's `rawTrade.distribution`. */
export function parseSoroswapDistribution(
  quote: Record<string, unknown>,
): SoroswapDistributionEntry[] {
  const rawTrade = quote.rawTrade as { distribution?: unknown } | undefined;
  const distribution = rawTrade?.distribution;
  if (!Array.isArray(distribution) || distribution.length === 0) {
    throw new Error('Soroswap quote is missing rawTrade.distribution');
  }

  return distribution.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid Soroswap distribution entry at ${index}`);
    }
    const e = entry as Record<string, unknown>;
    const protocolId = String(e.protocol_id ?? e.protocolId ?? '').toLowerCase();
    if (!protocolId) throw new Error(`Soroswap distribution entry ${index} missing protocol_id`);

    const path = e.path;
    if (!Array.isArray(path) || path.length < 2 || !path.every((p) => typeof p === 'string')) {
      throw new Error(`Soroswap distribution entry ${index} has an invalid path`);
    }

    const parts = typeof e.parts === 'number' ? e.parts : Number(e.parts);
    if (!Number.isFinite(parts) || parts <= 0) {
      throw new Error(`Soroswap distribution entry ${index} has invalid parts`);
    }

    const hashes = e.poolHashes;
    const poolHashes = Array.isArray(hashes)
      ? hashes.map((h) => {
          if (typeof h !== 'string') throw new Error(`Invalid poolHashes string: ${String(h)}`);
          return h;
        })
      : undefined;

    return { protocolId, path: path as string[], parts: Math.floor(parts), poolHashes };
  });
}

function poolHashesToScVal(poolHashes?: string[]): xdr.ScVal {
  // Option<Vec<BytesN<32>>>: None → void; Some(vec) → scvVec of scvBytes.
  if (!poolHashes || poolHashes.length === 0) return nativeToScVal(null);
  return xdr.ScVal.scvVec(
    poolHashes.map((hash) => {
      const buf = poolHashToBytes(hash);
      if (buf.length !== 32) throw new Error(`Expected 32-byte pool hash, got ${buf.length}`);
      return xdr.ScVal.scvBytes(buf);
    }),
  );
}

/** Encode one DexDistribution map. Keys sorted (Soroban map canonical order): bytes, parts, path, protocol_id. */
export function dexDistributionEntryToScVal(entry: SoroswapDistributionEntry): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('bytes'),
      val: poolHashesToScVal(entry.poolHashes),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('parts'),
      val: nativeToScVal(entry.parts, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('path'),
      val: nativeToScVal(entry.path.map((addr) => new Address(addr))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('protocol_id'),
      val: nativeToScVal(soroswapProtocolIdToU32(entry.protocolId), { type: 'u32' }),
    }),
  ]);
}

export function buildDexDistributionScVal(entries: SoroswapDistributionEntry[]): xdr.ScVal {
  return xdr.ScVal.scvVec(entries.map(dexDistributionEntryToScVal));
}

/** `swap_exact_tokens_for_tokens` returns Vec<Vec<i128>>; sum the last hop of each parallel route. */
export function extractAggregatorAmountOut(retval: xdr.ScVal): bigint {
  const native = scValToNative(retval) as unknown;
  if (!Array.isArray(native) || native.length === 0) {
    throw new Error('Soroswap simulation returned an empty swap result');
  }

  let total = 0n;
  for (const route of native) {
    if (!Array.isArray(route) || route.length === 0) {
      throw new Error('Soroswap simulation returned an invalid route result');
    }
    const last = route[route.length - 1];
    const asBig =
      typeof last === 'bigint'
        ? last
        : typeof last === 'number' || typeof last === 'string'
          ? BigInt(last)
          : null;
    if (asBig === null || asBig < 0n) {
      throw new Error('Soroswap simulation returned a non-integer amountOut');
    }
    total += asBig;
  }
  if (total <= 0n) throw new Error('Soroswap simulation returned zero amountOut');
  return total;
}
