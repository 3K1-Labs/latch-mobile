import React, { createContext, useContext, useMemo, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  Easing,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Drives the bottom tab bar's scroll-reactive shrink. `shrink` runs 0 → 1
 * (0 = full size, 1 = shrunk). Screens feed scroll deltas via `useTabBarScroll`;
 * the CustomTabBar reads `shrink` and animates its scale.
 */
interface TabBarScrollContextValue {
  shrink: SharedValue<number>;
}

const TabBarScrollContext = createContext<TabBarScrollContextValue | null>(null);

const SHRINK_TIMING = { duration: 380, easing: Easing.inOut(Easing.cubic) };

// Per-frame delta needed to act. The up (expand) threshold is larger so that
// bounce/overscroll recoil — which registers as small upward deltas — doesn't
// snap the bar back to full size.
const DOWN_THRESHOLD = 4;
const UP_THRESHOLD = 14;

export function TabBarScrollProvider({ children }: { children: React.ReactNode }) {
  const shrink = useSharedValue(0);
  const value = useMemo(() => ({ shrink }), [shrink]);
  return <TabBarScrollContext.Provider value={value}>{children}</TabBarScrollContext.Provider>;
}

/** Consumed by the CustomTabBar. Null when no provider is mounted. */
export function useTabBarShrink(): SharedValue<number> | null {
  return useContext(TabBarScrollContext)?.shrink ?? null;
}

/**
 * Spread the returned props onto a screen's main scroll container
 * (`<ScrollView {...useTabBarScroll()} />`). Scrolling down shrinks the tab
 * bar; scrolling up — or reaching the top — restores it.
 */
export function useTabBarScroll() {
  const ctx = useContext(TabBarScrollContext);
  const lastY = useRef(0);
  const lastTarget = useRef(0);

  return useMemo(() => {
    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const shrink = ctx?.shrink;
      if (!shrink) return;

      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      lastY.current = y;

      // Only dispatch a worklet animation on an actual 0↔1 transition, not
      // on every scroll frame that stays in the same state.
      const setTarget = (t: 0 | 1) => {
        if (lastTarget.current === t) return;
        lastTarget.current = t;
        shrink.value = withTiming(t, SHRINK_TIMING);
      };

      // Always expand near the very top.
      if (y <= 8) {
        setTarget(0);
        return;
      }

      if (dy > 0) {
        // Scrolling down → shrink.
        if (dy >= DOWN_THRESHOLD) setTarget(1);
      } else {
        // Scrolling up → expand, but only past the bounce-jitter threshold.
        if (-dy >= UP_THRESHOLD) setTarget(0);
      }
    };

    return { onScroll, scrollEventThrottle: 16 };
  }, [ctx]);
}
