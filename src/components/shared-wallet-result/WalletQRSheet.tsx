import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { Image, Modal, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { captureRef } from 'react-native-view-shot';
import Box from '../shared/Box';

const LATCH_LOGO = require('@/src/assets/images/logoLoading.png');
const STELLAR_LOGO = require('@/src/assets/token/stellar.png');

interface WalletQRSheetProps {
  visible: boolean;
  address: string;
  onClose: () => void;
}

const WalletQRSheet: React.FC<WalletQRSheetProps> = ({ visible, address, onClose }) => {
  const theme = useTheme<Theme>();
  const cardRef = useRef<View>(null);

  const handleShare = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      await Share.share({ url: uri, message: address });
    } catch {}
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <Box bg="bg11" ref={cardRef} style={[styles.card, { borderColor: theme.colors.inputOutline }]} collapsable={false}>
          <View style={styles.logoRow}>
            <Image source={LATCH_LOGO} style={styles.latchLogo} resizeMode="contain" />
            <Text variant="h9" color="textPrimary" fontWeight="700" style={{ letterSpacing: 1.5 }}>
              LATCH
            </Text>
          </View>

          <Text
            variant="p8"
            color="textSecondary"
            textAlign="center"
            mb="xl"
            style={{ letterSpacing: 0.5 }}
          >
            SHARED WALLET
          </Text>

          <View style={styles.qrWrapper}>
            <QRCode
              value={address || ' '}
              size={220}
              color="#000"
              backgroundColor="white"
              logo={STELLAR_LOGO}
              logoSize={48}
              logoBackgroundColor="white"
              logoBorderRadius={24}
              logoMargin={4}
            />
          </View>

          <View style={[styles.addressPill, { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.inputOutline }]}>
            <Text
              variant="p8"
              color="textSecondary"
              textAlign="center"
              style={{ fontFamily: 'SFproRegular', letterSpacing: 0.5 }}
            >
              {address}
            </Text>
          </View>
        </Box>

        <TouchableOpacity style={styles.shareBtn} activeOpacity={0.8} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color="#000" />
          <Text variant="p7" color="black" fontWeight="700" ml="s">
            Share
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  card: {
    width: '100%',
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: 'center',
    borderWidth: 1,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  latchLogo: {
    width: 28,
    height: 28,
  },
  qrWrapper: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
  },
  addressPill: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    width: '100%',
  },
  shareBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#C9F542',
    borderRadius: 26,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
});

export default WalletQRSheet;
