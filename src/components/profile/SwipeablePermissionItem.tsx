import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import type { SessionKey } from '@/src/store/permissions';
import PermissionItem from './PermissionItem';

interface Props {
  permission: SessionKey;
  onRevoke: (id: string) => void;
}

function RightAction({ dragX, onRevoke }: { dragX: SharedValue<number>; onRevoke: () => void }) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(dragX.value, [-80, 0], [0, 80], 'clamp') }],
  }));

  return (
    <TouchableOpacity onPress={onRevoke} activeOpacity={0.8} style={styles.revokeAction}>
      <Animated.View style={animatedStyle}>
        <Ionicons name="trash-outline" size={24} color="#E23A10" />
      </Animated.View>
    </TouchableOpacity>
  );
}

const SwipeablePermissionItem = ({ permission, onRevoke }: Props) => {
  const renderRightActions = (_progress: SharedValue<number>, dragX: SharedValue<number>) => (
    <RightAction dragX={dragX} onRevoke={() => onRevoke(permission.id)} />
  );

  return (
    <ReanimatedSwipeable
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={40}
      containerStyle={styles.swipeableContainer}
    >
      <PermissionItem permission={permission} />
    </ReanimatedSwipeable>
  );
};

const styles = StyleSheet.create({
  swipeableContainer: {
    marginBottom: 0,
  },
  revokeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 16,
  },
});

export default SwipeablePermissionItem;
