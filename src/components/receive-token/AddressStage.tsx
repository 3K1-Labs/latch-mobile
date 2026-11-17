import ShareCard from '@/src/components/receive-token/ShareCard';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { type TokenBalance } from '@/src/hooks/use-portfolio';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { shortenAddress } from '@/src/utils';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

const STELLAR_LOGO = require('@/src/assets/token/stellar.png');
const ICONS = {
  share: require('@/src/assets/images/receive/share.svg'),
  copy: require('@/src/assets/images/receive/copy-dark.svg'),
  latch: require('@/src/assets/images/receive/latch-mark.svg'),
};

interface Props {
  token: TokenBalance;
  address: string;
  onCopy: () => void;
}

const AddressStage = ({ token, address, onCopy }: Props) => {
  const theme = useTheme<Theme>();
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const [showShareCard, setShowShareCard] = useState(false);
  const logoSource = iconUrl ? { uri: iconUrl } : STELLAR_LOGO;

  return (
    <Box flex={1} style={styles.body}>
      <Box flex={1} alignItems="center" justifyContent="center">
        <Box
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          style={styles.card}
        >
          <Box alignItems="center" justifyContent="center" style={styles.qr}>
            <QRCode
              value={address}
              size={192}
              logo={logoSource}
              logoSize={44}
              logoBackgroundColor="white"
              logoBorderRadius={12}
              logoMargin={4}
            />
          </Box>

          <Box flexDirection="row" alignItems="flex-end" justifyContent="space-between" style={styles.meta}>
            <Box gap="xs" flexShrink={1}>
              <Text fontSize={12} lineHeight={20} color="textSubheading">
                Stellar Wallet
              </Text>
              <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textPrimary">
                {shortenAddress(address)}
              </Text>
            </Box>
            <Image source={ICONS.latch} contentFit="contain" style={styles.latchMark} />
          </Box>
        </Box>

        <Text fontSize={12} lineHeight={20} color="textSubheading" textAlign="center" style={styles.caption}>
          Use this address to receive {token.code} on Stellar.
        </Text>
      </Box>

      <Box flexDirection="row" gap="sm">
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          onPress={() => setShowShareCard(true)}
          style={[
            styles.button,
            styles.shareButton,
            { backgroundColor: theme.colors.inputBox, borderColor: theme.colors.inputOutline },
          ]}
        >
          <Image
            source={ICONS.share}
            contentFit="contain"
            tintColor={theme.colors.iconPrimary}
            style={styles.buttonIcon}
          />
          <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
            Share
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Copy address"
          activeOpacity={0.8}
          onPress={onCopy}
          style={[styles.button, { backgroundColor: theme.colors.buttonBg }]}
        >
          <Image
            source={ICONS.copy}
            contentFit="contain"
            tintColor={theme.colors.buttonLabel}
            style={styles.buttonIcon}
          />
          <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="buttonLabel">
            Copy
          </Text>
        </TouchableOpacity>
      </Box>

      {showShareCard && (
        <ShareCard token={token} address={address} onClose={() => setShowShareCard(false)} />
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  card: {
    width: 253,
    borderRadius: 28,
    padding: 14,
    paddingBottom: 18,
  },
  qr: {
    height: 224,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  meta: {
    marginTop: 13,
    paddingHorizontal: 3,
  },
  latchMark: {
    width: 31,
    height: 16.58,
    marginBottom: 3,
  },
  caption: {
    width: 241,
    marginTop: 12,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareButton: {
    borderWidth: 1,
  },
  buttonIcon: {
    width: 20,
    height: 20,
  },
});

export default AddressStage;
