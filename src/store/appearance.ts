import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** 'system' follows the phone's light/dark setting. Device-level, not per account. */
export type AppearancePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'latch.appearance.v1';
const VALUES: AppearancePreference[] = ['system', 'light', 'dark'];

interface AppearanceState {
  preference: AppearancePreference;
  hydrated: boolean;
  rehydrate: () => Promise<void>;
  setPreference: (preference: AppearancePreference) => void;
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  preference: 'system',
  hydrated: false,

  rehydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw && (VALUES as string[]).includes(raw)) {
        set({ preference: raw as AppearancePreference, hydrated: true });
        return;
      }
    } catch {
      // A miss just leaves 'system'.
    }
    set({ hydrated: true });
  },

  setPreference: (preference) => {
    set({ preference });
    AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => {});
  },
}));

export async function hydrateAppearance(): Promise<void> {
  await useAppearanceStore.getState().rehydrate();
}
