/**
 * SharePacketModal — surface for handing a co-sign packet to the next signer
 * (docs/multisig-p2p-cosign.md). Shows a scannable QR of the latch://cosign
 * deep link, plus Share (OS sheet) and Copy actions.
 *
 * QR capacity guard: an assembled packet (XDR + signatures) can exceed what a
 * QR can hold — especially swaps with deep DEX auth trees. Past a safe byte
 * budget we hide the QR and steer the user to Share/Copy, which have no size
 * limit. The recipient scans the QR (auto-opens the review screen) or opens the
 * shared link / pastes it.
 */

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { encodePacketParam, serializePacket, type CosignPacket } from '@/src/lib/cosign-packet';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import React, { useMemo, useState } from 'react';
import { Modal, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// Byte-mode QR at EC level L tops out ~2953 bytes, but dense codes are hard for
// cheap cameras. Keep the scannable budget conservative; bigger packets fall
// back to Share/Copy.
const QR_SAFE_LIMIT = 1800;

interface SharePacketModalProps {
  visible: boolean;
  packet: CosignPacket | null;
  onClose: () => void;
}

const SharePacketModal: React.FC<SharePacketModalProps> = ({ visible, packet, onClose }) => {
  const theme = useTheme<Theme>();
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => {
    if (!packet) return '';
    return Linking.createURL('cosign', { queryParams: { d: encodePacketParam(packet) } });
  }, [packet]);

  const qrFits = !!link && link.length <= QR_SAFE_LIMIT;

  const handleShare = async () => {
    if (!packet) return;
    try {
      // Prefer the tappable deep link; fall back to the raw blob if it's too
      // long for some chat apps to keep intact.
      const message = link.length <= 7000 ? link : serializePacket(packet);
      await Share.share({ message });
    } catch {
      /* user dismissed */
    }
  };

  const handleCopy = async () => {
    if (!packet) return;
    await Clipboard.setStringAsync(link.length <= 7000 ? link : serializePacket(packet));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <Box bg="bg11" style={[styles.card, { borderColor: theme.colors.inputOutline }]}>
          <Text variant="h10" color="textPrimary" fontFamily="SFproSemibold" mb="xs">
            Send to the next owner
          </Text>
          <Text variant="p8" color="textSecondary" textAlign="center" mb="l">
            They scan this code, or open the link you share, to review and approve.
          </Text>

          {qrFits ? (
            <View style={styles.qrWrapper}>
              <QRCode value={link} size={220} color="#000" backgroundColor="white" />
            </View>
          ) : (
            <Box style={[styles.qrFallback, { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.inputOutline }]} alignItems="center" justifyContent="center">
              <Ionicons name="qr-code-outline" size={40} color="#888" />
              <Text variant="p8" color="textSecondary" textAlign="center" mt="s" px="m">
                This request is too large to show as a QR code. Use Share or Copy instead.
              </Text>
            </Box>
          )}

          <Box flexDirection="row" mt="l" style={{ gap: 12 }}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.chipBg }]} activeOpacity={0.8} onPress={handleCopy}>
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={18}
                color={theme.colors.textPrimary}
              />
              <Text variant="p7" color="textPrimary" fontWeight="700" ml="s">
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareBtn, { backgroundColor: theme.colors.primary }]}
              activeOpacity={0.8}
              onPress={handleShare}
            >
              <Ionicons name="share-outline" size={18} color="#000" />
              <Text variant="p7" color="black" fontWeight="700" ml="s">
                Share
              </Text>
            </TouchableOpacity>
          </Box>
        </Box>
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
  },
  card: {
    width: '100%',
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  qrWrapper: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 12,
  },
  qrFallback: {
    width: 244,
    height: 244,
    borderRadius: 16,
    borderWidth: 1,
  },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SharePacketModal;
