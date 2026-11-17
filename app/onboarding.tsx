import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import OnboardingIllustration, {
  ARTBOARD_HEIGHT,
  ARTBOARD_WIDTH,
} from '@/src/components/onboarding/OnboardingIllustration';
import { ONBOARDING_SLIDES } from '@/src/components/onboarding/slides';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import ProgressPagination from '@/src/components/shared/ProgressPagination';
import Text from '@/src/components/shared/Text';
import { LATCH_TERMS_URL } from '@/src/constants/constants';
import { openInAppBrowser } from '@/src/lib/open-in-app-browser';
import { clearProvisionedPasskeyAtIndex } from '@/src/lib/provision-passkey';
import * as Sentry from '@sentry/react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// const ONBOARDING_KEY = 'latch_onboarding_complete';

const SLIDE_TEXT_HEIGHT = 136;
const FOOTER_HEIGHT = 181;

const Onboarding = () => {
  const statusBarStyle = useStatusBarStyle();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const footerPadding = Math.max(insets.bottom, 16);
  const artScale = Math.min(
    width / ARTBOARD_WIDTH,
    (height - SLIDE_TEXT_HEIGHT - FOOTER_HEIGHT - footerPadding) / ARTBOARD_HEIGHT,
  );

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
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />

      {/* Content */}
      <FlatList
        ref={flatListRef}
        data={ONBOARDING_SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        keyExtractor={(item) => item.id.toString()}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <Box width={width} alignItems="center">
            <OnboardingIllustration illustration={item.illustration} scale={artScale} />
            <Box alignItems="center" px="l">
              <Text
                variant="title"
                fontFamily="SFproSemibold"
                lineHeight={29}
                letterSpacing={0}
                textAlign="center"
                marginBottom="sm"
              >
                {item.title}
              </Text>
              <Text
                variant="p5"
                lineHeight={22}
                letterSpacing={0}
                textAlign="center"
                color="textSubheading"
                style={{ maxWidth: item.descriptionWidth }}
              >
                {item.description}
              </Text>
            </Box>
          </Box>
        )}
      />

      {/* Footer */}
      <Box px="l" style={styles.footer} alignItems="center">
        <ProgressPagination
          total={ONBOARDING_SLIDES.length}
          activeIndex={activeIndex}
          dotSize={5}
          activeWidth={10}
          dotMargin={1}
          activeColor="white"
          inactiveColor="textSubtle"
        />
        <Box width="100%" gap={10} mt="l">
          <Button
            label="Create Wallet"
            variant="ghost"
            bg="buttonBg"
            labelColor="buttonLabel"
            labelStyle={styles.buttonLabel}
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
              router.navigate('/(onboarding)/create-wallet');
            }}
            // onPress={() => router.navigate('/(onboarding)/choose-wallet')}
          />
          <Button
            label="I Already have a Wallet"
            variant="ghost"
            labelColor="textSubheading"
            labelStyle={styles.buttonLabel}
            onPress={() => router.navigate('/(onboarding)/get-started')}
          />
        </Box>
        <Text
          variant="caption"
          color="textSecondary"
          textAlign="center"
          mt="s"
          px="m"
          style={{ marginBottom: footerPadding }}
        >
          By proceeding, you agree to our{' '}
          <Text
            variant="caption"
            color="primary700"
            fontWeight="600"
            onPress={() => openInAppBrowser(LATCH_TERMS_URL)}
          >
            Terms of Service.
          </Text>
          {/* {' and '}
          <Text
            variant="caption"
            color="primary700"
            fontWeight="600"
            onPress={() => openInAppBrowser(LATCH_PRIVACY_URL)}
          >
            Privacy Policy
          </Text> */}
          {/* . */}
        </Text>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  footer: {
    marginTop: 20,
  },
  buttonLabel: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: 'SFproMedium',
    fontWeight: 'normal',
  },
});

export default Onboarding;
