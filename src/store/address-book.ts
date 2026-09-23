import AsyncStorage from '@react-native-async-storage/async-storage';
import QuickCrypto from 'react-native-quick-crypto';
import { create } from 'zustand';

/**
 * Locally-saved wallet addresses ("contacts"). Local only — there is no
 * backend concept of an address book, this is purely a per-device convenience
 * for the send flow.
 *
 * A shared zustand store (rather than a per-hook `useState`) so every screen
 * reading it — the management sheet, the send flow's recipient picker — sees
 * the same list and stays in sync without each owning its own copy.
 *
 * Persisted key is versioned (`.v1`) like the other local stores
 * (signer-nicknames, shared-wallet-naming) so a future shape change has a
 * clean migration path. `rehydrate()` also imports the one-off pre-store key
 * this data used to live under, then deletes it.
 */
const STORAGE_KEY = 'latch.addressBook.v1';
const LEGACY_STORAGE_KEY = 'latch_address_book';

export interface AddressBookEntry {
  id: string;
  label: string;
  address: string;
  network: 'Stellar';
  createdAt: number;
  updatedAt: number;
}

type SaveInput = { label: string; address: string };

type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: 'duplicate'; existing: AddressBookEntry }
  | { ok: false; error: 'not-found' };

interface AddressBookState {
  entries: Record<string, AddressBookEntry>;
  hydrated: boolean;
  rehydrate: () => Promise<void>;
  addEntry: (input: SaveInput) => SaveResult;
  updateEntry: (id: string, input: SaveInput) => SaveResult;
  removeEntry: (id: string) => AddressBookEntry | undefined;
  restoreEntry: (entry: AddressBookEntry) => void;
  findByAddress: (address: string, excludeId?: string) => AddressBookEntry | undefined;
}

function newId(): string {
  return Buffer.from(QuickCrypto.randomBytes(16)).toString('hex');
}

function normalize(input: SaveInput): SaveInput {
  return { label: input.label.trim(), address: input.address.trim().toUpperCase() };
}

function persist(entries: Record<string, AddressBookEntry>): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {
    // best-effort; a missed persist just means a reload loses this write
  });
}

export const useAddressBookStore = create<AddressBookState>((set, get) => ({
  entries: {},
  hydrated: false,

  rehydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        set({ entries: JSON.parse(raw), hydrated: true });
        return;
      }

      // One-time migration from the old, unversioned key.
      const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        const legacyList = JSON.parse(legacyRaw) as {
          id: string;
          label: string;
          address: string;
          network?: string;
        }[];
        const now = Date.now();
        const migrated: Record<string, AddressBookEntry> = {};
        for (const entry of legacyList) {
          migrated[entry.id] = {
            id: entry.id,
            label: entry.label,
            address: entry.address,
            network: 'Stellar',
            createdAt: now,
            updatedAt: now,
          };
        }
        set({ entries: migrated, hydrated: true });
        persist(migrated);
        AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
        return;
      }

      set({ hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  findByAddress: (address, excludeId) => {
    const normalized = address.trim().toUpperCase();
    return Object.values(get().entries).find(
      (e) => e.address === normalized && e.id !== excludeId,
    );
  },

  addEntry: (input) => {
    const { label, address } = normalize(input);
    const existing = get().findByAddress(address);
    if (existing) {
      return { ok: false, error: 'duplicate', existing };
    }

    const now = Date.now();
    const id = newId();
    const entry: AddressBookEntry = { id, label, address, network: 'Stellar', createdAt: now, updatedAt: now };
    const next = { ...get().entries, [id]: entry };
    set({ entries: next });
    persist(next);
    return { ok: true, id };
  },

  updateEntry: (id, input) => {
    const { label, address } = normalize(input);
    const existing = get().findByAddress(address, id);
    if (existing) {
      return { ok: false, error: 'duplicate', existing };
    }

    const current = get().entries[id];
    if (!current) {
      return { ok: false, error: 'not-found' };
    }

    const updated: AddressBookEntry = { ...current, label, address, updatedAt: Date.now() };
    const next = { ...get().entries, [id]: updated };
    set({ entries: next });
    persist(next);
    return { ok: true, id };
  },

  removeEntry: (id) => {
    const removed = get().entries[id];
    if (!removed) return undefined;
    const next = { ...get().entries };
    delete next[id];
    set({ entries: next });
    persist(next);
    return removed;
  },

  restoreEntry: (entry) => {
    const next = { ...get().entries, [entry.id]: entry };
    set({ entries: next });
    persist(next);
  },
}));
