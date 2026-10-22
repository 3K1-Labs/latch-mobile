/**
 * pairing-payload.ts — shared challenge/response codec for device pairing.
 *
 * Used by both QR mode (P2P) and link-code mode (backend-mediated). The
 * challenge is 32 random bytes; the joiner signs it with their device key
 * to prove ownership of the public key they're claiming.
 *
 * Wire encoding (used by the pair-code backend and by QR payloads):
 *   responsePubkey       : `${kind}:${hex}` — kind is one of "ed25519",
 *                          "webauthn", "delegated"
 *   responseSignatureB64 : base64 of JSON {kind, ...kind-specific fields}
 *
 * The backend treats both as opaque strings; the inner shape is a client
 * concern. Device A (initiator) verifies the signature locally before
 * including the new device in the on-chain add_signer transaction.
 */

import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { b64uEncode } from './base64url';
import type { PasskeySignature } from './passkey-webauthn';

export type PairingSignerKind = 'ed25519' | 'webauthn' | 'delegated';

export type SignedPairingChallenge =
  | {
      kind: 'ed25519';
      /** 64-char hex (32-byte) raw Ed25519 public key. */
      publicKeyHex: string;
      /** 128-char hex (64-byte) Ed25519 signature over the raw challenge. */
      signatureHex: string;
    }
  | {
      kind: 'webauthn';
      /** Hex-encoded WebAuthn key_data as stored on-chain. */
      keyDataHex: string;
      /** Hex-encoded WebAuthn authenticatorData (37 bytes when our authenticator emits it). */
      authenticatorDataHex: string;
      /** UTF-8 JSON string emitted by the authenticator. */
      clientDataJSON: string;
      /** 128-char hex (64-byte) raw P-256 signature, low-S normalised. */
      signatureHex: string;
    }
  | {
      kind: 'delegated';
      /** G-address or C-address. */
      address: string;
      /**
       * Ed25519 signature over the raw challenge by the underlying account.
       * For G-address delegated signers we sign with the account's Ed25519
       * key. For C-address delegated signers the pairing flow doesn't apply
       * — this case is included for completeness.
       */
      signatureHex: string;
    };

/** Sign the 32-byte challenge with an Ed25519 keypair (mobile seed wallet). */
export function signChallengeEd25519(
  challenge: Uint8Array,
  keypair: Keypair,
): SignedPairingChallenge {
  const signature = keypair.sign(Buffer.from(challenge));
  return {
    kind: 'ed25519',
    publicKeyHex: Buffer.from(keypair.rawPublicKey()).toString('hex'),
    signatureHex: Buffer.from(signature).toString('hex'),
  };
}

/**
 * Sign the challenge with the local stored passkey. The challenge is used
 * directly as the WebAuthn authDigest (signWithStoredPasskey hashes it
 * into the signed message per the WebAuthn spec).
 *
 * @param keyDataHex  Hex of the on-chain key_data for this passkey. Stored
 *                    locally in SECURE_KEYS.KEY_DATA_HEX.
 * @param rpId        Relying party ID (e.g. "uselatch.app"). Must match
 *                    what the passkey was registered with.
 */
export async function signChallengePasskey(
  challenge: Uint8Array,
  keyDataHex: string,
  rpId: string,
): Promise<SignedPairingChallenge> {
  // Imported at call time, not at module load. The signing side reaches the
  // device's SecureStore and the wallet store, which drags React Native in
  // behind it; the verification side below is pure. Deferring this keeps the
  // module importable — and therefore testable — outside the app.
  const { signWithStoredPasskey } = await import('./passkey-webauthn');
  const sig: PasskeySignature = await signWithStoredPasskey(challenge, rpId);
  return {
    kind: 'webauthn',
    keyDataHex,
    authenticatorDataHex: Buffer.from(sig.authenticatorData).toString('hex'),
    clientDataJSON: new TextDecoder().decode(sig.clientDataJSON),
    signatureHex: Buffer.from(sig.signature).toString('hex'),
  };
}

// ─── Verification ─────────────────────────────────────────────────────────

/**
 * Verify a SignedPairingChallenge against the original challenge bytes.
 *
 * Returns true iff the signature is valid for the claimed public key over
 * the challenge. Throws only on malformed inputs (bad hex, length
 * mismatch); returns false for genuine signature mismatch.
 */
export function verifySignedChallenge(
  challenge: Uint8Array,
  signed: SignedPairingChallenge,
): boolean {
  switch (signed.kind) {
    case 'ed25519':
      return verifyEd25519(challenge, signed.publicKeyHex, signed.signatureHex);
    case 'webauthn':
      return verifyWebAuthn(
        challenge,
        signed.keyDataHex,
        signed.authenticatorDataHex,
        signed.clientDataJSON,
        signed.signatureHex,
      );
    case 'delegated':
      // Treat delegated as Ed25519 over the G-address-derived pubkey.
      if (!signed.address.startsWith('G')) return false;
      try {
        const pubkey = Buffer.from(
          StrKey.decodeEd25519PublicKey(signed.address),
        );
        return verifyEd25519(challenge, pubkey.toString('hex'), signed.signatureHex);
      } catch {
        return false;
      }
  }
}

function verifyEd25519(challenge: Uint8Array, publicKeyHex: string, signatureHex: string): boolean {
  try {
    const kp = Keypair.fromPublicKey(
      StrKey.encodeEd25519PublicKey(Buffer.from(publicKeyHex, 'hex')),
    );
    return kp.verify(Buffer.from(challenge), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

function verifyWebAuthn(
  challenge: Uint8Array,
  keyDataHex: string,
  authenticatorDataHex: string,
  clientDataJSON: string,
  signatureHex: string,
): boolean {
  try {
    // 1. Verify clientDataJSON commits to our challenge.
    const parsed = JSON.parse(clientDataJSON) as { type?: string; challenge?: string };
    if (parsed.type !== 'webauthn.get') return false;
    if (parsed.challenge !== b64uEncode(challenge)) return false;

    // 2. Reconstruct the signed message: SHA256(authData || SHA256(clientDataJSON))
    const authData = Buffer.from(authenticatorDataHex, 'hex');
    const clientDataBytes = new TextEncoder().encode(clientDataJSON);
    const clientDataHash = sha256(clientDataBytes);
    const messageToSign = new Uint8Array(authData.length + clientDataHash.length);
    messageToSign.set(authData, 0);
    messageToSign.set(clientDataHash, authData.length);
    const msgHash = sha256(messageToSign);

    // 3. Recover the raw P-256 pubkey from key_data.
    //    Our passkey-webauthn convention stores key_data as the
    //    65-byte uncompressed point (0x04 || X || Y). p256.verify accepts
    //    that directly.
    const pubkey = Buffer.from(keyDataHex, 'hex');
    const signature = Buffer.from(signatureHex, 'hex');
    // prehash: false — msgHash is the final digest the signer committed to.
    // @noble/curves v2 defaults prehash:true, which would hash msgHash again and
    // reject otherwise-valid WebAuthn signatures.
    return p256.verify(signature, msgHash, pubkey, { lowS: true, prehash: false });
  } catch {
    return false;
  }
}

// ─── Wire encoding (pair-code + QR) ────────────────────────────────────────

/**
 * Encode a SignedPairingChallenge into the two strings the backend stores
 * (responsePubkey + responseSignatureB64). Use the same encoding inside
 * the QR payload so both pairing modes share a codec.
 */
export function encodeSignedChallenge(signed: SignedPairingChallenge): {
  responsePubkey: string;
  responseSignatureB64: string;
} {
  const publicKey =
    signed.kind === 'ed25519'
      ? signed.publicKeyHex
      : signed.kind === 'webauthn'
        ? signed.keyDataHex
        : signed.address;
  return {
    responsePubkey: `${signed.kind}:${publicKey}`,
    responseSignatureB64: Buffer.from(JSON.stringify(signed), 'utf-8').toString('base64'),
  };
}

/**
 * Decode the (responsePubkey, responseSignatureB64) pair back into a
 * SignedPairingChallenge. Throws on malformed input. Use
 * verifySignedChallenge afterwards to confirm authenticity.
 */
export function decodeSignedChallenge(
  responsePubkey: string,
  responseSignatureB64: string,
): SignedPairingChallenge {
  const idx = responsePubkey.indexOf(':');
  if (idx === -1) throw new Error('decodeSignedChallenge: responsePubkey missing kind prefix');
  const kind = responsePubkey.slice(0, idx) as PairingSignerKind;
  if (kind !== 'ed25519' && kind !== 'webauthn' && kind !== 'delegated') {
    throw new Error(`decodeSignedChallenge: unknown kind "${kind}"`);
  }
  const json = Buffer.from(responseSignatureB64, 'base64').toString('utf-8');
  const parsed = JSON.parse(json) as SignedPairingChallenge;
  if (parsed.kind !== kind) {
    throw new Error(
      `decodeSignedChallenge: kind mismatch (${parsed.kind} in body vs ${kind} in prefix)`,
    );
  }
  return parsed;
}

/** Decode a base64 challenge string from the backend or QR payload. */
export function decodeChallengeB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Encode a Uint8Array challenge for transport. */
export function encodeChallengeB64(challenge: Uint8Array): string {
  return Buffer.from(challenge).toString('base64');
}
