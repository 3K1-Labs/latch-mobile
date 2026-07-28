import MascotSection from '@/src/components/shared-wallet-result/MascotSection';
import ResultButton from '@/src/components/shared-wallet-result/ResultButton';
import ResultTextSection from '@/src/components/shared-wallet-result/ResultTextSection';
import WalletAddressCard from '@/src/components/shared-wallet-result/WalletAddressCard';
import WalletQRSheet from '@/src/components/shared-wallet-result/WalletQRSheet';
import Box from '@/src/components/shared/Box';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
<StatusBar style="light" />

        <ScrollView
          bounces={false}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <Box flex={1} px="m" pt="l" justifyContent="center">
            <MascotSection success={success} />
            <ResultTextSection success={success} errorMessage={errorMessage} />
          </Box>
        </ScrollView>

        <Box
          px="m"
          style={{
            paddingBottom: Math.max(insets.bottom, 20),
            paddingTop: 12,
          }}
        >
          {success && (
            <WalletAddressCard address={walletAddress} onShowQR={() => setQrVisible(true)} />
          )}
          <ResultButton success={success} onPress={onClose} />
        </Box>

        <WalletQRSheet
          visible={qrVisible}
          address={walletAddress}
          onClose={() => setQrVisible(false)}
        />
      </Box>
    </Modal>
  );
};

export default SharedWalletResultModal;
