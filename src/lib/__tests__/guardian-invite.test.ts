/**
 * The guardian invite round-trip: challenge → signature → verification.
 *
 * Exercises the codec directly rather than the service, which needs
 * AsyncStorage and app config. What matters here is that a reply proves
 * possession and that a forged one does not — the storage bookkeeping around it
 * is ordinary.
 */
import { Keypair } from '@stellar/stellar-sdk';

import {
  decodeSignedChallenge,
  encodeSignedChallenge,
  signChallengeEd25519,
  verifySignedChallenge,
} from '../pairing-payload';

const challenge = () => new Uint8Array(32).fill(7);

describe('guardian invite round-trip', () => {
  it('verifies a reply signed by the key it claims', () => {
    const guardian = Keypair.random();
    const signed = signChallengeEd25519(challenge(), guardian);

    // Survives the wire encoding the invite envelope uses.
    const { responsePubkey, responseSignatureB64 } = encodeSignedChallenge(signed);
    const decoded = decodeSignedChallenge(responsePubkey, responseSignatureB64);

    expect(verifySignedChallenge(challenge(), decoded)).toBe(true);
    expect(decoded.kind).toBe('ed25519');
  });

  /**
   * The point of the whole exercise: claiming someone else's key without
   * holding it must fail. Otherwise an invite reply proves nothing and the
   * owner is back to taking a pasted address on faith.
   */
  it('rejects a reply that claims a key it does not hold', () => {
    const attacker = Keypair.random();
    const victim = Keypair.random();

    const signed = signChallengeEd25519(challenge(), attacker);
    const forged = {
      ...signed,
      publicKeyHex: Buffer.from(victim.rawPublicKey()).toString('hex'),
    };

    expect(verifySignedChallenge(challenge(), forged as typeof signed)).toBe(false);
  });

  /** A signature is bound to its challenge, so it cannot be replayed. */
  it('rejects a reply signed over a different challenge', () => {
    const guardian = Keypair.random();
    const signed = signChallengeEd25519(challenge(), guardian);

    const otherChallenge = new Uint8Array(32).fill(9);
    expect(verifySignedChallenge(otherChallenge, signed)).toBe(false);
  });
});

/**
 * The unified inbox rests entirely on payloads being distinguishable without
 * being told what they are. If two kinds ever collide, a guardian pastes an
 * invitation and gets an error about recovery requests.
 */
describe('guardian payload classification', () => {
  const INVITE_PREFIX = 'latch-guardian-invite:v1:';
  const RESPONSE_PREFIX = 'latch-guardian-accept:v1:';

  const classify = (raw: string): string => {
    const text = raw.trim();
    if (text.startsWith(INVITE_PREFIX)) return 'invite';
    if (text.startsWith(RESPONSE_PREFIX)) return 'reply';
    if (/^C[A-Z2-7]{55}$/.test(text)) return 'account';
    try {
      const parsed = JSON.parse(Buffer.from(text, 'base64').toString('utf-8'));
      if (parsed && typeof parsed === 'object' && 'unsignedTxXdr' in parsed) {
        return 'recovery-request';
      }
    } catch {
      /* not a packet */
    }
    return 'unknown';
  };

  it('tells the four payload kinds apart', () => {
    const packet = Buffer.from(
      JSON.stringify({ v: 1, unsignedTxXdr: 'AAAA', signatures: [] }),
    ).toString('base64');

    expect(classify(`${INVITE_PREFIX}abc`)).toBe('invite');
    expect(classify(`${RESPONSE_PREFIX}abc`)).toBe('reply');
    expect(classify('CAUSIP3BETIRVFUGN6DKE4ZDLWYVOUMQBZCVR4K2EXVSQDERLVP5FE4G')).toBe('account');
    expect(classify(packet)).toBe('recovery-request');
  });

  /** Whitespace from a messaging app must not change what something is. */
  it('is not confused by surrounding whitespace', () => {
    expect(classify(`\n  ${INVITE_PREFIX}abc \n`)).toBe('invite');
  });

  it('reports anything else as unknown rather than guessing', () => {
    expect(classify('hello')).toBe('unknown');
    expect(classify('GDH3GVIFXHMCOIMCGXESRXUROOGZWGEGNMJSTX4X3Q4EBGEHQMJGTDW3')).toBe('unknown');
  });
});

describe('start-recovery payload', () => {
  const START_PREFIX = 'latch-guardian-recover:v1:';

  const encode = (req: { account: string; newDeviceAddress: string }) =>
    START_PREFIX + Buffer.from(JSON.stringify(req), 'utf-8').toString('base64');

  const decode = (raw: string) => {
    const text = raw.trim();
    if (!text.startsWith(START_PREFIX)) throw new Error('not a recovery request');
    const parsed = JSON.parse(
      Buffer.from(text.slice(START_PREFIX.length), 'base64').toString('utf-8'),
    );
    if (!parsed.account || !parsed.newDeviceAddress) throw new Error('incomplete');
    return parsed;
  };

  it('round-trips both addresses', () => {
    const req = {
      account: 'CAUSIP3BETIRVFUGN6DKE4ZDLWYVOUMQBZCVR4K2EXVSQDERLVP5FE4G',
      newDeviceAddress: 'GDH3GVIFXHMCOIMCGXESRXUROOGZWGEGNMJSTX4X3Q4EBGEHQMJGTDW3',
    };
    expect(decode(encode(req))).toEqual(req);
  });

  it('rejects a request missing the new device', () => {
    const bad = START_PREFIX + Buffer.from(JSON.stringify({ account: 'C…' })).toString('base64');
    expect(() => decode(bad)).toThrow();
  });

  it('does not collide with the other payload kinds', () => {
    const req = encode({ account: 'C1', newDeviceAddress: 'G1' });
    expect(req.startsWith('latch-guardian-invite:v1:')).toBe(false);
    expect(req.startsWith('latch-guardian-accept:v1:')).toBe(false);
  });
});
