/**
 * pair-code.ts — REST client for the wallet-backend link-code pairing flow.
 *
 * Endpoints documented in docs/multisig-build-plan.md Phase B2.
 *
 * Flow:
 *   1. Initiator POSTs to create → gets a 6-digit code and the challenge.
 *   2. Joiner GETs /{code} to read metadata (initiator pubkey, account, challenge).
 *   3. Joiner signs the challenge, POSTs the response.
 *   4. Initiator polls /{code}/response until joiner submits.
 *
 * QR pairing does NOT use this client — that flow exchanges the same data
 * via QR codes directly without backend mediation.
 */

import { ApiError } from './api-error';
import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1/pair-codes`;

export interface PairCodeMeta {
  code: string;
  smartAccountAddress: string;
  initiatorPubkey: string;
  /** Base64-encoded 32-byte random challenge the joiner must sign. */
  challengeB64: string;
  expiresAt: string;
}

export interface PairCodeResponse {
  code: string;
  responsePubkey: string;
  responseSignatureB64: string;
  consumedAt: string;
}

interface RawPairCodeMeta {
  code: string;
  smart_account_address: string;
  initiator_pubkey: string;
  challenge_b64: string;
  expires_at: string;
}

interface RawPairCodeResponse {
  code: string;
  response_pubkey: string;
  response_signature_b64: string;
  consumed_at: string;
}

function adaptMeta(r: RawPairCodeMeta): PairCodeMeta {
  return {
    code: r.code,
    smartAccountAddress: r.smart_account_address,
    initiatorPubkey: r.initiator_pubkey,
    challengeB64: r.challenge_b64,
    expiresAt: r.expires_at,
  };
}

function adaptResponse(r: RawPairCodeResponse): PairCodeResponse {
  return {
    code: r.code,
    responsePubkey: r.response_pubkey,
    responseSignatureB64: r.response_signature_b64,
    consumedAt: r.consumed_at,
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
    `${API_BASE}${path}`,
    body ? JSON.stringify(body) : null,
    token,
  );
  if (status >= 200 && status < 300) {
    if (status === 204) return null;
    return (resp?.data ?? null) as T | null;
  }
  const err = resp?.error;
  throw new ApiError(
    err?.message ?? `Request failed (${status})`,
    err?.code ?? `HTTP_${status}`,
    status,
  );
}

/**
 * Initiator creates a pair code. The returned challenge must be presented
 * to the joiner (out-of-band, e.g. shown on-screen alongside the code) so
 * the joiner can sign it.
 */
export async function createPairCode(
  token: string,
  smartAccountAddress: string,
  initiatorPubkey: string,
): Promise<PairCodeMeta> {
  const raw = await call<RawPairCodeMeta>(
    'POST',
    '',
    {
      smart_account_address: smartAccountAddress,
      initiator_pubkey: initiatorPubkey,
    },
    token,
  );
  if (!raw) throw new ApiError('empty create response', 'INTERNAL_ERROR', 500);
  return adaptMeta(raw);
}

/**
 * Joiner reads the pair code metadata. Each call increments a read-attempts
 * counter on the backend; the code is exhausted after 5 attempts.
 *
 * Throws ApiError with code "EXHAUSTED" (HTTP 410) when the attempt
 * cap is hit, "EXPIRED" (410) when the TTL has lapsed, "NOT_FOUND" (404)
 * for unknown codes.
 */
export async function getPairCodeMeta(token: string, code: string): Promise<PairCodeMeta> {
  const raw = await call<RawPairCodeMeta>('GET', `/${code}`, null, token);
  if (!raw) throw new ApiError('not found', 'NOT_FOUND', 404);
  return adaptMeta(raw);
}

/**
 * Joiner submits its pubkey + signed challenge. Single-use; a second
 * submission returns CONSUMED (HTTP 409).
 */
export async function submitPairCodeResponse(
  token: string,
  code: string,
  responsePubkey: string,
  responseSignatureB64: string,
): Promise<PairCodeResponse> {
  const raw = await call<RawPairCodeResponse>(
    'POST',
    `/${code}/response`,
    {
      response_pubkey: responsePubkey,
      response_signature_b64: responseSignatureB64,
    },
    token,
  );
  if (!raw) throw new ApiError('empty submit response', 'INTERNAL_ERROR', 500);
  return adaptResponse(raw);
}

/**
 * Initiator polls for the joiner's response.
 *
 * Returns ApiError with code "NOT_READY" (HTTP 425) when the joiner
 * hasn't submitted yet — callers should treat this as "keep polling".
 */
export async function pollPairCodeResponse(token: string, code: string): Promise<PairCodeResponse> {
  const raw = await call<RawPairCodeResponse>('GET', `/${code}/response`, null, token);
  if (!raw) throw new ApiError('not found', 'NOT_FOUND', 404);
  return adaptResponse(raw);
}
