/**
 * USD→fiat conversion rates. latch-api /prices is USD-only (see latch-api#77),
 * so the app converts locally until that endpoint grows a currency parameter.
 *
 * open.er-api.com is a public ECB-derived feed — no key, nothing secret.
 */
const FX_URL = 'https://open.er-api.com/v6/latest/USD';

export async function getUsdFxRates(): Promise<Record<string, number>> {
  const res = await fetch(FX_URL);
  if (!res.ok) {
    throw new Error(`fx rates unavailable (${res.status})`);
  }
  const body = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
  };
  if (body.result !== 'success' || !body.rates) {
    throw new Error('fx rates unavailable');
  }
  return body.rates;
}
