import Box from '@/src/components/shared/Box';
import { LINKS, MARK_VIEWBOX } from '@/src/components/splash/link-paths';
import { SECURE_KEYS } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const LOGO = require('@/src/assets/images/logoLoading.png');
// Must match the native launch screen (app.config.js: expo-splash-screen imageWidth),
// so the hand-off is invisible: the first frame is the logo at rest.
const LOGO_W = 120;
const LOGO_H = Math.round((LOGO_W * 180) / 336);
const UNIT = LOGO_W / MARK_VIEWBOX.width;

const SHOCK = 130;
const SPARKS = 12;

// How far the links swing open, per side.
const OPEN_X = 30;
const OPEN_DEG = 18;

// The native splash hides ~500ms after this screen mounts (app/_layout.tsx).
const HANDOFF = 550;
const OPEN = 420;
const SNAP_AT = HANDOFF + 720;
const IMPACT = SNAP_AT + 90;
const NAVIGATE_AT = IMPACT + 720;
const NAVIGATE_AT_REDUCED = HANDOFF + 450;

const ease = (duration: number, curve = Easing.out(Easing.cubic)) => ({ duration, easing: curve });
const SNAP = { stiffness: 700, damping: 16, mass: 0.6 };

/** One link of the mark, drawn on its own so it can swing about its own centre. */
const Link = ({
  link,
  side,
  open,
  bob,
  color,
}: {
  link: (typeof LINKS)['left' | 'right'];
  side: -1 | 1;
  open: SharedValue<number>;
  bob: SharedValue<number>;
  color: string;
}) => {
  const width = (link.x1 - link.x0) * UNIT;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: side * OPEN_X * open.value },
      { translateY: side * 3 * bob.value },
      { rotate: `${side * OPEN_DEG * open.value}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.link, { left: link.x0 * UNIT, width }, style]}>
      <Svg
        width={width}
        height={LOGO_H}
        viewBox={`${link.x0} 0 ${link.x1 - link.x0} ${MARK_VIEWBOX.height}`}
        preserveAspectRatio="none"
      >
        <Path d={link.d} fill={color} />
      </Svg>
    </Animated.View>
  );
};

const Spark = ({
  index,
  burst,
  color,
}: {
  index: number;
  burst: SharedValue<number>;
  color: string;
}) => {
  const angle = (index / SPARKS) * 2 * Math.PI + 0.2;
  const reach = index % 2 === 0 ? 46 : 32;
  const style = useAnimatedStyle(() => {
    const t = burst.value;
    const r = 20 + reach * t;
    return {
      opacity: t === 0 ? 0 : 1 - t,
      transform: [
        { translateX: r * Math.cos(angle) },
        { translateY: r * Math.sin(angle) },
        { rotate: `${angle}rad` },
        { scaleX: 1 - 0.6 * t },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.spark, { backgroundColor: color }, style]} />
  );
};

const Splash = () => {
  const router = useRouter();
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  // `split` swaps the flat logo for the two separate links while they move.
  const split = useSharedValue(0);
  const open = useSharedValue(0);
  const bob = useSharedValue(0);
  const scale = useSharedValue(1);
  const burst = useSharedValue(0);
  const shock = useSharedValue(0);

  const route = useCallback(async () => {
    try {
      // SECURE_KEYS.SMART_ACCOUNT is written by deploy-account.tsx for both the
      // passkey and the Ed25519 (import-phrase) paths; its presence means a wallet exists.
      const smartAccountAddress = await SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT);
      if (smartAccountAddress) {
        router.replace({ pathname: '/(auth)/biometric', params: { mode: 'unlock' } });
        return;
      }
      router.replace('/onboarding');
    } catch {
      router.replace('/onboarding');
    }
  }, [router]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const animate = () => {
      split.set(
        withSequence(
          withDelay(HANDOFF, withTiming(1, { duration: 1 })),
          withDelay(IMPACT + 450 - HANDOFF, withTiming(0, { duration: 1 })),
        ),
      );
      // 1. Unlatch: the links swing apart and hang there, drifting.
      // 2. Relatch: a wind-up, then they snap shut.
      open.set(
        withSequence(
          withDelay(HANDOFF, withTiming(1, ease(OPEN, Easing.out(Easing.back(1.6))))),
          withDelay(
            SNAP_AT - HANDOFF - OPEN - 160,
            withTiming(1.15, ease(160, Easing.out(Easing.quad))),
          ),
          withSpring(0, SNAP),
        ),
      );
      bob.set(
        withSequence(
          withDelay(HANDOFF + 180, withTiming(1, ease(260, Easing.inOut(Easing.sin)))),
          withTiming(-0.4, ease(260, Easing.inOut(Easing.sin))),
          withTiming(0, ease(120)),
        ),
      );
      // 3. Impact: sparks fly from the join, a shockwave, and the beat.
      burst.set(withDelay(IMPACT, withTiming(1, ease(480))));
      shock.set(withDelay(IMPACT, withTiming(1, ease(620))));
      scale.set(
        withDelay(
          IMPACT,
          withSequence(
            withTiming(1.1, ease(110, Easing.out(Easing.quad))),
            withSpring(1, { damping: 9, stiffness: 230, mass: 0.8 }),
          ),
        ),
      );
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        // Reduced motion: the logo simply holds, then moves on.
        if (!reduced) animate();
        timer = setTimeout(route, reduced ? NAVIGATE_AT_REDUCED : NAVIGATE_AT);
      });

    return () => clearTimeout(timer);
  }, [bob, burst, open, route, scale, shock, split]);

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const flatStyle = useAnimatedStyle(() => ({ opacity: 1 - split.value }));
  const linksStyle = useAnimatedStyle(() => ({ opacity: split.value }));
  const shockStyle = useAnimatedStyle(() => ({
    opacity: shock.value === 0 ? 0 : 0.7 * (1 - shock.value),
    transform: [{ scale: 0.4 + 1.8 * shock.value }],
  }));

  const accent = theme.colors.primary700;
  const spark = isDark ? '#FFE7A3' : accent;

  return (
    <Box flex={1} backgroundColor="surfaceBase" alignItems="center" justifyContent="center">
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Animated.View
        pointerEvents="none"
        style={[styles.shock, { borderColor: accent }, shockStyle]}
      />

      <Animated.View style={[styles.mark, markStyle]} accessible accessibilityLabel="Latch">
        <Animated.View style={flatStyle}>
          <Image source={LOGO} contentFit="contain" style={styles.mark} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, linksStyle]}>
          <Link link={LINKS.left} side={-1} open={open} bob={bob} color={accent} />
          <Link link={LINKS.right} side={1} open={open} bob={bob} color={accent} />
        </Animated.View>
      </Animated.View>

      {/* In front of the mark, so they read as flying off the join. */}
      {Array.from({ length: SPARKS }, (_, i) => (
        <Spark key={i} index={i} burst={burst} color={spark} />
      ))}
    </Box>
  );
};

const styles = StyleSheet.create({
  mark: {
    width: LOGO_W,
    height: LOGO_H,
  },
  link: {
    position: 'absolute',
    top: 0,
    height: LOGO_H,
  },
  shock: {
    position: 'absolute',
    width: SHOCK,
    height: SHOCK,
    borderRadius: SHOCK / 2,
    borderWidth: 2,
  },
  spark: {
    position: 'absolute',
    width: 10,
    height: 2.5,
    borderRadius: 1.25,
  },
});

export default Splash;
