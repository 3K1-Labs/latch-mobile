import { Image } from 'expo-image';
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import Box from '@/src/components/shared/Box';
import type { ArtLayer, ArtPart, Illustration, Motion } from './slides';

export const ARTBOARD_WIDTH = 390;
export const ARTBOARD_HEIGHT = 465;

const EASE_IN_OUT = Easing.bezierFn(0.42, 0, 0.58, 1);

const sample = (progress: number, motion: Motion, values: number[] | undefined, rest: number) => {
  'worklet';
  if (!values) return rest;
  const { times, easings } = motion;
  let i = 0;
  while (i < times.length - 2 && progress > times[i + 1]) i++;
  const t = (progress - times[i]) / (times[i + 1] - times[i]);
  const ease = easings ? easings[i] : EASE_IN_OUT;
  return values[i] + (values[i + 1] - values[i]) * ease(t);
};

const Part = ({ part }: { part: ArtPart }) => {
  const { source, frame, size, transform, imageInset } = part;
  return (
    <Box style={[styles.part, frame]}>
      <Box
        style={{
          width: size ? size[0] : frame.width,
          height: size ? size[1] : frame.height,
          overflow: imageInset ? 'hidden' : 'visible',
          transform,
        }}
      >
        <Image
          source={source}
          contentFit="fill"
          style={
            imageInset
              ? {
                  position: 'absolute',
                  top: `${imageInset[0]}%`,
                  right: `${imageInset[1]}%`,
                  bottom: `${imageInset[2]}%`,
                  left: `${imageInset[3]}%`,
                }
              : StyleSheet.absoluteFill
          }
        />
      </Box>
    </Box>
  );
};

const Parts = ({ layer }: { layer: ArtLayer }) => (
  <>
    {layer.parts.map((part, index) => (
      <Part key={index} part={part} />
    ))}
  </>
);

const MovingLayer = ({
  layer,
  motion,
  progress,
}: {
  layer: ArtLayer;
  motion: Motion;
  progress: SharedValue<number>;
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: sample(p, motion, motion.x, 0) },
        { translateY: sample(p, motion, motion.y, 0) },
        { rotate: `${sample(p, motion, motion.rotate, 0)}rad` },
        { scaleX: sample(p, motion, motion.scaleX, 1) },
        { scaleY: sample(p, motion, motion.scaleY, 1) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.layer, layer.frame, animatedStyle]}>
      <Parts layer={layer} />
    </Animated.View>
  );
};

interface Props {
  illustration: Illustration;
  scale: number;
}

const OnboardingIllustration: React.FC<Props> = ({ illustration, scale }) => {
  const { artboard, clip, durationMs, layers } = illustration;
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [durationMs, progress, reducedMotion]);

  return (
    <Box style={{ width: ARTBOARD_WIDTH * scale, height: ARTBOARD_HEIGHT * scale }}>
      <Box style={[styles.canvas, { transform: [{ scale }] }]}>
        <Box style={[styles.layer, artboard, clip && styles.clip]}>
          {layers.map((layer, index) =>
            layer.motion && !reducedMotion ? (
              <MovingLayer key={index} layer={layer} motion={layer.motion} progress={progress} />
            ) : (
              <Box key={index} style={[styles.layer, layer.frame]}>
                <Parts layer={layer} />
              </Box>
            ),
          )}
        </Box>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  canvas: {
    width: ARTBOARD_WIDTH,
    height: ARTBOARD_HEIGHT,
    transformOrigin: 'left top',
  },
  layer: {
    position: 'absolute',
  },
  clip: {
    overflow: 'hidden',
  },
  part: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default OnboardingIllustration;
