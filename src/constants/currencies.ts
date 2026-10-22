export type FiatCurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CAD'
  | 'AUD'
  | 'JPY'
  | 'NGN'
  | 'KES'
  | 'GHS'
  | 'ZAR'
  | 'INR'
  | 'BRL'
  | 'MXN'
  | 'PHP';

export interface FiatCurrency {
  code: FiatCurrencyCode;
  name: string;
  symbol: string;
}

export const DEFAULT_FIAT_CURRENCY: FiatCurrencyCode = 'USD';

export const FIAT_CURRENCIES: FiatCurrency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
];

const BY_CODE = Object.fromEntries(FIAT_CURRENCIES.map((c) => [c.code, c])) as Record<
  FiatCurrencyCode,
  FiatCurrency
>;

export function isFiatCurrencyCode(value: string): value is FiatCurrencyCode {
  return value in BY_CODE;
}

export function getFiatCurrency(code: string): FiatCurrency {
  return BY_CODE[code as FiatCurrencyCode] ?? BY_CODE[DEFAULT_FIAT_CURRENCY];
}
