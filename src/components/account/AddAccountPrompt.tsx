import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

interface AddAccountPromptProps {
  onBack: () => void;
  onCreatePress: () => void;
  onAddSharedPress: () => void;
  onCreateMultisigPress: () => void;
  onAddPasskeyPress: () => void;
  /** False when the device/OS has no synced-passkey support — hides that option. */
  platformPasskeySupported: boolean;
}

const AddAccountPrompt = ({
  onBack,
  onCreatePress,
  onAddSharedPress,
  onCreateMultisigPress,
  onAddPasskeyPress,
  platformPasskeySupported,
}: AddAccountPromptProps) => {
  const theme = useTheme<Theme>();
  const [selected, setSelected] = React.useState<
    'create' | 'shared' | 'create-multisig' | 'passkey' | 'connect' | null
  >(null);

  const handlePress = (
    option: 'create' | 'shared' | 'create-multisig' | 'passkey' | 'connect',
    callback?: () => void,
  ) => {
    setSelected(option);
    setTimeout(() => {
      if (callback) {
        callback();
      }
      setSelected(null);
    }, 400);
  };

  return (
    <Box paddingHorizontal="m" paddingBottom="xl">
      {/* Header */}
      <Box flexDirection={'row'} alignItems="center" justifyContent="space-between" py="xs" mb="m">
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>

        <Text variant="h10" color="textPrimary" fontWeight="800">
          Add Account
        </Text>
        <Box width={40} />
      </Box>

      {/* Options List */}
      <Box gap="s">
        {/* Create Smart Account Option */}
        <TouchableOpacity activeOpacity={0.8} onPress={() => handlePress('create', onCreatePress)}>
          <Box
            padding="l"
            borderRadius={24}
            borderWidth={1.5}
            borderColor={selected === 'create' ? 'primary700' : 'gray800'}
          >
            <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="s">
              <Text variant="h9" color="textPrimary" fontWeight="700">
                Create Smart Account
              </Text>
              <Text
                variant="h12"
                color="primary700"
                fontWeight="700"
                style={{ letterSpacing: 0.5 }}
              >
                Recommended
              </Text>
            </Box>
            <Text variant="p7" color="textSecondary" lineHeight={22}>
              Set up a fresh account powered by smart contracts. Enjoy advanced security like
              multisig and session keys.
            </Text>
          </Box>
        </TouchableOpacity>

        {/* Create Multisig Wallet Option */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handlePress('create-multisig', onCreateMultisigPress)}
        >
          <Box
            padding="l"
            borderRadius={24}
            borderWidth={1.5}
            borderColor={selected === 'create-multisig' ? 'primary700' : 'gray800'}
          >
            <Box mb="s">
              <Text variant="h9" color="textPrimary" fontWeight="700">
                Create Multisig Wallet
              </Text>
            </Box>
            <Text variant="p7" color="textSecondary" lineHeight={22}>
              Create a shared wallet that requires multiple approvals. Invite co-owners and set how
              many signatures are needed to send funds.
            </Text>
          </Box>
        </TouchableOpacity>

        {/* Add Shared Wallet Option */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handlePress('shared', onAddSharedPress)}
        >
          <Box
            padding="l"
            borderRadius={24}
            borderWidth={1.5}
            borderColor={selected === 'shared' ? 'primary700' : 'gray800'}
          >
            <Box mb="s">
              <Text variant="h9" color="textPrimary" fontWeight="700">
                Import Multisig Wallet
              </Text>
            </Box>
            <Text variant="p7" color="textSecondary" lineHeight={22}>
              Already a signer on a multisig wallet? Add it by address to view it and co-sign
              transfers from this device.
            </Text>
          </Box>
        </TouchableOpacity>

        {/* Add Existing Passkey Account Option */}
        {platformPasskeySupported && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => handlePress('passkey', onAddPasskeyPress)}
          >
            <Box
              padding="l"
              borderRadius={24}
              borderWidth={1.5}
              borderColor={selected === 'passkey' ? 'primary700' : 'gray800'}
            >
              <Box mb="s">
                <Text variant="h9" color="textPrimary" fontWeight="700">
                  Add Passkey Account
                </Text>
              </Box>
              <Text variant="p7" color="textSecondary" lineHeight={22}>
                Already have a Latch account with a passkey? Add it here using the passkey synced
                to Google Password Manager or iCloud Keychain — no address to type.
              </Text>
            </Box>
          </TouchableOpacity>
        )}

        {/* Connect Existing Option */}
        {/* <TouchableOpacity activeOpacity={0.8} onPress={() => handlePress('connect')}>
          <Box
            padding="l"
            borderRadius={24}
            borderWidth={1.5}
            borderColor={selected === 'connect' ? 'primary700' : 'gray800'}
          >
            <Box mb="s">
              <Text variant="h9" color="textPrimary" fontWeight="700">
                Connect Existing
              </Text>
            </Box>
            <Text variant="p7" color="textSecondary" lineHeight={22}>
              Import a hardware wallet, traditional Stellar account, or another Smart Account you
              already own.
            </Text>
          </Box>
        </TouchableOpacity> */}
      </Box>
    </Box>
  );
};

export default AddAccountPrompt;
