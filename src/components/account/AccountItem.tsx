import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { WalletAccount } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';

const ICONS = {
  copy: require('@/src/assets/images/drawer/copy.svg'),
  chevron: require('@/src/assets/images/settings/card-chevron.svg'),
};

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
  onShowSigners,
  isDeploying,
  avatarDataUri,
}: AccountItemProps) => {
  const theme = useTheme<Theme>();
  const address = account.smartAccountAddress || account.gAddress || '';

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={isDeploying}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="inputBox"
        borderColor="cardBorder"
        gap="sm"
        style={[styles.card, isActive && styles.activeCard]}
      >
        <Box backgroundColor="avatarBg" style={styles.avatar}>
          {avatarDataUri ? (
            <Image source={{ uri: avatarDataUri }} contentFit="cover" style={styles.avatarImage} />
          ) : (
            <Box flex={1} justifyContent="center" alignItems="center">
              <Text fontSize={18} lineHeight={26} fontFamily="SFproSemibold" color="textPrimary">
                {account.name.charAt(0).toUpperCase()}
              </Text>
            </Box>
          )}
        </Box>

        <Box flex={1} gap="xs">
          <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary" numberOfLines={1}>
            {account.name}
          </Text>
          <Box flexDirection="row" alignItems="center" gap="s">
            <Text fontSize={14} lineHeight={22} color="textSubheading">
              {shortenAddress(address)}
            </Text>
            {address ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Copy address"
                hitSlop={10}
                onPress={() => copyToClipboard(address)}
                style={styles.copyChip}
              >
                <Image source={ICONS.copy} contentFit="contain" style={styles.copyIcon} />
              </TouchableOpacity>
            ) : null}
          </Box>
        </Box>

        {onShowSigners && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Show signers"
            hitSlop={10}
            onPress={onShowSigners}
          >
            <Ionicons name="people-outline" size={20} color="#706F6F" />
          </TouchableOpacity>
        )}

        <Image
          source={ICONS.chevron}
          contentFit="contain"
          tintColor={theme.colors.iconPrimary}
          style={styles.chevron}
        />
      </Box>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  // The active account is marked by a faint green outline rather than a radio.
  activeCard: {
    borderColor: 'rgba(118,177,1,0.24)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  copyChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(241,246,225,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyIcon: {
    width: 13.5,
    height: 13.5,
  },
  chevron: {
    width: 20,
    height: 20,
    transform: [{ rotate: '-90deg' }],
  },
});

export default AccountItem;
