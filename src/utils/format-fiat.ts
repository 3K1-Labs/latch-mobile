import { DEFAULT_FIAT_CURRENCY, getFiatCurrency } from '@/src/constants/currencies';

export interface FiatFormatInput {
  /** Amount already expressed in USD (latch-api prices). */
  usdAmount: number;
  selectedCurrency: string;
  /** Units of the selected currency per 1 USD. Missing/invalid → USD fallback. */
  usdToSelectedRate?: number | null;
  approx?: boolean;
  maximumFractionDigits?: number;
}

export interface FiatFormatResult {
  text: string;
  currency: string;
  usedFallback: boolean;
  /** True when no USD price was available, so `text` is UNPRICED_LABEL. */
  unpriced?: boolean;
}

/** Rendered in place of a figure when a token has no USD price. */
export const UNPRICED_LABEL = '—';

export function resolveDisplayCurrency(
  selectedCurrency: string,
  usdToSelectedRate?: number | null,
): { currency: string; rate: number; usedFallback: boolean } {
  if (selectedCurrency === DEFAULT_FIAT_CURRENCY) {
    return { currency: DEFAULT_FIAT_CURRENCY, rate: 1, usedFallback: false };
  }
  if (usdToSelectedRate != null && Number.isFinite(usdToSelectedRate) && usdToSelectedRate > 0) {
    return { currency: selectedCurrency, rate: usdToSelectedRate, usedFallback: false };
  }
  return { currency: DEFAULT_FIAT_CURRENCY, rate: 1, usedFallback: true };
}

function formatCurrencyNumber(
  amount: number,
  currency: string,
  maximumFractionDigits: number,
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: Math.min(2, maximumFractionDigits),
      maximumFractionDigits,
    }).format(amount);
  } catch {
    const symbol = getFiatCurrency(currency).symbol;
    return `${symbol}${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits,
    })}`;
  }
}

/**
 * Shared fiat formatter. Replaces the duplicated `formatUsd` helpers so a
 * currency change reaches every screen that shows a dollar figure.
 */
export function formatFiat(input: FiatFormatInput): FiatFormatResult {
  const resolved = resolveDisplayCurrency(input.selectedCurrency, input.usdToSelectedRate);
  const usd = Number.isFinite(input.usdAmount) ? input.usdAmount : 0;
  const amount = usd * resolved.rate;
  const digits = input.maximumFractionDigits ?? 2;
  const prefix = input.approx ? '≈' : '';
  const suffix = resolved.usedFallback ? ' (USD)' : '';
  return {
    text: `${prefix}${formatCurrencyNumber(amount, resolved.currency, digits)}${suffix}`,
    currency: resolved.currency,
    usedFallback: resolved.usedFallback,
  };
}

/**
 * A missing price is not a zero balance: /v1/prices omits a quote whenever the
 * symbol is unknown or the upstream feed missed, and rendering that as $0.00
 * states a value we do not have. Return UNPRICED_LABEL instead.
 */
export function formatTokenAsFiat(
  amountStr: string,
  usdPrice: string | undefined,
  selectedCurrency: string,
  usdToSelectedRate?: number | null,
  options?: { approx?: boolean; maximumFractionDigits?: number },
): FiatFormatResult {
  const amount = parseFloat(amountStr || '0');
  const price = parseFloat(usdPrice ?? '');
  if (!Number.isFinite(price)) {
    const resolved = resolveDisplayCurrency(selectedCurrency, usdToSelectedRate);
    return {
      text: UNPRICED_LABEL,
      currency: resolved.currency,
      usedFallback: resolved.usedFallback,
      unpriced: true,
    };
  }
  const usdAmount = amount && price ? amount * price : 0;
  return formatFiat({
    usdAmount,
    selectedCurrency,
    usdToSelectedRate,
    approx: options?.approx ?? true,
    maximumFractionDigits: options?.maximumFractionDigits,
  });
}
