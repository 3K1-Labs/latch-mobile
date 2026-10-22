import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  DEFAULT_FIAT_CURRENCY,
  isFiatCurrencyCode,
  type FiatCurrencyCode,
} from '@/src/constants/currencies';

/**
 * Display-currency preference. Device-level (like network), not per account:
 * it only changes how USD prices are labelled, and nothing about keys or
 * balances is account-specific here.
 */
const STORAGE_KEY = 'latch.display-currency.v1';

interface DisplayCurrencyState {
  currency: FiatCurrencyCode;
  hydrated: boolean;
  rehydrate: () => Promise<void>;
  setCurrency: (currency: FiatCurrencyCode) => void;
}

export const useDisplayCurrencyStore = create<DisplayCurrencyState>((set, get) => ({
  currency: DEFAULT_FIAT_CURRENCY,
  hydrated: false,

  rehydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw && isFiatCurrencyCode(raw)) {
        set({ currency: raw, hydrated: true });
        return;
      }
    } catch {
      // A miss just leaves the default USD.
    }
    set({ hydrated: true });
  },

  setCurrency: (currency) => {
    set({ currency });
    AsyncStorage.setItem(STORAGE_KEY, currency).catch(() => {});
  },
}));

export async function hydrateDisplayCurrency(): Promise<void> {
  await useDisplayCurrencyStore.getState().rehydrate();
}
