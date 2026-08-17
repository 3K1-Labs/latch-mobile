/**
 * recovery-cosign.ts — collecting several guardians' signatures for one
 * recovery action.
 *
 * A guardian quorum is not a vote the chain tallies. A recovery is ONE
 * transaction carrying ONE auth entry, whose AuthPayload holds a map of
 * signatures; the threshold policy counts the entries in that map. Every
 * guardian therefore signs the *same* digest — and that digest binds the
 * entry's nonce, its expiration ledger, the exact invocation, and the
 * context_rule_ids — so the signatures have to be gathered into a single entry
 * before anything is broadcast.
 *
 * That is the same problem shared-wallet transfers already solve, so this
 * reuses their machinery rather than growing a parallel one:
 *
 *   buildAssembledOperation  freeze the transaction (pins nonce + expiration)
 *   CosignPacket             carry it between devices, gathering signatures
 *   aggregateAndSubmit       merge the signatures and broadcast
 *
 * Only two things differ from a transfer. The signatures are made under the
 * GUARDIAN rule rather than the default one, so the AuthPayload names that
 * rule's id — guardians are not signers on rule 0 and signing under 0 is
 * rejected outright. And the signer is a guardian on someone else's account, so
 * who-can-sign comes from findLocalGuardian rather than the device's own
 * accounts.
 *
 * A 1-of-N group never needs any of this: proposeRecovery and finalizeRecovery
 * submit directly. This is only reached when a group needs more than one.
 */

import { Transaction, xdr } from '@stellar/stellar-sdk';

import { STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';
import {
  addEntryToPacket,
  createPacket,
  loadPackets,
  removePacket,
  savePacket,
  type CosignPacket,
} from '@/src/lib/cosign-packet';
import { getPacket } from '@/src/lib/cosign-packet-flow';
import { createLogger } from '@/src/lib/logger';
import {
  aggregateAndSubmit,
  buildAssembledOperation,
  type CollectedEntry,
} from '@/src/lib/multisig-send';
import {
  fetchRecoveryStatus,
  findLocalGuardian,
  guardianSignerKey,
  recoveryActionOp,
  signRecoveryEntryAs,
  type GuardianIdentity,
  type LocalGuardian,
  type RecoveryRule,
} from '@/src/services/social-recovery';

const log = createLogger('recovery-cosign');

export type RecoveryAction = 'propose' | 'finalize';

export interface CreateRecoveryPacketParams {
  smartAccountAddress: string;
  rule: RecoveryRule;
  /** The guardian creating it — signs first, so a packet is never empty. */
  guardian: LocalGuardian;
  action: RecoveryAction;
  /** Replacement device, as the G-address a person can read back. */
  newDeviceAddress: string;
  newSignerPublicKeyHex: string;
}

/**
 * Freeze a recovery action and sign it as the creating guardian.
 *
 * The threshold stamped here is the rule's, read from chain when the status was
 * fetched; submitRecoveryPacket re-reads it before broadcasting, so a stale or
 * tampered value cannot lower the bar.
 */
export async function createRecoveryPacket(
  p: CreateRecoveryPacketParams,
): Promise<CosignPacket> {
  const operation = await recoveryActionOp(
    p.smartAccountAddress,
    p.rule,
    p.action,
    p.newSignerPublicKeyHex,
  );

  const assembled = await buildAssembledOperation({
    multisigAddress: p.smartAccountAddress,
    operation,
  });

  let packet = createPacket(assembled, p.smartAccountAddress, p.rule.threshold, {
    kind: 'recovery',
    recoveryMeta: {
      action: p.action,
      guardianRuleId: p.rule.ruleId,
      newDeviceAddress: p.newDeviceAddress,
    },
  });

  packet = addEntryToPacket(packet, await signPacketAs(packet, p.guardian));
  await savePacket(packet);
  log.debug('created', packet.id, p.action);
  return packet;
}

/**
 * Add this device's guardian signature to a packet someone else started.
 *
 * The guardian is re-derived from the chain rather than taken from the packet:
 * a packet is data received from another device, so what it claims about who
 * may sign is not evidence. The rule it names is only used to locate the
 * matching guardian entry.
 */
export async function approveRecoveryPacket(
  id: string,
  identity: GuardianIdentity,
): Promise<CosignPacket> {
  const packet = await getPacket(id);
  if (!packet) throw new Error('That recovery request could not be found.');
  if (packet.kind !== 'recovery') throw new Error('That request is not a recovery.');

  const local = await resolveGuardian(packet, identity);

  const signerKey = guardianSignerKey(local);
  if (packet.signatures.some((s: CollectedEntry) => s.signerKey === signerKey)) {
    throw new Error('You have already approved this recovery.');
  }

  const updated = addEntryToPacket(packet, await signPacketAs(packet, local));
  await savePacket(updated);
  return updated;
}

/**
 * Broadcast once the quorum is met, then drop the packet.
 *
 * The threshold is re-read from the chain rather than trusted from the packet —
 * the same defence in depth the transfer flow applies, and it matters more here
 * because meeting it hands someone a key on another person's wallet.
 */
export async function submitRecoveryPacket(
  id: string,
  identity: GuardianIdentity,
): Promise<{ hash: string }> {
  const packet = await getPacket(id);
  if (!packet) throw new Error('That recovery request could not be found.');
  if (packet.kind !== 'recovery') throw new Error('That request is not a recovery.');

  const local = await resolveGuardian(packet, identity);
  if (packet.signatures.length < local.rule.threshold) {
    throw new Error(
      `Not enough guardians have agreed yet (${packet.signatures.length}/${local.rule.threshold}).`,
    );
  }

  const { hash } = await aggregateAndSubmit(packet.unsignedTxXdr, packet.signatures);
  await removePacket(id);
  log.debug('submitted', hash);
  return { hash };
}

/** Recovery packets held on this device, newest first. */
export async function listRecoveryPackets(): Promise<CosignPacket[]> {
  const all = await loadPackets();
  return all
    .filter((p) => p.kind === 'recovery')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Whether this device holds a guardian key that has not signed yet. */
export async function canApproveRecovery(
  packet: CosignPacket,
  identity: GuardianIdentity,
): Promise<boolean> {
  try {
    const local = await resolveGuardian(packet, identity);
    return !packet.signatures.some((s: CollectedEntry) => s.signerKey === guardianSignerKey(local));
  } catch {
    return false;
  }
}

// ─── internals ────────────────────────────────────────────────────────────────

async function resolveGuardian(
  packet: CosignPacket,
  identity: GuardianIdentity,
): Promise<LocalGuardian> {
  const status = await fetchRecoveryStatus(packet.smartAccountAddress);
  const match = await findLocalGuardian(status, identity);
  if (!match.ok) throw new Error('You are not a guardian for that account.');

  const expected = packet.recoveryMeta?.guardianRuleId;
  if (expected !== undefined && match.local.rule.ruleId !== expected) {
    throw new Error('Your guardian access is on a different group than this request.');
  }
  return match.local;
}

/**
 * Sign the packet's single shared auth entry.
 *
 * The entry is taken from the frozen transaction rather than re-simulated: a
 * fresh simulation mints a new nonce, which would invalidate every signature
 * already collected.
 */
async function signPacketAs(
  packet: CosignPacket,
  local: LocalGuardian,
): Promise<CollectedEntry> {
  const tx = new Transaction(packet.unsignedTxXdr, STELLAR_NETWORK_PASSPHRASE);
  const op = tx.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] } | undefined;
  const entry = op?.auth?.[0];
  if (!entry) throw new Error('This recovery request has no signature slot.');

  return signRecoveryEntryAs(entry, local);
}
