import { create } from 'zustand';

export interface HistoryDateRange {
  period: string;
  start: Date;
  end: Date;
}

/** Date range applied from the filter sheet to the History list. Session-only. */
interface HistoryFilterState {
  range: HistoryDateRange | null;
  setRange: (range: HistoryDateRange) => void;
  clear: () => void;
}

export const useHistoryFilterStore = create<HistoryFilterState>((set) => ({
  range: null,
  setRange: (range) => set({ range }),
  clear: () => set({ range: null }),
}));
