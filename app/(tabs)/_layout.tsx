import SharedWalletNamingModal from '@/src/components/account/SharedWalletNamingModal';
import { CustomTabBar } from '@/src/components/CustomTabBar';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import { DrawerProvider } from '@/src/context/drawer-context';
import { TabBarScrollProvider } from '@/src/context/tab-bar-scroll';
import { usePushNotifications } from '@/src/hooks/use-push-notifications';
import { useLoadingOverlay } from '@/src/store/loading-overlay';
import { useWalletStore } from '@/src/store/wallet';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Profile from './profile';

const TabsLayout = () => {
  const { rehydrateWallet } = useWalletStore();
  const { visible, text, subText } = useLoadingOverlay();

  // Rehydrate once when the authenticated shell mounts so mnemonic + accounts
  // are available to every screen and the profile drawer before they render.
  useEffect(() => {
    rehydrateWallet();
  }, [rehydrateWallet]);

  // Post-auth surface: register for content-free approval pushes + handle taps.
  usePushNotifications();

  return (
    <BottomSheetModalProvider>
      <DrawerProvider drawerContent={<Profile />}>
        <View style={{ flex: 1 }}>
          <TabBarScrollProvider>
            <Tabs
              tabBar={(props) => <CustomTabBar {...props} />}
              screenOptions={{ headerShown: false }}
            >
              <Tabs.Screen name="index" options={{ title: 'Home' }} />
              <Tabs.Screen name="swap" options={{ title: 'Swap' }} />
              <Tabs.Screen name="history" options={{ title: 'History' }} />
              <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
              <Tabs.Screen name="profile" options={{ href: null }} />
            </Tabs>
          </TabBarScrollProvider>
          {/* Sibling of <Tabs> so the overlay sits ABOVE the CustomTabBar but
            still inside the DrawerProvider — the drawer can't slide over it. */}
          <LoadingBlur visible={visible} text={text} subText={subText} />
          {/* Prompts for a name when discovery finds a shared wallet this device
            was added to, before the wallet is stored. */}
          <SharedWalletNamingModal />
        </View>
      </DrawerProvider>
    </BottomSheetModalProvider>
  );
};

export default TabsLayout;
