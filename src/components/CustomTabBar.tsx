import { useTheme } from '@shopify/restyle';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarShrink } from '../context/tab-bar-scroll';
import { usePendingPackets } from '../hooks/use-pending-packets';
import { useAppTheme } from '../theme/ThemeContext';
import { Theme } from '../theme/theme';
import { TabBarExploreIcon } from './navigation/TabBarExploreIcon';
import { TabBarHistoryIcon } from './navigation/TabBarHistoryIcon';
import { TabBarHomeIcon } from './navigation/TabBarHomeIcon';
import { TabBarSwapIcon } from './navigation/TabBarSwapIcon';

// Re-export Swap for compatibility with swap.tsx
export { TabBarSwapIcon as Swap } from './navigation/TabBarSwapIcon';

const TAB_ITEMS = [
  { name: 'index', icon: TabBarHomeIcon, label: 'Home' },
  { name: 'swap', icon: TabBarSwapIcon, label: 'Swap' },
  { name: 'history', icon: TabBarHistoryIcon, label: 'History' },
  { name: 'explore', icon: TabBarExploreIcon, label: 'Explore' },
];

const PILL_PADDING = 8;
const INDICATOR_WIDTH = 76;
const INDICATOR_HEIGHT = 44;
const PILL_HEIGHT = 72;

// iOS 26+ ships the Liquid Glass design; render a native GlassView background
// there and fall back to the BlurView + translucent fill on older iOS/Android.
// Availability never changes at runtime, so resolve it once at module load.
const LIQUID_GLASS = isLiquidGlassAvailable();

export function CustomTabBar({ state, navigation }: any) {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { count: pendingCount } = usePendingPackets();

  const pillWidth = useSharedValue(0);
  const activeIndex = useSharedValue(state.index);

  // Scroll-reactive shrink: pill scales down a touch when the active screen
  // scrolls downward, restoring on upward scroll / at the top.
  const shrink = useTabBarShrink();
  const shrinkStyle = useAnimatedStyle(() => {
    const s = shrink?.value ?? 0;
    return {
      transform: [{ scale: interpolate(s, [0, 1], [1, 0.9]) }, { translateY: interpolate(s, [0, 1], [0, 6]) }],
      opacity: interpolate(s, [0, 1], [1, 0.92]),
    };
  });

  useEffect(() => {
    activeIndex.value = withTiming(state.index, {
      duration: 400,
      easing: Easing.out(Easing.cubic),
    });
  }, [state.index, activeIndex]);

  const indicatorStyle = useAnimatedStyle(() => {
    const tabWidth = (pillWidth.value - PILL_PADDING * 2) / TAB_ITEMS.length;
    const x = PILL_PADDING + activeIndex.value * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2;
    return { transform: [{ translateX: x }] };
  });

  const containerBg = isDark ? 'rgba(26, 26, 28, 0.95)' : 'rgba(245, 245, 247, 0.95)';
  const containerBorder = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

  const indicatorBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
  const indicatorBorder = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.12)';

  const activeColor = theme.colors.primary700;
  const inactiveColor = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';

  return (
    <View style={[styles.wrapper, { bottom: insets.bottom > 0 ? insets.bottom : 16 }]}>
      {/* Plain View container — BlurView must stay a childless absolute-fill
          layer here. On Android, expo-blur's native BlurView inserts its own
          internal child via addView() outside RN's Yoga-managed child list,
          so any real content (the tab row) nested inside it falls back to
          native top-left stacking instead of flexDirection: row. */}
      <Animated.View
        style={[
          styles.pill,
          { borderColor: containerBorder },
          // Liquid Glass supplies its own edge treatment — drop the manual border.
          LIQUID_GLASS && styles.pillGlass,
          shrinkStyle,
        ]}
        onLayout={(e) => {
          pillWidth.value = e.nativeEvent.layout.width;
        }}
      >
        {LIQUID_GLASS ? (
          <GlassView
            style={[StyleSheet.absoluteFill, { borderRadius: 36 }]}
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            isInteractive
          />
        ) : (
          <>
            <BlurView
              intensity={30}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[StyleSheet.absoluteFill, { borderRadius: 36, backgroundColor: containerBg }]}
            />
          </>
        )}
        <Animated.View
          style={[
            styles.indicator,
            indicatorStyle,
            {
              backgroundColor: indicatorBg,
              borderColor: indicatorBorder,
            },
          ]}
        />
        {TAB_ITEMS.map((item, index) => {
          const isFocused = state.index === index;

          const onPress = () => {
            const route = state.routes.find((r: any) => r.name === item.name);
            if (route) {
              const event = navigation.emit({ target: route.key, canPreventDefault: true });
              if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
            } else {
              navigation.navigate(item.name);
            }
          };

          const color = isFocused ? activeColor : inactiveColor;
          const showBadge = item.name === 'history' && pendingCount > 0;

          return (
            <TouchableOpacity
              key={item.name}
              onPress={onPress}
              style={styles.tabButton}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrap}>
                <item.icon width={24} color={color} />
                {showBadge && (
                  <View style={[styles.badge, { backgroundColor: theme.colors.primary700 }]}>
                    <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 24,
  },
  pill: {
    flexDirection: 'row',
    borderRadius: 36,
    height: PILL_HEIGHT,
    paddingHorizontal: PILL_PADDING,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  pillGlass: {
    borderWidth: 0,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  indicator: {
    position: 'absolute',
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
    top: (PILL_HEIGHT - INDICATOR_HEIGHT) / 2,
    left: 0,
    borderRadius: 22,
    borderWidth: 1,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
