import { fetchDefaultContextRule } from '@/src/api/account-admin';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
  getNetworkId,
} from '@/src/constants/config';
import { clearSacTransferCache } from '@/src/lib/sac-transfer-cache';
import { deriveWalletAtIndex, restoreStellarWallet, StellarWallet } from '@/src/lib/seed-wallet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// SecureStore keys
export const SECURE_KEYS = {
  MNEMONIC: 'latch_mnemonic',
  SMART_ACCOUNT: 'latch_smart_account', // legacy key — account 0's C-address (kept for migration)
  ACCOUNTS: 'latch_accounts',           // JSON: WalletAccount[]
  ACTIVE_ACCOUNT_INDEX: 'latch_active_account_index',
  PIN: 'latch_pin',
  PENDING_MNEMONIC: 'latch_pending_mnemonic',
  CREDENTIAL_ID: 'latch_credential_id',
  KEY_DATA_HEX: 'latch_key_data_hex',
  PASSKEY_PRIVATE_KEY: 'latch_passkey_private_key',
  PASSKEY_REQUIRES_BIOMETRIC: 'latch_passkey_requires_biometric',
  // 'platform' for a real OS passkey (react-native-passkey — synced via Google
  // Password Manager / iCloud Keychain, no local private key); absent or
  // 'local' for today's SecureStore-only P-256 key. See platform-passkey.ts.
  PASSKEY_KIND: 'latch_passkey_kind',
  // The relying party ID the credential in this slot was created under.
  //
  // A platform passkey is scoped to its RP: the OS locates it by RP ID, so
  // changing EXPO_PUBLIC_PASSKEY_RP_ID orphans every credential minted under
  // the old one. Credential Manager then simply reports no match, which
  // surfaces as a generic ceremony failure naming nothing — the app asks for a
  // nonce, signs nothing, and never reaches the deploy call. Recording the RP
  // makes that detectable instead of a silent dead end.
  PASSKEY_RP_ID: 'latch_passkey_rp_id',
  // Fingerprint of the keyDataHex used when the smart account was last deployed.
  // If this differs from the current KEY_DATA_HEX, the account must be re-deployed.
  DEPLOYED_KEY_DATA: 'latch_deployed_key_data',
  // Latch backend auth tokens
  ACCESS_TOKEN: 'latch_access_token',
  REFRESH_TOKEN: 'latch_refresh_token',
  USER_EMAIL: 'latch_user_email',
  // Wallet-scope (SEP-10-inspired) tokens — separate from the email tokens above.
  WALLET_ACCESS_TOKEN: 'latch_wallet_access_token',
  WALLET_REFRESH_TOKEN: 'latch_wallet_refresh_token',
  // Temporary session key — holds recovery password during onboarding only.
  // Deleted immediately after the first successful backup upload.
  RECOVERY_PASSWORD_SESSION: 'latch_recovery_password_session',
} as const;

export const ASYNC_KEYS = {
  AVATARS: 'latch_account_avatars',
  // Set when an onboarding backup upload fails so the app can nudge the user
  // to complete it once they reach the dashboard, instead of losing the
  // failure silently. Cleared as soon as the nudge is shown (one-shot).
  BACKUP_PENDING: 'latch_backup_pending',
} as const;

/**
 * A device paired to a smart account. The first device is the one that
 * deployed the account; subsequent devices are added via the pairing flow
 * (Phase P2). Multi-device accounts use a split-policy: 1-of-N for normal
 * ops, ⌈N/2⌉-of-N for admin ops — see docs/multisig-build-plan.md.
 */
export interface Device {
  /**
   * Canonical signer key used to identify this device in cosign requests
   * and in the on-chain signer set. G-address for Ed25519 signers, hex
   * public key for WebAuthn signers, contract/account address for
   * delegated signers.
   */
  signerKey: string;
  /** Human-readable label, e.g. "iPhone 15", "Pixel 8". */
  label: string;
  /** Which on-chain Signer variant this device is. */
  kind: 'ed25519' | 'webauthn' | 'delegated';
  /** Public key material for external signers (hex). Empty string for 'delegated'. */
  keyDataHex: string;
  /**
   * Stable on-chain signer id assigned by `add_signer` / `batch_add_signer`.
   * Needed for `remove_signer` calls. Null until the device's add_signer tx
   * has been confirmed.
   */
  onChainSignerId: number | null;
  /** True for the device that holds this signer's private key. */
  isLocal: boolean;
  /** ISO-8601 timestamp of when the device was paired. */
  pairedAt: string;
}

/**
 * One wallet account derived from the user's seed phrase.
 * Passkey users always have exactly one entry (index -1, no mnemonic derivation).
 */
export interface WalletAccount {
  /** BIP-44 account index (m/44'/148'/{index}'). -1 for passkey accounts. */
  index: number;
  /** Display name, e.g. "Account 1" */
  name: string;
  /** G... Stellar public key */
  gAddress: string;
  /** Raw hex public key (used for smart account deployment) */
  publicKeyHex: string;
  /** Deployed C-address on Stellar, null if not yet deployed */
  smartAccountAddress: string | null;
  /**
   * Network the smart account was deployed on. The C-address only exists on
   * that one chain, but the active network is switchable at runtime — so
   * without this the two can silently disagree and every on-chain read for
   * this account hits a ledger it isn't in. Absent on accounts persisted
   * before the field existed; resolved on demand by findDeployedNetwork.
   */
  network?: 'testnet' | 'mainnet';
  /** Custom profile image URI, null if default */
  image: string | null;
  /** Passkey credential ID (hex). Present only on passkey accounts added after account 0. */
  credentialId?: string;
  /**
   * Paired devices on this account. Always has at least one entry once the
   * smart account is deployed. Backfilled to [] for accounts deployed
   * before the multisig migration.
   */
  devices?: Device[];
  /**
   * Context rule id for the admin (⌈N/2⌉-of-N) rule. Null until the second
   * device is paired and the admin rule is installed.
   */
  adminRuleId?: number | null;
  /**
   * True for shared (multisig) wallets created via the shared-wallet wizard.
   * These have `index: -1` and empty `gAddress`/`publicKeyHex` like passkey
   * accounts, but their signers are delegated member C-addresses with a
   * threshold — so they have NO local passkey/mnemonic credential and cannot
   * sign transfers single-handedly. Used to route away from the single-device
   * signing paths (see send-token.tsx). Absent/false on personal accounts.
   */
  isMultisig?: boolean;
  /**
   * Number of member approvals required to authorize a transfer from this
   * shared wallet (the on-chain threshold). Set at creation. Multisig only.
   */
  multisigThreshold?: number;
  /**
   * Delegated signer addresses (member personal-account C-addresses,
   * including the creator's). Used as the cosign roster and to match each
   * member's nested auth entry during signing. Multisig only.
   */
  multisigSigners?: string[];
  /**
   * Stable fingerprint of this wallet's member set + threshold (see
   * `multisigMembershipHash`). Used only to warn when re-creating a wallet with
   * an identical member set. Multisig only.
   */
  multisigMembershipHash?: string;
  /**
   * Per-wallet uniqueness nonce (hex) folded into the deploy salt. The creator's
   * record of how the address was derived; lets a future P2P onboarding flow
   * share it so joiners can predict the address. Multisig only.
   */
  multisigNonceHex?: string;
}

/**
 * Return the SecureStore key names for the passkey credential at a given list position.
 * Index 0 uses the original non-indexed keys for backward compatibility.
 * Index 1+ uses indexed keys so each passkey account stores its own credential.
 */
export function getPasskeyStorageKeys(listIndex: number): {
  credentialId: string;
  keyDataHex: string;
  privateKey: string;
  requiresBiometric: string;
  kind: string;
  rpId: string;
} {
  if (listIndex === 0) {
    return {
      credentialId: SECURE_KEYS.CREDENTIAL_ID,
      keyDataHex: SECURE_KEYS.KEY_DATA_HEX,
      privateKey: SECURE_KEYS.PASSKEY_PRIVATE_KEY,
      requiresBiometric: SECURE_KEYS.PASSKEY_REQUIRES_BIOMETRIC,
      kind: SECURE_KEYS.PASSKEY_KIND,
      rpId: SECURE_KEYS.PASSKEY_RP_ID,
    };
  }
  return {
    credentialId: `latch_credential_id_${listIndex}`,
    keyDataHex: `latch_key_data_hex_${listIndex}`,
    privateKey: `latch_passkey_private_key_${listIndex}`,
    requiresBiometric: `latch_passkey_requires_biometric_${listIndex}`,
    kind: `latch_passkey_kind_${listIndex}`,
    rpId: `latch_passkey_rp_id_${listIndex}`,
  };
}

interface WalletStore {
  /** Wallet generated during onboarding — not yet committed to storage */
  pendingWallet: StellarWallet | null;

  /** In-memory mnemonic for the current session (loaded from SecureStore on rehydrate) */
  mnemonic: string | null;

  /** All derived accounts for this seed */
  accounts: WalletAccount[];

  /** Index into `accounts` for the currently active account */
  activeAccountIndex: number;

  // ─── Derived shortcuts (backward-compatible with existing screens) ────────
  /** Full keypair for the active account (null for passkey users) */
  activeWallet: StellarWallet | null;
  /** Deployed C-address for the active account */
  smartAccountAddress: string | null;
  /** In-memory map from publicKeyHex → data:image/jpeg;base64,... */
  avatars: Record<string, string>;

  // ─── Legacy setters (called by deploy-account.tsx) ────────────────────────
  setPendingWallet: (wallet: StellarWallet) => void;
  clearPendingWallet: () => void;
  setActiveWallet: (wallet: StellarWallet) => void;
  setSmartAccountAddress: (address: string) => void;

  // ─── Multi-account actions ────────────────────────────────────────────────
  /**
   * Derive the next BIP-44 account and add it to the list.
   * Only works for mnemonic users; returns null for passkey users.
   */
  addAccount: () => Promise<WalletAccount | null>;

  /**
   * Add a new passkey-backed account. The caller is responsible for generating and
   * persisting the P-256 credential before calling this (via storePasskeyCredentialAtIndex).
   */
  addPasskeyAccount: (credentialId: string, publicKeyHex: string) => Promise<WalletAccount>;

  /**
   * Append a fully-formed account (e.g. a shared/multisig wallet the device is a
   * signer on) to the list. Deduplicates by smart-account address. Pass
   * makeActive to switch to it. Returns the appended (or pre-existing) account.
   */
  appendAccount: (account: WalletAccount, makeActive?: boolean) => Promise<WalletAccount>;

  /** Switch the active account to the given list position. */
  switchAccount: (listIndex: number) => Promise<void>;

  /** Rename an account by its list position. */
  renameAccount: (listIndex: number, name: string) => Promise<void>;

  /** Set a custom image for an account. */
  setAccountImage: (listIndex: number, imageUri: string | null) => Promise<void>;

  /**
   * Called after a new account is deployed on-chain. Updates its C-address
   * in both the in-memory list and SecureStore.
   */
  updateAccountSmartAddress: (bip44Index: number, smartAddress: string) => Promise<void>;

  /**
   * Record which network an account's smart account is deployed on, keyed by
   * C-address (unique across the list, unlike `index`). Backfills accounts
   * persisted before `network` existed, so the chain is probed once per
   * account rather than on every sign-in.
   */
  setAccountNetwork: (smartAddress: string, network: 'testnet' | 'mainnet') => Promise<void>;

  /**
   * Remove an account by its BIP-44/passkey index. Used to roll back an
   * optimistically-added account when its on-chain deployment fails.
   */
  removeAccount: (index: number) => Promise<void>;

  /**
   * Replace the devices list and (optionally) the admin rule id for an
   * account. Used after a pair flow completes to persist the new device
   * set + freshly installed admin rule.
   */
  updateAccountDevices: (
    bip44Index: number,
    devices: Device[],
    adminRuleId?: number | null,
  ) => Promise<void>;

  /**
   * Tag an account (by array position) as a shared/multisig wallet and store
   * its delegated signer roster + threshold. Used to recover accounts created
   * before the `isMultisig` flag existed, once an on-chain read confirms the
   * account's rule holds delegated signers (see lib/tx-diagnostics.ts). The
   * on-chain rule is the source of truth, so this is a correction, not a guess.
   */
  markAccountMultisig: (
    listIndex: number,
    threshold: number,
    signers: string[],
  ) => Promise<void>;

  /**
   * Reconcile an account's local `devices` list against the on-chain signer
   * set of its Default context rule. The chain is the source of truth for
   * which signers exist; local fields (label, isLocal, pairedAt,
   * onChainSignerId) are preserved by matching on signerKey. Newly
   * discovered signers are added as non-local devices.
   *
   * Takes the account's position in `accounts` (NOT its `index` field, which
   * is the non-unique `-1` sentinel for passkey/multisig accounts).
   *
   * No-op (resolves false) when the account has no deployed smart account.
   * Network/parse failures are swallowed and logged — the cached list stays.
   * Returns true if a reconcile ran (regardless of whether anything changed).
   */
  syncSignersFromChain: (accountListIndex: number) => Promise<boolean>;

  /**
   * Restore wallet + accounts from SecureStore.
   * Handles migration from the old single-account format automatically.
   * Returns true if a wallet was found.
   */
  rehydrateWallet: () => Promise<boolean>;

  /** Full reset — used on logout / account removal */
  clearAll: () => Promise<void>;
}

/** Persist the accounts array to SecureStore. */
async function persistAccounts(accounts: WalletAccount[]): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEYS.ACCOUNTS, JSON.stringify(accounts));
}

async function loadAvatars(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(ASYNC_KEYS.AVATARS);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch { return {}; }
}

async function persistAvatars(avatars: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(ASYNC_KEYS.AVATARS, JSON.stringify(avatars));
}

// Keyed by BIP-44 account index. Mnemonic is session-immutable, so this mapping
// is stable for the lifetime of a session. Avoids re-running PBKDF2 on every switch.
const derivedWalletCache = new Map<number, StellarWallet>();

function getCachedWallet(mnemonic: string, bip44Index: number): StellarWallet {
  let wallet = derivedWalletCache.get(bip44Index);
  if (!wallet) {
    wallet = deriveWalletAtIndex(mnemonic, bip44Index);
    derivedWalletCache.set(bip44Index, wallet);
  }
  return wallet;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  pendingWallet: null,
  mnemonic: null,
  accounts: [],
  activeAccountIndex: 0,
  activeWallet: null,
  smartAccountAddress: null,
  avatars: {},

  // ─── Legacy setters ───────────────────────────────────────────────────────

  setPendingWallet: (wallet) => set({ pendingWallet: wallet }),
  clearPendingWallet: () => set({ pendingWallet: null }),

  /**
   * Called by deploy-account.tsx after importing a phrase.
   * Syncs the full keypair into activeWallet and patches accounts[0].
   */
  setActiveWallet: (wallet) => {
    const { accounts } = get();
    if (accounts.length === 0) {
      // Store not yet initialised — just set the shortcut
      set({ activeWallet: wallet });
      return;
    }
    // Keep account 0 public fields in sync
    const updated = accounts.map((a) =>
      a.index === 0
        ? { ...a, gAddress: wallet.gAddress, publicKeyHex: wallet.publicKeyHex }
        : a,
    );
    persistAccounts(updated).catch(() => { });
    set({ activeWallet: wallet, accounts: updated });
  },

  /**
   * Called by deploy-account.tsx after the smart account is deployed.
   * Updates the active account's C-address.
   */
  setSmartAccountAddress: (address) => {
    const { accounts, activeAccountIndex } = get();
    if (accounts.length === 0) {
      set({ smartAccountAddress: address });
      return;
    }
    // Stamp the network it was deployed on — the C-address is only valid there.
    const updated = accounts.map((a, i) =>
      i === activeAccountIndex ? { ...a, smartAccountAddress: address, network: getNetworkId() } : a,
    );
    persistAccounts(updated).catch(() => { });
    // Also write the legacy key so app/index.tsx can still find it
    SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, address).catch(() => { });
    set({ smartAccountAddress: address, accounts: updated });
  },

  // ─── Multi-account actions ─────────────────────────────────────────────────

  addAccount: async () => {
    const { mnemonic, accounts } = get();
    if (!mnemonic) return null; // passkey users cannot add accounts

    // Next BIP-44 index is one beyond the highest existing index
    const nextIndex = accounts.reduce((max, a) => Math.max(max, a.index), -1) + 1;
    const wallet = getCachedWallet(mnemonic, nextIndex);

    const newAccount: WalletAccount = {
      index: nextIndex,
      name: `Account ${accounts.length + 1}`,
      gAddress: wallet.gAddress,
      publicKeyHex: wallet.publicKeyHex,
      smartAccountAddress: null,
      image: null,
    };

    const updated = [...accounts, newAccount];
    await persistAccounts(updated);
    set({ accounts: updated });
    return newAccount;
  },

  addPasskeyAccount: async (credentialId, publicKeyHex) => {
    const { accounts } = get();
    const newAccount: WalletAccount = {
      // Passkey accounts use negative indices: account 0 = -1 (from onboarding),
      // subsequent accounts = -(listIndex + 1)
      index: -(accounts.length + 1),
      name: `Account ${accounts.length + 1}`,
      gAddress: '',
      publicKeyHex,
      smartAccountAddress: null,
      image: null,
      credentialId,
    };
    const updated = [...accounts, newAccount];
    await persistAccounts(updated);
    set({ accounts: updated });
    return newAccount;
  },

  appendAccount: async (account, makeActive = false) => {
    const { accounts } = get();
    // Dedupe by smart-account address — re-adding the same shared wallet is a no-op.
    const existingIndex = accounts.findIndex(
      (a) => a.smartAccountAddress && a.smartAccountAddress === account.smartAccountAddress,
    );
    if (existingIndex >= 0) {
      if (makeActive) await get().switchAccount(existingIndex);
      return accounts[existingIndex];
    }

    // A shared wallet can only be joined on the network it lives on, so the
    // active one is the right stamp when the caller didn't supply it.
    const appended = { ...account, network: account.network ?? getNetworkId() };
    const updated = [...accounts, appended];
    const newIndex = updated.length - 1;
    await persistAccounts(updated);
    set({ accounts: updated });
    if (makeActive) await get().switchAccount(newIndex);
    return appended;
  },

  switchAccount: (listIndex) => {
    const { mnemonic, accounts } = get();
    const account = accounts[listIndex];
    if (!account) return Promise.resolve();

    // index < 0 is the sentinel for passkey + multisig accounts, which have no
    // BIP-44-derived keypair. Guard like rehydrate does — deriving at a negative
    // index would be invalid.
    const activeWallet = mnemonic && account.index >= 0 ? getCachedWallet(mnemonic, account.index) : null;

    // Update store first so the UI responds immediately, then persist in the background.
    // Awaiting Keychain writes before set() was causing 3–5 s UI freezes on iOS.
    set({
      activeAccountIndex: listIndex,
      activeWallet,
      smartAccountAddress: account.smartAccountAddress,
    });

    const writes: Promise<void>[] = [
      SecureStore.setItemAsync(SECURE_KEYS.ACTIVE_ACCOUNT_INDEX, String(listIndex)),
    ];
    if (account.smartAccountAddress) {
      // Update the legacy SMART_ACCOUNT key so app/index.tsx still works
      writes.push(SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, account.smartAccountAddress));
    }
    return Promise.all(writes).then(() => { });
  },

  renameAccount: async (listIndex, name) => {
    const { accounts } = get();
    const updated = accounts.map((a, i) => (i === listIndex ? { ...a, name } : a));
    await persistAccounts(updated);
    set({ accounts: updated });
  },

  setAccountImage: async (listIndex, imageDataUri) => {
    const { accounts, avatars } = get();
    const account = accounts[listIndex];
    if (!account) return;
    const key = account.publicKeyHex;
    let updatedAvatars: Record<string, string>;
    if (imageDataUri && key) {
      updatedAvatars = { ...avatars, [key]: imageDataUri };
    } else if (!imageDataUri && key) {
      const { [key]: _removed, ...rest } = avatars;
      updatedAvatars = rest;
    } else {
      updatedAvatars = { ...avatars };
    }
    await persistAvatars(updatedAvatars);
    // Null out the image field so the SecureStore blob never carries image data
    const updatedAccounts = accounts.map((a, i) =>
      i === listIndex ? { ...a, image: null } : a,
    );
    await persistAccounts(updatedAccounts);
    set({ avatars: updatedAvatars, accounts: updatedAccounts });
  },

  removeAccount: async (index) => {
    const { accounts } = get();
    const updated = accounts.filter((a) => a.index !== index);
    await persistAccounts(updated);
    set({ accounts: updated });
  },

  updateAccountSmartAddress: async (bip44Index, smartAddress) => {
    const { accounts, activeAccountIndex } = get();
    const updated = accounts.map((a) =>
      a.index === bip44Index
        ? { ...a, smartAccountAddress: smartAddress, network: getNetworkId() }
        : a,
    );
    await persistAccounts(updated);

    const activeAccount = updated[activeAccountIndex];
    const isActive = activeAccount?.index === bip44Index;

    // Update legacy key whenever account 0 (the primary) is deployed
    if (bip44Index === 0 || isActive) {
      await SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, smartAddress);
    }

    set({
      accounts: updated,
      ...(isActive ? { smartAccountAddress: smartAddress } : {}),
    });
  },

  setAccountNetwork: async (smartAddress, network) => {
    const { accounts } = get();
    const updated = accounts.map((a) =>
      a.smartAccountAddress === smartAddress ? { ...a, network } : a,
    );
    await persistAccounts(updated);
    set({ accounts: updated });
  },

  markAccountMultisig: async (listIndex, threshold, signers) => {
    const { accounts } = get();
    if (!accounts[listIndex]) return;
    const updated = accounts.map((a, i) =>
      i === listIndex ? { ...a, isMultisig: true, multisigThreshold: threshold, multisigSigners: signers } : a,
    );
    await persistAccounts(updated);
    set({ accounts: updated });
  },

  updateAccountDevices: async (bip44Index, devices, adminRuleId) => {
    const { accounts } = get();
    const updated = accounts.map((a) =>
      a.index === bip44Index
        ? {
            ...a,
            devices,
            // Only overwrite adminRuleId if the caller explicitly passed it.
            ...(adminRuleId !== undefined ? { adminRuleId } : {}),
          }
        : a,
    );
    await persistAccounts(updated);
    set({ accounts: updated });
  },

  syncSignersFromChain: async (accountListIndex) => {
    // Locate by array position, NOT by `index`: shared/multisig and passkey
    // accounts both use the `-1` sentinel, so `index` is not unique and a
    // find() can resolve to the wrong account.
    const account = get().accounts[accountListIndex];
    if (!account?.smartAccountAddress) {
      if (__DEV__) {
        console.log(
          `[syncSigners] abort: no smartAccountAddress (listIndex=${accountListIndex}, account=${account ? account.name : 'undefined'})`,
        );
      }
      return false;
    }

    const factoryAddress = STELLAR_FACTORY_ADDRESS;
    if (!factoryAddress) {
      if (__DEV__) console.log('[syncSigners] abort: factory address not configured for the active network');
      return false;
    }
    if (__DEV__) {
      console.log(
        `[syncSigners] start: account=${account.smartAccountAddress.slice(0, 8)}… factory=${factoryAddress.slice(0, 8)}…`,
      );
    }
    const rpcUrl = STELLAR_RPC_URL;
    const networkPassphrase = STELLAR_NETWORK_PASSPHRASE;

    let rule;
    try {
      rule = await fetchDefaultContextRule(
        { rpcUrl, networkPassphrase, factoryAddress },
        account.smartAccountAddress,
      );
    } catch (e) {
      if (__DEV__) console.warn('syncSignersFromChain failed:', e);
      return false;
    }

    // Reconcile against chain truth. Existing local metadata (label, isLocal,
    // pairedAt, onChainSignerId) is preserved by matching on signerKey; newly
    // discovered signers are added as remote devices.
    const existing = account.devices ?? [];
    const byKey = new Map(existing.map((d) => [d.signerKey, d]));
    const hadLocal = existing.some((d) => d.isLocal);

    // Candidate signer keys that identify THIS device, so we can mark the
    // local signer (vs. members) and not mislabel it. Seed accounts sign with
    // an Ed25519 key; passkey/shared accounts sign with the device's WebAuthn
    // credential stored in SecureStore.
    const localKeys = new Set<string>();
    if (account.gAddress && account.publicKeyHex) {
      localKeys.add(`ed25519:${account.publicKeyHex}`);
    }
    try {
      const selfPasskey = await SecureStore.getItemAsync(SECURE_KEYS.KEY_DATA_HEX);
      if (selfPasskey) localKeys.add(`webauthn:${selfPasskey}`);
    } catch {
      // best-effort; isLocal labelling degrades gracefully without it
    }

    const reconciled: Device[] = rule.signers.map((s) => {
      const prev = byKey.get(s.signerKey);
      if (prev) return prev;
      const isLocal = !hadLocal && localKeys.has(s.signerKey);
      const label = isLocal
        ? 'This Device'
        : s.kind === 'delegated'
          ? 'Member wallet'
          : 'Paired device';
      return {
        signerKey: s.signerKey,
        label,
        kind: s.kind,
        keyDataHex: s.keyDataHex,
        onChainSignerId: null,
        isLocal,
        pairedAt: new Date().toISOString(),
      };
    });

    // Stable order: local device(s) first, then the rest.
    reconciled.sort((a, b) => Number(b.isLocal) - Number(a.isLocal));

    const changed =
      reconciled.length !== existing.length ||
      reconciled.some(
        (d, i) => existing[i]?.signerKey !== d.signerKey || existing[i]?.isLocal !== d.isLocal,
      );
    if (__DEV__) {
      console.log(
        `[syncSigners] ${account.smartAccountAddress?.slice(0, 6)}… chain=${rule.signers.length} local=${existing.length} changed=${changed}`,
      );
    }
    if (changed) {
      // Update positionally so we touch only this account (see lookup note).
      const accounts = get().accounts;
      const updated = accounts.map((a, i) =>
        i === accountListIndex ? { ...a, devices: reconciled } : a,
      );
      await persistAccounts(updated);
      set({ accounts: updated });
    }
    return true;
  },

  // ─── Rehydration ──────────────────────────────────────────────────────────

  rehydrateWallet: async () => {
    try {
      const [
        accountsJson,
        activeIndexStr,
        mnemonic,
        legacySmartAccount,
      ] = await Promise.all([
        SecureStore.getItemAsync(SECURE_KEYS.ACCOUNTS),
        SecureStore.getItemAsync(SECURE_KEYS.ACTIVE_ACCOUNT_INDEX),
        SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC),
        SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT),
      ]);

      // ── Case 1: no wallet at all ──────────────────────────────────────────
      if (!accountsJson && !mnemonic && !legacySmartAccount) return false;

      let accounts: WalletAccount[];
      let activeAccountIndex = 0;

      if (accountsJson) {
        // ── Case 2: new multi-account format ─────────────────────────────────
        accounts = (JSON.parse(accountsJson) as WalletAccount[]).map((a) => ({
          ...a,
          // Backfill multisig fields for accounts persisted before they existed.
          devices: a.devices ?? [],
          adminRuleId: a.adminRuleId ?? null,
        }));

        // Backfill `isMultisig` for shared wallets created before the flag
        // existed. A multisig and a passkey account both have index -1 + empty
        // gAddress, so we can't tell them apart by shape. But a passkey account
        // always stores a credential; a multisig never does. keyDataHex is the
        // PUBLIC half, so reading it never triggers Face ID. Absent credential
        // on an index -1, non-G account ⇒ it's a shared wallet. Without this,
        // an old multisig routes through the passkey send path and the on-chain
        // __check_auth rejects the unrecognized signer (Error(Contract,#3016)).
        accounts = await Promise.all(
          accounts.map(async (a, listIndex) => {
            if (a.isMultisig || a.index !== -1 || a.gAddress || a.credentialId) return a;
            const keyData = await SecureStore.getItemAsync(
              getPasskeyStorageKeys(listIndex).keyDataHex,
            );
            return keyData ? a : { ...a, isMultisig: true };
          }),
        );
        activeAccountIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : 0;
      } else {
        // ── Case 3: migrate old single-account format ─────────────────────────
        if (mnemonic) {
          const wallet = restoreStellarWallet(mnemonic);
          accounts = [
            {
              index: 0,
              name: 'Account 1',
              gAddress: wallet.gAddress,
              publicKeyHex: wallet.publicKeyHex,
              smartAccountAddress: legacySmartAccount ?? null,
              image: null,
            },
          ];
        } else {
          // Passkey user — no mnemonic, single account entry
          accounts = [
            {
              index: -1,
              name: 'Account 1',
              gAddress: '',
              publicKeyHex: '',
              smartAccountAddress: legacySmartAccount ?? null,
              image: null,
            },
          ];
        }
        // Persist the migrated format so next launch skips this branch
        await persistAccounts(accounts);
      }

      // One-time migration: strip stale file:// image URIs — avatars now live in AsyncStorage
      const hasStaleImages = accounts.some(
        (a) => a.image !== null && !a.image?.startsWith('data:'),
      );
      if (hasStaleImages) {
        accounts = accounts.map((a) => ({
          ...a,
          image: a.image?.startsWith('data:') ? a.image : null,
        }));
        persistAccounts(accounts).catch(() => {});
      }

      // Derive the in-memory keypair for the active account
      const activeAccount = accounts[activeAccountIndex] ?? accounts[0];
      const activeWallet =
        mnemonic && activeAccount.index >= 0
          ? getCachedWallet(mnemonic, activeAccount.index)
          : null;

      const storedAvatars = await loadAvatars();

      set({
        mnemonic,
        accounts,
        activeAccountIndex,
        activeWallet,
        smartAccountAddress: activeAccount.smartAccountAddress,
        avatars: storedAvatars,
      });

      return true;
    } catch {
      return false;
    }
  },

  // ─── Full reset ────────────────────────────────────────────────────────────

  clearAll: async () => {
    derivedWalletCache.clear();
    const { accounts } = get();

    // Delete indexed passkey keys for accounts beyond account 0
    const indexedPasskeyDeletions = accounts
      .slice(1)
      .flatMap((_, i) => {
        const keys = getPasskeyStorageKeys(i + 1);
        return [
          SecureStore.deleteItemAsync(keys.credentialId),
          SecureStore.deleteItemAsync(keys.keyDataHex),
          SecureStore.deleteItemAsync(keys.privateKey),
          SecureStore.deleteItemAsync(keys.requiresBiometric),
          SecureStore.deleteItemAsync(keys.kind),
          SecureStore.deleteItemAsync(keys.rpId),
        ];
      });

    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_KEYS.MNEMONIC),
      SecureStore.deleteItemAsync(SECURE_KEYS.SMART_ACCOUNT),
      SecureStore.deleteItemAsync(SECURE_KEYS.ACCOUNTS),
      SecureStore.deleteItemAsync(SECURE_KEYS.ACTIVE_ACCOUNT_INDEX),
      SecureStore.deleteItemAsync(SECURE_KEYS.PIN),
      SecureStore.deleteItemAsync(SECURE_KEYS.PENDING_MNEMONIC),
      SecureStore.deleteItemAsync(SECURE_KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN),
      SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN),
      SecureStore.deleteItemAsync(SECURE_KEYS.USER_EMAIL),
      SecureStore.deleteItemAsync(SECURE_KEYS.CREDENTIAL_ID),
      SecureStore.deleteItemAsync(SECURE_KEYS.KEY_DATA_HEX),
      SecureStore.deleteItemAsync(SECURE_KEYS.PASSKEY_PRIVATE_KEY),
      SecureStore.deleteItemAsync(SECURE_KEYS.PASSKEY_KIND),
      AsyncStorage.removeItem(ASYNC_KEYS.AVATARS),
      AsyncStorage.removeItem(ASYNC_KEYS.BACKUP_PENDING),
      clearSacTransferCache(),
      ...indexedPasskeyDeletions,
    ]);
    set({
      pendingWallet: null,
      mnemonic: null,
      accounts: [],
      activeAccountIndex: 0,
      activeWallet: null,
      smartAccountAddress: null,
      avatars: {},
    });
  },
}));
