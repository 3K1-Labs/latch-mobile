import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { generateStellarWallet, restoreStellarWallet } from '@/src/lib/seed-wallet';
import { useWalletStore } from '@/src/store/wallet';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import LoadingBlur from '@/src/components/shared/LoadingBlur';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { copySecretToClipboard } from '@/src/utils/copy-to-clipboard';
import { useSecureScreen } from '@/src/hooks/use-secure-screen';

export const PENDING_MNEMONIC_KEY = 'latch_pending_mnemonic';

const { width } = Dimensions.get('window');

const RecoveryPhrase = () => {
  // A recovery phrase or PIN on screen must not end up in the photo library.
  useSecureScreen();

  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);

  const { pendingWallet, setPendingWallet } = useWalletStore();

  useEffect(() => {
    const init = async () => {
      // Reuse in-memory wallet if already generated this session
      if (pendingWallet) {
        setIsGenerating(false);
        return;
      }

      // Restore from a previous incomplete session
      const savedMnemonic = await SecureStore.getItemAsync(PENDING_MNEMONIC_KEY);
      if (savedMnemonic) {
        setPendingWallet(restoreStellarWallet(savedMnemonic));
        setIsGenerating(false);
        return;
      }

      // Allow the loading UI to render before the synchronous crypto work blocks the JS thread
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const wallet = generateStellarWallet();
      await SecureStore.setItemAsync(PENDING_MNEMONIC_KEY, wallet.mnemonic);
      setPendingWallet(wallet);
      setIsGenerating(false);
    };

    init();
  }, [pendingWallet, setPendingWallet]);

  const recoveryPhrase = pendingWallet?.mnemonic.split(' ') ?? [];

  const handleCopyAll = async () => {
    if (!pendingWallet) return;
    await copySecretToClipboard(pendingWallet.mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const itemWidth = (width - theme.spacing.m * 2 - theme.spacing.m * 2) / 3;

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
      <View style={{ flex: 1 }}>
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.m,
            paddingBottom: 40,
            paddingTop: 60,
            flexGrow: 1,
          }}
        >
          {/* Header Section */}
          <Box flexDirection="row" justifyContent="space-between" mb="m">
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Image
              source={require('@/src/assets/images/logoLoading.png')}
              style={{ width: 35, height: 35 }}
              resizeMode="contain"
            />
            <Box width={40} />
          </Box>

          {/* Title Section */}
          <Box alignItems="center" mb="xxl">
            <Text variant="h7" fontSize={32} textAlign="center">
              Save Your Recovery Phrase
            </Text>
            <Text variant="p5" color="textSecondary" mt="xs" textAlign="center" width={'85%'}>
              Never share this. Anyone with these words can access your account.
            </Text>
          </Box>

          {/* Recovery Phrase Display */}
          <Box mb="xxl">
            <View style={{ position: 'relative', borderRadius: 16 }}>
              {/* Recovery Words Grid - 3 columns */}
              <Box flexDirection="row" flexWrap="wrap" gap="s">
                {recoveryPhrase.map((word, index) => (
                  <Box
                    key={index}
                    width={itemWidth}
                    paddingHorizontal="m"
                    height={52}
                    backgroundColor={statusBarStyle !== 'light' ? 'text50' : 'gray900'}
                    borderRadius={12}
                    borderWidth={1}
                    borderColor="gray800"
                    flexDirection="row"
                    alignItems="center"
                    gap="xs"
                  >
                    <Text variant="body" color="textSecondary" fontWeight="600" minWidth={20}>
                      {index + 1}
                    </Text>
                    <Text variant="body" color="textPrimary" fontWeight="600">
                      {word}
                    </Text>
                  </Box>
                ))}
              </Box>

              {isRevealed ? (
                <Box alignItems="flex-end" mt="m" pr={'s'}>
                  <TouchableOpacity
                    onPress={handleCopyAll}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.s,
                    }}
                  >
                    <Ionicons name="copy" size={16} color={theme.colors.primary700} />
                    <Text variant="body" color="primary600" fontWeight="600">
                      {copied ? 'Copied!' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                </Box>
              ) : (
                <Box height={24} mb="m" />
              )}

              {/* Blur Overlay */}
              {!isRevealed && !isGenerating && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setIsRevealed(true)}
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 10,
                      borderRadius: 12,
                      overflow: 'hidden',
                    },
                  ]}
                >
                  <BlurView
                    intensity={100}
                    tint={statusBarStyle !== 'light' ? 'light' : 'dark'}
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        borderRadius: 12,
                        backgroundColor: Platform.OS === 'android' ? 'rgba(0,0,0,0.9)' : undefined,
                      },
                    ]}
                  />
                  <Box justifyContent="center" alignItems="center">
                    <Image
                      source={require('@/src/assets/images/shieldLoader.png')}
                      style={{ width: 100, height: 100 }}
                      resizeMode="contain"
                    />
                    <Text
                      variant="p5"
                      color={statusBarStyle === 'light' ? 'textPrimary' : 'black'}
                      fontWeight="600"
                      textAlign="center"
                    >
                      Tap to reveal
                    </Text>
                  </Box>
                </TouchableOpacity>
              )}
            </View>
          </Box>
        </ScrollView>

        {/* Continue Button - Always at Bottom */}
        <Box
          paddingHorizontal="m"
          paddingTop="m"
          backgroundColor="mainBackground"
          style={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <Button
            label="Continue"
            variant={isRevealed && !isGenerating ? 'primary' : 'disabled'}
            onPress={() =>
              isRevealed && !isGenerating && router.push('/(onboarding)/verify-phrase')
            }
            bg={isRevealed && !isGenerating ? 'primary700' : 'btnDisabled'}
            labelColor={isRevealed && !isGenerating ? 'black' : 'gray600'}
            disabled={!isRevealed || isGenerating}
          />
        </Box>
      </View>

      <LoadingBlur visible={isGenerating} text="Generating your wallet…" />
    </Box>
  );
};

export default RecoveryPhrase;
