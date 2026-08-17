import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * Queue of auto-detected shared-wallet addresses awaiting a name from the user.
 * The background discovery sweep enqueues addresses instead of silently adding
 * them; SharedWalletNamingModal drains the queue one at a time, letting the user
 * name each wallet before it's stored (the verified add happens on submit).
 *
 * `queue` is persisted to AsyncStorage (just public C-addresses, nothing
 * sensitive) so a discovered-but-not-yet-named wallet survives a JS reload or
 * app kill instead of silently vanishing until the next foreground sweep
 * happens to re-find it.
 *
 * `dismissed` holds addresses the user tapped "Not now" on. It's session-scoped
 * (in-memory) on purpose: discovery runs every foreground, so without it a
 * declined wallet would re-prompt within 30s. Being added to a shared wallet is
 * worth re-surfacing eventually, so we let a fresh app launch re-offer it rather
 * than persisting the dismissal forever (the wallet also stays addable by hand).
 */
const STORAGE_KEY = 'latch.sharedWalletNamingQueue.v1';

interface SharedWalletNamingState {
  queue: string[];
  dismissed: string[];
  hydrated: boolean;
  // Loads the persisted queue once. Safe to call repeatedly; a no-op after
  // the first successful (or failed) load.
  rehydrate: () => Promise<void>;
  // Returns true if newly enqueued, false if already pending or dismissed (dedup).
  enqueue: (address: string) => boolean;
  dequeue: () => void;
  // Drop the head of the queue and suppress it for the rest of this session.
  dismiss: (address: string) => void;
}

function persistQueue(queue: string[]): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue)).catch(() => {
    // best-effort; a missed persist just means a reload before the next
    // enqueue/dequeue loses this queue, same as before this store persisted
  });
}

export const useSharedWalletNaming = create<SharedWalletNamingState>((set, get) => ({
  queue: [],
  dismissed: [],
  hydrated: false,

  rehydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      set({ queue: Array.isArray(queue) ? queue : [], hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  enqueue: (address) => {
    const { queue, dismissed } = get();
    if (queue.includes(address) || dismissed.includes(address)) return false;
    const next = [...queue, address];
    set({ queue: next });
    persistQueue(next);
    return true;
  },
  dequeue: () => {
    const next = get().queue.slice(1);
    set({ queue: next });
    persistQueue(next);
  },
  dismiss: (address) => {
    const next = get().queue.filter((a) => a !== address);
    set((s) => ({
      queue: next,
      dismissed: s.dismissed.includes(address) ? s.dismissed : [...s.dismissed, address],
    }));
    persistQueue(next);
  },
}));
