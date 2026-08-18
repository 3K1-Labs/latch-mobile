/**
 * passkey-webauthn.ts — React Native re-engineering of the Latch web WebAuthn library.
 *
 * Mirrors /lib/webauthn.ts from the web project but replaces browser WebAuthn APIs
 * (@simplewebauthn/browser) with:
 *   - react-native-quick-crypto — P-256 key generation + SHA-256 hashing
 *   - crypto.subtle (polyfilled by react-native-quick-crypto install()) — ECDSA signing
 *   - expo-secure-store with requireAuthentication: true — private key stored in the
 *     iOS Keychain / Android Keystore with biometric access control (Secure Enclave-
 *     backed on iPhone). Reading the key triggers the native Face ID / Touch ID prompt.
 *
 * The on-chain WebAuthn verifier validates:
 *   secp256r1_verify(pubKey, SHA256(authenticatorData || SHA256(clientDataJSON)), signature)
 *
 * We replicate browser behaviour by constructing authenticatorData and clientDataJSON
 * manually and signing with the stored P-256 private key.
 *
 * All base64 / base64url encoding uses btoa() with an explicit byte loop to avoid the
 * Buffer polyfill bug where Buffer.toString('base64') can emit "0,255,..." in React Native.
 */

import { getPasskeyStorageKeys, SECURE_KEYS } from '@/src/store/wallet';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Address, hash, xdr } from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';
import QuickCrypto from 'react-native-quick-crypto';
import { hashSorobanAuthPayload } from './soroban-auth-payload';

import { createLogger } from './logger';
import { b64uDecode, b64uEncode } from './base64url';

// Moved to ./base64url so pure consumers need not import this module (it
// reaches SecureStore and the wallet store); re-exported so existing callers
// are unaffected. See the note there.
export { b64uDecode, b64uEncode };

const log = createLogger('passkey');

// ─── base64url helpers (btoa-based — no Buffer polyfill) ─────────────────────


// ─── Key generation ───────────────────────────────────────────────────────────

export interface PasskeyCredential {
  /** hex-encoded random credential ID (16 bytes → 32 hex chars) */
  credentialId: string;
  /** 65-byte uncompressed P-256 pubkey hex + credentialId hex (≥132 hex chars total) */
  keyDataHex: string;
  /** P-256 private key hex (32 bytes → 64 hex chars) */
  privateKeyHex: string;
  /** uncompressed P-256 public key hex (65 bytes → 130 hex chars, starts with 04) */
  publicKeyHex: string;
}

/**
 * Generate a new P-256 passkey credential on-device.
 *
 * Call this AFTER biometric consent is confirmed.  Immediately after, store
 * the private key with biometric protection (requireAuthentication: true) via
 * storePasskeyCredential() so that all future signing requires Face ID / Touch ID.
 */
export function createPasskeyCredential(): PasskeyCredential {
  const ecdh = QuickCrypto.createECDH('prime256v1');
  ecdh.generateKeys();

  const publicKeyHex = (
    ecdh.getPublicKey() as unknown as { toString(enc: string): string }
  ).toString('hex');
  const privateKeyHex = (
    ecdh.getPrivateKey() as unknown as { toString(enc: string): string }
  ).toString('hex');
  const credentialId = (
    QuickCrypto.randomBytes(16) as unknown as { toString(enc: string): string }
  ).toString('hex');
  const keyDataHex = publicKeyHex + credentialId;

  return { credentialId, keyDataHex, privateKeyHex, publicKeyHex };
}

/**
 * Persist a passkey credential to SecureStore.
 *
 * Biometric path (requireBiometric = true):
 *   The private key is stored with requireAuthentication: true — protected in the
 *   iOS Keychain / Android Keystore with biometric access control (Secure Enclave
 *   on iPhone). Every read triggers a Face ID / Touch ID prompt automatically.
 *
 * PIN-only path (requireBiometric = false):
 *   The private key is stored with WHEN_PASSCODE_SET_THIS_DEVICE_ONLY on iOS —
 *   hardware-backed Keychain entry tied to passcode existence, never backed up to
 *   iCloud, and wiped if the device passcode is removed. On Android the key lands
 *   in the hardware Keystore without an additional auth gate; the app-level PIN is
 *   the security boundary.
 *
 * The public material (credentialId, keyDataHex) is stored without any protection
 * so it can be read freely for deployment and address lookup.
 */
export async function storePasskeyCredential(
  credential: PasskeyCredential,
  requireBiometric = true,
): Promise<void> {
  // Public material — never auth-gated
  await SecureStore.setItemAsync(SECURE_KEYS.CREDENTIAL_ID, credential.credentialId);
  await SecureStore.setItemAsync(SECURE_KEYS.KEY_DATA_HEX, credential.keyDataHex);

  // Auth mode flag — read back by signWithStoredPasskey to pick the right read options
  await SecureStore.setItemAsync(
    SECURE_KEYS.PASSKEY_REQUIRES_BIOMETRIC,
    requireBiometric ? 'true' : 'false',
  );

  if (requireBiometric) {
    await SecureStore.setItemAsync(SECURE_KEYS.PASSKEY_PRIVATE_KEY, credential.privateKeyHex, {
      requireAuthentication: true,
      authenticationPrompt: 'Authenticate to access your Latch wallet',
    });
  } else {
    // Hardware-backed on iOS: key exists only while device has a passcode set.
    // On Android: key is in hardware Keystore, accessible without additional auth.
    await SecureStore.setItemAsync(SECURE_KEYS.PASSKEY_PRIVATE_KEY, credential.privateKeyHex, {
      keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    });
  }
}

/**
 * Store a passkey credential at a specific list index.
 * Index 0 uses the original non-indexed keys (same as storePasskeyCredential).
 * Index 1+ uses indexed keys so each passkey account has its own credential.
 */
export async function storePasskeyCredentialAtIndex(
  credential: PasskeyCredential,
  listIndex: number,
  requireBiometric = true,
): Promise<void> {
  const keys = getPasskeyStorageKeys(listIndex);

  await SecureStore.setItemAsync(keys.credentialId, credential.credentialId);
  await SecureStore.setItemAsync(keys.keyDataHex, credential.keyDataHex);
  await SecureStore.setItemAsync(keys.requiresBiometric, requireBiometric ? 'true' : 'false');

  if (requireBiometric) {
    await SecureStore.setItemAsync(keys.privateKey, credential.privateKeyHex, {
      requireAuthentication: true,
      authenticationPrompt: 'Authenticate to access your Latch wallet',
    });
  } else {
    await SecureStore.setItemAsync(keys.privateKey, credential.privateKeyHex, {
      keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    });
  }
}

// ─── Signing ──────────────────────────────────────────────────────────────────

export interface PasskeySignature {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** 64-byte compact P-256 signature (r || s, low-S normalised) */
  signature: Uint8Array;
}

/**
 * Sign an auth digest using a P-256 private key, constructing the WebAuthn
 * authenticatorData and clientDataJSON exactly as the browser would produce them.
 *
 * Verifier checks:
 *   secp256r1_verify(pubKey, SHA256(authenticatorData || SHA256(clientDataJSON)), signature)
 *
 * Uses @noble/curves p256.sign (pure JS) to avoid crypto.subtle platform
 * inconsistencies in React Native where ECDSA/SHA-256 may not hash internally.
 *
 * @param privateKeyHex  Stored P-256 private key (64 hex chars)
 * @param authDigest     32-byte auth digest the passkey must commit to
 * @param rpId           Relying party ID used as origin and for rpIdHash in authenticatorData
 */
export async function signWithPasskey(
  privateKeyHex: string,
  authDigest: Uint8Array,
  rpId: string,
): Promise<PasskeySignature> {
  // authenticatorData: rpIdHash(32) + flags(1) + signCount(4)
  const rpIdHash = sha256(new TextEncoder().encode(rpId));
  const flags = new Uint8Array([0x05]); // UP=1, UV=1
  const signCount = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash, 0);
  authenticatorData.set(flags, 32);
  authenticatorData.set(signCount, 33);

  // clientDataJSON: type, challenge (= base64url(authDigest)), origin
  const challenge = b64uEncode(authDigest);
  const clientDataJSONStr = JSON.stringify({ type: 'webauthn.get', challenge, origin: rpId });
  const clientDataJSON = new TextEncoder().encode(clientDataJSONStr);

  // Sign SHA256(authenticatorData || SHA256(clientDataJSON)) with P-256
  const clientDataHash = sha256(clientDataJSON);
  const messageToSign = new Uint8Array(authenticatorData.length + clientDataHash.length);
  messageToSign.set(authenticatorData, 0);
  messageToSign.set(clientDataHash, authenticatorData.length);
  const msgHash = sha256(messageToSign);

  // msgHash is already the final digest the on-chain verifier checks, so we must
  // sign it as-is. @noble/curves v2 defaults `prehash: true` (v1 defaulted false),
  // which would sign sha256(msgHash) and silently break on-chain secp256r1
  // verification — pass `prehash: false` to sign the digest directly. v2 also
  // rejects hex-string secret keys (must be 32 bytes) and sign() returns the
  // 64-byte compact signature directly (no .toCompactRawBytes()).
  const secretKey = Buffer.from(privateKeyHex.padStart(64, '0'), 'hex');
  const signature = p256.sign(msgHash, secretKey, { lowS: true, prehash: false });

  return { authenticatorData, clientDataJSON, signature };
}

/**
 * Sign using the passkey stored in SecureStore for list index 0.
 *
 * Biometric users: reading the private key triggers Face ID / Touch ID automatically
 * (key was stored with requireAuthentication: true / Secure Enclave on iOS).
 *
 * PIN-only users: key is read without a biometric prompt — it was stored with
 * WHEN_PASSCODE_SET_THIS_DEVICE_ONLY (hardware-backed but no auth prompt on read).
 * The app-level PIN already gated access to this code path.
 *
 * @param authDigest   32-byte auth digest to sign
 * @param rpId         Relying party ID (e.g. "latch.finance")
 * @param promptMsg    Message shown in the biometric prompt (biometric path only)
 */
export async function signWithStoredPasskey(
  authDigest: Uint8Array,
  rpId: string,
  promptMsg = 'Authenticate to sign this transaction',
): Promise<PasskeySignature> {
  const { sig } = await signWithStoredPasskeyAtIndex(0, authDigest, rpId, promptMsg);
  return sig;
}

/**
 * Sign using the passkey stored at a specific account list index and return both
 * the signature and keyDataHex (needed to build the on-chain auth payload).
 *
 * @param listIndex    Position in the accounts array (0 = first account)
 * @param authDigest   32-byte auth digest to sign
 * @param rpId         Relying party ID (e.g. "latch.finance")
 * @param promptMsg    Message shown in the biometric prompt (biometric path only)
 */
/**
 * Read the device's stored WebAuthn key_data (65-byte P-256 pubkey + credential
 * id) for an account list index, without triggering a biometric prompt. Used to
 * match this device against the account's on-chain registered signer.
 */
export async function getStoredKeyDataHex(listIndex: number): Promise<string | null> {
  const keys = getPasskeyStorageKeys(listIndex);
  return SecureStore.getItemAsync(keys.keyDataHex);
}

/**
 * Read the device's stored P-256 private key (hex) for an account list index.
 * Respects the account's biometric flag — reading a biometric-gated key triggers
 * Face ID / Touch ID. Used to open a WCK bundle sealed to this device's passkey.
 */
export async function getStoredPrivateKeyHex(
  listIndex: number,
  promptMsg = 'Authenticate to receive this wallet’s key',
): Promise<string | null> {
  const keys = getPasskeyStorageKeys(listIndex);
  const requiresBiometric = await SecureStore.getItemAsync(keys.requiresBiometric);
  const useBiometric = requiresBiometric !== 'false';
  return SecureStore.getItemAsync(
    keys.privateKey,
    useBiometric ? { requireAuthentication: true, authenticationPrompt: promptMsg } : undefined,
  );
}

export async function signWithStoredPasskeyAtIndex(
  listIndex: number,
  authDigest: Uint8Array,
  rpId: string,
  promptMsg = 'Authenticate to sign this transaction',
): Promise<{ sig: PasskeySignature; keyDataHex: string }> {
  const keys = getPasskeyStorageKeys(listIndex);

  const requiresBiometric = await SecureStore.getItemAsync(keys.requiresBiometric);
  const useBiometric = requiresBiometric !== 'false';

  const privateKeyHex = await SecureStore.getItemAsync(
    keys.privateKey,
    useBiometric ? { requireAuthentication: true, authenticationPrompt: promptMsg } : undefined,
  );
  if (!privateKeyHex) {
    throw new Error('No passkey found. Please complete biometric setup first.');
  }

  const keyDataHex = await SecureStore.getItemAsync(keys.keyDataHex);
  if (!keyDataHex) {
    throw new Error('Key data missing. Please complete biometric setup first.');
  }

  // Pad private key to 32 bytes — QuickCrypto ECDH may return fewer if leading zeros are stripped
  const paddedPrivKey = privateKeyHex.padStart(64, '0');

  // Verify the stored private key corresponds to the registered public key.
  // A mismatch means credentials were regenerated after the smart account was deployed,
  // leaving an on-chain signer that can never verify. Fail fast with a clear error.
  const storedPub = keyDataHex.slice(0, 130);
  try {
    const derivedPub = Buffer.from(
      p256.getPublicKey(Buffer.from(paddedPrivKey, 'hex'), false),
    ).toString('hex');
    // The verdict is the whole diagnostic. A key length identifies the key
    // format and a prefix narrows a search space, so neither is logged — and
    // the mismatch below already raises a clear, actionable error.
    if (__DEV__) log.debug('stored key matches deployed signer:', derivedPub === storedPub);
    if (derivedPub !== storedPub) {
      throw new Error(
        'PASSKEY_KEY_MISMATCH: The stored credential no longer matches the deployed smart account. Re-initialize your account to continue.',
      );
    }
  } catch (e: any) {
    if (e.message?.startsWith('PASSKEY_KEY_MISMATCH')) throw e;
    if (__DEV__) log.debug('getPublicKey failed:', e);
  }

  const sig = await signWithPasskey(paddedPrivKey, authDigest, rpId);

  if (__DEV__) {
    try {
      const pubBytes = new Uint8Array(Buffer.from(keyDataHex.slice(0, 130), 'hex'));
      const cDataHash = sha256(sig.clientDataJSON);
      const msgBytes = new Uint8Array(sig.authenticatorData.length + cDataHash.length);
      msgBytes.set(sig.authenticatorData);
      msgBytes.set(cDataHash, sig.authenticatorData.length);
      const mHash = sha256(msgBytes);
      // prehash: false so this mirrors the on-chain verifier (which checks the
      // sig over mHash directly). Without it, v2 double-hashes and reports a
      // false "valid" even when on-chain secp256r1 verification fails.
      const localValid = p256.verify(sig.signature, mHash, pubBytes, { prehash: false });
      log.debug('local signature self-check:', localValid);
    } catch (e) {
      log.debug('local signature self-check failed:', e);
    }
  }

  return { sig, keyDataHex };
}

// ─── Auth digest ──────────────────────────────────────────────────────────────

/**
 * Compute the 32-byte auth digest the passkey must sign.
 * Mirrors computeAuthDigest() from the web library.
 *
 * auth_digest = SHA256(signaturePayload || contextRuleIds.toXDR())
 */
export function computeAuthDigest(
  authEntry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
  contextRuleIds: number[],
): Uint8Array {
  const signaturePayload = hashSorobanAuthPayload(authEntry, networkPassphrase);
  const ruleIdsXdr = new Uint8Array(
    xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))).toXDR(),
  );
  const combined = new Uint8Array(signaturePayload.length + ruleIdsXdr.length);
  combined.set(signaturePayload, 0);
  combined.set(ruleIdsXdr, signaturePayload.length);
  return new Uint8Array(hash(Buffer.from(combined)));
}

// ─── XDR encoding ─────────────────────────────────────────────────────────────

/**
 * Encode PasskeySignature as the XDR bytes the on-chain WebAuthn verifier expects.
 *
 * WebAuthnSigData { authenticator_data: Bytes, client_data: Bytes, signature: BytesN<64> }
 */
export function encodeWebAuthnSigData(sig: PasskeySignature): Uint8Array {
  // Soroban requires contracttype struct fields in alphabetical key order.
  // WebAuthnSigData fields sorted: authenticator_data < client_data < signature
  return new Uint8Array(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('authenticator_data'),
        val: xdr.ScVal.scvBytes(Buffer.from(sig.authenticatorData)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('client_data'),
        val: xdr.ScVal.scvBytes(Buffer.from(sig.clientDataJSON)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signature'),
        val: xdr.ScVal.scvBytes(Buffer.from(sig.signature)),
      }),
    ]).toXDR(),
  );
}
/**
 * Build the full AuthPayload ScVal for the on-chain smart account.
 *
 * AuthPayload { context_rule_ids: Vec<u32>, signers: Map<Signer, Bytes> }
 */
export function buildWebAuthnAuthPayload(
  verifierAddress: string,
  keyDataHex: string,
  sigDataXdr: Uint8Array,
  contextRuleIds: number[],
): xdr.ScVal {
  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    xdr.ScVal.scvAddress(Address.fromString(verifierAddress).toScAddress()),
    xdr.ScVal.scvBytes(Buffer.from(keyDataHex, 'hex')),
  ]);

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: signerKey,
          val: xdr.ScVal.scvBytes(Buffer.from(sigDataXdr)),
        }),
      ]),
    }),
  ]);
}

// ─── Recovery ────────────────────────────────────────────────────────────────

/**
 * Fix a PASSKEY_KEY_MISMATCH by deriving the correct public key from the
 * stored private key, updating keyDataHex in SecureStore, and redeploying
 * the smart account with the correct signer.
 *
 * Returns the new smart account C-address. Any assets at the old address
 * remain there — transfer them before calling this if needed.
 *
 * Triggers biometric prompt (private key read).
 */
export async function redeployWithCurrentKey(listIndex: number): Promise<string> {
  const keys = getPasskeyStorageKeys(listIndex);

  const requiresBiometric = await SecureStore.getItemAsync(keys.requiresBiometric);
  const useBiometric = requiresBiometric !== 'false';

  const privateKeyHex = await SecureStore.getItemAsync(
    keys.privateKey,
    useBiometric
      ? {
        requireAuthentication: true,
        authenticationPrompt: 'Authenticate to re-initialize your account',
      }
      : undefined,
  );
  if (!privateKeyHex) throw new Error('No passkey found. Please complete biometric setup first.');

  const paddedPrivKey = privateKeyHex.padStart(64, '0');
  const derivedPubKeyHex = Buffer.from(
    p256.getPublicKey(Buffer.from(paddedPrivKey, 'hex'), false),
  ).toString('hex');

  // Re-use existing credentialId if present; generate a new one otherwise.
  const existingCredId = await SecureStore.getItemAsync(keys.credentialId);
  const credentialId =
    existingCredId ??
    (QuickCrypto.randomBytes(16) as unknown as { toString(enc: string): string }).toString('hex');

  const newKeyDataHex = derivedPubKeyHex + credentialId;

  // Update stored public material so it matches the private key.
  await SecureStore.setItemAsync(keys.keyDataHex, newKeyDataHex);
  if (!existingCredId) {
    await SecureStore.setItemAsync(keys.credentialId, credentialId);
  }

  // Deploy a new smart account with the corrected key (force-skip the address cache).
  const { deploySmartAccount } = await import('@/src/api/passkey');
  const result = await deploySmartAccount(credentialId, newKeyDataHex, true);
  if (result.error) throw new Error(result.error);

  // Update the persisted smart account address.
  await SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, result.smartAccountAddress);
  await SecureStore.setItemAsync(SECURE_KEYS.DEPLOYED_KEY_DATA, newKeyDataHex);

  return result.smartAccountAddress;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
