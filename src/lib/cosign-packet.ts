/**
 * cosign-packet.ts — the backend-free transport artifact for multisig
 * transfers (see docs/multisig-p2p-cosign.md).
 *
 * A Co-sign Packet (CSP) is a self-contained blob members pass to each other
 * (file / share-sheet / QR) instead of a server request. It is the off-chain
 * CosignRequest shape minus the backend, generated client-side. The signing
 * and submit logic is shared with the backend transport via the
 * transport-agnostic core in multisig-send.ts.
 *
 * Persisted in AsyncStorage (NOT SecureStore): packets exceed SecureStore's
 * ~2KB Android value limit and contain no secrets — just an assembled tx and
 * public partial signatures, identical to what lands on-chain at submit.
 *
 * SECURITY: there is no trusted amount/destination field. Always derive the
 * human summary from `unsignedTxXdr` via decodeTransferSummary — a relayer
 * can't alter the bytes without invalidating every signature.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address, Operation, scValToNative, Transaction } from '@stellar/stellar-sdk';
import QuickCrypto from 'react-native-quick-crypto';

import { getNetworkId, STELLAR_NETWORK_PASSPHRASE } from '@/src/constants/config';
import type { AssembledTransfer, CollectedEntry } from '@/src/lib/multisig-send';

const PACKET_VERSION = 1 as const;
const STORE_KEY = 'latch_cosign_packets';
export interface SwapMeta {
  fromCode: string;
  toCode: string;
  amountIn: string;
  amountOut: string;
}

export interface CosignPacket {
  v: typeof PACKET_VERSION;
  /** Client-generated id; dedupe + display only (not security-bearing). */
  id: string;
  network: 'testnet' | 'mainnet';
  /** The multisig C-address funds move FROM. */
  smartAccountAddress: string;
  /** Assembled tx: resource fees + pinned auth entries (nonce + expiration). */
  unsignedTxXdr: string;
  /** Approvals required before submit. */
  threshold: number;
  /** Collected per-member entries; grows as members sign. */
  signatures: CollectedEntry[];
  /** Ledger the pinned signatures expire at (mirrors signatureExpirationLedger). */
  expiresLedger: number;
  createdAt: string;
  /** Operation kind — 'transfer' (default) or 'swap'. */
  kind?: 'transfer' | 'swap';
  /** Present when kind === 'swap'; display-only (security gate is the XDR auth entry). */
  swapMeta?: SwapMeta;
  /**
   * On-chain tx hash once the request has been broadcast (backend transport
   * only). Lets a member still viewing the request detect that someone else met
   * the threshold and executed it, so they can be shown the success screen.
   */
  submittedTxHash?: string | null;
}

export interface TransferSummary {
  sacContractId: string;
  /** C-address funds leave (must equal smartAccountAddress). */
  from: string;
  to: string;
  /** Amount in SAC base units (7 decimals), as a decimal string. */
  amountBaseUnits: string;
}

// ─── Construction ──────────────────────────────────────────────────────────

function newId(): string {
  return Buffer.from(QuickCrypto.randomBytes(16)).toString('hex');
}

/** Wrap a freshly built assembled operation into a new packet (no signatures). */
export function createPacket(
  assembled: AssembledTransfer,
  smartAccountAddress: string,
  threshold: number,
  options?: { kind?: CosignPacket['kind']; swapMeta?: SwapMeta },
): CosignPacket {
  return {
    v: PACKET_VERSION,
    id: newId(),
    network: getNetworkId(),
    smartAccountAddress,
    unsignedTxXdr: assembled.unsignedTxXdr,
    threshold,
    signatures: [],
    expiresLedger: assembled.expiresLedger,
    createdAt: new Date().toISOString(),
    kind: options?.kind ?? 'transfer',
    swapMeta: options?.swapMeta,
  };
}

/**
 * Append a member entry, deduping by signerKey (a member can't double-sign).
 * Returns a NEW packet; the input is not mutated.
 */
export function addEntryToPacket(packet: CosignPacket, entry: CollectedEntry): CosignPacket {
  if (packet.signatures.some((s) => s.signerKey === entry.signerKey)) return packet;
  return { ...packet, signatures: [...packet.signatures, entry] };
}

export function isThresholdMet(packet: CosignPacket): boolean {
  return packet.signatures.length >= packet.threshold;
}

// ─── Serialization ───────────────────────────────────────────────────────

export function serializePacket(packet: CosignPacket): string {
  return JSON.stringify(packet);
}

/** Parse + validate a packet from untrusted input (scanned QR / imported file). */
export function deserializePacket(raw: string): CosignPacket {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('Invalid co-sign packet: not valid JSON');
  }
  const p = obj as Partial<CosignPacket>;
  if (p.v !== PACKET_VERSION) {
    throw new Error(`Unsupported co-sign packet version: ${String(p.v)}`);
  }
  if (
    typeof p.id !== 'string' ||
    typeof p.smartAccountAddress !== 'string' ||
    typeof p.unsignedTxXdr !== 'string' ||
    typeof p.threshold !== 'number' ||
    typeof p.expiresLedger !== 'number' ||
    !Array.isArray(p.signatures)
  ) {
    throw new Error('Invalid co-sign packet: missing or malformed fields');
  }
  // Confirm the tx actually decodes for the active network — fail early, not at sign time.
  try {
    new Transaction(p.unsignedTxXdr, STELLAR_NETWORK_PASSPHRASE);
  } catch {
    throw new Error('Invalid co-sign packet: transaction does not decode for this network');
  }
  return obj as CosignPacket;
}

// ─── Deep-link codec (latch://cosign?d=<base64url packet>) ──────────────────

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encode a packet as a base64url string for the `d` query param of a
 * latch://cosign deep link. base64url (no `+ / =`) is URL-safe, so chat-app
 * link detection doesn't truncate or mangle it. Packet JSON is pure ASCII, so
 * btoa round-trips it without TextEncoder.
 */
export function encodePacketParam(packet: CosignPacket): string {
  return btoa(serializePacket(packet)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode the `d` param back to packet JSON (pass to importPacket). Hand-rolled
 * base64url→bytes so it doesn't depend on atob/Buffer — the RN Buffer polyfill
 * is unreliable for base64 (see reference: RN toXDR base64 bug). ASCII output.
 */
export function decodePacketParam(param: string): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < param.length; i++) {
    const val = B64URL.indexOf(param[i]);
    if (val < 0) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

// ─── Summary (derive from the signed bytes — never trust a sidecar field) ───

/**
 * Decode an ScSymbol (contract function name) to a string WITHOUT
 * Buffer.prototype.toString(), which the RN/Hermes Buffer polyfill renders as
 * comma-joined decimal bytes (e.g. "116,114,97,…" instead of "transfer").
 * Symbol names are ASCII, so a fromCharCode walk is exact. Same polyfill flaw as
 * the toXDR('base64') encode bug fixed in multisig-send.ts.
 */
function readScSymbol(sym: unknown): string {
  if (typeof sym === 'string') return sym;
  const bytes = sym instanceof Uint8Array ? sym : new Uint8Array(sym as ArrayBufferLike);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * Decode the transfer details from the packet's assembled tx so the UI can show
 * what is actually being authorized. Throws if the tx isn't a single SAC
 * `transfer(from, to, amount)` invocation.
 */
export function decodeTransferSummary(packet: CosignPacket): TransferSummary {
  const tx = new Transaction(packet.unsignedTxXdr, STELLAR_NETWORK_PASSPHRASE);
  const op = tx.operations[0] as Operation.InvokeHostFunction | undefined;
  if (!op || op.type !== 'invokeHostFunction') {
    throw new Error('packet: not an invokeHostFunction transaction');
  }
  const invoke = op.func.invokeContract();
  const sacContractId = Address.fromScAddress(invoke.contractAddress()).toString();
  const fnName = readScSymbol(invoke.functionName());
  if (fnName !== 'transfer') {
    throw new Error(`packet: unexpected contract call "${fnName}" (expected transfer)`);
  }
  const args = invoke.args();
  const from = String(scValToNative(args[0]));
  const to = String(scValToNative(args[1]));
  const amountBaseUnits = String(scValToNative(args[2]));
  return { sacContractId, from, to, amountBaseUnits };
}

// ─── Persistence (AsyncStorage) ────────────────────────────────────────────

async function readAll(): Promise<CosignPacket[]> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CosignPacket[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(packets: CosignPacket[]): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(packets));
}

/** Upsert a packet by id (used after create and after each appended signature). */
export async function savePacket(packet: CosignPacket): Promise<void> {
  const all = await readAll();
  const i = all.findIndex((p) => p.id === packet.id);
  if (i >= 0) all[i] = packet;
  else all.push(packet);
  await writeAll(all);
}

export async function loadPackets(): Promise<CosignPacket[]> {
  return readAll();
}

export async function removePacket(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((p) => p.id !== id));
}

/**
 * Drop packets whose signing window has elapsed (createdAt + ttlMs in the past)
 * and return the survivors. Expired packets can't be submitted — their pinned
 * signatureExpirationLedger has passed — so they're dead weight in the list and
 * storage. `ttlMs` mirrors the on-chain pin (SIGNATURE_VALIDITY_LEDGERS); the
 * caller supplies it so this module stays decoupled from ledger timing.
 */
export async function pruneExpiredPackets(ttlMs: number): Promise<CosignPacket[]> {
  const all = await readAll();
  const now = Date.now();
  const live = all.filter((p) => new Date(p.createdAt).getTime() + ttlMs > now);
  if (live.length !== all.length) await writeAll(live);
  return live;
}
