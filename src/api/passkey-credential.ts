/**
 * passkey-credential.ts — client for latch-api's passkey recovery index
 * (`POST /v1/passkey-credentials/*`).
 *
 * This is what lets "I have a wallet" skip asking for an address: a fresh
 * device that only has the (synced) passkey runs one WebAuthn ceremony with
 * no address and no allowCredentials — the OS offers every synced Latch
 * passkey — and the server resolves whichever credential answered back to
 * the wallet it deployed, plus the label it was created with.
 *
 * Two network calls, one ceremony: `/challenge` issues a nonce (not bound to
 * any credential — nobody knows which one will answer yet), then the single
 * `Passkey.get` produces the assertion `/lookup` verifies. See
 * PasskeyCredentialService in latch-api for why it's two calls instead of a
 * plain GET: a bare credential ID isn't secret (it's readable on-chain from
 * the account's own signer record), so an unauthenticated lookup would let
 * anyone who'd seen one pull that wallet's address and label.
 *
 * Does not sign the caller in — signInToExistingWalletWithPlatformPasskey
 * still owns that, and still runs its own ceremony against the discovered
 * address. Two prompts, not one: latch-api's wallet sign-in challenge is
 * bound to an address up front, and collapsing that needs a backend change
 * of its own (tracked, not done here). What this module removes is the need
 * to already know — or type — the address before the first prompt.
 */

import { API_BASE_URL } from '@/src/constants/api-host';
import { PASSKEY_RP_ID } from '@/src/constants/config';
import { bytesToB64, compactSigToDER } from '@/src/lib/wallet-auth';

const API_BASE = `${API_BASE_URL}/v1/passkey-credentials`;

export class PasskeyCredentialLookupError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface PasskeyCredentialRecord {
  smartAccountAddress: string;
  label: string;
  seq: number;
}

// ─── transport ────────────────────────────────────────────────────────────────
// Raw XHR, matching smart-account-deploy.ts — see the Android TLS note in
// CLAUDE.md.

function xhrPost(path: string, body: object): Promise<{ status: number; body: any }> {
  const url = `${API_BASE}${path}`;
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.timeout = 30000;
    req.onload = () => {
      try {
        resolve({ status: req.status, body: JSON.parse(req.responseText) });
      } catch {
        resolve({ status: req.status, body: null });
      }
    };
    req.onerror = () => reject(new Error(`Network error contacting ${url}`));
    req.ontimeout = () => reject(new Error(`Request timed out contacting ${url}`));
    req.send(JSON.stringify(body));
  });
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * Recover a wallet's address and label from the passkey alone: one WebAuthn
 * ceremony with no address typed and no allowCredentials, so the OS offers
 * every synced Latch passkey on the device.
 *
 * Throws PasskeyCredentialLookupError on any failure — including "no such
 * credential", an expired nonce, or a bad signature, which the backend
 * deliberately reports identically (see the module doc). Callers should
 * treat every failure the same way: fall back to asking for the address.
 */
export async function lookupWalletByPasskey(): Promise<PasskeyCredentialRecord> {
  const ch = await xhrPost('/challenge', {});
  if (ch.status !== 200 || !ch.body?.data?.nonce) {
    throw new PasskeyCredentialLookupError(
      ch.body?.error?.message ?? `lookup challenge failed (${ch.status})`,
      ch.status,
    );
  }
  const nonceHex = ch.body.data.nonce as string;

  // Dynamic import: keeps react-native-passkey's native module out of every
  // consumer of this file unless a lookup ceremony is actually run.
  const { signWithPlatformPasskey } = await import('@/src/lib/platform-passkey');
  const sig = await signWithPlatformPasskey({
    rpId: PASSKEY_RP_ID,
    challenge: hexToBytes(nonceHex),
    // No allowCredentialIdHex: discovering which credential answers is the
    // whole point — see the module doc.
  });

  const res = await xhrPost('/lookup', {
    nonce: nonceHex,
    credential_id: sig.credentialIdHex,
    authenticator_data: bytesToB64(sig.authenticatorData),
    client_data_json: bytesToB64(sig.clientDataJSON),
    signature: bytesToB64(compactSigToDER(sig.signature)),
  });
  if (res.status !== 200 || !res.body?.data?.smart_account_address) {
    throw new PasskeyCredentialLookupError(
      res.body?.error?.message ?? `passkey lookup failed (${res.status})`,
      res.status,
    );
  }

  return {
    smartAccountAddress: res.body.data.smart_account_address,
    label: res.body.data.label ?? '',
    seq: res.body.data.seq ?? 0,
  };
}
