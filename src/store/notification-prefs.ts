import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** Push categories the user can switch off. The inbox always records every event. */
export type NotificationCategory = 'transactions' | 'security' | 'appUpdates';

export type NotificationPrefs = Record<NotificationCategory, boolean>;

const STORAGE_KEY = 'latch.notification-prefs.v1';
const DEFAULTS: NotificationPrefs = { transactions: true, security: true, appUpdates: true };

// Device-local until latch-api stores preferences per push device; nothing
// reads these to filter pushes yet.
interface NotificationPrefsState {
  prefs: NotificationPrefs;
  hydrated: boolean;
  rehydrate: () => Promise<void>;
  setPref: (category: NotificationCategory, enabled: boolean) => void;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  prefs: DEFAULTS,
  hydrated: false,

  rehydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<NotificationPrefs>;
        const prefs = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as NotificationCategory[]) {
          if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
        }
        set({ prefs, hydrated: true });
        return;
      }
    } catch {
      // A miss or bad JSON leaves everything on.
    }
    set({ hydrated: true });
  },

  setPref: (category, enabled) => {
    const prefs = { ...get().prefs, [category]: enabled };
    set({ prefs });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
  },
}));
