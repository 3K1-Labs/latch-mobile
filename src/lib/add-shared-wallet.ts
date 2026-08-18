/**
 * add-shared-wallet.ts — let a member add a shared (multisig) wallet they're a
 * signer on to their account list, so it shows in the switcher and they can view
 * it + co-sign transfers (docs/shared-wallet-concerns.md §6c).
 *
 * SECURITY: adding grants NO authority. The on-chain __check_auth is the only
 * authorization, and a transfer still needs threshold approvals from members.
 * The member-check + threshold read here are read-only simulations for UX +
 * correctness; the cached threshold/signers are DISPLAY-ONLY — the cosign flow
 * re-reads the live threshold from chain at create + submit (never trusts cache).
 */

import { StrKey } from '@stellar/stellar-sdk';

import { fetchDefaultContextRule, fetchRuleThreshold } from '@/src/api/account-admin';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { getMySignerKey } from '@/src/lib/cosign-packet-flow';
import { autoFetchWalletCosignKey } from '@/src/lib/wallet-cosign-key';
import { useWalletStore, type WalletAccount } from '@/src/store/wallet';

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

/**
 * Verify (on-chain) that this device is a signer on the shared wallet at
 * `address`, then append it as a multisig account and switch to it. Throws with
 * a user-facing message on any failure.
 */
export async function addSharedWalletByAddress(
  rawAddress: string,
  name?: string,
): Promise<WalletAccount> {
  const address = rawAddress.trim();
  if (!StrKey.isValidContract(address)) {
    throw new Error('Enter a valid shared wallet address (it starts with C).');
  }

  if (useWalletStore.getState().accounts.some((a) => a.smartAccountAddress === address)) {
    throw new Error('This shared wallet is already in your accounts.');
  }

  // The key THIS device will actually sign shared-wallet transfers with.
  const myKey = await getMySignerKey();
  if (!myKey) {
    throw new Error('No signing key on this device. Set up your personal account first.');
  }

  let rule;
  try {
    rule = await fetchDefaultContextRule(simParams(), address);
  } catch {
    throw new Error("Couldn't read that wallet on-chain. Check the address and your connection.");
  }

  if (rule.signers.length < 2) {
    throw new Error('That address is a single-signer account, not a shared wallet.');
  }

  const mine = myKey.toLowerCase();
  const isMember = rule.signers.some((s) => s.keyDataHex && s.keyDataHex.toLowerCase() === mine);
  if (!isMember) {
    throw new Error("This device isn't a signer on that shared wallet, so it can't be added.");
  }

  // Threshold is display-only; the cosign flow re-reads it live at send time.
  let threshold = rule.signers.length;
  try {
    const t = await fetchRuleThreshold(simParams(), address, rule.ruleId);
    if (Number.isFinite(t) && t >= 1) threshold = t;
  } catch {
    /* no threshold policy read — fall back to signer count for display */
  }

  const account: WalletAccount = {
    index: -1,
    name: (name ?? '').trim() || 'Shared Wallet',
    gAddress: '',
    publicKeyHex: '',
    smartAccountAddress: address,
    image: null,
    isMultisig: true,
    multisigThreshold: threshold,
    multisigSigners: rule.signers.map((s) => s.signerKey),
  };

  // Zero-touch WCK pickup: membership was just verified, so try importing the
  // wallet's sealed key bundle in the background. Non-fatal — the pending list
  // self-heals via listForAccount, and the manual link remains the fallback.
  autoFetchWalletCosignKey(address).catch((err) => {
    if (__DEV__) console.log('[wck] auto-fetch failed:', err?.message);
  });

  return useWalletStore.getState().appendAccount(account, true);
}
