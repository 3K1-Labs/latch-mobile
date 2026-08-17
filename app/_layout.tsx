import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { IconRegistry } from '@ui-kitten/components';
import { EvaIconsPack } from '@ui-kitten/eva-icons';
import '@walletconnect/react-native-compat';
import { Buffer } from 'buffer';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';
import '../shim';
import { queryClient } from '../src/api/client';
import AppToast from '../src/components/toast/AppToast';
import { hydrateActiveNetwork } from '../src/constants/config';
import { useDeviceIntegrity } from '../src/hooks/use-device-integrity';
import { useNetworkStatus } from '../src/hooks/use-network-status';
import { useOtaUpdate } from '../src/hooks/use-ota-update';
import { useWalletConnect } from '../src/hooks/use-walletconnect';
import { useWalletConnectDeepLink } from '../src/hooks/use-walletconnect-deeplink';
import { AppThemeProvider, useAppTheme } from '../src/theme/ThemeContext';

// Wire React Query's online/offline state to the device's actual connectivity.
// When offline, RQ pauses all queries and retries them once the device comes back.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) =>
    setOnline(state.isConnected !== false && state.isInternetReachable !== false),
  ),
);

global.Buffer = Buffer;

if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    // Any non-dev build, not just production: a TestFlight/preview build is
    // precisely the case that can't be debugged locally, and console.* is
    // stripped there (metro.config.js drop_console), so Sentry is the only
    // channel left. `environment` still separates staging from production.
    enabled: !__DEV__,
  });
}

SplashScreen.preventAutoHideAsync();

if (__DEV__) {
  void import('../ReactotronConfig.js');
}

LogBox.ignoreAllLogs(true);

function RootLayoutContent() {
  const { isDark } = useAppTheme();
  useOtaUpdate();
  useWalletConnect();
  useWalletConnectDeepLink();
  useNetworkStatus();
  useDeviceIntegrity();

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="send-token" options={{ presentation: 'modal' }} />
        <Stack.Screen name="receive-token" options={{ presentation: 'modal' }} />
        <Stack.Screen name="address-book" options={{ presentation: 'modal' }} />
        <Stack.Screen name="network-settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notification" options={{ presentation: 'modal' }} />
        <Stack.Screen name="help-support" options={{ presentation: 'modal' }} />
        <Stack.Screen name="about" options={{ presentation: 'modal' }} />
        <Stack.Screen name="qrcode-scan" options={{ headerShown: false }} />
        <Stack.Screen name="filter-sheet" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-device" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pair-show-code" options={{ headerShown: false }} />
        <Stack.Screen name="pair-enter-code" options={{ headerShown: false }} />
        <Stack.Screen name="pair-show-qr" options={{ headerShown: false }} />
        <Stack.Screen name="pair-scan-qr" options={{ headerShown: false }} />
        <Stack.Screen name="pending-approval" options={{ headerShown: false }} />
        <Stack.Screen name="wc-session-proposal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="wc-session-request" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppToast />
    </>
  );
}

export default function RootLayout() {
  // Gates rendering until the persisted network choice is applied, so no query
  // or screen reads a network-derived value while it's still the default.
  const [networkReady, setNetworkReady] = useState(false);

  useEffect(() => {
    hydrateActiveNetwork().finally(() => setNetworkReady(true));
  }, []);

  const [fontsLoaded] = useFonts({
    SFproThin: require('../assets/fonts/SFPRO-Thin.ttf'),
    SFproRegular: require('../assets/fonts/SFPRO-Regular.ttf'),
    SFproMedium: require('../assets/fonts/SFPRO-Medium.ttf'),
    SFproBold: require('../assets/fonts/SFPRO-bold.ttf'),
    SFproRoundedBold: require('../assets/fonts/SFProRounded-Bold.ttf'),
    SFproRoundedMedium: require('../assets/fonts/SFProRounded-Medium.ttf'),
    SFproSemibold: require('../assets/fonts/SFPRO-Semibold.ttf'),
    SFproSemiboldItalic: require('../assets/fonts/SFPRO-Semibolditalic.otf'),
    SFproLight: require('../assets/fonts/SFPRO-Light.ttf'),
    ...Ionicons.font,
  });

  useEffect(() => {
    if (fontsLoaded && networkReady) {
      setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, 500);
    }
  }, [fontsLoaded, networkReady]);

  if (!fontsLoaded || !networkReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <IconRegistry icons={EvaIconsPack} />
        <AppThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RootLayoutContent />
          </QueryClientProvider>
        </AppThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
