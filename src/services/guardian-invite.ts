/**
 * guardian-invite.ts — proving a guardian holds the key before they are added.
 *
 * Adding a guardian used to be one-way: the owner pasted an address or a
 * guardian code and the app took it on faith. That is safe in the narrow sense
 * — a guardian can spend nothing, so a wrong entry cannot lose money — but it
 * fails in the worst possible way. A mistyped code, a stale key, or a person
 * who never learns they are a guardian all produce an account that LOOKS
 * protected and only reveals otherwise on the day recovery is needed.
 *
 * So the owner now issues a challenge, the guardian signs it, and the owner
 * verifies that signature before the key goes anywhere near a context rule.
 * Confirming three things at once:
 *
 *   - the key is real and well formed
 *   - the guardian actually holds its private half, right now
 *   - a person on the other end knows they have been asked
 *
 * The challenge/response codec is the one device pairing already uses
 * (src/lib/pairing-payload.ts), which handles ed25519 and WebAuthn alike. Only
 * the envelope and the challenge bookkeeping are new.
 *
 * Delegated (C-address) guardians are deliberately outside this: a smart
 * account has no single key to sign with, and its authorisation is a nested
 * auth entry rather than a detached signature. They are still added directly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

import { getNetworkId, PASSKEY_RP_ID } from '@/src/constants/config';
import { createLogger } from '@/src/lib/logger';
import {
  decodeSignedChallenge,
  encodeSignedChallenge,
  signChallengeEd25519,
  signChallengePasskey,
  verifySignedChallenge,
  type SignedPairingChallenge,
} from '@/src/lib/pairing-payload';
import { getStoredKeyDataHex } from '@/src/lib/passkey-webauthn';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import type { Guardian } from '@/src/services/social-recovery';

const log = createLogger('guardian-invite');

export const INVITE_PREFIX = 'latch-guardian-invite:v1:';
export const RESPONSE_PREFIX = 'latch-guardian-accept:v1:';
export const START_PREFIX = 'latch-guardian-recover:v1:';

/**
 * Classify a payload someone was sent, so a single field can route it.
 *
 * Guardians receive three unrelated things — an invitation to the role, a
 * request to approve a recovery, and (rarely) an account address to look up —
 * and cannot be expected to know which is which. Every payload already carries
 * a distinct prefix, so this is dispatch rather than guesswork.
 */
export type GuardianPayloadKind =
  | 'invite'
  | 'reply'
  | 'start-recovery'
  | 'recovery-request'
  | 'account'
  | 'unknown';

export function classifyGuardianPayload(raw: string): GuardianPayloadKind {
  const text = raw.trim();
  if (text.startsWith(INVITE_PREFIX)) return 'invite';
  if (text.startsWith(RESPONSE_PREFIX)) return 'reply';
  if (text.startsWith(START_PREFIX)) return 'start-recovery';
  if (/^C[A-Z2-7]{55}$/.test(text)) return 'account';
  // Cosign packets are base64 JSON; recognised by decoding rather than by a
  // prefix, since that format predates this flow.
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64').toString('utf-8'));
    if (parsed && typeof parsed === 'object' && 'unsignedTxXdr' in parsed) {
      return 'recovery-request';
    }
  } catch {
    // Not a packet.
  }
  return 'unknown';
}

/** Where issued challenges live until the response comes back. */
const PENDING_KEY = 'latch_guardian_invites';
const DRAFT_KEY = 'latch_guardian_draft';

/**
 * How long an invite stays valid. Long enough that a guardian can reply the
 * next day, short enough that a leaked invite is not indefinitely replayable.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingInvite {
  id: string;
  challengeB64: string;
  createdAt: number;
}

interface InviteBody {
  v: 1;
  id: string;
  /** 32 random bytes, base64. What the guardian signs. */
  challenge: string;
  network: 'testnet' | 'mainnet';
  /** The account asking, for display. Absent when recovery is not set up yet. */
  account?: string;
}

interface ResponseBody {
  v: 1;
  id: string;
  responsePubkey: string;
  responseSignatureB64: string;
}

// ─── owner side ───────────────────────────────────────────────────────────────

/**
 * Issue an invite. The challenge is kept locally; only its bytes travel.
 *
 * Randomness comes from `crypto.getRandomValues`, which the app polyfills at
 * startup — the same source device pairing uses for its challenge.
 */
export async function createGuardianInvite(account?: string): Promise<string> {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const id = Buffer.from(challenge.slice(0, 6)).toString('hex');
  const challengeB64 = Buffer.from(challenge).toString('base64');

  const pending = await loadPending();
  pending.push({ id, challengeB64, createdAt: Date.now() });
  await savePending(pending);

  const body: InviteBody = { v: 1, id, challenge: challengeB64, network: getNetworkId(), account };
  log.debug('issued invite', id);
  return INVITE_PREFIX + Buffer.from(JSON.stringify(body), 'utf-8').toString('base64');
}

/**
 * Verify a guardian's reply and turn it into a Guardian ready to be added.
 *
 * Throws rather than returning null: every failure here is something the owner
 * must see and act on, and silently dropping one would put them back in exactly
 * the state this exists to prevent.
 */
export async function verifyGuardianResponse(raw: string): Promise<Guardian> {
  const text = raw.trim();
  if (!text.startsWith(RESPONSE_PREFIX)) {
    throw new Error('That is not a guardian reply.');
  }

  let body: ResponseBody;
  try {
    body = JSON.parse(
      Buffer.from(text.slice(RESPONSE_PREFIX.length), 'base64').toString('utf-8'),
    ) as ResponseBody;
  } catch {
    throw new Error('That reply is damaged — ask them to send it again.');
  }

  const pending = await loadPending();
  const invite = pending.find((p) => p.id === body.id);
  if (!invite) {
    throw new Error('That reply does not match an invite from this device, or it has expired.');
  }

  const challenge = new Uint8Array(Buffer.from(invite.challengeB64, 'base64'));
  const signed = decodeSignedChallenge(body.responsePubkey, body.responseSignatureB64);

  if (!verifySignedChallenge(challenge, signed)) {
    throw new Error('That reply did not verify — it was not signed by the key it claims.');
  }

  // Single use. A verified challenge that stays valid is a replayable one.
  await savePending(pending.filter((p) => p.id !== body.id));

  return toGuardianFromSigned(signed);
}

function toGuardianFromSigned(signed: SignedPairingChallenge): Guardian {
  switch (signed.kind) {
    case 'ed25519':
      return {
        address: publicKeyHexToAddress(signed.publicKeyHex),
        kind: 'ed25519',
        publicKeyHex: signed.publicKeyHex.toLowerCase(),
      };
    case 'webauthn':
      return {
        address: `passkey:${signed.keyDataHex.slice(0, 16)}`,
        kind: 'passkey',
        keyDataHex: signed.keyDataHex.toLowerCase(),
      };
    case 'delegated':
      return { address: signed.address, kind: 'delegated' };
  }
}

function publicKeyHexToAddress(publicKeyHex: string): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(publicKeyHex, 'hex'));
}

// ─── guardian side ────────────────────────────────────────────────────────────

export interface InviteDetails {
  id: string;
  network: 'testnet' | 'mainnet';
  account?: string;
}

/** Read an invite without acting on it, so the guardian can see what they are agreeing to. */
export function readGuardianInvite(raw: string): InviteDetails {
  const text = raw.trim();
  if (!text.startsWith(INVITE_PREFIX)) {
    throw new Error('That is not a guardian invite.');
  }
  let body: InviteBody;
  try {
    body = JSON.parse(
      Buffer.from(text.slice(INVITE_PREFIX.length), 'base64').toString('utf-8'),
    ) as InviteBody;
  } catch {
    throw new Error('That invite is damaged — ask them to send it again.');
  }
  if (body.network !== getNetworkId()) {
    throw new Error(`That invite is for ${body.network}, and this wallet is on ${getNetworkId()}.`);
  }
  return { id: body.id, network: body.network, account: body.account };
}

/**
 * Sign the invite's challenge and produce the reply.
 *
 * Signs with whatever this device actually has: a seed wallet uses its derived
 * key, a passkey wallet raises the biometric prompt. Either way the owner ends
 * up holding proof that this device can sign, which is the only thing that
 * makes the guardian entry worth adding.
 */
export async function acceptGuardianInvite(
  raw: string,
  identity: { mnemonic: string | null; accountIndex: number },
): Promise<string> {
  const text = raw.trim();
  const details = readGuardianInvite(text);

  const body = JSON.parse(
    Buffer.from(text.slice(INVITE_PREFIX.length), 'base64').toString('utf-8'),
  ) as InviteBody;
  const challenge = new Uint8Array(Buffer.from(body.challenge, 'base64'));

  let signed: SignedPairingChallenge;
  if (identity.mnemonic) {
    const { keypair } = deriveWalletAtIndex(identity.mnemonic, identity.accountIndex);
    signed = signChallengeEd25519(challenge, keypair);
  } else {
    const keyDataHex = await getStoredKeyDataHex(identity.accountIndex);
    if (!keyDataHex) {
      throw new Error('This device has no key to accept with.');
    }
    signed = await signChallengePasskey(challenge, keyDataHex, PASSKEY_RP_ID);
  }

  const { responsePubkey, responseSignatureB64 } = encodeSignedChallenge(signed);
  const reply: ResponseBody = { v: 1, id: details.id, responsePubkey, responseSignatureB64 };
  return RESPONSE_PREFIX + Buffer.from(JSON.stringify(reply), 'utf-8').toString('base64');
}

// ─── pending invite storage ───────────────────────────────────────────────────

async function loadPending(): Promise<PendingInvite[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const all = raw ? (JSON.parse(raw) as PendingInvite[]) : [];
    // Drop expired ones on every read, so a stale challenge cannot be replayed
    // and the list cannot grow without bound.
    const cutoff = Date.now() - INVITE_TTL_MS;
    return all.filter((p) => p.createdAt > cutoff);
  } catch {
    return [];
  }
}

async function savePending(invites: PendingInvite[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(invites));
}

// ─── setup draft ──────────────────────────────────────────────────────────────

export interface GuardianDraft {
  account: string;
  guardians: Guardian[];
  delayLedgers: number;
}

export async function loadGuardianDraft(account: string): Promise<GuardianDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as GuardianDraft;
    return draft.account === account ? draft : null;
  } catch {
    return null;
  }
}

export async function saveGuardianDraft(draft: GuardianDraft): Promise<void> {
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export async function clearGuardianDraft(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_KEY);
}

export interface StartRecoveryRequest {
  account: string;
  newDeviceAddress: string;
}

export function encodeStartRecovery(req: StartRecoveryRequest): string {
  return START_PREFIX + Buffer.from(JSON.stringify(req), 'utf-8').toString('base64');
}

export function decodeStartRecovery(raw: string): StartRecoveryRequest {
  const text = raw.trim();
  if (!text.startsWith(START_PREFIX)) throw new Error('That is not a recovery request.');
  const parsed = JSON.parse(
    Buffer.from(text.slice(START_PREFIX.length), 'base64').toString('utf-8'),
  ) as StartRecoveryRequest;
  if (!parsed.account || !parsed.newDeviceAddress) {
    throw new Error('That recovery request is incomplete.');
  }
  return parsed;
}
