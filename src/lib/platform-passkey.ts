/**
 * platform-passkey.ts — real platform WebAuthn via react-native-passkey.
 *
 * Unlike passkey-webauthn.ts (which hand-rolls a P-256 keypair stored in
 * SecureStore and fabricates authenticatorData/clientDataJSON to satisfy the
 * on-chain verifier), this module runs the actual OS passkey ceremony:
 * ASAuthorizationPlatformPublicKeyCredentialProvider on iOS, Credential
 * Manager on Android. The private key never leaves the Secure
 * Enclave/Keystore, and the resulting credential syncs via whichever
 * provider the OS ceremony used (iCloud Keychain, Google Password Manager,
 * or any other passkey provider the user has configured) — the app cannot
 * and should not try to force one over another; see the request shape below.
 *
 * The `create`/`get` request asks for a discoverable credential and nothing
 * more: no `authenticatorAttachment`, no `excludeCredentials` transports, and
 * no attachment-forcing call (createPlatformKey/getPlatformKey), so the system
 * passkey chooser is free to offer every provider — forcing `platform`
 * attachment or `internal` transports is what broke Google Password Manager
 * passkeys in the web extension (see reference/latch-web-extension's
 * passkey.ts).
 *
 * Output shapes (keyDataHex, PasskeySignature) match passkey-webauthn.ts
 * exactly, so deploySmartAccount, encodeWebAuthnSigData, and the on-chain
 * verifier need no changes — a platform passkey is just another way to
 * produce the same signer material.
 */

import { p256 } from '@noble/curves/nist.js';
import { Passkey } from 'react-native-passkey';

import { b64uDecode, b64uEncode } from './base64url';
import { decodeCBOR } from './cbor';
import type { PasskeySignature } from './passkey-webauthn';

// ─── COSE_Key (EC2/P-256) → uncompressed point hex ───────────────────────────

function leftPad32(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 32) return bytes;
  if (bytes.length > 32) {
    throw new Error(`platform-passkey: EC coordinate too long (${bytes.length} bytes)`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function coseEC2PublicKeyToUncompressedHex(coseKeyBytes: Uint8Array): string {
  const decoded = decodeCBOR(coseKeyBytes);
  if (!(decoded instanceof Map)) {
    throw new Error('platform-passkey: COSE public key is not a CBOR map');
  }
  const kty = decoded.get(1);
  const crv = decoded.get(-1);
  const x = decoded.get(-2);
  const y = decoded.get(-3);
  if (kty !== 2)
    throw new Error(`platform-passkey: unsupported COSE kty ${kty} (expected 2 = EC2)`);
  if (crv !== 1)
    throw new Error(`platform-passkey: unsupported COSE crv ${crv} (expected 1 = P-256)`);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error('platform-passkey: COSE public key missing x/y coordinates');
  }

  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(leftPad32(x), 1);
  point.set(leftPad32(y), 33);
  return Buffer.from(point).toString('hex');
}

// ─── attestationObject / authData parsing (needed on iOS — see below) ───────

function parseAttestationObjectAuthData(attestationObjectBytes: Uint8Array): Uint8Array {
  const decoded = decodeCBOR(attestationObjectBytes);
  if (!(decoded instanceof Map)) {
    throw new Error('platform-passkey: attestationObject is not a CBOR map');
  }
  const authData = decoded.get('authData');
  if (!(authData instanceof Uint8Array)) {
    throw new Error('platform-passkey: attestationObject missing authData');
  }
  return authData;
}

const AT_FLAG = 0x40; // bit 6 of the authData flags byte: "attested credential data included"

/** Extract the COSE public key bytes embedded in authData's attested credential data. */
function extractCosePublicKeyFromAuthData(authData: Uint8Array): Uint8Array {
  if (authData.length < 37)
    throw new Error('platform-passkey: authData shorter than rpIdHash+flags+signCount');
  const flags = authData[32];
  if ((flags & AT_FLAG) === 0) {
    throw new Error(
      'platform-passkey: authData has no attested credential data (registration required)',
    );
  }
  let offset = 37; // rpIdHash(32) + flags(1) + signCount(4)
  offset += 16; // aaguid
  if (authData.length < offset + 2)
    throw new Error('platform-passkey: authData truncated before credIdLength');
  const credIdLen = (authData[offset] << 8) | authData[offset + 1];
  offset += 2 + credIdLen;
  if (authData.length <= offset)
    throw new Error('platform-passkey: authData truncated before credentialPublicKey');
  // credentialPublicKey is CBOR; trailing extension bytes (if any) are not
  // requested by createPlatformPasskeyCredential, so decoding through to the
  // end of the buffer is expected to consume it exactly.
  return authData.subarray(offset);
}

// ─── SPKI DER (Android's response.publicKey) → uncompressed point hex ───────
// Fixed 26-byte SubjectPublicKeyInfo header for id-ecPublicKey + prime256v1,
// followed by the 65-byte uncompressed point. This header never varies for
// ES256/P-256, so a constant prefix check is sufficient (no general ASN.1
// parser needed).
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

function spkiToUncompressedHex(spki: Uint8Array): string {
  if (spki.length !== P256_SPKI_PREFIX.length + 65) {
    throw new Error(`platform-passkey: unexpected SPKI length ${spki.length}`);
  }
  for (let i = 0; i < P256_SPKI_PREFIX.length; i++) {
    if (spki[i] !== P256_SPKI_PREFIX[i]) {
      throw new Error(
        'platform-passkey: SPKI header does not match expected P-256/id-ecPublicKey prefix',
      );
    }
  }
  const point = spki.subarray(P256_SPKI_PREFIX.length);
  if (point[0] !== 0x04)
    throw new Error('platform-passkey: SPKI point is not uncompressed (expected 0x04)');
  return Buffer.from(point).toString('hex');
}

// ─── DER ECDSA signature → raw compact (r‖s, low-S) hex ─────────────────────
// Real WebAuthn assertions are DER-encoded and are not guaranteed low-S; the
// on-chain verifier expects a 64-byte compact low-S signature (the same
// convention passkey-webauthn.ts's signWithPasskey already produces).
function derSignatureToCompactHex(der: Uint8Array): string {
  const sig = p256.Signature.fromBytes(der, 'der');
  const order = p256.Point.Fn.ORDER;
  const normalized = sig.hasHighS() ? new (p256.Signature as any)(sig.r, order - sig.s) : sig;
  return Buffer.from(normalized.toBytes('compact')).toString('hex');
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface PlatformPasskeyCredential {
  /** hex-encoded credential ID, as returned by the OS ceremony (variable length). */
  credentialId: string;
  /** uncompressed P-256 pubkey hex (130 hex chars) + credentialId hex, matching passkey-webauthn.ts's convention. */
  keyDataHex: string;
  /** uncompressed P-256 pubkey hex alone (130 hex chars, starts with 04). */
  publicKeyHex: string;
}

export interface CreatePlatformPasskeyParams {
  rpId: string;
  rpName: string;
  /** Opaque WebAuthn user handle — not a secret, but should not be PII (e.g. a random id or the smart account address). */
  userId: Uint8Array;
  userName: string;
  userDisplayName: string;
  /** Server- or client-derived challenge bytes (e.g. computeAuthDigest's output, or a dedicated random nonce). */
  challenge: Uint8Array;
}

/**
 * Run the real OS passkey creation ceremony. Deliberately does not set
 * `authenticatorSelection` or `excludeCredentials` transports, and calls
 * `Passkey.create` (not `createPlatformKey`) so the system chooser can offer
 * every available provider — see the module doc comment.
 */
export async function createPlatformPasskeyCredential(
  params: CreatePlatformPasskeyParams,
): Promise<PlatformPasskeyCredential> {
  const result = await Passkey.create({
    challenge: b64uEncode(params.challenge),
    rp: { id: params.rpId, name: params.rpName },
    user: {
      id: b64uEncode(params.userId),
      name: params.userName,
      displayName: params.userDisplayName,
    },
    // Request a discoverable (resident) credential so the OS stores it and syncs
    // via Google Password Manager / iCloud Keychain (WebAuthn §5.4.4). This is
    // what makes sign-in on a second device possible at all: that flow runs
    // Passkey.get with no allowCredentials, so the provider has to be able to
    // find the credential from the RP ID alone. requireResidentKey is the
    // WebAuthn L1 spelling of the same request, still read by some Play
    // Services versions; userVerification matches the get side.
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 (P-256 + SHA-256)
    attestation: 'none',
  });

  // Android's Credential Manager forwards the OS's registrationResponseJson
  // verbatim, which includes response.publicKey (SPKI DER) directly. iOS's
  // native module never populates it (PasskeyDelegate.swift leaves it nil),
  // so iOS falls back to parsing the COSE key out of attestationObject.
  const publicKeyHex = result.response.publicKey
    ? spkiToUncompressedHex(b64uDecode(result.response.publicKey))
    : coseEC2PublicKeyToUncompressedHex(
        extractCosePublicKeyFromAuthData(
          parseAttestationObjectAuthData(b64uDecode(result.response.attestationObject)),
        ),
      );

  const credentialIdHex = Buffer.from(b64uDecode(result.rawId ?? result.id)).toString('hex');

  return {
    credentialId: credentialIdHex,
    keyDataHex: publicKeyHex + credentialIdHex,
    publicKeyHex,
  };
}

export interface SignWithPlatformPasskeyParams {
  rpId: string;
  /** Must match the challenge passed to computeAuthDigest on the caller's side. */
  challenge: Uint8Array;
  /** Restrict the ceremony to this device's credential; omit to let the OS offer any matching passkey. */
  allowCredentialIdHex?: string;
}

/**
 * Run the real OS passkey authentication ceremony and return a
 * PasskeySignature (in the exact shape encodeWebAuthnSigData/
 * buildWebAuthnAuthPayload already expect) plus the hex credential ID the OS
 * actually used. That ID matters when `allowCredentialIdHex` was omitted —
 * e.g. signing in in to an existing account on a device that has never
 * stored anything locally, where the OS locates the synced credential via
 * Google Password Manager / iCloud Keychain and the caller needs to know
 * which one it picked to match it against the account's on-chain signers.
 */
export async function signWithPlatformPasskey(
  params: SignWithPlatformPasskeyParams,
): Promise<PasskeySignature & { credentialIdHex: string }> {
  const result = await Passkey.get({
    challenge: b64uEncode(params.challenge),
    rpId: params.rpId,
    allowCredentials: params.allowCredentialIdHex
      ? [
          {
            type: 'public-key',
            id: b64uEncode(Buffer.from(params.allowCredentialIdHex, 'hex')),
          },
        ]
      : undefined,
    userVerification: 'required',
  });

  return {
    authenticatorData: b64uDecode(result.response.authenticatorData),
    clientDataJSON: b64uDecode(result.response.clientDataJSON),
    signature: Buffer.from(derSignatureToCompactHex(b64uDecode(result.response.signature)), 'hex'),
    credentialIdHex: Buffer.from(b64uDecode(result.rawId ?? result.id)).toString('hex'),
  };
}

/** Whether the OS/device supports platform passkeys at all (gates showing the feature in UI). */
export function isPlatformPasskeySupported(): boolean {
  return Passkey.isSupported();
}
