import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, View } from 'react-native';

interface ApprovalSliderProps {
  value: number;
  total: number;
  onChange: (value: number) => void;
}

const TRACK_HEIGHT = 6;
const TRACK_RADIUS = 3;
const THUMB_SIZE = 16;
const ROW_HEIGHT = 44; // meets the 44pt touch-target minimum

const ApprovalSlider: React.FC<ApprovalSliderProps> = ({ value, total, onChange }) => {
  const trackWidth = useRef(0);

  const fillRatio = total > 1 ? (value - 1) / (total - 1) : 1;

  // Latest props for the pan handlers (created once) to read without stale closures.
  const valueRef = useRef(value);
  const totalRef = useRef(total);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  totalRef.current = total;
  onChangeRef.current = onChange;

  // Respect reduced motion for the thumb/fill spring.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  // Animate the fill/thumb to the snapped position.
  const progress = useRef(new Animated.Value(fillRatio)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(fillRatio);
      return;
    }
    Animated.spring(progress, {
      toValue: fillRatio,
      useNativeDriver: false,
      bounciness: 6,
      speed: 16,
    }).start();
  }, [fillRatio, reduceMotion, progress]);

  const positionLeft = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const commit = (next: number) => {
    const clamped = Math.max(1, Math.min(totalRef.current, next));
    if (clamped !== valueRef.current) {
      Haptics.selectionAsync().catch(() => {});
      onChangeRef.current(clamped);
    }
  };

  const updateFromX = (x: number) => {
    const w = trackWidth.current;
    if (w === 0) return;
    const t = totalRef.current;
    const clamped = Math.max(0, Math.min(w, x));
    const ratio = clamped / w;
    commit(Math.round(ratio * (t - 1)) + 1);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => updateFromX(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => updateFromX(evt.nativeEvent.locationX),
    }),
  ).current;

  return (
    <Box
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      justifyContent="center"
      style={styles.card}
    >
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textSubheading">
          Approvals Required
        </Text>
        <Text fontSize={12} lineHeight={18} fontFamily="SFproMedium" color="textSubheading">
          {value} of {total}
        </Text>
      </Box>

      <View
        onLayout={(e) => {
          trackWidth.current = e.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Approvals required"
        accessibilityValue={{ min: 1, max: total, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') commit(valueRef.current + 1);
          else if (e.nativeEvent.actionName === 'decrement') commit(valueRef.current - 1);
        }}
        style={styles.row}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width: positionLeft }]} />
        </View>
        <Animated.View pointerEvents="none" style={[styles.thumb, { left: positionLeft }]} />
      </View>
    </Box>
  );
};

const styles = StyleSheet.create({
  card: {
    minHeight: 130,
    borderRadius: 14,
    paddingHorizontal: 33,
    paddingVertical: 12,
  },
  row: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_RADIUS,
    backgroundColor: '#F1F6E1',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#76B101',
    borderRadius: TRACK_RADIUS,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#116B19',
    borderWidth: 2,
    borderColor: '#76B101',
    top: (ROW_HEIGHT - THUMB_SIZE) / 2,
    transform: [{ translateX: -(THUMB_SIZE / 2) }],
  },
});

export default ApprovalSlider;
