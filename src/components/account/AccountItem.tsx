import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { Image, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { WalletAccount } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';

interface AccountItemProps {
  account: WalletAccount;
  isActive: boolean;
  onPress: () => void;
  onDeploy?: () => void;
  onShowSigners?: () => void;
  isDeploying?: boolean;
  avatarDataUri?: string;
}

const AccountItem = ({
  account,
  isActive,
  onPress,
  onDeploy,
  onShowSigners,
  isDeploying,
  avatarDataUri,
}: AccountItemProps) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  const handleCopy = async () => {
    const address = account.smartAccountAddress || account.gAddress;
    if (address) {
      await copyToClipboard(address);
    }
  };

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} disabled={isDeploying}>
      <Box
        backgroundColor="bg11"
        borderRadius={16}
        padding="m"
        flexDirection="row"
        alignItems="center"
        mb="m"
        gap="m"
      >
        {/* Avatar */}
        <Box
          width={48}
          height={48}
          borderRadius={24}
          overflow="hidden"
          backgroundColor={isDark ? 'gray800' : 'gray100'}
        >
          {avatarDataUri ? (
            <Image source={{ uri: avatarDataUri }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Box flex={1} justifyContent="center" alignItems="center">
              <Text variant="h9" color="textPrimary" fontWeight="700">
                {account.name.charAt(0)}
              </Text>
            </Box>
          )}
        </Box>

        {/* Info */}
        <Box flex={1}>
          <Text variant="h10" color="textPrimary" fontWeight="700">
            {account.name}
          </Text>
          <Box flexDirection="row" alignItems="center" gap="xs" mt="xs">
            <Text variant="p7" color="textSecondary">
              {shortenAddress(account.smartAccountAddress || account.gAddress || '')}
            </Text>
            <TouchableOpacity
              onPress={handleCopy}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="copy-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </Box>
        </Box>

        {/* Signers (multisig only) */}
        {onShowSigners && (
          <TouchableOpacity
            onPress={onShowSigners}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="people-outline" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}

        {/* Selection Indicator */}
        <Box
          width={24}
          height={24}
          borderRadius={12}
          borderWidth={2}
          borderColor={isActive ? 'primary700' : 'gray800'}
          justifyContent="center"
          alignItems="center"
        >
          {isActive && <Box width={12} height={12} borderRadius={6} backgroundColor="primary700" />}
        </Box>
      </Box>
    </TouchableOpacity>
  );
};

export default AccountItem;
