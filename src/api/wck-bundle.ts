/**
 * wck-bundle.ts — raw REST client for the latch-api sealed WCK bundle pickup
 * (PUT/GET /v1/wck-bundles/:pickup_key). Transport only: the bundle is already
 * ECIES-sealed per member by sealed-wck.ts, so the server stores opaque
 * ciphertext it cannot open. pickup_key derivation + bundle crypto live in
 * wallet-cosign-key.ts.
 *
 * Auth: a wallet-scope Latch JWT, supplied by the caller. No refresh on 401.
 * Transport: raw XHR (Android TLS via OkHttp).
 */

import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1/wck-bundles`;

export class WckBundleApiError extends Error {
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
  throw new WckBundleApiError(
    err?.message ?? `Request failed (${status})`,
    err?.code ?? `HTTP_${status}`,
    status,
  );
}

/**
 * Upload (or replace, if this principal uploaded it) the sealed bundle for a
 * pickup key. 409 CONFLICT means another account owns the slot.
 */
export async function uploadWckBundle(
  token: string,
  pickupKey: string,
  bundle: string,
): Promise<void> {
  await call<void>('PUT', `/${encodeURIComponent(pickupKey)}`, { bundle }, token);
}

/** Fetch the sealed bundle for a pickup key, or null when none exists (404). */
export async function fetchWckBundle(token: string, pickupKey: string): Promise<string | null> {
  try {
    const data = await call<{ bundle: string }>(
      'GET',
      `/${encodeURIComponent(pickupKey)}`,
      null,
      token,
    );
    return data?.bundle ?? null;
  } catch (e) {
    if (e instanceof WckBundleApiError && e.status === 404) return null;
    throw e;
  }
}
