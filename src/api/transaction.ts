/**
 * Transaction API service.
 *
 * Wraps the latch backend transaction endpoints:
 *   POST /api/transaction/build   → builds an unsigned Soroban tx + auth digest
 *   POST /api/transaction/submit  → attaches Ed25519 signature + submits via bundler
 *
 * The mobile app signs locally with the stored Ed25519 keypair from seed-wallet.ts.
 * The bundler keypair (fee-payer / outer tx signer) lives only on the backend.
 */

import { STELLAR_AUTH_PREFIX } from '../constants/config';
import { Keypair } from '@stellar/stellar-sdk';

const LATCH_BACKEND_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildResult {
  /** Base64-encoded XDR of the assembled (but unsigned) transaction */
  txXdr: string;
  /** Base64-encoded XDR of the Soroban auth entry that needs signing */
  authEntryXdr: string;
  /** Lowercase hex of the 32-byte auth digest the wallet must sign */
  authDigestHex: string;
  /** Ledger number until which the auth entry is valid */
  validUntilLedger: number;
}

export interface SubmitResult {
  hash: string;
  status: 'SUCCESS';
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Ask the latch backend to build a `counter.increment` transaction.
 * Returns the auth digest the mobile wallet must sign.
 *
 * @param smartAccountAddress  The deployed C-address of the smart account
 */
export async function buildTransaction(smartAccountAddress: string): Promise<BuildResult> {
  const url = `${LATCH_BACKEND_URL}/api/transaction/build`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ smartAccountAddress }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Transaction build failed (${res.status})`);
  }
  return data as BuildResult;
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Sign the auth digest locally with the Ed25519 keypair.
 *
 * The latch verifier contract expects:
 *   message = "Stellar Smart Account Auth:\n" + lowercase_hex(authDigest)
 *
 * @param authDigestHex  64-char lowercase hex from buildTransaction()
 * @param keypair        The Stellar Keypair from the seed wallet
 * @returns              { prefixedMessage, authSignatureHex }
 */
export function signAuthDigest(
  authDigestHex: string,
  keypair: Keypair,
): { prefixedMessage: string; authSignatureHex: string } {
  const prefixedMessage = STELLAR_AUTH_PREFIX + authDigestHex.toLowerCase();
  const messageBytes = Buffer.from(prefixedMessage, 'utf8');
  const signatureBytes = keypair.sign(messageBytes);
  const authSignatureHex = Buffer.from(signatureBytes).toString('hex');
  return { prefixedMessage, authSignatureHex };
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * Submit the signed transaction to the latch backend.
 * The backend attaches the signature to the auth entry, runs an enforcing
 * simulation, then signs and submits the outer tx with the bundler keypair.
 *
 * @param params.txXdr             From buildTransaction()
 * @param params.authEntryXdr      From buildTransaction()
 * @param params.prefixedMessage   From signAuthDigest()
 * @param params.authSignatureHex  From signAuthDigest()
 * @param params.publicKeyHex      64-char hex Ed25519 public key
 */
export async function submitTransaction(params: {
  txXdr: string;
  authEntryXdr: string;
  prefixedMessage: string;
  authSignatureHex: string;
  publicKeyHex: string;
}): Promise<SubmitResult> {
  const url = `${LATCH_BACKEND_URL}/api/transaction/submit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Transaction submit failed (${res.status})`);
  }
  return data as SubmitResult;
}

// ─── Convenience: build + sign + submit in one call ──────────────────────────

/**
 * Full round-trip: build → sign → submit.
 * Use this from a React hook to increment the counter contract.
 *
 * @param smartAccountAddress  Deployed C-address
 * @param publicKeyHex         64-char hex Ed25519 public key
 * @param keypair              Full Stellar Keypair (from seed wallet)
 * @returns                    { hash } on success
 */
export async function buildAndSubmitTransaction(
  smartAccountAddress: string,
  publicKeyHex: string,
  keypair: Keypair,
): Promise<SubmitResult> {
  // 1. Build
  const build = await buildTransaction(smartAccountAddress);

  // 2. Sign locally
  const { prefixedMessage, authSignatureHex } = signAuthDigest(build.authDigestHex, keypair);

  // 3. Submit
  return submitTransaction({
    txXdr: build.txXdr,
    authEntryXdr: build.authEntryXdr,
    prefixedMessage,
    authSignatureHex,
    publicKeyHex,
  });
}
