/**
 * memberships.ts — raw REST client for shared-wallet membership discovery
 * (POST/GET /v1/memberships). A creator announces, for each member of a new
 * shared wallet, a row keyed by the member's BLIND id (a hash of the member's
 * public on-chain signer key); a joining device lists the wallets announced for
 * its own blind id. The server stores only the public C-address against a
 * one-way hash — nothing the chain doesn't already expose. Membership is
 * re-verified on-chain client-side before a discovered wallet is trusted.
 *
 * Auth: a wallet-scope Latch JWT, supplied by the caller. Transport: raw XHR
 * (Android TLS via OkHttp), matching wck-bundle.ts.
 */

import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1/memberships`;

export class MembershipApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

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

// In-call retry only smooths a brief 429 burst (e.g. a double-fired announce);
// a sustained rate-limit is left to the cross-session pending-announce sweep in
// membership.ts, so we cap the in-call wait rather than block on a long
// Retry-After.
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
    throw new MembershipApiError(
      err?.message ?? `Request failed (${status})`,
      err?.code ?? `HTTP_${status}`,
      status,
    );
  }
}

/** Announce that each member blind id is a member of `walletRef` (idempotent). */
export async function announceMemberships(
  token: string,
  walletRef: string,
  memberBlindIds: string[],
): Promise<void> {
  if (memberBlindIds.length === 0) return;
  await call<void>('POST', '', { wallet_ref: walletRef, member_blind_ids: memberBlindIds }, token);
}

export interface DiscoveredWallet {
  wallet_ref: string;
  created_at: string;
}

/** List the wallets announced for this device's member blind id. */
export async function listMemberships(
  token: string,
  memberBlindId: string,
): Promise<DiscoveredWallet[]> {
  const data = await call<{ wallets: DiscoveredWallet[] }>(
    'GET',
    `?member_blind_id=${encodeURIComponent(memberBlindId)}`,
    null,
    token,
  );
  return data?.wallets ?? [];
}
