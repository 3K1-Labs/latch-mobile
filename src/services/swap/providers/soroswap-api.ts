import { Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

import {
  SOROSWAP_API_KEY,
  SOROSWAP_API_URL,
  SOROSWAP_NETWORK,
  STELLAR_NETWORK_PASSPHRASE,
} from '@/src/constants/config';
import { toBaseUnits } from '@/src/services/send-token';
import type { SwapQuote, SwapQuoteParams } from '../types';

function fromBaseUnits(base: string): string {
  const neg = base.startsWith('-');
  const digits = (neg ? base.slice(1) : base).padStart(8, '0');
  const intPart = digits.slice(0, -7).replace(/^0+(?=\d)/, '');
  const fracPart = digits.slice(-7).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
}

async function swapApiPost(path: string, body: object): Promise<any> {
  const url = `${SOROSWAP_API_URL}${path}?network=${SOROSWAP_NETWORK}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${SOROSWAP_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Swap API ${path} ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/** Fetch a quote restricted to the requested protocol set. */
export function fetchRawSwapQuote(params: SwapQuoteParams, protocols: string[]): Promise<any> {
  return swapApiPost('/quote', {
    assetIn: params.fromSacId,
    assetOut: params.toSacId,
    amount: toBaseUnits(params.amountIn).toString(),
    tradeType: 'EXACT_IN',
    protocols,
    slippageBps: params.slippageBps,
  });
}

export function mapSwapQuote(
  rawQuote: any,
  params: SwapQuoteParams,
  providerId: string,
): SwapQuote {
  const amountOut = fromBaseUnits(String(rawQuote.amountOut ?? '0'));
  const minReceived = fromBaseUnits(String(rawQuote.otherAmountThreshold ?? '0'));
  const inNum = parseFloat(params.amountIn);
  return {
    providerId,
    amountIn: params.amountIn,
    amountOut,
    minReceived,
    rate: inNum > 0 ? parseFloat(amountOut) / inNum : 0,
    priceImpactPct: parseFloat(String(rawQuote.priceImpactPct ?? '0')),
    fromSacId: params.fromSacId,
    toSacId: params.toSacId,
    slippageBps: params.slippageBps,
    raw: rawQuote,
  };
}

/** Build the provider route and strip auth so the wallet signs its own entry. */
export async function buildSwapApiOperation(
  rawQuote: unknown,
  smartAccountAddress: string,
): Promise<xdr.Operation> {
  const buildRes = await swapApiPost('/quote/build', {
    quote: rawQuote,
    from: smartAccountAddress,
    to: smartAccountAddress,
  });

  if (!buildRes?.xdr) throw new Error('Swap API build returned no xdr');

  const tx = TransactionBuilder.fromXDR(buildRes.xdr, STELLAR_NETWORK_PASSPHRASE);
  const op = ('operations' in tx ? tx.operations[0] : undefined) as
    | { type?: string; func?: xdr.HostFunction }
    | undefined;
  if (!op || op.type !== 'invokeHostFunction' || !op.func) {
    throw new Error('Swap API build did not return an invokeHostFunction operation');
  }

  return Operation.invokeHostFunction({ func: op.func, auth: [] });
}

export function isPoolHashesError(err: unknown): boolean {
  return err instanceof Error && /poolhashes/i.test(err.message);
}
