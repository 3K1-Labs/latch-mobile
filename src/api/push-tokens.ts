/**
 * push-tokens.ts — raw REST client for latch-api push registrations
 * (POST/DELETE /v1/push-tokens). A registration maps this device's Expo push
 * token to the blind {queue_index, blind_signer_id} pairs it watches — never a
 * wallet address or device key. Blind-id derivation lives in
 * push-registration.ts; this is transport only.
 *
 * Auth: a wallet-scope Latch JWT, supplied by the caller. No refresh on 401.
 * Transport: raw XHR (Android TLS via OkHttp).
 */

import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1/push-tokens`;

export interface PushRegistration {
  queueIndex: string;
  blindSignerId: string;
}

export class PushTokenApiError extends Error {
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

async function call(method: string, path: string, body: object | null, token: string): Promise<void> {
  const { status, body: resp } = await xhr(
    method,
    `${API_BASE}${path}`,
    body ? JSON.stringify(body) : null,
    token,
  );
  if (status >= 200 && status < 300) return;
  const err = resp?.error;
  throw new PushTokenApiError(
    err?.message ?? `Request failed (${status})`,
    err?.code ?? `HTTP_${status}`,
    status,
  );
}

/** Replace ALL queue registrations for this push token (replace-set semantics). */
export async function replacePushRegistrations(
  token: string,
  pushToken: string,
  registrations: PushRegistration[],
): Promise<void> {
  await call(
    'POST',
    '',
    {
      push_token: pushToken,
      registrations: registrations.map((r) => ({
        queue_index: r.queueIndex,
        blind_signer_id: r.blindSignerId,
      })),
    },
    token,
  );
}

/** Remove all registrations for a push token (logout hygiene). */
export async function deletePushRegistrations(token: string, pushToken: string): Promise<void> {
  await call('DELETE', `/${encodeURIComponent(pushToken)}`, null, token);
}
