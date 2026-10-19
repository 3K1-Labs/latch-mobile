/**
 * multisig.ts — REST client for the wallet-backend shared-wallet endpoints.
 *
 * Backend slice currently shipped: B1-1..3 (schema + create + get). Accept,
 * decline, deploy, and cancel land in follow-up slices; this client adds
 * them when those endpoints exist.
 *
 * Auth model: every endpoint requires an email-scope Latch JWT. Token is
 * supplied by the caller (typically a React Query hook). This module does
 * not refresh on 401.
 *
 * Transport: raw XHR for the same reason cosign.ts and latch-auth.ts use
 * XHR — Soroban / wallet-backend calls from Android need to traverse the
 * platform TLS stack via OkHttp, which Axios bypasses.
 */

import { apiBaseUrl } from '../constants/api-host';

const API_PATH = '/v1/multisig/wallets';

export type MultisigWalletState =
  | 'pending_invites'
  | 'ready_to_deploy'
  | 'deployed'
  | 'cancelled';

export type MultisigInviteState = 'pending' | 'accepted' | 'declined' | 'expired';

export interface MultisigInvite {
  id: string;
  inviteeEmail: string | null;
  boundCAddress: string | null;
  state: MultisigInviteState;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

export interface MultisigWallet {
  id: string;
  name: string;
  threshold: number;
  state: MultisigWalletState;
  cAddress: string | null;
  creatorCAddress: string;
  creatorUserId: string;
  deployTxHash: string | null;
  expiresAt: string;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
  invites: MultisigInvite[];
}

export class MultisigApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface RawInvite {
  id: string;
  invitee_email?: string | null;
  bound_c_address?: string | null;
  state: MultisigInviteState;
  expires_at: string;
  responded_at?: string | null;
  created_at: string;
}

interface RawWallet {
  id: string;
  name: string;
  threshold: number;
  state: MultisigWalletState;
  c_address?: string | null;
  creator_c_address: string;
  creator_user_id: string;
  deploy_tx_hash?: string | null;
  expires_at: string;
  cancelled_reason?: string | null;
  created_at: string;
  updated_at: string;
  invites: RawInvite[];
}

function adaptInvite(raw: RawInvite): MultisigInvite {
  return {
    id: raw.id,
    inviteeEmail: raw.invitee_email ?? null,
    boundCAddress: raw.bound_c_address ?? null,
    state: raw.state,
    expiresAt: raw.expires_at,
    respondedAt: raw.responded_at ?? null,
    createdAt: raw.created_at,
  };
}

function adaptWallet(raw: RawWallet): MultisigWallet {
  return {
    id: raw.id,
    name: raw.name,
    threshold: raw.threshold,
    state: raw.state,
    cAddress: raw.c_address ?? null,
    creatorCAddress: raw.creator_c_address,
    creatorUserId: raw.creator_user_id,
    deployTxHash: raw.deploy_tx_hash ?? null,
    expiresAt: raw.expires_at,
    cancelledReason: raw.cancelled_reason ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    invites: (raw.invites ?? []).map(adaptInvite),
  };
}

function xhr(
  method: string,
  url: string,
  body: string | null,
  token: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${token}`);
    req.timeout = 30000;
    req.onload = () => {
      let parsed: any = null;
      if (req.responseText) {
        try {
          parsed = JSON.parse(req.responseText);
        } catch {
          parsed = null;
        }
      }
      resolve({ status: req.status, body: parsed });
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Request timed out'));
    req.send(body);
  });
}

async function call<T>(
  method: string,
  path: string,
  body: object | null,
  token: string,
): Promise<T | null> {
  const { status, body: resp } = await xhr(
    method,
    `${apiBaseUrl()}${API_PATH}${path}`,
    body ? JSON.stringify(body) : null,
    token,
  );

  if (status >= 200 && status < 300) {
    if (status === 204) return null;
    return (resp?.data ?? null) as T | null;
  }

  const err = resp?.error;
  throw new MultisigApiError(
    err?.message ?? `Request failed (${status})`,
    err?.code ?? `HTTP_${status}`,
    status,
  );
}

export interface MultisigSignerInput {
  cAddress?: string;
  email?: string;
}

export interface CreateMultisigWalletParams {
  name: string;
  threshold: number;
  creatorCAddress: string;
  signers: MultisigSignerInput[];
}

/**
 * Creates a shared-wallet record + per-signer invite rows. Paste-only
 * wallets come back in `ready_to_deploy` state; any email signer puts
 * the wallet in `pending_invites` and the backend dispatches invite
 * emails asynchronously (best-effort, failures are logged server-side
 * only).
 */
export async function createMultisigWallet(
  token: string,
  params: CreateMultisigWalletParams,
): Promise<MultisigWallet> {
  const raw = await call<RawWallet>(
    'POST',
    '/',
    {
      name: params.name,
      threshold: params.threshold,
      creator_c_address: params.creatorCAddress,
      signers: params.signers.map((s) => ({
        c_address: s.cAddress,
        email: s.email,
      })),
    },
    token,
  );
  if (!raw) throw new MultisigApiError('empty create response', 'INTERNAL_ERROR', 500);
  return adaptWallet(raw);
}

/**
 * Fetches a wallet + roster by ID. Authorization is roster-scoped on the
 * backend: callers who are neither the creator nor an invitee receive a
 * 404 (intentionally indistinguishable from a truly-missing wallet to
 * avoid leaking existence by ID).
 */
export async function getMultisigWallet(token: string, walletId: string): Promise<MultisigWallet> {
  const raw = await call<RawWallet>('GET', `/${encodeURIComponent(walletId)}`, null, token);
  if (!raw) throw new MultisigApiError('empty get response', 'INTERNAL_ERROR', 404);
  return adaptWallet(raw);
}
