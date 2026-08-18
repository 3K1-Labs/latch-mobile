import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import React from 'react';
import { Share, StyleSheet, View } from 'react-native';
import AddressActionButton from './AddressActionButton';

interface WalletAddressCardProps {
  address: string;
  onShowQR: () => void;
}

const WalletAddressCard: React.FC<WalletAddressCardProps> = ({ address, onShowQR }) => {
  const { isDark } = useAppTheme();
  const handleCopy = async () => {
    await copyToClipboard(address);
  };

  const handleShare = async () => {
    await Share.share({ message: address });
  };

  return (
    <Box backgroundColor={isDark ? 'bg11' : 'textDark900'} borderRadius={16} p="m" mb="l">
      <Text variant="p6" fontWeight="700" color="textPrimary" mb="s">
        Wallet Address
      </Text>

      <View style={styles.addressBox}>
        <Text variant="p7" color="textPrimary" style={styles.addressText}>
          {address}
        </Text>
      </View>

      <Box flexDirection="row" gap="s" mt="m">
        <AddressActionButton icon="copy-outline" label="Copy" onPress={handleCopy} />
        <AddressActionButton icon="share-social-outline" label="Share" onPress={handleShare} />
        <AddressActionButton icon="qr-code-outline" label="QR Code" onPress={onShowQR} />
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  addressBox: {
    borderWidth: 1,
    borderColor: '#3A3A3C',
    borderRadius: 10,
    padding: 12,
  },
  addressText: {
    fontFamily: 'monospace',
    lineHeight: 20,
  },
});

export default WalletAddressCard;
