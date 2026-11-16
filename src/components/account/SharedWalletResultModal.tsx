import { RoundBackButton, SetupButton } from '@/src/components/onboarding/SetupChrome';
import WalletQRSheet from '@/src/components/shared-wallet-result/WalletQRSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Modal, ScrollView, Share, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const IMAGES = {
  success: require('@/src/assets/images/result/tx-success.svg'),
  failed: require('@/src/assets/images/result/tx-failed.svg'),
  rays: require('@/src/assets/images/result/success-rays.png'),
  copy: require('@/src/assets/images/multisig/copy.svg'),
  share: require('@/src/assets/images/multisig/share.svg'),
  qr: require('@/src/assets/images/multisig/qr.svg'),
};

interface Props {
  visible: boolean;
  success: boolean;
  walletAddress: string;
  errorMessage?: string;
  onClose: () => void;
}

const SharedWalletResultModal = ({
  visible,
  success,
  walletAddress,
  errorMessage,
  onClose,
}: Props) => {
  const insets = useSafeAreaInsets();
  const [qrVisible, setQrVisible] = useState(false);

  const actions = [
    { key: 'copy', label: 'Copy address', icon: IMAGES.copy, onPress: () => copyToClipboard(walletAddress) },
    { key: 'share', label: 'Share address', icon: IMAGES.share, onPress: () => Share.share({ message: walletAddress }) },
    { key: 'qr', label: 'Show QR code', icon: IMAGES.qr, onPress: () => setQrVisible(true) },
  ];

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top + 8 }}>
        <StatusBar style="light" />

        <Box style={styles.header}>
          <RoundBackButton onPress={onClose} />
        </Box>

        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Box alignItems="center" gap="xs">
            <Box>
              {success && (
                <Image source={IMAGES.rays} contentFit="contain" style={styles.rays} />
              )}
              <Image
                source={success ? IMAGES.success : IMAGES.failed}
                contentFit="contain"
                style={success ? styles.successArt : styles.failedArt}
              />
            </Box>
            <Box alignItems="center" style={styles.copyBlock}>
              <Text
                fontSize={20}
                lineHeight={28}
                fontFamily="SFproSemibold"
                color="textPrimary"
                textAlign="center"
              >
                {success ? 'Multisig Wallet Created' : "Multisig Wallet Wasn't Created"}
              </Text>
              <Text fontSize={16} lineHeight={24} color="textSubheading" textAlign="center">
                {success
                  ? 'Your Multisig wallet is ready to receive funds.'
                  : errorMessage || 'Your Multisig wallet failed to create.'}
              </Text>
            </Box>
          </Box>

          {success && (
            <Box style={styles.addressSection}>
              <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textSubheading">
                Wallet Address
              </Text>
              <Box
                backgroundColor="inputBox"
                borderColor="inputOutline"
                borderWidth={1}
                style={styles.addressBox}
              >
                <Text fontSize={16} lineHeight={24} color="textPrimary" selectable>
                  {walletAddress}
                </Text>
              </Box>
              <Box flexDirection="row" gap="s" style={styles.actions}>
                {actions.map((a) => (
                  <TouchableOpacity
                    key={a.key}
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    activeOpacity={0.7}
                    onPress={a.onPress}
                    style={styles.action}
                  >
                    <Image source={a.icon} contentFit="contain" style={styles.actionIcon} />
                  </TouchableOpacity>
                ))}
              </Box>
            </Box>
          )}
        </ScrollView>

        <Box style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <SetupButton label={success ? 'Continue' : 'Try Again'} onPress={onClose} />
        </Box>

        <WalletQRSheet visible={qrVisible} address={walletAddress} onClose={() => setQrVisible(false)} />
      </Box>
    </Modal>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  // Green burst behind the mascot; offsets match the Figma frame (802:33319).
  rays: {
    position: 'absolute',
    width: 312,
    height: 312,
    left: -37.5,
    top: -58,
    transform: [{ rotate: '180deg' }],
  },
  successArt: {
    width: 229,
    height: 229,
  },
  failedArt: {
    width: 243,
    height: 243,
  },
  copyBlock: {
    width: 281,
    gap: 2,
  },
  addressSection: {
    marginTop: 32,
    gap: 6,
  },
  addressBox: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  actions: {
    marginTop: 10,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(241,246,225,0.08)',
  },
  actionIcon: {
    width: 24,
    height: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
});

export default SharedWalletResultModal;
