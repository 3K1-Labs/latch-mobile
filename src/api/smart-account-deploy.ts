/**
 * smart-account-deploy.ts — client for latch-api's bundler-paid smart account
 * deploy routes (`POST /v1/smart-account/*`).
 *
 * The bundler keypair that funds and signs a deployment used to live in
 * EXPO_PUBLIC_BUNDLER_SECRET. Expo inlines EXPO_PUBLIC_* values into the
 * shipped JS bundle, so that key was readable by anyone who unzipped an
 * APK/IPA — on mainnet as well as testnet. It now lives server-side.
 *
 * Deploys carry no session token. A passkey account's identity *is* its
 * smart account address, and the backend verifies a passkey by reading that
 * account's on-chain signer — neither exists until the account is deployed.
 * So instead of a session, the caller proves it holds the key it is asking us
 * to deploy: request a single-use nonce, sign it with that key, send both.
 *
 * Transport is raw XHR, not Axios — see the Android TLS note in CLAUDE.md.
 */

import * as Sentry from '@sentry/react-native';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';

import { getNetworkId, PASSKEY_RP_ID } from '@/src/constants/config';
import type { AccountSigner } from '@/src/lib/account-signers';
import { signWithStoredPasskeyAtIndex } from '@/src/lib/passkey-webauthn';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import { bytesToB64, compactSigToDER } from '@/src/lib/wallet-auth';
import { getPasskeyStorageKeys, SECURE_KEYS } from '@/src/store/wallet';
import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1/smart-account`;

/** How many BIP-44 indices to probe when matching a public key to its seed. */
const MAX_ACCOUNT_INDEX_PROBE = 10;

export interface BackendDeployResult {
  smartAccountAddress: string;
  alreadyDeployed: boolean;
}

export class DeployApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ─── transport ────────────────────────────────────────────────────────────────

function xhrPost(path: string, body: object): Promise<{ status: number; body: any }> {
  const url = `${API_BASE}${path}`;
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    // Deployment simulates, submits, and then polls the ledger for
    // confirmation, so it outlives the 30s used elsewhere in the app.
    req.timeout = 90000;
    req.onload = () => {
      try {
        resolve({ status: req.status, body: JSON.parse(req.responseText) });
      } catch {
        resolve({ status: req.status, body: null });
      }
    };
    // XHR's onerror carries no detail (no status code, no message) — it fires
    // identically for DNS failure, TLS failure, and connection refused. Name
    // the URL so a misresolved API_BASE_URL (e.g. a stale bundle still
    // pointing at localhost) is distinguishable from a real outage.
    req.onerror = () => reject(new Error(`Network error contacting ${url}`));
    req.ontimeout = () => reject(new Error(`Deployment request timed out contacting ${url}`));
    req.send(JSON.stringify(body));
  });
}

/**
 * Retry a full challenge→sign→submit cycle exactly once if the proof came
 * back rejected as expired.
 *
 * The nonce is single-use and short-lived, but the WebAuthn signing step can
 * now be a real OS ceremony (system passkey sheet, provider hand-off) rather
 * than an instant local biometric read — a user who pauses on that sheet can
 * outlive the server's TTL through no fault of their own. Re-running `attempt`
 * requests a fresh nonce and re-signs it (a second Face ID/passkey prompt),
 * rather than surfacing a failure for something a plain retry fixes.
 */
async function withExpiredProofRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    const isExpiredProof = err instanceof DeployApiError && /expired|invalid.*proof/i.test(err.message);
    if (!isExpiredProof) throw err;
    return attempt();
  }
}

function unwrapDeploy(res: { status: number; body: any }): BackendDeployResult {
  if (res.status !== 200 || !res.body?.data?.smart_account_address) {
    throw new DeployApiError(
      res.body?.error?.message ?? `smart account deployment failed (${res.status})`,
      res.status,
    );
  }
  return {
    smartAccountAddress: res.body.data.smart_account_address,
    alreadyDeployed: Boolean(res.body.data.already_deployed),
  };
}

// ─── proof of key possession ──────────────────────────────────────────────────

type ProofKeyType = 'ed25519' | 'webauthn' | 'delegated';

/**
 * Ask the backend for a single-use nonce bound to the key being deployed.
 * Returned as hex — sign the decoded bytes, and send the hex back verbatim.
 */
async function requestChallenge(keyType: ProofKeyType, keyRef: string): Promise<string> {
  const res = await xhrPost('/challenge', {
    key_type: keyType,
    key_ref: keyRef,
    network: getNetworkId(),
  });
  if (res.status !== 200 || !res.body?.data?.nonce) {
    throw new DeployApiError(
      res.body?.error?.message ?? `deployment challenge failed (${res.status})`,
      res.status,
    );
  }
  return res.body.data.nonce as string;
}

/**
 * Sign a nonce with the seed-wallet key matching `publicKeyHex`.
 *
 * The caller only has the public key, so the owning BIP-44 index is found by
 * probing — index 0 in almost every case. Matching on the derived public key
 * rather than trusting a passed-in index means we can never sign with the
 * wrong account's key.
 */
async function signNonceWithSeedWallet(
  publicKeyHex: string,
  nonceBytes: Uint8Array,
): Promise<string> {
  const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
  if (!mnemonic) {
    throw new Error('mnemonic not available — deployment requires the wallet to be unlocked');
  }

  for (let index = 0; index < MAX_ACCOUNT_INDEX_PROBE; index++) {
    const wallet = deriveWalletAtIndex(mnemonic, index);
    if (wallet.publicKeyHex !== publicKeyHex) continue;
    return bytesToB64(new Uint8Array(wallet.keypair.sign(Buffer.from(nonceBytes))));
  }
  throw new Error('no account in this wallet matches the key being deployed');
}

/** Locate which account list index owns a given passkey credential ID. */
async function findPasskeyListIndex(credentialId: string): Promise<number> {
  for (let index = 0; index < MAX_ACCOUNT_INDEX_PROBE; index++) {
    const keys = getPasskeyStorageKeys(index);
    const storedCredentialId = await SecureStore.getItemAsync(keys.credentialId);
    if (storedCredentialId === credentialId) return index;
    // Slot 0 predates per-slot credential IDs, so accept it on a bare match
    // against whichever key material is present there.
    if (index === 0 && !storedCredentialId) {
      const hasKeyData = await SecureStore.getItemAsync(keys.keyDataHex);
      if (hasKeyData) return index;
    }
  }
  throw new Error('passkey credential not found in SecureStore');
}

/**
 * Produce a WebAuthn assertion over the nonce. Raises the OS Face ID / Touch ID
 * prompt for a local key, or the OS passkey ceremony (Google Password Manager /
 * iCloud Keychain) for a platform key — signWithStoredPasskeyAtIndex routes
 * between the two based on how this credential was provisioned.
 */
async function signNonceWithPasskey(
  credentialId: string,
  nonceBytes: Uint8Array,
): Promise<{ signature: string; authenticatorData: string; clientDataJSON: string }> {
  const listIndex = await findPasskeyListIndex(credentialId);
  const { sig } = await signWithStoredPasskeyAtIndex(listIndex, nonceBytes, PASSKEY_RP_ID);
  return {
    signature: bytesToB64(compactSigToDER(sig.signature)),
    authenticatorData: bytesToB64(sig.authenticatorData),
    clientDataJSON: bytesToB64(sig.clientDataJSON),
  };
}

// ─── deploy calls ─────────────────────────────────────────────────────────────

/** Deploy the smart account for a seed-wallet (BIP-44) Ed25519 key. */
export async function deploySeedWalletAccount(
  publicKeyHex: string,
): Promise<BackendDeployResult> {
  return withExpiredProofRetry(async () => {
    const nonceHex = await requestChallenge('ed25519', publicKeyHex);
    const signature = await signNonceWithSeedWallet(publicKeyHex, hexToBytes(nonceHex));

    return unwrapDeploy(
      await xhrPost('/ed25519', {
        public_key_hex: publicKeyHex,
        network: getNetworkId(),
        proof: { nonce: nonceHex, signature },
      }),
    );
  });
}

/**
 * Deploy the smart account for a passkey (P-256 / WebAuthn) credential.
 *
 * The three phases are traced separately because they fail independently and
 * for unrelated reasons: `deploy.challenge` and `deploy.submit` are network
 * round-trips to latch-api, while `passkey.sign` is an OS ceremony that touches
 * no network at all. A deployment that dies between the first and the third
 * with nothing in the backend log is a signing failure, and the span breakdown
 * says so without needing the backend's access log to prove a negative.
 */
export async function deployPasskeyAccount(
  credentialId: string,
  keyDataHex: string,
  /** Fed straight into latch-api's passkey-credentials recovery index — see provision-passkey.ts. Omit when there's no computed name to send (never blocks the deploy itself). */
  label?: string,
  seq?: number,
): Promise<BackendDeployResult> {
  return withExpiredProofRetry(async () => {
    const nonceHex = await Sentry.startSpan(
      { name: 'deploy.challenge', op: 'http.client' },
      () => requestChallenge('webauthn', keyDataHex),
    );
    const proof = await Sentry.startSpan({ name: 'passkey.sign', op: 'passkey.ceremony' }, () =>
      signNonceWithPasskey(credentialId, hexToBytes(nonceHex)),
    );

    return unwrapDeploy(
      await Sentry.startSpan({ name: 'deploy.submit', op: 'http.client' }, () =>
        xhrPost('/webauthn', {
          key_data_hex: keyDataHex,
          network: getNetworkId(),
          ...(label ? { label, seq } : {}),
          proof: {
            nonce: nonceHex,
            signature: proof.signature,
            authenticator_data: proof.authenticatorData,
            client_data_json: proof.clientDataJSON,
          },
        }),
      ),
    );
  });
}

/**
 * Deploy a shared (multi-signer) smart account.
 *
 * `signers` and `saltHex` are sent verbatim: both feed the deterministic
 * address, and every participating device derives them identically via
 * sortSignersCanonical + deriveMultisigSalt. The backend must not reorder them.
 *
 * The deploying device proves possession of its own key within the set —
 * holding an unrelated key is not authorisation to spend bundler funds here.
 */
export async function deployMultisigAccount(
  signers: AccountSigner[],
  threshold: number,
  saltHex: string,
): Promise<BackendDeployResult> {
  const prover = await resolveLocalProver(signers);

  return withExpiredProofRetry(async () => {
    const nonceHex = await requestChallenge(prover.keyType, prover.keyRef);
    const nonceBytes = hexToBytes(nonceHex);

    let proof: Record<string, string>;
    if (prover.keyType === 'ed25519') {
      proof = { nonce: nonceHex, signature: await signNonceWithSeedWallet(prover.keyRef, nonceBytes) };
    } else {
      const p = await signNonceWithPasskey(prover.credentialId, nonceBytes);
      proof = {
        nonce: nonceHex,
        signature: p.signature,
        authenticator_data: p.authenticatorData,
        client_data_json: p.clientDataJSON,
      };
    }

    return unwrapDeploy(
      await xhrPost('/multisig', {
        signers: signers.map(toWireSigner),
        threshold,
        salt_hex: saltHex,
        network: getNetworkId(),
        proof_key_type: prover.keyType,
        proof_key_ref: prover.keyRef,
        proof,
      }),
    );
  });
}

type LocalProver =
  | { keyType: 'ed25519'; keyRef: string }
  | { keyType: 'webauthn'; keyRef: string; credentialId: string };

/**
 * Find which signer in the set belongs to this device, so it can sign the
 * deploy proof. Matching against local key material — rather than trusting the
 * caller to say — means a device can only ever prove for a key it actually
 * holds, and the shared-wallet callers need no extra plumbing.
 */
async function resolveLocalProver(signers: AccountSigner[]): Promise<LocalProver> {
  const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
  if (mnemonic) {
    const seedSigners = new Set(
      signers.filter((s) => s.kind === 'ed25519').map((s) => s.publicKeyHex),
    );
    for (let index = 0; index < MAX_ACCOUNT_INDEX_PROBE && seedSigners.size > 0; index++) {
      const { publicKeyHex } = deriveWalletAtIndex(mnemonic, index);
      if (seedSigners.has(publicKeyHex)) return { keyType: 'ed25519', keyRef: publicKeyHex };
    }
  }

  const passkeySigners = new Set(
    signers.filter((s) => s.kind === 'webauthn').map((s) => s.keyDataHex),
  );
  if (passkeySigners.size > 0) {
    for (let index = 0; index < MAX_ACCOUNT_INDEX_PROBE; index++) {
      const keys = getPasskeyStorageKeys(index);
      const keyDataHex = await SecureStore.getItemAsync(keys.keyDataHex);
      if (!keyDataHex || !passkeySigners.has(keyDataHex)) continue;
      const credentialId = await SecureStore.getItemAsync(keys.credentialId);
      if (credentialId) return { keyType: 'webauthn', keyRef: keyDataHex, credentialId };
    }
  }

  throw new Error(
    'this device holds none of the wallet’s signer keys, so it cannot authorise the deployment',
  );
}

function toWireSigner(signer: AccountSigner): Record<string, string> {
  switch (signer.kind) {
    case 'ed25519':
      return { type: 'ed25519', key_data_hex: signer.publicKeyHex };
    case 'webauthn':
      return { type: 'webauthn', key_data_hex: signer.keyDataHex };
    case 'delegated':
      return { type: 'delegated', g_address: signer.address };
  }
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}
