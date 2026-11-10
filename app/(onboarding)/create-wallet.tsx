import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { CREATE_WALLET_ART } from '@/src/components/onboarding/create-wallet-art';
import OnboardingIllustration, {
  ARTBOARD_WIDTH,
} from '@/src/components/onboarding/OnboardingIllustration';
import {
  RoundBackButton,
  SEMIBOLD_TRACKING,
  SetupButton,
} from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ART_HEIGHT = 400;
const CONTENT_HEIGHT = 382;

const FEATURES = [
  {
    icon: require('@/src/assets/images/onboarding/create-wallet/icon-setup.svg'),
    iconSize: { width: 48.269, height: 48.51 },
    title: 'Seamless Setup',
    description: 'Create a wallet seamlessly and start transacting.',
  },
  {
    icon: require('@/src/assets/images/onboarding/create-wallet/icon-recovery.svg'),
    iconSize: { width: 25, height: 38, marginTop: 4 },
    title: 'Stress-Free Recovery',
    description: 'Recover access to your wallet with your 4-Digit PIN',
  },
];

const CreateWallet = () => {
  const router = useRouter();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const footerPadding = Math.max(insets.bottom, 16);
  const artScale = Math.min(
    width / ARTBOARD_WIDTH,
    (height - CONTENT_HEIGHT - footerPadding) / ART_HEIGHT,
  );

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />

      <ScrollView
        style={styles.scroll}
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <OnboardingIllustration
          illustration={CREATE_WALLET_ART}
          scale={artScale}
          height={ART_HEIGHT}
        />

        <Box width="100%" px="l">
          <Box alignItems="center" gap="xs">
            <Text
              variant="p4"
              fontFamily="SFproSemibold"
              letterSpacing={SEMIBOLD_TRACKING}
              textAlign="center"
              color="textPrimary"
            >
              Create a New Wallet
            </Text>
            <Text
              variant="p6"
              lineHeight={24}
              letterSpacing={0}
              textAlign="center"
              color="textSubheading"
            >
              Login or import an existing wallet.
            </Text>
          </Box>

          <Box gap="sm" style={styles.cards}>
            {FEATURES.map((feature) => (
              <Box
                key={feature.title}
                flexDirection="row"
                gap="m"
                p="m"
                borderWidth={1}
                borderColor="inputOutline"
                backgroundColor="inputBox"
                borderRadius={20}
              >
                <Box width={49} height={48} alignItems="center">
                  <Image source={feature.icon} contentFit="fill" style={feature.iconSize} />
                </Box>
                <Box flex={1} style={styles.cardText}>
                  <Text
                    variant="p5"
                    fontFamily="SFproMedium"
                    lineHeight={26}
                    letterSpacing={0}
                    color="textPrimary"
                  >
                    {feature.title}
                  </Text>
                  <Text variant="p7" lineHeight={20} letterSpacing={0} color="textSubheading">
                    {feature.description}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </ScrollView>

      <Box px="l" pt="m" style={{ paddingBottom: footerPadding }}>
        <SetupButton
          label="Continue"
          onPress={() => router.push('/(onboarding)/customise-wallet')}
        />
      </Box>

      <RoundBackButton
        onPress={() => {
          if (router.canGoBack()) router.back();
        }}
        style={[styles.back, { top: insets.top + 12 }]}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
  },
  cards: {
    marginTop: 48,
  },
  cardText: {
    gap: 3,
  },
  back: {
    position: 'absolute',
    left: 24,
  },
});

export default CreateWallet;
