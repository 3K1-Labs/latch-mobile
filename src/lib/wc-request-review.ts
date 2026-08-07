/**
 * wc-request-review.ts — validates and decodes a WalletConnect signing request.
 *
 * Two jobs, one parse:
 *
 *   1. Reject what must never reach the user — a request for another chain, a
 *      method we don't implement, or an XDR that doesn't parse. These map to
 *      JSON-RPC errors and the sheet is never shown.
 *
 *   2. Decode what does reach them. The approve button previously sat under a
 *      base64 blob, which is not something anyone can consent to. Everything the
 *      sheet needs to describe the transaction in words comes from here.
 *
 * Risky-but-legitimate findings are WARNINGS, not rejections. A transaction
 * sourced from another account, or one that adds a signer, can be exactly what
 * the user intends — the wallet's job is to say so clearly, not to decide for
 * them. Only structural invalidity is a hard reject.
 */
import {
  FeeBumpTransaction,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';

export const WC_SIGN_METHODS = ['stellar_signXDR', 'stellar_signAndSubmitXDR'] as const;
export type WcSignMethod = (typeof WC_SIGN_METHODS)[number];

export type RejectionCode =
  | 'UNSUPPORTED_CHAINS'
  | 'UNSUPPORTED_METHOD'
  | 'INVALID_PARAMS'
  | 'INVALID_XDR';

export interface RequestRejection {
  code: RejectionCode;
  message: string;
}

export type WarningId =
  | 'foreign-source'
  | 'operation-source-override'
  | 'signer-or-threshold-change'
  | 'account-merge'
  | 'never-expires'
  | 'fee-bump';

export interface RequestWarning {
  id: WarningId;
  title: string;
  detail: string;
}

export interface OperationSummary {
  index: number;
  /** Raw SDK operation type, e.g. 'payment' */
  type: string;
  /** Human label for the row, e.g. 'Send payment' */
  label: string;
  /** One-line specifics, e.g. '10 XLM to GABC…' — absent when the type carries none */
  detail?: string;
  /** Set only when this operation overrides the transaction's source account */
  sourceOverride?: string;
}

export interface RequestReview {
  method: WcSignMethod;
  /** Signing only, vs signing and broadcasting */
  submits: boolean;
  isFeeBump: boolean;
  /** Source of the transaction being signed (inner source for a fee bump) */
  source: string;
  /** Fee in XLM, already converted from stroops */
  fee: string;
  memo?: string;
  /** Memo discriminant, so the sheet can label it ('text', 'id', 'hash', 'return') */
  memoType?: string;
  operations: OperationSummary[];
  /** ISO timestamp from timebounds.maxTime; absent when the signature never expires */
  expiresAt?: string;
  warnings: RequestWarning[];
  /** Kept so the sheet can still offer the raw XDR behind a disclosure */
  xdr: string;
}

export type ReviewResult =
  | { ok: true; review: RequestReview; tx: Transaction | FeeBumpTransaction }
  | { ok: false; rejection: RequestRejection };

const STROOPS_PER_XLM = 10_000_000;

function isSignMethod(method: string): method is WcSignMethod {
  return (WC_SIGN_METHODS as readonly string[]).includes(method);
}

// The SDK returns fixed 7-decimal strings ('10.0000000'). Trailing zeros carry
// no information and make amounts harder to read at a glance, which is the one
// thing a signing screen must get right. Precision is never dropped.
function formatAmount(amount?: string): string {
  if (!amount || !amount.includes('.')) return amount ?? '0';
  return amount.replace(/\.?0+$/, '') || '0';
}

function describeAsset(asset: { code?: string; isNative?: () => boolean }): string {
  try {
    if (typeof asset?.isNative === 'function' && asset.isNative()) return 'XLM';
  } catch {
    // fall through to the code below
  }
  return asset?.code ?? 'asset';
}

// Only the operation types a dApp realistically asks a wallet to sign get a
// bespoke line. Everything else falls back to a humanised type name, which is
// still far better than base64.
function describeOperation(op: any): { label: string; detail?: string } {
  switch (op.type) {
    case 'payment':
      return {
        label: 'Send payment',
        detail: `${formatAmount(op.amount)} ${describeAsset(op.asset)} to ${op.destination}`,
      };
    case 'createAccount':
      return {
        label: 'Create account',
        detail: `Fund ${op.destination} with ${formatAmount(op.startingBalance)} XLM`,
      };
    case 'pathPaymentStrictSend':
      return {
        label: 'Path payment',
        detail: `Send ${formatAmount(op.sendAmount)} ${describeAsset(op.sendAsset)} to ${op.destination}`,
      };
    case 'pathPaymentStrictReceive':
      return {
        label: 'Path payment',
        detail: `Receive ${formatAmount(op.destAmount)} ${describeAsset(op.destAsset)} at ${op.destination}`,
      };
    case 'changeTrust':
      return {
        label: op.limit === '0' ? 'Remove trustline' : 'Add trustline',
        detail: describeAsset(op.line ?? {}),
      };
    case 'accountMerge':
      return { label: 'Merge account', detail: `Send everything to ${op.destination}` };
    case 'setOptions':
      return { label: 'Change account settings' };
    case 'invokeHostFunction':
      return { label: 'Call smart contract' };
    case 'manageSellOffer':
    case 'manageBuyOffer':
      return { label: 'Manage offer' };
    default:
      // 'bumpSequence' → 'Bump sequence'
      return {
        label: op.type
          ? op.type
              .replace(/([A-Z])/g, (c: string) => ` ${c.toLowerCase()}`)
              .replace(/^./, (c: string) => c.toUpperCase())
          : 'Unknown operation',
      };
  }
}

function collectWarnings(
  tx: Transaction,
  operations: OperationSummary[],
  accountAddress: string | null,
  isFeeBump: boolean,
  feeBumpSource?: string,
): RequestWarning[] {
  const warnings: RequestWarning[] = [];

  if (accountAddress && tx.source !== accountAddress) {
    warnings.push({
      id: 'foreign-source',
      title: 'Not your account',
      detail: `This transaction is sent from ${tx.source}, not the account connected to this app. Approving adds your signature to someone else's transaction.`,
    });
  }

  const overrides = operations.filter((op) => op.sourceOverride);
  if (overrides.length > 0) {
    warnings.push({
      id: 'operation-source-override',
      title: 'Acts on another account',
      detail: `${overrides.length} operation${overrides.length > 1 ? 's' : ''} run against a different account than the transaction source.`,
    });
  }

  if (operations.some((op) => op.type === 'setOptions')) {
    warnings.push({
      id: 'signer-or-threshold-change',
      title: 'Changes account settings',
      detail:
        'This can add or remove signers and change the thresholds that protect the account. Approve only if you expect it.',
    });
  }

  if (operations.some((op) => op.type === 'accountMerge')) {
    warnings.push({
      id: 'account-merge',
      title: 'Closes an account',
      detail: 'A merge transfers the entire remaining balance and deletes the account.',
    });
  }

  // A signature over a transaction with no upper timebound stays valid forever,
  // so a dApp can hold it and submit at a moment of its choosing.
  const maxTime = tx.timeBounds?.maxTime;
  if (!maxTime || maxTime === '0') {
    warnings.push({
      id: 'never-expires',
      title: 'No expiry',
      detail:
        'This transaction has no time limit, so the signature stays valid indefinitely and can be submitted at any point in the future.',
    });
  }

  if (isFeeBump) {
    warnings.push({
      id: 'fee-bump',
      title: 'Fee-bump transaction',
      detail: `The fee is paid by ${feeBumpSource ?? 'another account'}, which wraps the transaction shown below.`,
    });
  }

  return warnings;
}

/**
 * Validates a WalletConnect session request and decodes it for display.
 *
 * `accountAddress` is the account the dApp session was approved against —
 * omitting it skips the ownership warning but nothing else.
 */
export function reviewSessionRequest(params: {
  method: string;
  chainId: string;
  activeChain: string;
  requestParams: unknown;
  accountAddress?: string | null;
}): ReviewResult {
  const { method, chainId, activeChain, requestParams, accountAddress = null } = params;

  if (chainId !== activeChain) {
    return {
      ok: false,
      rejection: {
        code: 'UNSUPPORTED_CHAINS',
        message: `Request is for ${chainId}, wallet is on ${activeChain}`,
      },
    };
  }

  if (!isSignMethod(method)) {
    return {
      ok: false,
      rejection: { code: 'UNSUPPORTED_METHOD', message: `Unsupported method: ${method}` },
    };
  }

  const xdr = (requestParams as { xdr?: unknown } | null)?.xdr;
  if (typeof xdr !== 'string' || xdr.trim() === '') {
    return {
      ok: false,
      rejection: { code: 'INVALID_PARAMS', message: 'Request is missing an xdr parameter' },
    };
  }

  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(xdr, STELLAR_NETWORK_PASSPHRASE);
  } catch (e: any) {
    return {
      ok: false,
      rejection: {
        code: 'INVALID_XDR',
        // A tx built for the other network fails here rather than at signing —
        // worth saying so, since it is the most common cause.
        message: `Could not decode transaction for this network: ${e?.message ?? 'invalid XDR'}`,
      },
    };
  }

  const isFeeBump = parsed instanceof FeeBumpTransaction;
  const inner = isFeeBump ? (parsed as FeeBumpTransaction).innerTransaction : (parsed as Transaction);
  const feeBumpSource = isFeeBump ? (parsed as FeeBumpTransaction).feeSource : undefined;

  const operations: OperationSummary[] = inner.operations.map((op: Operation, index: number) => {
    const { label, detail } = describeOperation(op);
    const opSource = (op as { source?: string }).source;
    return {
      index,
      type: op.type,
      label,
      ...(detail ? { detail } : {}),
      ...(opSource && opSource !== inner.source ? { sourceOverride: opSource } : {}),
    };
  });

  const maxTime = inner.timeBounds?.maxTime;
  const expiresAt =
    maxTime && maxTime !== '0' ? new Date(Number(maxTime) * 1000).toISOString() : undefined;

  // MemoText carries a Buffer, not a string, so it has to be decoded as utf8 —
  // base64-encoding it would show the user gibberish for the one memo type they
  // are most likely to need to read.
  const memoType = inner.memo?.type;
  const memoValue = inner.memo?.value;
  const memo =
    !memoType || memoType === 'none' || memoValue == null
      ? undefined
      : typeof memoValue === 'string'
        ? memoValue
        : Buffer.from(memoValue as Uint8Array).toString(memoType === 'text' ? 'utf8' : 'base64');

  return {
    ok: true,
    tx: parsed,
    review: {
      method,
      submits: method === 'stellar_signAndSubmitXDR',
      isFeeBump,
      source: inner.source,
      fee: (Number(parsed.fee) / STROOPS_PER_XLM).toFixed(7),
      ...(memo ? { memo, memoType } : {}),
      operations,
      ...(expiresAt ? { expiresAt } : {}),
      warnings: collectWarnings(inner, operations, accountAddress, isFeeBump, feeBumpSource),
      xdr,
    },
  };
}
