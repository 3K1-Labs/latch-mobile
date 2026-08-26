import { useMemo } from 'react';

import { getFiatCurrency } from '@/src/constants/currencies';
import { useFxRates } from '@/src/hooks/use-fx-rates';
import { useDisplayCurrencyStore } from '@/src/store/display-currency';
import {
  formatFiat,
  formatTokenAsFiat,
  resolveDisplayCurrency,
  type FiatFormatResult,
} from '@/src/utils/format-fiat';

export function useDisplayFiat() {
  const selectedCurrency = useDisplayCurrencyStore((s) => s.currency);
  const setCurrency = useDisplayCurrencyStore((s) => s.setCurrency);
  const { data: rates } = useFxRates();

  const usdToSelectedRate = selectedCurrency === 'USD' ? 1 : (rates?.[selectedCurrency] ?? null);
  const resolved = resolveDisplayCurrency(selectedCurrency, usdToSelectedRate);
  const meta = getFiatCurrency(resolved.currency);

  return useMemo(
    () => ({
      selectedCurrency,
      displayCurrency: resolved.currency,
      usedFallback: resolved.usedFallback,
      currencyLabel: meta.code,
      setCurrency,
      formatUsdValue: (usdAmount: number, options?: { approx?: boolean }): FiatFormatResult =>
        formatFiat({
          usdAmount,
          selectedCurrency,
          usdToSelectedRate,
          approx: options?.approx,
        }),
      formatToken: (
        amountStr: string,
        usdPrice: string | undefined,
        options?: { approx?: boolean; maximumFractionDigits?: number },
      ): FiatFormatResult =>
        formatTokenAsFiat(amountStr, usdPrice, selectedCurrency, usdToSelectedRate, options),
    }),
    [selectedCurrency, resolved.currency, resolved.usedFallback, meta.code, setCurrency, usdToSelectedRate],
  );
}
