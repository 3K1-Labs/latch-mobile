import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import React from 'react';

interface ContinueButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

const ContinueButton: React.FC<ContinueButtonProps> = ({ onPress, disabled = false }) => (
  <SetupButton label="Continue" disabled={disabled} onPress={onPress} />
);

export default ContinueButton;
