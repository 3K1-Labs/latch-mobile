import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * "Accounts this device guards" — the missing half of the guardian protocol.
 *
 * Accepting a guardian invite is peer-to-peer: this device signs a challenge
 * and hands the reply back, then hears nothing else. There is no server
 * announcing the role (unlike shared-wallet membership) and no push
 * notification when the owner finishes adding it on chain, so without this,
 * a device that became a guardian has no way to ever be reminded of it short
 * of someone telling it the account address again.
 *
 * Entries are added the moment this device learns something concrete:
 *   - `pending`  it sent a signed accept reply, but the owner may never have
 *                finished `setUpRecovery` — nothing on chain confirms it yet.
 *   - `active`   confirmed live via `fetchRecoveryStatus` + `findLocalGuardian`.
 *   - `removed`  was active, then a re-check found the guardian rule gone or
 *                this device no longer on it. Kept visible rather than
 *                silently deleted — a role disappearing without explanation
 *                is worse than one marked "no longer active."
 *
 * Just public C-addresses and counts, nothing sensitive — same class of data
 * as the shared-wallet pending-announce list in src/lib/membership.ts.
 */
const STORAGE_KEY = 'latch.guardianRoles.v1';

export type GuardianRoleStatus = 'pending' | 'active' | 'removed';

export interface GuardianRole {
  /** The C-address of the account this device guards. */
  account: string;
  status: GuardianRoleStatus;
  /** Group size, when known from a confirmed on-chain read. */
  guardianCount?: number;
  threshold?: number;
  /** When this device first learned about the role. */
  addedAt: number;
  /** Last time status was checked against chain (or the accept happened). */
  lastCheckedAt: number;
}

interface GuardianRolesState {
  roles: GuardianRole[];
  hydrated: boolean;
  /** Loads the persisted list once. Safe to call repeatedly. */
  rehydrate: () => Promise<void>;
  /** Insert or update by account address. Preserves the original `addedAt`. */
  upsert: (role: {
    account: string;
    status: GuardianRoleStatus;
    guardianCount?: number;
    threshold?: number;
  }) => void;
  /** Explicit user action only — nothing in this store auto-deletes an entry. */
  remove: (account: string) => void;
}

function persist(roles: GuardianRole[]): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(roles)).catch(() => {
    // best-effort; a missed persist just means this update isn't durable
  });
}

export const useGuardianRoles = create<GuardianRolesState>((set, get) => ({
  roles: [],
  hydrated: false,

  rehydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const roles = raw ? JSON.parse(raw) : [];
      set({ roles: Array.isArray(roles) ? roles : [], hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  upsert: (role) => {
    const now = Date.now();
    const existing = get().roles.find((r) => r.account === role.account);
    const next: GuardianRole = {
      account: role.account,
      status: role.status,
      guardianCount: role.guardianCount ?? existing?.guardianCount,
      threshold: role.threshold ?? existing?.threshold,
      addedAt: existing?.addedAt ?? now,
      lastCheckedAt: now,
    };
    const roles = [next, ...get().roles.filter((r) => r.account !== role.account)];
    set({ roles });
    persist(roles);
  },

  remove: (account) => {
    const roles = get().roles.filter((r) => r.account !== account);
    set({ roles });
    persist(roles);
  },
}));
