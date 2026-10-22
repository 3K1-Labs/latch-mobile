import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import ProgressPagination from '@/src/components/shared/ProgressPagination';
import Text from '@/src/components/shared/Text';
import { LATCH_TERMS_URL } from '@/src/constants/constants';
import { clearProvisionedPasskeyAtIndex } from '@/src/lib/provision-passkey';
import * as Sentry from '@sentry/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import { Dimensions, FlatList, Image, Linking, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
// const ONBOARDING_KEY = 'latch_onboarding_complete';

const ONBOARDING_DATA = [
  {
    id: 1,
    title: 'Welcome to Latch',
    description: 'To get started, create a new wallet or import an existing one.',
    image: require('@/src/assets/images/ob1.png'),
  },
  {
    id: 2,
    title: 'Smart Accounts',
    description: 'Programmable wallets with better security, recovery, and control.',
    image: require('@/src/assets/images/ob3.png'),
  },
  {
    id: 3,
    title: 'Seamless Funding',
    description: 'Fund and use a next-generation Stellar wallet with ease',
    image: require('@/src/assets/images/on2.png'),
  },
];

const Onboarding = () => {
  const statusBarStyle = useStatusBarStyle();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // const completeOnboarding = async () => {
  //   try {
  //     await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  //     router.replace('/(tabs)/home');
  //   } catch (e) {
  //     router.replace('/(tabs)/home');
  //   }
  // };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  return (
    <Box flex={1} backgroundColor="onboardingbg">
      <LinearGradient
        colors={['rgba(50, 60, 14, 0.74)', '#121212']}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.91 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />
      {/* Header */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingHorizontal="xl"
        style={{ paddingTop: insets.top + 20, zIndex: 10 }}
      >
        <Box />
        {/* <TouchableOpacity onPress={completeOnboarding}>
                    <Box flexDirection="row" alignItems="center">
                        <Text variant="body" color="textSecondary" marginRight="xs">Skip</Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                    </Box>
                </TouchableOpacity> */}
      </Box>

      {/* Content */}
      <FlatList
        ref={flatListRef}
        data={ONBOARDING_DATA}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        keyExtractor={(item) => item.id.toString()}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <Box
            width={width}
            justifyContent={'space-between'}
            // bg={'danger500'}
            alignItems="center"
            paddingTop="xl"
          >
            <Box></Box>
            <Image
              source={item.image}
              style={{ width: width, height: width / 1.35 }}
              resizeMode="contain"
            />
            <Box alignItems="center" px="xl">
              <Text variant="h7" textAlign="center" marginBottom="s">
                {ONBOARDING_DATA[activeIndex].title}
              </Text>
              <Text variant="p5" textAlign="center" color="textSecondary">
                {ONBOARDING_DATA[activeIndex].description}
              </Text>
            </Box>
          </Box>
        )}
      />

      {/* Footer */}
      <Box
        px="xl"
        style={{ paddingBottom: insets.bottom + 20 }}
        alignItems="center"
        mt={'l'}
        gap="m"
      >
        <ProgressPagination total={3} activeIndex={activeIndex} />
        <Box width="100%" gap="m">
          <Button
            label="Create a New Wallet"
            variant="primary"
            onPress={async () => {
              // Start from a clean slot. A platform passkey from an earlier run
              // survives an app reinstall, and biometric.tsx skips the passkey
              // sheet whenever a credential id is already present — so without
              // this, a leftover credential makes new-wallet setup silently
              // reuse it. No smart account is deployed at this point, so the
              // discarded credential is unreferenced.
              try {
                await clearProvisionedPasskeyAtIndex(0);
              } catch (err) {
                // A failed clear is not fatal here — we still proceed — but it
                // means biometric.tsx's `existingCredId` check will reuse
                // whatever stale credential is left behind. Worth knowing about
                // rather than losing silently.
                Sentry.captureException(
                  err instanceof Error
                    ? err
                    : new Error(`clearProvisionedPasskeyAtIndex failed: ${String(err)}`),
                  { tags: { scope: 'onboarding-new-wallet-clear' } },
                );
              }
              router.navigate('/(auth)/biometric');
            }}
            // onPress={() => router.navigate('/(onboarding)/choose-wallet')}
          />
          <Button
            label="I Have a Wallet"
            variant="outline"
            onPress={() => router.navigate('/(onboarding)/get-started')}
            bg={'btnDisabled'}
            // shadowOffset={{ width: 0, height: 4 }}
            // shadowColor="primary500"
            // shadowRadius={15}
            // shadowOpacity={0.12}
            labelColor={statusBarStyle === 'light' ? 'textWhite' : 'black'}
          />
        </Box>
        <Text variant="caption" color="textSecondary" textAlign="center" mt="s" px="m">
          By proceeding, you agree to our{' '}
          <Text
            variant="caption"
            color="primary700"
            fontWeight="600"
            onPress={() => LATCH_TERMS_URL && Linking.openURL(LATCH_TERMS_URL)}
          >
            Terms of Service.
          </Text>
          {/* {' and '}
          <Text
            variant="caption"
            color="primary700"
            fontWeight="600"
            onPress={() => LATCH_PRIVACY_URL && Linking.openURL(LATCH_PRIVACY_URL)}
          >
            Privacy Policy
          </Text> */}
          {/* . */}
        </Text>
      </Box>
    </Box>
  );
};

export default Onboarding;
