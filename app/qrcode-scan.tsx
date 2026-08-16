import AddressResultCard from '@/src/components/scan/AddressResultCard';
import ScannerFrame from '@/src/components/scan/ScannerFrame';
import URLInputSheet from '@/src/components/scan/URLInputSheet';
import Box from '@/src/components/shared/Box';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import { useWalletConnectPairing } from '@/src/hooks/use-walletconnect-pairing';
import { useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const QRScanScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedAddress, setScannedAddress] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const { isPairing, pair, resetPairing } = useWalletConnectPairing();

  // When the screen loses focus (either because session_proposal navigated away,
  // or the user pressed back), clear any pending timeout and reset pairing state.
  useFocusEffect(
    useCallback(() => {
      return () => resetPairing();
    }, [resetPairing]),
  );

  if (!permission) {
    return (
      <Box flex={1} justifyContent="center" alignItems="center" backgroundColor="mainBackground">
        <ActivityIndicator size="small" color="orange" />
      </Box>
    );
  }

  if (!permission.granted) {
    requestPermission();
    return (
      <Box flex={1} justifyContent="center" alignItems="center" backgroundColor="mainBackground">
        {/* Permission Request UI could go here */}
      </Box>
    );
  }

  const handleCosignPayload = (data: string): boolean => {
    const trimmed = data.trim();
    // latch://cosign?d=<base64url> deep link from another owner's "Show QR".
    const dMatch = trimmed.match(/cosign\?(?:.*&)?d=([^&\s]+)/);
    if (dMatch) {
      router.replace({ pathname: '/cosign-review', params: { d: dMatch[1] } });
      return true;
    }
    // Raw packet JSON (fallback when shared as text and re-encoded into a QR).
    if (trimmed.startsWith('{') && trimmed.includes('"unsignedTxXdr"')) {
      router.replace({ pathname: '/cosign-review', params: { data: trimmed } });
      return true;
    }
    return false;
  };

  const handleBarcodeScanned = (data: string) => {
    if (data.startsWith('wc:')) {
      pair(data);
      return;
    }
    if (handleCosignPayload(data)) return;
    setScannedAddress(data);
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <Box flex={1} backgroundColor="black">
      <StatusBar style="light" />

      {/* Scanner View */}
      {/* `scanned` detaches CameraView's callback — without isPairing here the
          camera keeps re-delivering the same wc: QR every frame while pairing. */}
      <ScannerFrame onBarcodeScanned={handleBarcodeScanned} scanned={!!scannedAddress || isPairing} />

      {/* Header Overlay */}
      <Box position="absolute" top={insets.top} left={0} right={0}>
        <UtilityHeader title="Scan QR Code" onBack={handleBack} showHandle={false} />
      </Box>

      {/* Logic for showing result or input */}
      {scannedAddress ? (
        <Box
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
          justifyContent="center"
          alignItems="center"
        >
          <AddressResultCard
            address={scannedAddress}
            onSend={() => {
              router.push({
                pathname: '/send-token',
                params: { address: scannedAddress },
              });
            }}
            onScanAgain={() => setScannedAddress(null)}
          />
        </Box>
      ) : (
        <KeyboardStickyView
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom: insets.bottom,
          }}
        >
          <URLInputSheet
            url={inputUrl}
            onChangeUrl={setInputUrl}
            onConnect={() => {
              // A pasted cosign link routes to the approval screen; otherwise
              // treat the input as a WalletConnect URI.
              if (handleCosignPayload(inputUrl)) return;
              pair(inputUrl);
            }}
            isConnecting={isPairing}
          />
        </KeyboardStickyView>
      )}
    </Box>
  );
};

export default QRScanScreen;
