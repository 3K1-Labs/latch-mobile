import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

import {
  buildDexDistributionScVal,
  dexDistributionEntryToScVal,
  extractAggregatorAmountOut,
  parseSoroswapDistribution,
  poolHashToBytes,
  soroswapProtocolIdToU32,
} from '@/src/services/swap/providers/soroswap-distribution';

describe('soroswapProtocolIdToU32', () => {
  it('maps the aggregator Protocol enum values', () => {
    expect(soroswapProtocolIdToU32('soroswap')).toBe(0);
    expect(soroswapProtocolIdToU32('phoenix')).toBe(1);
    expect(soroswapProtocolIdToU32('aqua')).toBe(2);
    expect(soroswapProtocolIdToU32('aquarius')).toBe(2);
    expect(soroswapProtocolIdToU32('comet')).toBe(3);
  });

  it('rejects sdex — the classic order book has no DexDistribution leg', () => {
    expect(() => soroswapProtocolIdToU32('sdex')).toThrow(/Unknown Soroswap protocol_id/);
  });
});

describe('poolHashToBytes', () => {
  const hex = 'ab'.repeat(32); // 64 hex chars = 32 bytes

  it('decodes 64-char hex pool indexes', () => {
    const buf = poolHashToBytes(hex);
    expect(buf.length).toBe(32);
    expect(buf.toString('hex')).toBe(hex);
  });

  it('decodes base64 pool hashes', () => {
    const b64 = Buffer.from(hex, 'hex').toString('base64');
    expect(poolHashToBytes(b64).toString('hex')).toBe(hex);
  });

  it('rejects a string that is neither', () => {
    expect(() => poolHashToBytes('not-a-hash')).toThrow(/Invalid poolHashes string/);
  });
});

describe('parseSoroswapDistribution', () => {
  it('parses a distribution from a quote payload', () => {
    const entries = parseSoroswapDistribution({
      rawTrade: {
        distribution: [
          {
            protocol_id: 'soroswap',
            path: [
              'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
              'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
            ],
            parts: 10,
          },
        ],
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ protocolId: 'soroswap', parts: 10 });
    expect(entries[0].poolHashes).toBeUndefined();
  });

  it('throws when rawTrade.distribution is missing', () => {
    expect(() => parseSoroswapDistribution({})).toThrow(/missing rawTrade.distribution/);
  });
});

describe('dexDistributionEntryToScVal / buildDexDistributionScVal', () => {
  it('encodes a map with the four canonical keys', () => {
    const scVal = dexDistributionEntryToScVal({
      protocolId: 'phoenix',
      path: [
        'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
        'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
      ],
      parts: 10,
    });
    expect(scVal.switch().name).toBe('scvMap');
    const keys = scVal.map()!.map((e) => e.key().sym().toString());
    expect(keys).toEqual(['bytes', 'parts', 'path', 'protocol_id']);
  });

  it('builds a vec of entries', () => {
    // Not "tokenA"/"tokenB" — gitleaks' generic-api-key rule flags any
    // "token*"-named identifier assigned a high-entropy string, and a Stellar
    // contract address (public, not secret) fits that shape closely enough.
    const assetA = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
    const assetB = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
    const scVal = buildDexDistributionScVal([
      { protocolId: 'soroswap', path: [assetA, assetB], parts: 5 },
      { protocolId: 'phoenix', path: [assetA, assetB], parts: 5 },
    ]);
    expect(scVal.switch().name).toBe('scvVec');
    expect(scVal.vec()).toHaveLength(2);
  });
});

// Vec<Vec<i128>>, built by hand — nativeToScVal's `{ type: 'i128' }` hint only
// applies at the value it's passed to, not recursively through nested arrays.
function routesScVal(routes: bigint[][]): xdr.ScVal {
  return xdr.ScVal.scvVec(
    routes.map((route) => xdr.ScVal.scvVec(route.map((v) => nativeToScVal(v, { type: 'i128' })))),
  );
}

describe('extractAggregatorAmountOut', () => {
  it('sums the last hop of each parallel route', () => {
    expect(
      extractAggregatorAmountOut(
        routesScVal([
          [100n, 200n],
          [50n, 75n],
        ]),
      ),
    ).toBe(275n);
  });

  it('rejects an empty result', () => {
    expect(() => extractAggregatorAmountOut(xdr.ScVal.scvVec([]))).toThrow(/empty swap result/);
  });

  it('rejects a zero total', () => {
    expect(() => extractAggregatorAmountOut(routesScVal([[0n]]))).toThrow(/zero amountOut/);
  });
});
