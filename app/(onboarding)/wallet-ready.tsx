import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { SEMIBOLD_TRACKING, SetupButton } from '@/src/components/onboarding/SetupChrome';
import WalletCard, { CARD_ASPECT_RATIO } from '@/src/components/onboarding/WalletCard';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  DEFAULT_CARD_COLOR,
  loadWalletAppearance,
  tintColor,
  type WalletAppearance,
} from '@/src/lib/wallet-customisation';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WalletReady = () => {
  const router = useRouter();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { accountAddress } = useLocalSearchParams<{ accountAddress?: string }>();
  const [appearance, setAppearance] = useState<WalletAppearance | null>(null);

  useEffect(() => {
    if (accountAddress) loadWalletAppearance(accountAddress).then(setAppearance);
  }, [accountAddress]);

  const color = appearance?.color ?? null;
  const baseColor = color ?? DEFAULT_CARD_COLOR;
  const address = shortenAddress(accountAddress ?? null);
  const cardWidth = Math.min(width - 80, 310);
  const finish = () => router.replace('/(tabs)');

  return (
    <Box flex={1} backgroundColor="sheetDim">
      <StatusBar style={statusBarStyle} />
      <Box
        flex={1}
        backgroundColor="surfaceBase"
        style={[styles.sheet, { marginTop: insets.top + 46 }]}
      >
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <Box style={styles.handle} backgroundColor="inputOutline" />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close"
            activeOpacity={0.7}
            hitSlop={8}
            onPress={finish}
            style={styles.close}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <Box alignSelf="center" style={[styles.cards, { width: cardWidth }]}>
            <Box
              style={[
                styles.backCard,
                styles.backCardFar,
                {
                  height: cardWidth / CARD_ASPECT_RATIO,
                  backgroundColor: tintColor(baseColor, 0.85),
                },
              ]}
            />
            <Box
              style={[
                styles.backCard,
                styles.backCardNear,
                {
                  height: cardWidth / CARD_ASPECT_RATIO,
                  backgroundColor: tintColor(baseColor, 0.7),
                },
              ]}
            />
            <WalletCard
              color={color}
              name={appearance?.name ?? ''}
              image={appearance?.image ?? null}
              address={address}
              addressColor={baseColor === DEFAULT_CARD_COLOR ? '#FFFFFF' : '#111111'}
            />
          </Box>

          <Box alignItems="center" gap="xs" style={styles.heading}>
            <Text
              variant="p4"
              fontFamily="SFproSemibold"
              letterSpacing={SEMIBOLD_TRACKING}
              textAlign="center"
              color="textPrimary"
            >
              Your Smart Account is here!
            </Text>
            <Text
              variant="p6"
              lineHeight={24}
              letterSpacing={0}
              textAlign="center"
              color="textSubheading"
            >
              {'Your Smart Latch Stellar Wallet is ready.\nStart transacting now!'}
            </Text>
          </Box>

          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            backgroundColor="inputBox"
            borderWidth={1}
            borderColor="inputOutline"
            borderRadius={24}
            style={styles.addressRow}
          >
            <Text variant="p6" lineHeight={24} letterSpacing={0} color="textPrimary">
              {address}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Copy wallet address"
              activeOpacity={0.7}
              onPress={() => accountAddress && copyToClipboard(accountAddress)}
              style={styles.copy}
            >
              <Text variant="p8" letterSpacing={0} color="black">
                Copy
              </Text>
              <Ionicons name="copy-outline" size={14} color="#111111" />
            </TouchableOpacity>
          </Box>

          <SetupButton label="Proceed" onPress={finish} style={styles.proceed} />
        </ScrollView>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: 'hidden',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 126,
    height: 8,
    marginTop: 10,
    borderRadius: 4,
  },
  close: {
    alignSelf: 'flex-end',
    width: 40,
    height: 40,
    marginTop: 20,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
  },
  cards: {
    marginTop: 87,
  },
  backCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 28,
  },
  backCardFar: {
    transform: [{ translateX: -8.5 }, { translateY: -15 }, { rotate: '-10.4deg' }, { scaleX: 0.92 }, { scaleY: 0.9 }],
  },
  backCardNear: {
    transform: [{ translateX: 4.5 }, { translateY: -10.5 }, { rotate: '-4.7deg' }],
  },
  heading: {
    marginTop: 74,
  },
  addressRow: {
    height: 62,
    marginTop: 36,
    paddingLeft: 24,
    paddingRight: 24,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: '#EDFFAC',
  },
  proceed: {
    marginTop: 'auto',
  },
});

export default WalletReady;
