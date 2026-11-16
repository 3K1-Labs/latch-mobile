import type { TokenBalance } from '@/src/hooks/use-portfolio';

export type SendToken = TokenBalance;
export type Recipient = { address: string; label?: string };
export type SendStatus = 'initial' | 'sending' | 'success' | 'error' | 'view_transaction';

export const NUMERIC_KEYS = [
  { num: '1' },
  { num: '2' },
  { num: '3' },
  { num: '4' },
  { num: '5' },
  { num: '6' },
  { num: '7' },
  { num: '8' },
  { num: '9' },
];
