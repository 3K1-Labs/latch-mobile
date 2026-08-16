import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { StrKey } from '@stellar/stellar-sdk';
import { useTheme } from '@shopify/restyle';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Animated, Dimensions, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScannedMemberForm from './ScannedMemberForm';
import ScannerOverlay from './ScannerOverlay';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  onMemberAdded: (name: string, address: string) => void;
}

const ScanQRSheet: React.FC<Props> = ({ visible, onClose, onMemberAdded }) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedAddress, setScannedAddress] = useState<string | null>(null);
  const formSlide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const showForm = (address: string) => {
    setScannedAddress(address);
    Animated.spring(formSlide, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 90,
    }).start();
  };

  const resetScan = () => {
    Animated.timing(formSlide, {
      toValue: SCREEN_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setScannedAddress(null));
  };

  const handleClose = () => {
    resetScan();
    onClose();
  };

  const handleBarcodeScanned = (data: string) => {
    if (scannedAddress) return;
    // Only accept Stellar contract (C…) addresses. Anything else (URLs,
    // raw text, G-addresses) is silently ignored so the camera keeps
    // scanning — the user can simply point at a valid QR.
    if (!StrKey.isValidContract(data)) return;
    showForm(data);
  };

  return (
    <Modal transparent={false} visible={visible} animationType="slide" onRequestClose={handleClose}>
      <Box flex={1} backgroundColor="black" justifyContent={'center'} alignItems={'center'}>
        {/* Camera */}
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            onBarcodeScanned={scannedAddress ? undefined : ({ data }) => handleBarcodeScanned(data)}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
        ) : (
          /* Permission denied / not yet asked */
          <Box flex={1} justifyContent="center" alignItems="center" px="xl">
            <Ionicons name="camera-outline" size={64} color={theme.colors.gray600} />
            <Text variant="h9" color="textPrimary" fontWeight="700" textAlign="center" mt="l">
              Camera Access Required
            </Text>
            <Text variant="p6" color="textSecondary" textAlign="center" mt="s" mb="xl">
              Allow camera access to scan a member&apos;s QR code.
            </Text>
            <TouchableOpacity
              onPress={requestPermission}
              style={{
                backgroundColor: theme.colors.primary,
                height: 52,
                borderRadius: 26,
                paddingHorizontal: 32,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text variant="h10" color="black" fontWeight="700">
                Grant Permission
              </Text>
            </TouchableOpacity>
          </Box>
        )}

        {/* Scan frame overlay (only while scanning) */}
        {permission?.granted && !scannedAddress && <ScannerOverlay />}

        {/* Top bar */}
        <Box
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            paddingTop: Math.max(insets.top, 20),
            paddingHorizontal: 16,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.iconBtn}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>

          <Text variant="h10" color="white" fontWeight="700">
            Scan QR Code
          </Text>

          {/* Spacer to center title */}
          <Box width={40} />
        </Box>

        {/* Scanned result form */}
        {scannedAddress && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { transform: [{ translateY: formSlide }] }]}
          >
            <ScannedMemberForm
              address={scannedAddress}
              onAdd={(name, address) => {
                handleClose();
                onMemberAdded(name, address);
              }}
              onScanAgain={resetScan}
            />
          </Animated.View>
        )}
      </Box>
    </Modal>
  );
};

const styles = StyleSheet.create({
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ScanQRSheet;
