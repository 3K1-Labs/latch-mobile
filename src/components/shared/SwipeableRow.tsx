import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { Theme } from '@/src/theme/theme';

/**
 * Swipe-to-reveal-delete wrapper shared by list rows across the app (Signers,
 * Address Book, ...) so the gesture, threshold, and delete-icon treatment stay
 * identical everywhere it's used instead of drifting per screen.
 *
 * `disabled` renders `children` unwrapped (e.g. a row that can't be deleted,
 * like the account's primary signer).
 */
interface Props {
  onDelete?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function RightAction({ dragX, onDelete }: { dragX: SharedValue<number>; onDelete: () => void }) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(dragX.value, [-80, 0], [0, 80], 'clamp') }],
  }));
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity onPress={onDelete} activeOpacity={0.8} style={styles.deleteAction}>
      <Animated.View style={animatedStyle}>
        <Ionicons name="trash-outline" size={24} color={theme.colors.inputError} />
      </Animated.View>
    </TouchableOpacity>
  );
}

const SwipeableRow = ({ onDelete, disabled, children }: Props) => {
  if (disabled || !onDelete) {
    return <>{children}</>;
  }

  const renderRightActions = (_progress: SharedValue<number>, dragX: SharedValue<number>) => (
    <RightAction dragX={dragX} onDelete={onDelete} />
  );

  return (
    <ReanimatedSwipeable
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={40}
      containerStyle={styles.swipeableContainer}
    >
      {children}
    </ReanimatedSwipeable>
  );
};

const styles = StyleSheet.create({
  swipeableContainer: {
    marginBottom: 0,
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '80%',
    borderRadius: 24,
    marginLeft: -10,
    marginBottom: 16,
  },
});

export default SwipeableRow;
