import { useTheme } from '@shopify/restyle';
import React, { useState } from 'react';
import { ActivityIndicator, TouchableOpacity } from 'react-native';

import NetworkItem from '@/src/components/network/NetworkItem';
import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import { ACTIVE_NETWORK, MAINNET_NETWORK, TESTNET_NETWORK } from '@/src/constants/config';
import { switchActiveNetwork } from '@/src/lib/network-switch';
import { accountUsableOnNetwork, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

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
  /** Fired after switching to a network the wallet has no usable account on, so
   * the parent can send the user straight into account creation. */
  onNeedsAccount?: (network: NetworkId) => void;
}

const NetworkSheet = ({ visible, onClose, onNetworkChanged, onNeedsAccount }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const [switching, setSwitching] = useState(false);
  // The optimistic pick while a switch is in flight. Null the rest of the time,
  // when the selection is read straight off ACTIVE_NETWORK — re-read on every
  // render, so a switch made elsewhere is reflected the next time the sheet
  // opens (opening re-renders this component) with no effect-based syncing.
  const [pendingNetwork, setPendingNetwork] = useState<NetworkId | null>(null);
  const currentNetwork: NetworkId = ACTIVE_NETWORK.network === 'TESTNET' ? 'testnet' : 'mainnet';
  const selectedNetwork = pendingNetwork ?? currentNetwork;

  const applyNetwork = async (network: NetworkId) => {
    setSwitching(true);
    try {
      await switchActiveNetwork(network === 'testnet' ? TESTNET_NETWORK : MAINNET_NETWORK);
      // switchActiveNetwork re-points the active account to one on `network`, or
      // leaves the off-network selection in place when there's nothing here. In
      // that case there's no wallet to use — send the user straight to creating
      // one for this network rather than stranding them on an empty dashboard.
      const { accounts } = useWalletStore.getState();
      if (!accounts.some((a) => accountUsableOnNetwork(a, network))) {
        onNeedsAccount?.(network);
      }
    } finally {
      // In finally, not after the await: setActiveNetworkDetails runs first
      // inside switchActiveNetwork, so ACTIVE_NETWORK is already updated even if
      // a later step throws — the parent's label must re-read it regardless.
      onNetworkChanged?.();
      setPendingNetwork(null);
      setSwitching(false);
    }
  };

  const handleSelect = (network: NetworkId) => {
    if (network === selectedNetwork || switching) return;
    setPendingNetwork(network);
    void applyNetwork(network);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="Network" onBack={onClose} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}
    >
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
    </BottomSheet>
  );
};

export default NetworkSheet;
