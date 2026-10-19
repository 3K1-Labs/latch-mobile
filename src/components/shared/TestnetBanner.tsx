import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, usePathname } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Text from '@/src/components/shared/Text';
import { useWalletStore } from '@/src/store/wallet';
import { useAppTheme } from '@/src/theme/ThemeContext';

/**
 * Animated pulsing dot indicator for the Testnet pill.
 * Features an outer glowing ring that expands and fades,
 * combined with a crisp solid amber core.
 */
function PulseDot({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.75);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(2.2, {
        duration: 1500,
        easing: Easing.out(Easing.ease),
      }),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withTiming(0, {
        duration: 1500,
        easing: Easing.out(Easing.ease),
      }),
      -1,
      false,
    );
  }, [scale, opacity]);

  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.dotContainer}>
      <Animated.View
        style={[
          styles.pulseRing,
          { backgroundColor: color },
          animatedRingStyle,
        ]}
      />
      <View style={[styles.solidDot, { backgroundColor: color }]} />
    </View>
  );
}

/**
 * TestnetBanner — floating capsule pill indicating active Testnet mode.
 *
 * Positioned below the notch/status bar with responsive placement:
 * - Center-aligned on the Home screen (sits between account pill and action icons)
 * - Left-aligned on Explore (avoids the right-side QR scanner)
 * - Right-aligned on Swap, History, and modal sheets (balances the left back button)
 * - Hidden on the Network Settings screen itself to avoid redundant clutter
 *
 * Tapping opens /network-settings so the user can easily review or switch networks.
 */
export default function TestnetBanner() {
  const insets = useSafeAreaInsets();
  const activeNetwork = useWalletStore((s) => s.activeNetwork);
  const { isDark } = useAppTheme();
  const pathname = usePathname();

  if (activeNetwork !== 'testnet') return null;
  if (pathname === '/network-settings') return null;

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/network-settings');
  };

  const isHome =
    !pathname ||
    pathname === '/' ||
    pathname === '/(tabs)' ||
    pathname === '/(tabs)/index' ||
    pathname === '/index';

  const isExplore = pathname === '/explore' || pathname === '/(tabs)/explore';

  const topInset = Math.max(insets.top, 12);
  const topOffset = topInset + (isHome ? 15 : 14);

  const positionStyle: ViewStyle = isHome
    ? { left: 0, right: 0, alignItems: 'center' }
    : isExplore
      ? { left: 16, alignItems: 'flex-start' }
      : { right: 16, alignItems: 'flex-end' };

  const amberColor = isDark ? '#FFA128' : '#D97706';
  const amberChevronColor = isDark ? 'rgba(255, 161, 40, 0.7)' : 'rgba(217, 119, 6, 0.7)';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outerContainer,
        { top: topOffset },
        positionStyle,
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Testnet active. Tap to switch networks."
        accessibilityHint="Opens network settings"
        style={[
          styles.pill,
          {
            backgroundColor: isDark ? 'rgba(26, 22, 18, 0.92)' : 'rgba(255, 248, 238, 0.96)',
            borderColor: isDark ? 'rgba(255, 161, 40, 0.38)' : 'rgba(217, 119, 6, 0.38)',
            shadowOpacity: isDark ? 0.25 : 0.15,
          },
        ]}
      >
        <PulseDot color={amberColor} />
        <Text
          variant="captionBold"
          style={[styles.label, { color: amberColor }]}
        >
          TESTNET
        </Text>
        <Ionicons
          name="chevron-forward"
          size={11}
          color={amberChevronColor}
          style={styles.chevron}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    zIndex: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4.5,
    paddingHorizontal: 10,
    borderRadius: 100,
    borderWidth: 1,
    shadowColor: '#FFA128',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  dotContainer: {
    width: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  pulseRing: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  solidDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.8,
    fontFamily: 'SFproBold',
  },
  chevron: {
    marginLeft: 3,
  },
});
