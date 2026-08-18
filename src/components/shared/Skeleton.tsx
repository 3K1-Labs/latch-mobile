import React, { useEffect } from 'react';
import { type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import Box from '@/src/components/shared/Box';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface SkeletonProps {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  /** Spacing token applied as marginBottom, for stacking rows. */
  mb?: 'xs' | 's' | 'm' | 'l';
}

/**
 * Placeholder block for a section whose data has not arrived yet.
 *
 * Used in place of a blocking full-screen spinner: each section says it is
 * loading on its own, so a slow query can never hold the rest of the screen.
 */
const Skeleton = ({ width, height, borderRadius = 8, mb }: SkeletonProps) => {
  const { isDark } = useAppTheme();
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.75, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [opacity]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={pulse}>
      <Box
        width={width}
        height={height}
        borderRadius={borderRadius}
        mb={mb}
        backgroundColor={isDark ? 'gray900' : 'gray100'}
      />
    </Animated.View>
  );
};

export default Skeleton;
