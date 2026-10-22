import {
  formatFiat,
  formatTokenAsFiat,
  resolveDisplayCurrency,
  UNPRICED_LABEL,
} from './format-fiat';

describe('resolveDisplayCurrency', () => {
  it('keeps USD at a 1:1 rate', () => {
    expect(resolveDisplayCurrency('USD', 1)).toEqual({
      currency: 'USD',
      rate: 1,
      usedFallback: false,
    });
  });

  it('uses the selected currency when a positive rate exists', () => {
    expect(resolveDisplayCurrency('EUR', 0.92)).toEqual({
      currency: 'EUR',
      rate: 0.92,
      usedFallback: false,
    });
  });

  it('falls back to USD when the rate is missing', () => {
    expect(resolveDisplayCurrency('NGN', null)).toEqual({
      currency: 'USD',
      rate: 1,
      usedFallback: true,
    });
  });

  it('falls back to USD when the rate is zero or not finite', () => {
    expect(resolveDisplayCurrency('EUR', 0).usedFallback).toBe(true);
    expect(resolveDisplayCurrency('EUR', Number.NaN).usedFallback).toBe(true);
  });
});

describe('formatFiat', () => {
  it('formats USD without a fallback marker', () => {
    const result = formatFiat({ usdAmount: 12.5, selectedCurrency: 'USD', usdToSelectedRate: 1 });
    expect(result.usedFallback).toBe(false);
    expect(result.currency).toBe('USD');
    expect(result.text).toContain('12.50');
    expect(result.text).not.toContain('(USD)');
  });

  it('converts from USD using the supplied rate', () => {
    const result = formatFiat({
      usdAmount: 10,
      selectedCurrency: 'EUR',
      usdToSelectedRate: 2,
    });
    expect(result.usedFallback).toBe(false);
    expect(result.currency).toBe('EUR');
    expect(result.text).toContain('20.00');
  });

  it('labels the amount as USD when the selected rate is unavailable', () => {
    const result = formatFiat({
      usdAmount: 5,
      selectedCurrency: 'KES',
      usdToSelectedRate: null,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.currency).toBe('USD');
    expect(result.text).toContain('(USD)');
  });

  it('renders CAD/AUD/MXN with a plain $ rather than a country-prefixed symbol', () => {
    for (const currency of ['CAD', 'AUD', 'MXN']) {
      const result = formatFiat({ usdAmount: 20, selectedCurrency: currency, usdToSelectedRate: 1 });
      expect(result.text).toBe('$20.00');
    }
  });

  it('prefixes an approximate marker when asked', () => {
    const result = formatFiat({
      usdAmount: 1,
      selectedCurrency: 'USD',
      usdToSelectedRate: 1,
      approx: true,
    });
    expect(result.text.startsWith('≈')).toBe(true);
  });
});

describe('formatTokenAsFiat', () => {
  it('multiplies token amount by the USD price, then converts', () => {
    const result = formatTokenAsFiat('2', '5', 'EUR', 2, { approx: true });
    expect(result.usedFallback).toBe(false);
    expect(result.text).toContain('20.00');
    expect(result.text.startsWith('≈')).toBe(true);
  });

  it('formats zero when amount or price is missing', () => {
    const result = formatTokenAsFiat('0', '5', 'USD', 1, { approx: true });
    expect(result.text).toContain('0.00');
  });
});

describe('formatTokenAsFiat with no price', () => {
  it('renders the unpriced label rather than a zero figure', () => {
    expect(formatTokenAsFiat('12.5', undefined, 'USD', 1).text).toBe(UNPRICED_LABEL);
    expect(formatTokenAsFiat('12.5', undefined, 'USD', 1).unpriced).toBe(true);
  });

  it('treats an unparseable price as unpriced', () => {
    expect(formatTokenAsFiat('12.5', '', 'USD', 1).text).toBe(UNPRICED_LABEL);
    expect(formatTokenAsFiat('12.5', 'n/a', 'USD', 1).text).toBe(UNPRICED_LABEL);
  });

  it('still formats when the price is present and the amount is zero', () => {
    expect(formatTokenAsFiat('0', '1.0', 'USD', 1).unpriced).toBeUndefined();
  });
});
