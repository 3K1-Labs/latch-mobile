import AccountSwitcherSheet from '@/src/components/account/AccountSwitcherSheet';
import SharedWalletWizardSheet from '@/src/components/account/SharedWalletWizardSheet';
import HelpSupportSheet from '@/src/components/profile/HelpSupportSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useDrawer } from '@/src/context/drawer-context';
import { avatarKey, useWalletStore } from '@/src/store/wallet';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Image } from 'expo-image';
import { Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { ImageSourcePropType, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICONS = {
  chevron: require('@/src/assets/images/drawer/chevron.svg'),
  copy: require('@/src/assets/images/drawer/copy.svg'),
  profile: require('@/src/assets/images/drawer/profile.svg'),
  wallet: require('@/src/assets/images/drawer/wallet.svg'),
  history: require('@/src/assets/images/drawer/history.svg'),
  settings: require('@/src/assets/images/drawer/settings.svg'),
  support: require('@/src/assets/images/drawer/support.svg'),
  fallbackAvatar: require('@/src/assets/token/user.png'),
};

// Matches the drawer's close animation, so a pushed screen isn't covered by the
// drawer's Modal (its backdrop would otherwise keep swallowing touches).
const CLOSE_DELAY = 250;

const DrawerRow = ({
  icon,
  label,
  onPress,
}: {
  icon: ImageSourcePropType;
  label: string;
  onPress: () => void;
}) => (
  <TouchableOpacity accessibilityRole="button" activeOpacity={0.7} onPress={onPress}>
    <Box flexDirection="row" alignItems="center" gap="sm" style={styles.row}>
      <Box
        width={32}
        height={32}
        borderRadius={16}
        backgroundColor="inputOutline"
        justifyContent="center"
        alignItems="center"
      >
        <Image source={icon} contentFit="contain" style={styles.rowIcon} />
      </Box>
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
        {label}
      </Text>
    </Box>
  </TouchableOpacity>
);

const Profile = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { closeDrawer } = useDrawer();
  const { accounts, activeAccountIndex, avatars } = useWalletStore();
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [sharedWalletVisible, setSharedWalletVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);

  const activeAccount = accounts[activeAccountIndex];
  if (!activeAccount) return null;

  const address = activeAccount.smartAccountAddress || activeAccount.gAddress || '';
  const avatar = avatars[avatarKey(activeAccount)];

  const navigate = (href: Href) => {
    closeDrawer();
    setTimeout(() => router.navigate(href), CLOSE_DELAY);
  };

  return (
    <Box
      flex={1}
      backgroundColor="surfaceBase"
      style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 48 }]}
    >
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Switch account"
        activeOpacity={0.85}
        onPress={() => setSwitcherVisible(true)}
      >
        <Box flexDirection="row" gap="sm" borderBottomWidth={1} borderColor="inputOutline" style={styles.header}>
          <Image
            source={avatar ? { uri: avatar } : ICONS.fallbackAvatar}
            contentFit="cover"
            style={styles.avatar}
          />
          <Box flex={1} style={styles.identity}>
            <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="s">
              <Text
                flexShrink={1}
                fontSize={24}
                lineHeight={32}
                fontFamily="SFproMedium"
                color="textPrimary"
                numberOfLines={1}
              >
                {activeAccount.name || ''}
              </Text>
              <Image source={ICONS.chevron} contentFit="contain" style={styles.chevron} />
            </Box>
            <Box flexDirection="row" alignItems="center" gap="s">
              <Text fontSize={14} lineHeight={22} color="textSubheading">
                {shortenAddress(address)}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Copy address"
                hitSlop={10}
                onPress={() => address && copyToClipboard(address)}
                style={styles.copyChip}
              >
                <Image source={ICONS.copy} contentFit="contain" style={styles.copyIcon} />
              </TouchableOpacity>
            </Box>
          </Box>
        </Box>
      </TouchableOpacity>

      <Box style={styles.rows}>
        <DrawerRow icon={ICONS.profile} label="Profile" onPress={() => navigate('/account-info')} />
        <DrawerRow
          icon={ICONS.wallet}
          label="Multisig Wallets"
          onPress={() => setSharedWalletVisible(true)}
        />
        <DrawerRow icon={ICONS.history} label="History" onPress={() => navigate('/history')} />
      </Box>

      <Box flex={1} />

      <Box style={styles.footer}>
        <DrawerRow icon={ICONS.settings} label="Settings" onPress={() => navigate('/settings')} />
        <DrawerRow
          icon={ICONS.support}
          label="Help & Support"
          onPress={() => setHelpSupportVisible(true)}
        />
      </Box>

      <AccountSwitcherSheet visible={switcherVisible} onClose={() => setSwitcherVisible(false)} />
      <SharedWalletWizardSheet
        visible={sharedWalletVisible}
        onClose={() => setSharedWalletVisible(false)}
      />
      <HelpSupportSheet
        visible={helpSupportVisible}
        onClose={() => setHelpSupportVisible(false)}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
  },
  header: {
    paddingVertical: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  identity: {
    gap: 6,
  },
  chevron: {
    width: 20,
    height: 20,
    transform: [{ rotate: '-90deg' }],
  },
  copyChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(241,246,225,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyIcon: {
    width: 13.5,
    height: 13.5,
  },
  rows: {
    marginTop: 22,
    gap: 4,
  },
  footer: {
    gap: 9,
  },
  row: {
    paddingVertical: 16,
  },
  rowIcon: {
    width: 20,
    height: 20,
  },
});

export default Profile;
