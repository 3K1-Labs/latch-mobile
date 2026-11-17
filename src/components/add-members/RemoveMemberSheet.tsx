import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Image } from 'expo-image';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CLOSE = require('@/src/assets/images/swap/close.svg');

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const RemoveMemberSheet: React.FC<Props> = ({ visible, onCancel, onConfirm }) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 90,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const dismiss = (cb: () => void) => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => cb());
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={() => dismiss(onCancel)}>
      <TouchableWithoutFeedback onPress={() => dismiss(onCancel)}>
        <View style={[styles.backdrop, { backgroundColor: theme.colors.backdrop }]} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.colors.surfaceBase },
          {
            paddingBottom: Math.max(insets.bottom, 24),
            transform: [{ translateY }],
          },
        ]}
      >
        <Box alignItems="center" style={styles.grabberWrap}>
          <Box width={126} height={8} borderRadius={69} backgroundColor="inputOutline" />
        </Box>

        <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
          <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
            Remove Owner
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={() => dismiss(onCancel)}
            style={[styles.close, { backgroundColor: theme.colors.inputOutline }]}
          >
            <Image source={CLOSE} contentFit="contain" style={styles.closeIcon} />
          </TouchableOpacity>
        </Box>

        <Box
          alignItems="center"
          justifyContent="center"
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          style={styles.card}
        >
          <Text fontSize={16} lineHeight={24} color="textMuted" textAlign="center" style={styles.copy}>
            Are you sure you want to remove this owner from Latch?
          </Text>
          <Box flexDirection="row" style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              onPress={() => dismiss(onCancel)}
              style={[styles.pill, styles.cancel]}
            >
              <Text fontSize={12} lineHeight={20} style={{ color: '#27C11F' }}>
                No, Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              onPress={() => dismiss(onConfirm)}
              style={[styles.pill, styles.confirm, { backgroundColor: theme.colors.buttonBg }]}
            >
              <Text fontSize={12} lineHeight={20} color="buttonLabel">
                Yes, Go Ahead
              </Text>
            </TouchableOpacity>
          </Box>
        </Box>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    paddingHorizontal: 24,
  },
  grabberWrap: {
    paddingTop: 10,
  },
  header: {
    marginTop: 24,
    height: 40,
  },
  close: {
    position: 'absolute',
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
  card: {
    marginTop: 24,
    height: 170,
    borderRadius: 10,
    gap: 16,
  },
  copy: {
    width: 216,
  },
  actions: {
    gap: 15,
  },
  pill: {
    borderRadius: 33,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
  },
  cancel: {
    width: 100,
    backgroundColor: 'rgba(39,193,31,0.08)',
  },
  confirm: {
    width: 122,
    backgroundColor: '#FFFFFF',
  },
});

export default RemoveMemberSheet;
