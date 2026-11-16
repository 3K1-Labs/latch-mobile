import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import React from 'react';

interface CreateWalletButtonProps {
  onPress: () => void;
  loading?: boolean;
}

const CreateWalletButton: React.FC<CreateWalletButtonProps> = ({ onPress, loading }) => (
  <SetupButton label="Create Multisig Wallet" onPress={onPress} loading={loading} />
);

export default CreateWalletButton;
