/**
 * cosign-packet-flow.ts — orchestration for the backend-free (P2P) multisig
 * transfer flow (docs/multisig-p2p-cosign.md), EXTERNAL signer model.
 *
 * Shared wallets register members' device keys as External signers on the
 * Default context rule (rule id 0). A transfer produces ONE auth entry on the
 * multisig; each member signs THAT entry with their own device key, and the
 * signatures are merged via aggregateAuthEntries at submit. So each device
 * signs with its own personal account's key (no per-member entry to locate).
 *
 * No backend, no token. Network calls are the read-only simulation (build),
 * the AUTHORITATIVE on-chain threshold read (gate), and the final submit.
 *
 * SECURITY — threshold authority: the approval threshold is ALWAYS read from
 * chain (api/account-admin.fetchRuleThreshold), never from a locally-cached
 * field. A cached field that drifted from chain is what let a 1-of-N transfer
 * through (see the multisig audit). We read it at packet creation AND re-check
 * it at submit, so the client can never broadcast a sub-threshold transfer.
 */

import * as SecureStore from 'expo-secure-store';

import { fetchRuleThreshold } from '@/src/api/account-admin';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import {
  addEntryToPacket,
  createPacket,
  deserializePacket,
  loadPackets,
  removePacket,
  savePacket,
  type CosignPacket,
  type SwapMeta,
} from '@/src/lib/cosign-packet';
import {
  aggregateAndSubmit,
  buildAssembledOperation,
  buildAssembledTransfer,
  signSharedEntry,
} from '@/src/lib/multisig-send';
import { getPasskeyStorageKeys, useWalletStore, type WalletAccount } from '@/src/store/wallet';
import { type xdr } from '@stellar/stellar-sdk';

/**
 * On-chain id of the Default context rule that holds the member signer set +
 * threshold policy. The factory's account constructor creates it first, so it
 * is id 0 (confirmed by the contract tests and the [u32(0)] context_rule_ids
 * the signing primitives embed). Transfers authorize under this rule.
 */
const DEFAULT_RULE_ID = 0;

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

/**
 * The authoritative approval threshold for this shared wallet, read live from
 * the on-chain threshold policy. Throws if it can't be confirmed — we refuse
 * to gate a transfer on a guessed value.
 */
export async function onChainThreshold(multisigAddress: string): Promise<number> {
  try {
    const t = await fetchRuleThreshold(simParams(), multisigAddress, DEFAULT_RULE_ID);
    if (!Number.isFinite(t) || t < 1) {
      throw new Error(`on-chain threshold read returned ${t}`);
    }
    return t;
  } catch (err) {
    throw new Error(
      `Could not confirm this multisig wallet's approval threshold on-chain. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export interface SignerMatch {
  account: WalletAccount;
  /** Array position in the store — the passkey SecureStore slot. */
  listIndex: number;
}

function isSignable(a: WalletAccount): boolean {
  return !a.isMultisig && !!a.smartAccountAddress && (a.index >= 0 ? !!a.gAddress : true);
}

/**
 * The personal account on THIS device whose key signs shared-wallet entries.
 * Prefers the active account when it's itself signable, else the first
 * signable personal account. (Multisig accounts have no local key.)
 */
export function pickSigner(): SignerMatch | null {
  const { accounts, activeAccountIndex } = useWalletStore.getState();
  const active = accounts[activeAccountIndex];
  if (active && isSignable(active)) return { account: active, listIndex: activeAccountIndex };
  const i = accounts.findIndex(isSignable);
  return i >= 0 ? { account: accounts[i], listIndex: i } : null;
}

/**
 * True when signing on this device will itself raise an OS biometric prompt.
 *
 * That happens for passkey signers whose private key was stored with
 * requireAuthentication (see storePasskeyCredential) — the Secure Enclave /
 * Keystore gates every read. An app-level biometric gate on top of that shows
 * Face ID twice for one action, the second landing the instant the first
 * succeeds. PIN-only passkey users store the key WITHOUT that flag and get no
 * prompt on read, so for them the app-level gate is the only one and must stay.
 * Mnemonic accounts sign from the in-memory seed and never prompt.
 */
export async function signingRaisesBiometricPrompt(): Promise<boolean> {
  const me = pickSigner();
  if (!me || me.account.gAddress) return false;
  const keys = getPasskeyStorageKeys(me.listIndex);
  const requiresBiometric = await SecureStore.getItemAsync(keys.requiresBiometric);
  return requiresBiometric !== 'false';
}

/** This device's External signer-key id (ed25519 pubkey hex or passkey keyDataHex). */
export async function getMySignerKey(): Promise<string | null> {
  const me = pickSigner();
  if (!me) return null;
  if (me.account.gAddress && me.account.publicKeyHex) return me.account.publicKeyHex;
  return (await SecureStore.getItemAsync(getPasskeyStorageKeys(me.listIndex).keyDataHex)) ?? null;
}

/**
 * Every local personal account's on-chain signer key (hex), deduped.
 *
 * Unlike pickSigner()/getMySignerKey(), which resolve to a single "active"
 * signer for transaction-signing flows, membership discovery needs the union
 * across every signable account on this device: a creator announces to
 * whichever key it read as a member's device signer on-chain, and that need
 * not be the account that happens to be active locally right now.
 */
export async function getAllSignerKeys(): Promise<string[]> {
  const { accounts } = useWalletStore.getState();
  const keys = new Set<string>();
  for (let listIndex = 0; listIndex < accounts.length; listIndex++) {
    const account = accounts[listIndex];
    if (!isSignable(account)) continue;
    if (account.gAddress && account.publicKeyHex) {
      keys.add(account.publicKeyHex);
      continue;
    }
    const keyDataHex = await SecureStore.getItemAsync(
      getPasskeyStorageKeys(listIndex).keyDataHex,
    );
    if (keyDataHex) keys.add(keyDataHex);
  }
  return [...keys];
}

export interface CreateTransferPacketParams {
  /** The active multisig (shared wallet) account funds move FROM. */
  multisigAccount: WalletAccount;
  sacContractId: string;
  destinationAddress: string;
  amount: string;
}

/**
 * Build the assembled transfer, wrap it in a packet stamped with the live
 * on-chain threshold, sign with this device's key, persist, and return.
 */
export async function createTransferPacket(p: CreateTransferPacketParams): Promise<CosignPacket> {
  const { multisigAccount } = p;
  if (!multisigAccount.smartAccountAddress) {
    throw new Error('This multisig wallet is not deployed yet.');
  }
  const me = pickSigner();
  if (!me) {
    throw new Error('No personal account on this device to sign with.');
  }

  // Authoritative threshold from chain — never the cached account field.
  const threshold = await onChainThreshold(multisigAccount.smartAccountAddress);

  const assembled = await buildAssembledTransfer({
    multisigAddress: multisigAccount.smartAccountAddress,
    sacContractId: p.sacContractId,
    destinationAddress: p.destinationAddress,
    amount: p.amount,
  });

  let packet = createPacket(assembled, multisigAccount.smartAccountAddress, threshold);
  const entry = await signSharedEntry(
    packet.unsignedTxXdr,
    me.account,
    me.listIndex,
    useWalletStore.getState().mnemonic,
  );
  packet = addEntryToPacket(packet, entry);
  await savePacket(packet);
  return packet;
}

export async function getPacket(id: string): Promise<CosignPacket | null> {
  const all = await loadPackets();
  return all.find((p) => p.id === id) ?? null;
}

/** Parse + persist a packet received from another device (paste / share / QR). */
export async function importPacket(raw: string): Promise<CosignPacket> {
  const packet = deserializePacket(raw.trim());
  const existing = await getPacket(packet.id);
  // Merge: keep whichever copy has more signatures (handles round-tripping).
  const merged =
    existing && existing.signatures.length > packet.signatures.length ? existing : packet;
  await savePacket(merged);
  return merged;
}

/**
 * Sign this device's key into an existing packet and persist. Throws if this
 * device has no signer or has already signed.
 */
export async function approvePacket(id: string): Promise<CosignPacket> {
  const packet = await getPacket(id);
  if (!packet) throw new Error('Co-sign packet not found.');

  const me = pickSigner();
  if (!me) throw new Error('No personal account on this device to sign with.');

  const myKey = await getMySignerKey();
  if (myKey && packet.signatures.some((s) => s.signerKey === myKey)) {
    throw new Error('You have already approved this transfer.');
  }

  const entry = await signSharedEntry(
    packet.unsignedTxXdr,
    me.account,
    me.listIndex,
    useWalletStore.getState().mnemonic,
  );
  const updated = addEntryToPacket(packet, entry);
  await savePacket(updated);
  return updated;
}

/**
 * Submit a packet once threshold is met, then drop it from local storage.
 * The gate re-reads the threshold from chain — defense in depth against a
 * packet whose stamped threshold is wrong or tampered.
 */
export async function submitPacket(id: string): Promise<{ hash: string }> {
  const packet = await getPacket(id);
  if (!packet) throw new Error('Co-sign packet not found.');

  const threshold = await onChainThreshold(packet.smartAccountAddress);
  if (packet.signatures.length < threshold) {
    throw new Error(`Not enough approvals yet (${packet.signatures.length}/${threshold}).`);
  }

  const result = await aggregateAndSubmit(packet.unsignedTxXdr, packet.signatures);
  await removePacket(id);
  return { hash: result.hash };
}

/** Whether this device can still add an approval (has a signer + hasn't signed). */
export async function canApprove(packet: CosignPacket): Promise<boolean> {
  const myKey = await getMySignerKey();
  if (!myKey) return false;
  return !packet.signatures.some((s) => s.signerKey === myKey);
}

/**
 * Of the given on-chain signer keys (raw keyDataHex), return the subset that has
 * approved this packet. P2P signatures carry the raw signer key directly, so
 * this is a plain membership check (the backend variant matches by blind id).
 */
export function approvedKeyData(packet: CosignPacket, keyDataHexList: string[]): Set<string> {
  const signed = new Set(packet.signatures.map((s) => s.signerKey));
  return new Set(keyDataHexList.filter((k) => signed.has(k)));
}

export interface CreateSwapPacketParams {
  multisigAccount: WalletAccount;
  /** Pre-built swap operation from a SwapProvider.buildSwapOperation call. */
  operation: xdr.Operation;
  swapMeta: SwapMeta;
}

/**
 * Build an assembled swap operation, wrap in a packet, sign with this device's
 * member key, persist, and return. Mirrors createTransferPacket but uses the
 * pre-built DEX router operation instead of constructing a SAC transfer.
 */
export async function createSwapPacket(p: CreateSwapPacketParams): Promise<CosignPacket> {
  const { multisigAccount, operation, swapMeta } = p;
  if (!multisigAccount.smartAccountAddress) {
    throw new Error('This multisig wallet is not deployed yet.');
  }
  const me = pickSigner();
  if (!me) throw new Error('No personal account on this device to sign with.');

  const threshold = await onChainThreshold(multisigAccount.smartAccountAddress);

  const assembled = await buildAssembledOperation({
    multisigAddress: multisigAccount.smartAccountAddress,
    operation,
  });

  let packet = createPacket(assembled, multisigAccount.smartAccountAddress, threshold, {
    kind: 'swap',
    swapMeta,
  });
  const entry = await signSharedEntry(
    packet.unsignedTxXdr,
    me.account,
    me.listIndex,
    useWalletStore.getState().mnemonic,
  );
  packet = addEntryToPacket(packet, entry);
  await savePacket(packet);
  return packet;
}
