import { logout } from '@/src/api/latch-auth';
import AccountSwitcherSheet from '@/src/components/account/AccountSwitcherSheet';
import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import AboutSheet from '@/src/components/profile/AboutSheet';
import AppearanceSheet from '@/src/components/profile/AppearanceSheet';
import AddressBookSheet from '@/src/components/profile/AddressBookSheet';
import BackupSheet from '@/src/components/profile/BackupSheet';
import CurrencySheet from '@/src/components/profile/CurrencySheet';
import DrawerProfileHeader from '@/src/components/profile/DrawerProfileHeader';
import HelpSupportSheet from '@/src/components/profile/HelpSupportSheet';
import LogoutPromptSheet from '@/src/components/profile/LogoutPromptSheet';
import NetworkSheet from '@/src/components/profile/NetworkSheet';
import PermissionsSheet from '@/src/components/profile/PermissionsSheet';
import PrivacyPolicySheet from '@/src/components/profile/PrivacyPolicySheet';
import RecoveryPhraseSheet from '@/src/components/profile/RecoveryPhraseSheet';
import SettingItem, {
  SettingsGroup,
  SettingsSearchContext,
} from '@/src/components/profile/SettingItem';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { ACTIVE_NETWORK, MAINNET_NETWORK, TESTNET_NETWORK } from '@/src/constants/config';
import { NOTIFICATIONS_QUERY_KEY } from '@/src/hooks/use-notifications';
import { switchActiveNetwork } from '@/src/lib/network-switch';
import { unregisterPush } from '@/src/lib/push-registration';
import { useNotificationStore } from '@/src/store/notification-store';
import { avatarKey, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@shopify/restyle';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BIOMETRIC_ENABLED_KEY } from './(auth)/biometric';

const SEARCH = require('@/src/assets/images/swap/search.svg');
const ICONS = {
  wallet: require('@/src/assets/images/settings/wallet.svg'),
  addressBook: require('@/src/assets/images/settings/address-book.svg'),
  key: require('@/src/assets/images/settings/key.svg'),
  devices: require('@/src/assets/images/settings/devices.svg'),
  toggle: require('@/src/assets/images/settings/toggle.svg'),
  world: require('@/src/assets/images/settings/world.svg'),
  bell: require('@/src/assets/images/settings/bell.svg'),
  support: require('@/src/assets/images/settings/support.svg'),
  info: require('@/src/assets/images/settings/info.svg'),
};

const Settings = () => {
  const theme = useTheme<Theme>();
  const [search, setSearch] = useState('');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clearAll, accounts, activeAccountIndex, avatars } = useWalletStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  // 'add-info' when a network switch lands on a network with no usable account.
  const [switcherInitialStep, setSwitcherInitialStep] = useState<'list' | 'add-info'>('list');
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [permissionsVisible, setPermissionsVisible] = useState(false);
  const [addressBookVisible, setAddressBookVisible] = useState(false);
  const [networkVisible, setNetworkVisible] = useState(false);
  const [currencyVisible, setCurrencyVisible] = useState(false);
  const [appearanceVisible, setAppearanceVisible] = useState(false);
  // Held as state, not read straight off the ACTIVE_NETWORK module binding in
  // render: the binding is only reliably live at call time, so NetworkSheet's
  // onNetworkChanged reads the fresh value after the switch applies.
  const [networkLabel, setNetworkLabel] = useState(
    ACTIVE_NETWORK.network === 'TESTNET' ? 'Testnet' : 'Public Network',
  );
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [backupVisible, setBackupVisible] = useState(false);

  const activeAccount = accounts[activeAccountIndex];
  const isPasskeyAccount = !activeAccount?.gAddress;
  // Locally-cached count; account-signers.tsx syncs from chain on mount, so a
  // stale count only affects which route is pushed.
  const backupSignerCount = activeAccount?.devices?.filter((d) => d.isBackupSigner).length ?? 0;

  if (!activeAccount) return null;

  const handleLogout = async () => {
    await unregisterPush();
    queryClient.removeQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    useNotificationStore.getState().reset();
    await logout();
    await clearAll();
    await AsyncStorage.multiRemove([BIOMETRIC_ENABLED_KEY, 'latch_onboarding_complete']);
    router.replace('/onboarding');
  };

  // Escape hatch from the mandatory "create an account for this network" sheet:
  // revert to the network the user came from, which does have an account.
  const previousNetworkLabel = networkLabel === 'Testnet' ? 'Public Network' : 'Testnet';
  const handleSwitchBackNetwork = () => {
    setSwitcherVisible(false);
    setSwitcherInitialStep('list');
    const target = ACTIVE_NETWORK.network === 'TESTNET' ? MAINNET_NETWORK : TESTNET_NETWORK;
    void switchActiveNetwork(target).then(() => {
      setNetworkLabel(ACTIVE_NETWORK.network === 'TESTNET' ? 'Testnet' : 'Public Network');
    });
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />

      <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} style={styles.back} />
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Settings
        </Text>
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <Box
          flexDirection="row"
          alignItems="center"
          backgroundColor="inputBox"
          borderRadius={40}
          style={styles.search}
        >
          <Image source={SEARCH} contentFit="contain" style={styles.searchIcon} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={theme.colors.textSubheading}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
          />
        </Box>
        <DrawerProfileHeader
          name={activeAccount.name || ''}
          address={activeAccount.smartAccountAddress || activeAccount.gAddress || ''}
          image={avatars[avatarKey(activeAccount)] ?? null}
          onCopyAddress={async () => {
            if (activeAccount.smartAccountAddress) {
              await copyToClipboard(activeAccount.smartAccountAddress);
            }
          }}
          onPress={() => setSwitcherVisible(true)}
        />

        <AccountSwitcherSheet
          visible={switcherVisible}
          initialStep={switcherInitialStep}
          mandatory={switcherInitialStep === 'add-info'}
          onSwitchBack={handleSwitchBackNetwork}
          switchBackLabel={`Switch back to ${previousNetworkLabel}`}
          onClose={() => {
            setSwitcherVisible(false);
            setSwitcherInitialStep('list');
          }}
        />
        {!isPasskeyAccount && (
          <RecoveryPhraseSheet
            visible={recoveryVisible}
            onClose={() => setRecoveryVisible(false)}
          />
        )}
        <PermissionsSheet
          visible={permissionsVisible}
          onClose={() => setPermissionsVisible(false)}
        />
        <AddressBookSheet
          visible={addressBookVisible}
          onClose={() => setAddressBookVisible(false)}
        />
        <NetworkSheet
          visible={networkVisible}
          onClose={() => setNetworkVisible(false)}
          onNetworkChanged={() =>
            setNetworkLabel(ACTIVE_NETWORK.network === 'TESTNET' ? 'Testnet' : 'Public Network')
          }
          onNeedsAccount={() => {
            setNetworkVisible(false);
            // Let the network sheet finish dismissing before the switcher slides up.
            setTimeout(() => {
              setSwitcherInitialStep('add-info');
              setSwitcherVisible(true);
            }, 250);
          }}
        />
        <CurrencySheet visible={currencyVisible} onClose={() => setCurrencyVisible(false)} />
        <AppearanceSheet visible={appearanceVisible} onClose={() => setAppearanceVisible(false)} />
        <HelpSupportSheet
          visible={helpSupportVisible}
          onClose={() => setHelpSupportVisible(false)}
        />
        <AboutSheet visible={aboutVisible} onClose={() => setAboutVisible(false)} />
        <PrivacyPolicySheet visible={privacyVisible} onClose={() => setPrivacyVisible(false)} />
        <LogoutPromptSheet
          visible={logoutVisible}
          onClose={() => setLogoutVisible(false)}
          onConfirm={handleLogout}
        />
        <BackupSheet visible={backupVisible} onClose={() => setBackupVisible(false)} />

        <SettingsSearchContext.Provider value={search}>
          <Box style={styles.groups}>
            <SettingsGroup title="Account">
              <SettingItem
                svg={ICONS.wallet}
                label="My Accounts"
                value={String(accounts.length)}
                onPress={() => setSwitcherVisible(true)}
              />
              <SettingItem
                svg={ICONS.addressBook}
                label="Address Book"
                onPress={() => setAddressBookVisible(true)}
              />
              {!isPasskeyAccount && (
                <SettingItem
                  svg={ICONS.key}
                  label="Recovery Phrase"
                  onPress={() => setRecoveryVisible(true)}
                />
              )}
            </SettingsGroup>

            <SettingsGroup title="Security">
              {isPasskeyAccount && (
                <SettingItem
                  svg={ICONS.devices}
                  svgSize={14}
                  label="Signers"
                  onPress={() =>
                    router.push(backupSignerCount > 0 ? '/account-signers' : '/add-backup-signer')
                  }
                />
              )}
              <SettingItem
                svg={ICONS.toggle}
                label="Permissions"
                onPress={() => setPermissionsVisible(true)}
              />
              <SettingItem
                icon="cloud-upload"
                label="Wallet Backup"
                onPress={() => setBackupVisible(true)}
              />
            </SettingsGroup>

            <SettingsGroup title="Preferences">
              <SettingItem
                svg={ICONS.world}
                svgSize={13.33}
                label="Network"
                onPress={() => setNetworkVisible(true)}
              />
              <SettingItem
                svg={ICONS.bell}
                label="Notifications"
                rightElement={
                  unreadCount > 0 ? (
                    <Box
                      minWidth={20}
                      height={20}
                      borderRadius={10}
                      paddingHorizontal="xs"
                      justifyContent="center"
                      alignItems="center"
                      style={styles.badge}
                    >
                      <Text
                        fontSize={11}
                        lineHeight={14}
                        fontFamily="SFproSemibold"
                        style={styles.badgeText}
                      >
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </Text>
                    </Box>
                  ) : undefined
                }
                onPress={() => router.push('/notification')}
              />
              <SettingItem
                icon="cash"
                label="Currency"
                onPress={() => setCurrencyVisible(true)}
              />
              <SettingItem
                icon="contrast"
                label="Appearance"
                onPress={() => setAppearanceVisible(true)}
              />
            </SettingsGroup>

            <SettingsGroup title="Support">
              <SettingItem
                svg={ICONS.support}
                label="Help & Support"
                onPress={() => setHelpSupportVisible(true)}
              />
              <SettingItem
                svg={ICONS.info}
                label="About Latch"
                onPress={() => setAboutVisible(true)}
              />
              <SettingItem
                icon="document-text"
                label="Privacy Policy"
                onPress={() => setPrivacyVisible(true)}
              />
            </SettingsGroup>

            <SettingsGroup>
              <SettingItem svg={ICONS.wallet} label="Log out" onPress={() => setLogoutVisible(true)} />
            </SettingsGroup>
          </Box>
        </SettingsSearchContext.Provider>
      </ScrollView>
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
    paddingHorizontal: 24,
  },
  back: {
    position: 'absolute',
    left: 24,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 15,
  },
  search: {
    height: 48,
    paddingHorizontal: 22,
    gap: 10,
    marginBottom: 15,
  },
  searchIcon: {
    width: 13,
    height: 15,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: 14,
    // Keeps the bundled SF Pro vertically centred in an iOS TextInput.
    lineHeight: 18,
    fontFamily: 'SFproRegular',
    color: '#FFFFFF',
  },
  groups: {
    marginTop: 34,
    gap: 24,
  },
  badge: {
    backgroundColor: '#FFC508',
  },
  badgeText: {
    color: '#000000',
  },
});

export default Settings;
