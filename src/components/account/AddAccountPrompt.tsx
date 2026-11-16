import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

interface AddAccountPromptProps {
  onBack: () => void;
  onCreatePress: () => void;
  onAddSharedPress: () => void;
  onCreateMultisigPress: () => void;
  onAddPasskeyPress: () => void;
  /** False when the device/OS has no synced-passkey support — hides that option. */
  platformPasskeySupported: boolean;
}

const OptionCard = ({
  title,
  description,
  highlighted,
  onPress,
}: {
  title: string;
  description: string;
  highlighted?: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity accessibilityRole="button" activeOpacity={0.8} onPress={onPress}>
    <Box backgroundColor="inputBox" gap="s" style={[styles.card, highlighted && styles.highlighted]}>
      <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary">
        {title}
      </Text>
      <Text fontSize={12} lineHeight={14} letterSpacing={0.24} color="textSubheading">
        {description}
      </Text>
    </Box>
  </TouchableOpacity>
);

const AddAccountPrompt = ({
  onBack,
  onCreatePress,
  onAddSharedPress,
  onCreateMultisigPress,
  onAddPasskeyPress,
  platformPasskeySupported,
}: AddAccountPromptProps) => (
  <Box paddingBottom="xl">
    <Box flexDirection="row" alignItems="center" justifyContent="space-between" style={styles.header}>
      <RoundBackButton onPress={onBack} />
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
        Add Account
      </Text>
      <Box width={40} />
    </Box>

    <Box gap="s" style={styles.options}>
      <OptionCard
        highlighted
        title="Create Smart Account"
        description="Set up a smart account with advanced security and flexible permissions."
        onPress={onCreatePress}
      />
      <OptionCard
        title="Create a MultiSig Wallet"
        description="Create a wallet that requires multiple approvals."
        onPress={onCreateMultisigPress}
      />
      <OptionCard
        title="Import MultiSig Wallet"
        description="Already a signer on a multisig wallet? Add it by address to co-sign from here."
        onPress={onAddSharedPress}
      />
      {platformPasskeySupported && (
        <OptionCard
          title="Add Passkey Account"
          description="Add an existing Latch account using a passkey synced to iCloud or Google."
          onPress={onAddPasskeyPress}
        />
      )}
    </Box>
  </Box>
);

const styles = StyleSheet.create({
  header: {
    marginTop: 23,
    paddingHorizontal: 24,
  },
  options: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0F0F0F',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  highlighted: {
    borderColor: 'rgba(139,177,1,0.24)',
  },
});

export default AddAccountPrompt;
