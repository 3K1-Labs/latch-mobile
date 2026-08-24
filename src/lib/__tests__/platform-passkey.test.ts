/**
 * platform-passkey.test.ts
 *
 * Cross-checks the module's CBOR/COSE/SPKI/DER parsing against Node's own
 * `crypto` module rather than against fixtures built with the same
 * primitives the module under test uses — an independent implementation is
 * what makes these tests meaningful. `react-native-passkey` is mocked since
 * it touches native modules that don't exist under the Node test environment;
 * everything it would return (attestationObject CBOR, SPKI DER, DER
 * signatures) is instead produced with Node's `crypto`.
 */

import * as crypto from 'crypto';

import { p256 } from '@noble/curves/nist.js';

import { b64uEncode } from '../base64url';

import { Passkey } from 'react-native-passkey';
import {
  createPlatformPasskeyCredential,
  signWithPlatformPasskey,
  isPlatformPasskeySupported,
} from '../platform-passkey';

jest.mock('react-native-passkey', () => ({
  Passkey: {
    create: jest.fn(),
    get: jest.fn(),
    isSupported: jest.fn(() => true),
  },
}));

// ─── minimal CBOR encoder — test-only, independent of src/lib/cbor.ts ───────

function head(majorType: number, length: number): number[] {
  if (length < 24) return [(majorType << 5) | length];
  if (length < 256) return [(majorType << 5) | 24, length];
  if (length < 65536) return [(majorType << 5) | 25, (length >> 8) & 0xff, length & 0xff];
  throw new Error('test helper: length too large');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function cInt(value: number): Uint8Array {
  return value >= 0
    ? Uint8Array.from(head(0, value))
    : Uint8Array.from(head(1, -1 - value));
}

function cBytes(bytes: Uint8Array): Uint8Array {
  return concat(Uint8Array.from(head(2, bytes.length)), bytes);
}

function cText(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return concat(Uint8Array.from(head(3, bytes.length)), bytes);
}

function cMapIntKeys(entries: [number, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from(head(5, entries.length))];
  for (const [k, v] of entries) {
    parts.push(cInt(k));
    parts.push(v);
  }
  return concat(...parts);
}

function cMapTextKeys(entries: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from(head(5, entries.length))];
  for (const [k, v] of entries) {
    parts.push(cText(k));
    parts.push(v);
  }
  return concat(...parts);
}

// ─── fixtures built from a real Node-generated P-256 key ────────────────────

function generateP256KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const xBytes = new Uint8Array(Buffer.from(jwk.x, 'base64url'));
  const yBytes = new Uint8Array(Buffer.from(jwk.y, 'base64url'));
  const expectedUncompressedHex = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(xBytes),
    Buffer.from(yBytes),
  ]).toString('hex');
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { publicKey, privateKey, xBytes, yBytes, expectedUncompressedHex, spkiDer };
}

function buildCoseEC2Key(xBytes: Uint8Array, yBytes: Uint8Array): Uint8Array {
  return cMapIntKeys([
    [1, cInt(2)], // kty: EC2
    [3, cInt(-7)], // alg: ES256
    [-1, cInt(1)], // crv: P-256
    [-2, cBytes(xBytes)],
    [-3, cBytes(yBytes)],
  ]);
}

function buildAuthData(credentialId: Uint8Array, coseKeyBytes: Uint8Array): Uint8Array {
  const rpIdHash = new Uint8Array(32).fill(0xab);
  const flags = Uint8Array.from([0x45]); // UP | UV | AT
  const signCount = new Uint8Array(4); // zero
  const aaguid = new Uint8Array(16); // zero
  const credIdLen = Uint8Array.from([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff]);
  return concat(rpIdHash, flags, signCount, aaguid, credIdLen, credentialId, coseKeyBytes);
}

function buildAttestationObject(authData: Uint8Array): Uint8Array {
  return cMapTextKeys([
    ['fmt', cText('none')],
    ['attStmt', cMapTextKeys([])],
    ['authData', cBytes(authData)],
  ]);
}

describe('createPlatformPasskeyCredential', () => {
  const credentialId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  afterEach(() => jest.clearAllMocks());

  it('extracts the public key from attestationObject when response.publicKey is absent (iOS path)', async () => {
    const { xBytes, yBytes, expectedUncompressedHex } = generateP256KeyPair();
    const coseKey = buildCoseEC2Key(xBytes, yBytes);
    const authData = buildAuthData(credentialId, coseKey);
    const attestationObject = buildAttestationObject(authData);

    (Passkey.create as jest.Mock).mockResolvedValue({
      id: b64uEncode(credentialId),
      rawId: b64uEncode(credentialId),
      response: {
        clientDataJSON: b64uEncode('{}'),
        attestationObject: b64uEncode(attestationObject),
      },
    });

    const result = await createPlatformPasskeyCredential({
      rpId: 'latch.finance',
      rpName: 'Latch',
      userId: new Uint8Array([9, 9]),
      userName: 'user',
      userDisplayName: 'User',
      challenge: new Uint8Array(32),
    });

    expect(result.publicKeyHex).toBe(expectedUncompressedHex);
    expect(result.credentialId).toBe(Buffer.from(credentialId).toString('hex'));
    expect(result.keyDataHex).toBe(expectedUncompressedHex + Buffer.from(credentialId).toString('hex'));
  });

  it('prefers response.publicKey (SPKI DER) when present, ignoring attestationObject (Android path)', async () => {
    const { expectedUncompressedHex, spkiDer } = generateP256KeyPair();

    (Passkey.create as jest.Mock).mockResolvedValue({
      id: b64uEncode(credentialId),
      rawId: b64uEncode(credentialId),
      response: {
        clientDataJSON: b64uEncode('{}'),
        // Deliberately garbage — must not be touched when response.publicKey is present.
        attestationObject: b64uEncode(new Uint8Array([0xff, 0xff, 0xff])),
        publicKey: b64uEncode(new Uint8Array(spkiDer)),
      },
    });

    const result = await createPlatformPasskeyCredential({
      rpId: 'latch.finance',
      rpName: 'Latch',
      userId: new Uint8Array([9, 9]),
      userName: 'user',
      userDisplayName: 'User',
      challenge: new Uint8Array(32),
    });

    expect(result.publicKeyHex).toBe(expectedUncompressedHex);
  });

  it('rejects a COSE key with the wrong curve', async () => {
    const { xBytes, yBytes } = generateP256KeyPair();
    const badCoseKey = cMapIntKeys([
      [1, cInt(2)],
      [3, cInt(-7)],
      [-1, cInt(2)], // crv: P-384 (unsupported)
      [-2, cBytes(xBytes)],
      [-3, cBytes(yBytes)],
    ]);
    const authData = buildAuthData(credentialId, badCoseKey);
    const attestationObject = buildAttestationObject(authData);

    (Passkey.create as jest.Mock).mockResolvedValue({
      id: b64uEncode(credentialId),
      rawId: b64uEncode(credentialId),
      response: {
        clientDataJSON: b64uEncode('{}'),
        attestationObject: b64uEncode(attestationObject),
      },
    });

    await expect(
      createPlatformPasskeyCredential({
        rpId: 'latch.finance',
        rpName: 'Latch',
        userId: new Uint8Array([9, 9]),
        userName: 'user',
        userDisplayName: 'User',
        challenge: new Uint8Array(32),
      }),
    ).rejects.toThrow(/crv/);
  });
});

describe('signWithPlatformPasskey', () => {
  afterEach(() => jest.clearAllMocks());

  it('converts a real DER ECDSA signature to a verifiable low-S compact signature', async () => {
    const { publicKey, privateKey, xBytes, yBytes } = generateP256KeyPair();
    const pubKeyBytes = concat(Uint8Array.from([0x04]), xBytes, yBytes);

    const payload = Buffer.from('some webauthn client data + authenticator data payload');
    const digest = crypto.createHash('sha256').update(payload).digest();
    // Node's crypto.sign produces a DER-encoded ECDSA signature by default —
    // exactly the format a real Secure Enclave / Keystore assertion returns,
    // and independent of the @noble/curves signing path used elsewhere.
    const derSignature = crypto.sign('sha256', payload, privateKey);

    const fakeAuthenticatorData = new Uint8Array([1, 2, 3]);
    const fakeClientDataJSON = new Uint8Array([4, 5, 6]);

    (Passkey.get as jest.Mock).mockResolvedValue({
      id: 'cred-id',
      response: {
        authenticatorData: b64uEncode(fakeAuthenticatorData),
        clientDataJSON: b64uEncode(fakeClientDataJSON),
        signature: b64uEncode(derSignature),
      },
    });

    const sig = await signWithPlatformPasskey({ rpId: 'latch.finance', challenge: new Uint8Array(32) });

    expect(sig.authenticatorData).toEqual(fakeAuthenticatorData);
    expect(sig.clientDataJSON).toEqual(fakeClientDataJSON);
    expect(sig.signature.length).toBe(64);

    // The converted compact signature must still verify, in low-S form, against
    // the exact digest Node signed over (mirrors production's prehash:false usage).
    const parsed = p256.Signature.fromBytes(sig.signature, 'compact');
    expect(parsed.hasHighS()).toBe(false);
    const valid = p256.verify(sig.signature, digest, pubKeyBytes, { prehash: false, lowS: true, format: 'compact' });
    expect(valid).toBe(true);

    // Cross-check against Node's own verifier too, so the test doesn't rely
    // solely on @noble/curves agreeing with itself.
    const derFromCompact = parsed.toBytes('der');
    const nodeValid = crypto.verify('sha256', payload, publicKey, derFromCompact);
    expect(nodeValid).toBe(true);
  });

  it('normalises a high-S signature to low-S while remaining valid', async () => {
    const { privateKey, xBytes, yBytes } = generateP256KeyPair();
    const pubKeyBytes = concat(Uint8Array.from([0x04]), xBytes, yBytes);
    const payload = Buffer.from('another payload');
    const digest = crypto.createHash('sha256').update(payload).digest();

    // Force a high-S signature regardless of what Node produced, so the
    // normalisation branch (not just the already-low-S happy path) is covered.
    let derSignature = crypto.sign('sha256', payload, privateKey);
    let parsed = p256.Signature.fromBytes(derSignature, 'der');
    if (!parsed.hasHighS()) {
      const order = p256.Point.Fn.ORDER;
      parsed = new (p256.Signature as any)(parsed.r, order - parsed.s);
      derSignature = Buffer.from(parsed.toBytes('der'));
    }
    expect(parsed.hasHighS()).toBe(true);

    (Passkey.get as jest.Mock).mockResolvedValue({
      id: 'cred-id',
      response: {
        authenticatorData: b64uEncode(new Uint8Array([1])),
        clientDataJSON: b64uEncode(new Uint8Array([2])),
        signature: b64uEncode(derSignature),
      },
    });

    const sig = await signWithPlatformPasskey({ rpId: 'latch.finance', challenge: new Uint8Array(32) });
    const normalized = p256.Signature.fromBytes(sig.signature, 'compact');
    expect(normalized.hasHighS()).toBe(false);
    expect(p256.verify(sig.signature, digest, pubKeyBytes, { prehash: false, lowS: true, format: 'compact' })).toBe(
      true,
    );
  });
});

describe('isPlatformPasskeySupported', () => {
  it('delegates to Passkey.isSupported', () => {
    (Passkey.isSupported as jest.Mock).mockReturnValue(false);
    expect(isPlatformPasskeySupported()).toBe(false);
  });
});
