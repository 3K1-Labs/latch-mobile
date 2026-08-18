/**
 * passkey.ts — WebAuthn/passkey smart account deployment.
 *
 * Deployment itself runs server-side (src/api/smart-account-deploy.ts): the
 * bundler keypair that pays for it lives in latch-api, not in this bundle. What
 * stays here is the local bookkeeping — the SecureStore cache and the key
 * fingerprint that detects a credential regenerated after the last deploy.
 *
 * The deployed address is persisted to SecureStore so lookupSmartAccount can
 * return it across app restarts without any network call.
 */

import * as SecureStore from 'expo-secure-store';

import { deployPasskeyAccount } from '@/src/api/smart-account-deploy';
import {
  HORIZON_URL,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { SECURE_KEYS } from '../store/wallet';

// ─── Config ──────────────────────────────────────────────────────────────────
// Reads live off ACTIVE_NETWORK (src/constants/config.ts) on every call, so it
// follows switchActiveNetwork() without a restart — see smart-account.ts.

const getConfig = () => ({
  rpcUrl: STELLAR_RPC_URL,
  horizonUrl: HORIZON_URL,
  networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  factoryAddress: STELLAR_FACTORY_ADDRESS,
});

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DeployResult {
  smartAccountAddress: string;
  alreadyDeployed: boolean;
  error?: string;
}

export interface LookupResult {
  deployed: boolean;
  smartAccountAddress: string;
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

/**
 * Deploy a Soroban smart account for a WebAuthn/passkey credential.
 *
 * Does NOT call predictAddress (get_account_address simulation) — that was the
 * extra XHR call that failed on Android with status=0. The deployed address is
 * read from the settled transaction's resultMetaXdr and persisted to SecureStore.
 *
 * @param credentialId  Local credential identifier (cache + SecureStore key)
 * @param keyDataHex    Uncompressed P-256 pubkey (65B = 130 hex) + credentialId hex (16B = 32 hex)
 */
export async function deploySmartAccount(
  credentialId: string,
  keyDataHex: string,
  skipCache = false,
): Promise<DeployResult> {
  if (!keyDataHex || keyDataHex.length < 132) {
    return {
      smartAccountAddress: '',
      alreadyDeployed: false,
      error: `keyDataHex too short (got ${keyDataHex?.length ?? 0}, need ≥132)`,
    };
  }

  // Check SecureStore first — survives across app restarts.
  // Also verify the cached address was deployed with the current keyDataHex.
  // If they diverge (partial SecureStore clear, re-onboarding, etc.) we must
  // redeploy so the on-chain signer matches the stored private key.
  if (!skipCache) {
    const stored = await SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT);
    if (stored) {
      const deployedKeyData = await SecureStore.getItemAsync(SECURE_KEYS.DEPLOYED_KEY_DATA);
      if (deployedKeyData === null) {
        // Legacy account (fingerprint never stored). Store it now and trust cache.
        await SecureStore.setItemAsync(SECURE_KEYS.DEPLOYED_KEY_DATA, keyDataHex);
        return { smartAccountAddress: stored, alreadyDeployed: true };
      }
      if (deployedKeyData === keyDataHex) {
        return { smartAccountAddress: stored, alreadyDeployed: true };
      }
      // Fingerprint mismatch: credentials were regenerated after the last deployment.
      // Fall through to redeploy with the current key.
      if (__DEV__) {
        console.warn('[passkey] key fingerprint mismatch — redeploying with current credential');
      }
    }
  }

  try {
    const { factoryAddress } = getConfig();
    if (!factoryAddress) {
      return {
        smartAccountAddress: '',
        alreadyDeployed: false,
        error: 'EXPO_PUBLIC_FACTORY_ADDRESS not set',
      };
    }

    // latch-api owns the bundler keypair and pays for this. The Face ID /
    // Touch ID prompt raised below is the deploy proof: the passkey signs a
    // server-issued nonce, and that signature is what authorises spending
    // bundler funds.
    const { smartAccountAddress, alreadyDeployed } = await deployPasskeyAccount(
      credentialId,
      keyDataHex,
    );

    if (__DEV__) console.log('[passkey] deployed:', smartAccountAddress);
    // Persist fingerprint so future runs can detect credential/deployment mismatches.
    await SecureStore.setItemAsync(SECURE_KEYS.DEPLOYED_KEY_DATA, keyDataHex);
    return { smartAccountAddress, alreadyDeployed };
  } catch (error: any) {
    console.error('[passkey] deploySmartAccount error:', error?.message);
    return {
      smartAccountAddress: '',
      alreadyDeployed: false,
      error: error?.message ?? 'Deployment failed',
    };
  }
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Check whether a smart account has been deployed for the given credential.
 *
 * Reads from SecureStore first (no network call needed if previously deployed).
 * Falls back to getLedgerEntries against the factory-predicted address only if
 * the address can be derived from SecureStore data.
 */
export async function lookupSmartAccount(
  credentialId: string,
  keyDataHex: string,
): Promise<LookupResult> {
  if (!keyDataHex || keyDataHex.length < 132) return { deployed: false, smartAccountAddress: '' };

  // Prefer the stored address — avoids any sorobanCall on Android
  const stored = await SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT);
  if (stored) return { deployed: true, smartAccountAddress: stored };

  return { deployed: false, smartAccountAddress: '' };
}
