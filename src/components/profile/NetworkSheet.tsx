import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import NetworkItem from '@/src/components/network/NetworkItem';
import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { ACTIVE_NETWORK, MAINNET_NETWORK, TESTNET_NETWORK } from '@/src/constants/config';
import { switchActiveNetwork } from '@/src/lib/network-switch';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type NetworkId = 'testnet' | 'mainnet';

const NETWORKS: { id: NetworkId; name: string; description: string }[] = [
  { id: 'testnet', name: 'Testnet', description: 'Environment for testing' },
  { id: 'mainnet', name: 'Public Network', description: 'Standard production environment' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful switch so the parent (which reads ACTIVE_NETWORK
   * directly, e.g. the Profile row label) knows to re-render. */
  onNetworkChanged?: () => void;
}

const NetworkSheet = ({ visible, onClose, onNetworkChanged }: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkId>(
    ACTIVE_NETWORK.network === 'TESTNET' ? 'testnet' : 'mainnet',
  );
  const [switching, setSwitching] = useState(false);

  const applyNetwork = async (network: NetworkId) => {
    setSwitching(true);
    try {
      await switchActiveNetwork(network === 'testnet' ? TESTNET_NETWORK : MAINNET_NETWORK);
      onNetworkChanged?.();
    } finally {
      setSwitching(false);
    }
  };

  const handleSelect = (network: NetworkId) => {
    if (network === selectedNetwork || switching) return;
    setSelectedNetwork(network);
    void applyNetwork(network);
  };

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 90,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const handleClose = () => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [{ translateY }],
            height: SHEET_HEIGHT,
          },
        ]}
      >
        <BottomSheetHandle />

        {/* Header */}
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="m"
          py="m"
          mb="m"
        >
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          <Text variant="h10" color="textPrimary" fontWeight="700">
            Network
          </Text>

          <Box width={40} />
        </Box>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}>
          {NETWORKS.map((network) => (
            <TouchableOpacity
              key={network.id}
              activeOpacity={0.7}
              disabled={switching}
              onPress={() => handleSelect(network.id)}
            >
              <NetworkItem
                name={network.name}
                description={network.description}
                isSelected={selectedNetwork === network.id}
              />
            </TouchableOpacity>
          ))}
          {switching && (
            <Box mt="m" alignItems="center">
              <ActivityIndicator size="small" color="orange" />
            </Box>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    width: '100%',
    position: 'absolute',
    bottom: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default NetworkSheet;
