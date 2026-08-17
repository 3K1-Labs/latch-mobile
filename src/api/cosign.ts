/**
 * cosign.ts — raw REST client for the latch-api cosign queue. Transport only:
 * it sends/receives the already-encrypted XDR plus the blind identifiers and
 * does NO crypto itself. All encryption + blind-index derivation + wallet
 * resolution live in cosign-backend-flow.ts.
 *
 * Scoping is by an opaque queue_index = HMAC(WCK, wallet address): the server
 * never sees the wallet address, the device keys (blind_signer_id), or the tx
 * contents (encrypted). See docs/multisig-encrypted-queue.md.
 *
 * Auth: an email-scope Latch JWT (ACCESS_TOKEN), supplied by the caller. No
 * refresh on 401. Transport: raw XHR (Android TLS via OkHttp).
 */

import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1/cosign/requests`;

export type CosignStatus = 'pending' | 'submitted' | 'cancelled' | 'expired';

export interface CosignSignatureRaw {
  id: string;
  blindSignerId: string;
  /** Ciphertext (AES-GCM envelope) of a SorobanAuthorizationEntry. */
  authEntryXdr: string;
  createdAt: string;
}

export interface CosignRequestRaw {
  id: string;
  queueIndex: string;
  /** Ciphertext (AES-GCM envelope) of the assembled tx. */
  unsignedTxXdr: string;
  network: string;
  threshold: number;
  status: CosignStatus;
  submittedTxHash: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  signatures: CosignSignatureRaw[];
  signatureCount: number;
}

export class CosignApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface RawSig {
  id: string;
  blind_signer_id: string;
  auth_entry_xdr: string;
  created_at: string;
}

interface RawReq {
  id: string;
  queue_index: string;
  unsigned_tx_xdr: string;
  network: string;
  threshold: number;
  status: CosignStatus;
  submitted_tx_hash?: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  signatures: RawSig[];
  signature_count: number;
}

function adaptReq(r: RawReq): CosignRequestRaw {
  return {
    id: r.id,
    queueIndex: r.queue_index,
    unsignedTxXdr: r.unsigned_tx_xdr,
    network: r.network,
    threshold: r.threshold,
    status: r.status,
    submittedTxHash: r.submitted_tx_hash ?? null,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    signatures: (r.signatures ?? []).map((s) => ({
      id: s.id,
      blindSignerId: s.blind_signer_id,
      authEntryXdr: s.auth_entry_xdr,
      createdAt: s.created_at,
    })),
    signatureCount: r.signature_count,
  };
}

// ─── transport ────────────────────────────────────────────────────────────────

function xhr(
  method: string,
  url: string,
  body: string | null,
  token: string,
): Promise<{ status: number; body: any; retryAfterMs?: number }> {
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
      let retryAfterMs: number | undefined;
      const ra = req.getResponseHeader('Retry-After');
      if (ra) {
        const secs = Number(ra);
        if (Number.isFinite(secs) && secs >= 0) retryAfterMs = secs * 1000;
      }
      resolve({ status: req.status, body: parsed, retryAfterMs });
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Request timed out'));
    req.send(body);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// In-call retry only smooths a brief 429 burst (e.g. send firing alongside a
// foreground membership sweep); the wait is capped so a sustained rate-limit
// surfaces as an error the user can retry rather than blocking on a long
// Retry-After. Safe for the create POST: a rate-limited request is rejected
// before the handler runs, so there's no duplicate-create risk. Mirrors the
// pattern in memberships.ts.
const MAX_429_ATTEMPTS = 3;
const MAX_429_WAIT_MS = 4000;

async function call<T>(
  method: string,
  path: string,
  body: object | null,
  token: string,
): Promise<T | null> {
  const url = `${API_BASE}${path}`;
  const payload = body ? JSON.stringify(body) : null;

  for (let attempt = 1; ; attempt++) {
    const { status, body: resp, retryAfterMs } = await xhr(method, url, payload, token);

    if (status >= 200 && status < 300) {
      if (status === 204) return null;
      return (resp?.data ?? null) as T | null;
    }

    if (status === 429 && attempt < MAX_429_ATTEMPTS) {
      await delay(Math.min(retryAfterMs ?? attempt * 1000, MAX_429_WAIT_MS));
      continue;
    }

    const err = resp?.error;
    throw new CosignApiError(
      err?.message ?? `Request failed (${status})`,
      err?.code ?? `HTTP_${status}`,
      status,
    );
  }
}

// ─── endpoints ────────────────────────────────────────────────────────────────

export interface CreateCosignRequestParams {
  queueIndex: string;
  /** Ciphertext of the assembled tx. */
  unsignedTxXdr: string;
  network: 'testnet' | 'mainnet';
  threshold: number;
}

export async function createCosignRequest(
  token: string,
  params: CreateCosignRequestParams,
): Promise<CosignRequestRaw> {
  const raw = await call<RawReq>(
    'POST',
    '',
    {
      queue_index: params.queueIndex,
      unsigned_tx_xdr: params.unsignedTxXdr,
      network: params.network,
      threshold: params.threshold,
    },
    token,
  );
  if (!raw) throw new CosignApiError('empty create response', 'INTERNAL_ERROR', 500);
  return adaptReq(raw);
}

/** List pending requests for a blind queue index. */
export async function listCosignRequests(
  token: string,
  queueIndex: string,
): Promise<CosignRequestRaw[]> {
  const path = `?queue_index=${encodeURIComponent(queueIndex)}`;
  const raw = await call<{ requests: RawReq[] }>('GET', path, null, token);
  return (raw?.requests ?? []).map(adaptReq);
}

export async function getCosignRequest(token: string, id: string): Promise<CosignRequestRaw> {
  const raw = await call<RawReq>('GET', `/${id}`, null, token);
  if (!raw) throw new CosignApiError('not found', 'NOT_FOUND', 404);
  return adaptReq(raw);
}

/**
 * Attach a partial signature. `authEntryXdr` is ciphertext; `blindSignerId` is
 * HMAC(WCK, signerKey) — the server dedupes on it without seeing the device key.
 */
export async function addCosignSignature(
  token: string,
  id: string,
  blindSignerId: string,
  authEntryXdr: string,
): Promise<CosignRequestRaw> {
  const raw = await call<RawReq>(
    'POST',
    `/${id}/signatures`,
    { blind_signer_id: blindSignerId, auth_entry_xdr: authEntryXdr },
    token,
  );
  if (!raw) throw new CosignApiError('empty add-signature response', 'INTERNAL_ERROR', 500);
  return adaptReq(raw);
}

/** Record the on-chain submission tx hash; request transitions to `submitted`. */
export async function markCosignSubmitted(token: string, id: string, txHash: string): Promise<void> {
  await call<void>('POST', `/${id}/submission`, { tx_hash: txHash }, token);
}

/** Cancel a pending request. Idempotent. */
export async function cancelCosignRequest(token: string, id: string): Promise<void> {
  await call<void>('DELETE', `/${id}`, null, token);
}
