import { DEFAULT_PRICE_TOKENS, normalizePriceMap, resolvePriceTokens } from '../prices';

describe('resolvePriceTokens', () => {
  it('falls back to the full symbol list when no codes are given', () => {
    expect(resolvePriceTokens()).toEqual([...DEFAULT_PRICE_TOKENS]);
    expect(resolvePriceTokens([])).toEqual([...DEFAULT_PRICE_TOKENS]);
    expect(resolvePriceTokens(['', '  '])).toEqual([...DEFAULT_PRICE_TOKENS]);
  });

  it('lowercases and trims what the caller passes', () => {
    expect(resolvePriceTokens([' USDC ', 'Aqua'])).toEqual(['aqua', 'usdc']);
  });

  it('collapses the XLM aliases into one symbol', () => {
    expect(resolvePriceTokens(['native', 'XLM', 'stellar'])).toEqual(['native']);
  });

  it('keeps yXLM distinct — it is a separate balance row', () => {
    expect(resolvePriceTokens(['xlm', 'yxlm'])).toEqual(['native', 'yxlm']);
  });

  it('sorts so the same set produces the same query key', () => {
    expect(resolvePriceTokens(['btc', 'aqua'])).toEqual(resolvePriceTokens(['aqua', 'btc', 'btc']));
  });

  it('covers the tokens the old hardcoded request missed', () => {
    for (const symbol of ['btc', 'eth', 'sol', 'aqua', 'shx', 'yxlm', 'yusdc']) {
      expect(DEFAULT_PRICE_TOKENS).toContain(symbol);
    }
  });

  it('does not send an alias alongside the symbol it duplicates', () => {
    for (const alias of ['xlm', 'stellar', 'bitcoin', 'ethereum', 'solana', 'ripple']) {
      expect(DEFAULT_PRICE_TOKENS).not.toContain(alias);
    }
  });
});

describe('normalizePriceMap', () => {
  it('keys prices by the uppercase asset code, folding native to XLM', () => {
    expect(
      normalizePriceMap({
        native: { price: '0.1423', change_24h: -1.23 },
        usdc: { price: '1.0', change_24h: 0.01 },
      }),
    ).toEqual({
      XLM: { price: '0.1423', change_24h: -1.23 },
      USDC: { price: '1.0', change_24h: 0.01 },
    });
  });

  it('drops null entries instead of defaulting them', () => {
    expect(normalizePriceMap({ wat: null, btc: { price: '65000', change_24h: 2 } })).toEqual({
      BTC: { price: '65000', change_24h: 2 },
    });
  });

  it('returns an empty map for an all-null response — an upstream outage', () => {
    expect(normalizePriceMap({ native: null, usdc: null })).toEqual({});
  });

  it('tolerates a missing payload', () => {
    expect(normalizePriceMap(undefined)).toEqual({});
  });
});
