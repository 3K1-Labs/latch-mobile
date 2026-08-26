import AsyncStorage from '@react-native-async-storage/async-storage';
import { Networks } from '@stellar/stellar-sdk';

import { ACTIVE_NETWORK_STORAGE_KEY } from './network-storage-key';
import { normalizePasskeyRpId } from '@/src/lib/passkey-rp-id';

export { ACTIVE_NETWORK_STORAGE_KEY };

// ─── Stellar / Soroban ────────────────────────────────────────────────────────
const STELLAR_AUTH_PREFIX = 'Stellar Smart Account Auth:\n';

// ─── Network configuration ────────────────────────────────────────────────────
export interface NetworkDetails {
  network: 'TESTNET' | 'PUBLIC';
  networkName: string;
  horizonUrl: string;
  networkPassphrase: string;
  sorobanRpcUrl: string;
  friendbotUrl?: string;
  // Verifiers are NOT configured here. They are read from the chain — from the
  // account's own context rule where possible, else from the factory's
  // FactoryConfig (see resolveRegisteredEd25519Verifier in
  // src/services/send-token.ts and fetchFactoryVerifiers in
  // src/api/account-admin.ts).
  //
  // There used to be a `verifierAddress` here, mirroring the factory's ed25519
  // verifier. It went stale on a contract redeploy and every Ed25519 signature
  // failed __check_auth with #3002, because the account matches on the exact
  // `External(verifier, key_data)` tuple. Configuration must not hold a second
  // copy of something the chain already publishes.
  factoryAddress: string;
}

export const TESTNET_NETWORK: NetworkDetails = {
  network: 'TESTNET',
  networkName: 'Test Net',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  sorobanRpcUrl: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  factoryAddress: process.env.EXPO_PUBLIC_FACTORY_ADDRESS ?? '',
};

export const MAINNET_NETWORK: NetworkDetails = {
  network: 'PUBLIC',
  networkName: 'Main Net',
  horizonUrl: 'https://horizon.stellar.org',
  networkPassphrase: Networks.PUBLIC,
  sorobanRpcUrl: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET ?? 'https://mainnet.sorobanrpc.com',
  factoryAddress: process.env.EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET ?? '',
};

// `let`, not `const` — switchActiveNetwork() (src/lib/network-switch.ts) reassigns
// these live, without an app restart. Every reader is inside a function body
// (hook, event handler, render), never a module-top-level computation, so the
// live binding is picked up on the next call/render — see network-switch.ts.
//
// Starts on testnet and is corrected by hydrateActiveNetwork() during startup
// from the user's persisted choice. The app root gates rendering on that
// hydration, so nothing reads a network value before it is applied.
//
// Testnet is the default deliberately. A fresh install has no persisted choice,
// so whatever sits here is what a first run uses — and a first run that lands
// on mainnet deploys a real account and spends real bundler XLM before the user
// has chosen anything. The safe default is the one that costs nothing when it
// is wrong.
export let ACTIVE_NETWORK: NetworkDetails = TESTNET_NETWORK;

// Convenience shortcuts derived from the active network
let HORIZON_URL = ACTIVE_NETWORK.horizonUrl;
let STELLAR_NETWORK_PASSPHRASE = ACTIVE_NETWORK.networkPassphrase;
let STELLAR_RPC_URL = ACTIVE_NETWORK.sorobanRpcUrl;
let STELLAR_FACTORY_ADDRESS = ACTIVE_NETWORK.factoryAddress;

// Minimum XLM reserve per Stellar protocol:
//   (BASE_RESERVE_MIN_COUNT + subentry_count + num_sponsoring - num_sponsored) × BASE_RESERVE
export const BASE_RESERVE = 0.5;
export const BASE_RESERVE_MIN_COUNT = 2;

// Relying party ID used when constructing WebAuthn authenticatorData for passkey signing.
// Must be a stable domain string — the on-chain verifier checks signature math, not this value.
// Normalised to a bare domain: see normalizePasskeyRpId for what a scheme here breaks.
const PASSKEY_RP_ID = normalizePasskeyRpId(
  process.env.EXPO_PUBLIC_PASSKEY_RP_ID ?? 'michaelesenwa.me',
);

// ─── Swap / liquidity aggregation (Soroswap Aggregator API) ───────────────────
// The API key is baked into the bundle (EXPO_PUBLIC_*). Testnet only — move the
// key behind a backend proxy before production, as the bundler key already is.
const SOROSWAP_API_URL = (
  process.env.EXPO_PUBLIC_SOROSWAP_API_URL ?? 'https://api.soroswap.finance'
).replace(/\/+$/, '');
const SOROSWAP_API_KEY = process.env.EXPO_PUBLIC_SOROSWAP_API_KEY ?? '';
// Soroswap expects the network as a lowercase query param (?network=testnet|mainnet).
let SOROSWAP_NETWORK = getNetworkId();

/** `'testnet' | 'mainnet'` form of ACTIVE_NETWORK, used across cosign/multisig/swap code. */
export function getNetworkId(): 'testnet' | 'mainnet' {
  return ACTIVE_NETWORK.network === 'TESTNET' ? 'testnet' : 'mainnet';
}

// ─── Block explorer (stellar.expert) ──────────────────────────────────────────
// stellar.expert namespaces every route by network, so a link is only valid for
// the network the transaction was actually submitted on — a mainnet hash under
// /testnet resolves to "not found". Read through these helpers rather than
// pinning a base URL at module load, so a live network switch is picked up.
const STELLAR_EXPERT_BASE_URL = 'https://stellar.expert/explorer';
const STELLAR_EXPERT_API_BASE_URL = 'https://api.stellar.expert/explorer';

/** The path segment stellar.expert uses for the active network. */
function getExplorerNetworkPath(): 'public' | 'testnet' {
  return ACTIVE_NETWORK.network === 'TESTNET' ? 'testnet' : 'public';
}

/** stellar.expert API base for the active network, e.g. `…/explorer/public`. */
export function getExplorerApiUrl(): string {
  return `${STELLAR_EXPERT_API_BASE_URL}/${getExplorerNetworkPath()}`;
}

/** Explorer link for a transaction hash, on the network it was submitted to. */
export function getTransactionExplorerUrl(hash: string): string {
  return `${STELLAR_EXPERT_BASE_URL}/${getExplorerNetworkPath()}/tx/${encodeURIComponent(hash)}`;
}

/**
 * Live network switch — no app restart. Reassigns every derived config value
 * in place (live ES-module bindings, so every importer sees the update on its
 * next read) and persists the choice so a later cold start also honors it.
 * Callers are responsible for the side effects this doesn't own: disconnecting
 * WalletConnect sessions and clearing React Query's cache — see
 * src/lib/network-switch.ts.
 */
export async function setActiveNetworkDetails(details: NetworkDetails): Promise<void> {
  applyNetworkDetails(details);
  await AsyncStorage.setItem(ACTIVE_NETWORK_STORAGE_KEY, getNetworkId());
}

function applyNetworkDetails(details: NetworkDetails): void {
  ACTIVE_NETWORK = details;
  HORIZON_URL = details.horizonUrl;
  STELLAR_NETWORK_PASSPHRASE = details.networkPassphrase;
  STELLAR_RPC_URL = details.sorobanRpcUrl;
  STELLAR_FACTORY_ADDRESS = details.factoryAddress;
  SOROSWAP_NETWORK = getNetworkId();

  const isTestnet = details.network === 'TESTNET';
  AQUARIUS_AMM_API_URL = isTestnet ? TESTNET_AQUARIUS_API_URL : MAINNET_AQUARIUS_API_URL;
  AQUARIUS_ROUTER_ADDRESS = isTestnet ? TESTNET_AQUARIUS_ROUTER : MAINNET_AQUARIUS_ROUTER;
}

/**
 * Applies the persisted network choice on cold start. Must resolve before the
 * app renders anything that reads a network value — the root layout gates on it.
 * Unlike setActiveNetworkDetails it doesn't write back to storage, since it's
 * applying what storage already said.
 */
export async function hydrateActiveNetwork(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(ACTIVE_NETWORK_STORAGE_KEY);
    if (stored === 'testnet') applyNetworkDetails(TESTNET_NETWORK);
  } catch {
    // Storage unavailable — keep the mainnet default rather than blocking launch.
  }
}

// ─── Aquarius AMM (swap liquidity, both networks) ─────────────────────────────
// Aquarius is the swap provider on BOTH networks — see services/swap/registry.ts.
// Testnet: Aquarius resets testnet quarterly, so the router can be overridden via env.
const TESTNET_AQUARIUS_API_URL =
  process.env.EXPO_PUBLIC_AQUARIUS_API_URL ??
  'https://amm-api-testnet.aqua.network/api/external/v1';
const TESTNET_AQUARIUS_ROUTER =
  process.env.EXPO_PUBLIC_AQUARIUS_ROUTER ??
  'CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD';
// Mainnet router taken from the XLM/USDC pool's own on-chain `Router` storage
// entry (pool CA6PUJLB…, the deep ~9.6M-XLM constant-product pool), not guessed.
const MAINNET_AQUARIUS_API_URL =
  process.env.EXPO_PUBLIC_AQUARIUS_API_URL_MAINNET ??
  'https://amm-api.aqua.network/api/external/v1';
const MAINNET_AQUARIUS_ROUTER =
  process.env.EXPO_PUBLIC_AQUARIUS_ROUTER_MAINNET ??
  'CBQDHNBFBZYE4MKPWBSJOPIYLW4SFSXAXUTSXJN76GNKYVYPCKWC6QUK';

// Reassigned by applyNetworkDetails() on a live switch, same as the values above.
let AQUARIUS_AMM_API_URL =
  ACTIVE_NETWORK.network === 'TESTNET' ? TESTNET_AQUARIUS_API_URL : MAINNET_AQUARIUS_API_URL;
let AQUARIUS_ROUTER_ADDRESS =
  ACTIVE_NETWORK.network === 'TESTNET' ? TESTNET_AQUARIUS_ROUTER : MAINNET_AQUARIUS_ROUTER;

// ─── Deposit relayer (latch-relayer) ──────────────────────────────────────────
// A relayer deployment is bound to ONE Stellar network by its own NETWORK env
// var and watches exactly one pool G-address on it, so serving both networks
// takes two deployments. ACTIVE_NETWORK, by contrast, is user-switchable at
// runtime. Handing out a pool address + memo while the app sits on a network no
// relayer is watching would tell the user to send funds nowhere, so every
// deposit-intent caller must gate on isDepositRelayerAvailable() first.
//
// EXPO_PUBLIC_RELAYER_NETWORKS lists the networks that have a relayer, e.g.
// "testnet,mainnet". The older singular EXPO_PUBLIC_RELAYER_NETWORK still works
// and means the same thing with one entry.
const DEPOSIT_RELAYER_NETWORKS = (
  process.env.EXPO_PUBLIC_RELAYER_NETWORKS ??
  process.env.EXPO_PUBLIC_RELAYER_NETWORK ??
  'testnet'
)
  .split(',')
  .map((n: string) => n.trim().toLowerCase())
  .filter(Boolean) as ('testnet' | 'mainnet')[];

/** True when a deposit relayer is deployed for the network the app is on. */
export function isDepositRelayerAvailable(): boolean {
  return DEPOSIT_RELAYER_NETWORKS.includes(getNetworkId());
}

export {
  AQUARIUS_AMM_API_URL,
  AQUARIUS_ROUTER_ADDRESS,
  DEPOSIT_RELAYER_NETWORKS,
  HORIZON_URL,
  PASSKEY_RP_ID,
  SOROSWAP_API_KEY,
  SOROSWAP_API_URL,
  SOROSWAP_NETWORK,
  STELLAR_AUTH_PREFIX,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL
};

