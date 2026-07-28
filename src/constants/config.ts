import AsyncStorage from '@react-native-async-storage/async-storage';
import { Networks } from '@stellar/stellar-sdk';

import { ACTIVE_NETWORK_STORAGE_KEY } from './network-storage-key';

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
  // Deploy-time-pinned contract config — differs per network, see
  // reference/LATCH_REFERENCE.md. The ed25519 verifier is the only one passed
  // client-side; secp256k1/webauthn verifiers are read on-chain from the
  // active factory (see fetchFactoryVerifiers in src/api/account-admin.ts).
  factoryAddress: string;
  bundlerSecret: string;
  verifierAddress: string;
}

export const TESTNET_NETWORK: NetworkDetails = {
  network: 'TESTNET',
  networkName: 'Test Net',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  sorobanRpcUrl: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  factoryAddress: process.env.EXPO_PUBLIC_FACTORY_ADDRESS ?? '',
  bundlerSecret: process.env.EXPO_PUBLIC_BUNDLER_SECRET ?? '',
  verifierAddress:
    process.env.EXPO_PUBLIC_VERIFIER_ADDRESS ?? 'CCRB63MFFBYXBZCRLRGLJVTHC7O4SUGAYTO5ZZEUNVY5W5DVGKHETI67',
};

export const MAINNET_NETWORK: NetworkDetails = {
  network: 'PUBLIC',
  networkName: 'Main Net',
  horizonUrl: 'https://horizon.stellar.org',
  networkPassphrase: Networks.PUBLIC,
  sorobanRpcUrl: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET ?? 'https://mainnet.sorobanrpc.com',
  factoryAddress: process.env.EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET ?? '',
  bundlerSecret: process.env.EXPO_PUBLIC_BUNDLER_SECRET_MAINNET ?? '',
  verifierAddress: process.env.EXPO_PUBLIC_VERIFIER_ADDRESS_MAINNET ?? '',
};

// `let`, not `const` — switchActiveNetwork() (src/lib/network-switch.ts) reassigns
// these live, without an app restart. Every reader is inside a function body
// (hook, event handler, render), never a module-top-level computation, so the
// live binding is picked up on the next call/render — see network-switch.ts.
//
// Starts on mainnet and is corrected by hydrateActiveNetwork() during startup.
// The app root gates rendering on that hydration, so nothing reads a network
// value before the persisted choice has been applied.
export let ACTIVE_NETWORK: NetworkDetails = MAINNET_NETWORK;

// Convenience shortcuts derived from the active network
let HORIZON_URL = ACTIVE_NETWORK.horizonUrl;
let STELLAR_NETWORK_PASSPHRASE = ACTIVE_NETWORK.networkPassphrase;
let STELLAR_RPC_URL = ACTIVE_NETWORK.sorobanRpcUrl;
let STELLAR_FACTORY_ADDRESS = ACTIVE_NETWORK.factoryAddress;
let STELLAR_BUNDLER_SECRET = ACTIVE_NETWORK.bundlerSecret;
let STELLAR_VERIFIER_ADDRESS = ACTIVE_NETWORK.verifierAddress;

// Minimum XLM reserve per Stellar protocol:
//   (BASE_RESERVE_MIN_COUNT + subentry_count + num_sponsoring - num_sponsored) × BASE_RESERVE
export const BASE_RESERVE = 0.5;
export const BASE_RESERVE_MIN_COUNT = 2;

// Relying party ID used when constructing WebAuthn authenticatorData for passkey signing.
// Must be a stable domain string — the on-chain verifier checks signature math, not this value.
const PASSKEY_RP_ID = process.env.EXPO_PUBLIC_PASSKEY_RP_ID ?? 'latch.finance';

// ─── Swap / liquidity aggregation (Soroswap Aggregator API) ───────────────────
// The API key is baked into the bundle (EXPO_PUBLIC_*). Testnet only — move the
// key behind a backend proxy before production, same as EXPO_PUBLIC_BUNDLER_SECRET.
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
  STELLAR_BUNDLER_SECRET = details.bundlerSecret;
  STELLAR_VERIFIER_ADDRESS = details.verifierAddress;
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

export {
  AQUARIUS_AMM_API_URL,
  AQUARIUS_ROUTER_ADDRESS,
  HORIZON_URL,
  PASSKEY_RP_ID,
  SOROSWAP_API_KEY,
  SOROSWAP_API_URL,
  SOROSWAP_NETWORK,
  STELLAR_AUTH_PREFIX,
  STELLAR_BUNDLER_SECRET,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
  STELLAR_VERIFIER_ADDRESS,
};
