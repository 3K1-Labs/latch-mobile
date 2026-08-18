import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import AppToast from '@/src/components/toast/AppToast';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.9;
const DURATION_OPEN = 250;
const DURATION_CLOSE = 200;

interface DrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
}

const DrawerContext = createContext<DrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function useDrawer() {
  return useContext(DrawerContext);
}

export function DrawerProvider({
  children,
  drawerContent,
}: {
  children: React.ReactNode;
  drawerContent: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const openDrawer = useCallback(() => {
    translateX.setValue(-DRAWER_WIDTH);
    backdropOpacity.setValue(0);
    setVisible(true);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: DURATION_OPEN,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: DURATION_OPEN,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateX, backdropOpacity]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -DRAWER_WIDTH,
        duration: DURATION_CLOSE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: DURATION_CLOSE,
        useNativeDriver: true,
      }),
    ]).start(() => setVisible(false));
  }, [translateX, backdropOpacity]);

  return (
    <DrawerContext.Provider value={{ openDrawer, closeDrawer }}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={closeDrawer}
        statusBarTranslucent
      >
        <View style={StyleSheet.absoluteFill}>
          <TouchableWithoutFeedback onPress={closeDrawer}>
            <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
            {drawerContent}
          </Animated.View>
          {/* A React Native Modal is its own native window above the root view,
              so the <Toast/> in app/_layout.tsx can never paint over this
              drawer. Mount one inside, after the panel. react-native-toast-
              message keeps a stack of refs and shows on the most recently
              mounted, restoring the previous on unmount — gated on `visible` so
              a closed drawer never sits on top of that stack. */}
          {visible && <AppToast />}
        </View>
      </Modal>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
  },
});
