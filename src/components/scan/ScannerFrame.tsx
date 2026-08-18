import React from 'react';
import { StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

interface ScannerFrameProps {
  onBarcodeScanned: (data: string) => void;
  scanned: boolean;
}

const ScannerFrame = ({ onBarcodeScanned, scanned }: ScannerFrameProps) => {
  return (
    <Box flex={1} backgroundColor="black">
      <CameraView
        style={StyleSheet.absoluteFill}
        onBarcodeScanned={scanned ? undefined : ({ data }) => onBarcodeScanned(data)}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
      />
      
      {/* Overlay */}
      <Box style={StyleSheet.absoluteFill} justifyContent="center" alignItems="center">
        <Box
          width={280}
          height={280}
          borderWidth={4}
          borderColor="primary"
          borderRadius={24}
          backgroundColor="transparent"
        />
        <Text variant="p6" color="white" mt="l" fontWeight="600">
          Scan a Wallet QR code
        </Text>
      </Box>
    </Box>
  );
};

export default ScannerFrame;
