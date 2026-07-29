import NetworkItem from '@/src/components/network/NetworkItem';
import Box from '@/src/components/shared/Box';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import { ACTIVE_NETWORK, MAINNET_NETWORK, TESTNET_NETWORK } from '@/src/constants/config';
import { switchActiveNetwork } from '@/src/lib/network-switch';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';

type NetworkId = 'testnet' | 'mainnet';

const NETWORKS: { id: NetworkId; name: string; description: string }[] = [
  { id: 'testnet', name: 'Testnet', description: 'Environment for testing' },
  { id: 'mainnet', name: 'Public Network', description: 'Standard production environment' },
];

const NetworkSettings = () => {
  const router = useRouter();
  const [selectedNetwork, setSelectedNetwork] = React.useState<NetworkId>(
    ACTIVE_NETWORK.network === 'TESTNET' ? 'testnet' : 'mainnet',
  );
  const [switching, setSwitching] = React.useState(false);

  const handleBack = () => {
    router.back();
  };

  const applyNetwork = async (network: NetworkId) => {
    setSwitching(true);
    try {
      await switchActiveNetwork(network === 'testnet' ? TESTNET_NETWORK : MAINNET_NETWORK);
    } finally {
      setSwitching(false);
    }
  };

  const handleSelect = (network: NetworkId) => {
    if (network === selectedNetwork || switching) return;
    setSelectedNetwork(network);
    void applyNetwork(network);
  };

  return (
    <Box
      flex={1}
      backgroundColor="cardbg"
      style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
    >
      <StatusBar style="light" />

      <UtilityHeader title="Network" onBack={handleBack} />

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
    </Box>
  );
};

export default NetworkSettings;
