import AccountSwitcherSheet from '@/src/components/account/AccountSwitcherSheet';
import SharedWalletWizardSheet from '@/src/components/account/SharedWalletWizardSheet';
import AboutSheet from '@/src/components/profile/AboutSheet';
import AccountInfoSheet from '@/src/components/profile/AccountInfoSheet';
import AddressBookSheet from '@/src/components/profile/AddressBookSheet';
import BackupSheet from '@/src/components/profile/BackupSheet';
import CurrencySheet from '@/src/components/profile/CurrencySheet';
import DrawerProfileHeader from '@/src/components/profile/DrawerProfileHeader';
import HelpSupportSheet from '@/src/components/profile/HelpSupportSheet';
import LogoutItem from '@/src/components/profile/LogoutItem';
import LogoutPromptSheet from '@/src/components/profile/LogoutPromptSheet';
import NetworkSheet from '@/src/components/profile/NetworkSheet';
import NotificationSheet from '@/src/components/profile/NotificationSheet';
import PermissionsSheet from '@/src/components/profile/PermissionsSheet';
// import PoliciesSheet from '@/src/components/profile/PoliciesSheet';
import { logout } from '@/src/api/latch-auth';
import PrivacyPolicySheet from '@/src/components/profile/PrivacyPolicySheet';
import RecoveryPhraseSheet from '@/src/components/profile/RecoveryPhraseSheet';
import SettingItem from '@/src/components/profile/SettingItem';
import SignersSheet from '@/src/components/profile/SignersSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { ACTIVE_NETWORK, MAINNET_NETWORK, TESTNET_NETWORK } from '@/src/constants/config';
import { useDrawer } from '@/src/context/drawer-context';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { switchActiveNetwork } from '@/src/lib/network-switch';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BIOMETRIC_ENABLED_KEY } from '../(auth)/biometric';

const Profile = () => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearAll, accounts, activeAccountIndex, avatars } = useWalletStore();
  const { closeDrawer } = useDrawer();
  // const { isDark, toggleTheme } = useAppTheme();
  const [accountInfoVisible, setAccountInfoVisible] = useState(false);
  // const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  // Non-null when the switcher should open straight into account creation —
  // set when a network switch lands on a network with no usable account.
  const [switcherInitialStep, setSwitcherInitialStep] = useState<'list' | 'add-info'>('list');
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [signersVisible, setSignersVisible] = useState(false);
  const [permissionsVisible, setPermissionsVisible] = useState(false);
  // const [policiesVisible, setPoliciesVisible] = useState(false);
  const [addressBookVisible, setAddressBookVisible] = useState(false);
  const [networkVisible, setNetworkVisible] = useState(false);
  const [currencyVisible, setCurrencyVisible] = useState(false);
  const { selectedCurrency } = useDisplayFiat();
  // Held as state, not read straight off the ACTIVE_NETWORK module binding in
  // render: the binding is only reliably live at call time (event handlers, API
  // calls), and a bare re-render was not reliably picking up the reassignment.
  // The NetworkSheet calls onNetworkChanged after the switch has applied, and
  // that callback reads the fresh value.
  const [networkLabel, setNetworkLabel] = useState(
    ACTIVE_NETWORK.network === 'TESTNET' ? 'Testnet' : 'Public Network',
  );
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [backupVisible, setBackupVisible] = useState(false);
  const [sharedWalletVisible, setSharedWalletVisible] = useState(false);

  const activeAccount = accounts[activeAccountIndex];
  const isPasskeyAccount = !activeAccount?.gAddress;

  if (!activeAccount) return null;

  const handleLogout = async () => {
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
    // Read the live ACTIVE_NETWORK binding, not the networkLabel state — the
    // binding is reliably current at call time, the state may still be catching up.
    const target = ACTIVE_NETWORK.network === 'TESTNET' ? MAINNET_NETWORK : TESTNET_NETWORK;
    void switchActiveNetwork(target).then(() => {
      setNetworkLabel(ACTIVE_NETWORK.network === 'TESTNET' ? 'Testnet' : 'Public Network');
    });
  };

  return (
    <Box flex={1} backgroundColor="cardbg" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Box height={56} justifyContent="center" alignItems="flex-end" paddingHorizontal="m">
          <TouchableOpacity onPress={closeDrawer}>
            <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </Box>

        <DrawerProfileHeader
          name={activeAccount?.name || ''}
          address={activeAccount?.smartAccountAddress || activeAccount?.gAddress || ''}
          image={activeAccount ? (avatars[activeAccount.publicKeyHex] ?? null) : null}
          onCopyAddress={async () => {
            console.log('activeAccount', activeAccount);
            if (activeAccount?.smartAccountAddress) {
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
        <AccountInfoSheet
          visible={accountInfoVisible}
          onClose={() => setAccountInfoVisible(false)}
        />
        {!isPasskeyAccount && (
          <RecoveryPhraseSheet
            visible={recoveryVisible}
            onClose={() => setRecoveryVisible(false)}
          />
        )}
        <SignersSheet visible={signersVisible} onClose={() => setSignersVisible(false)} />
        {/* <PoliciesSheet visible={policiesVisible} onClose={() => setPoliciesVisible(false)} /> */}
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
            // Let the network sheet finish dismissing before the switcher slides
            // up, so they don't cross-fade over each other. Set the step and
            // visibility together so the sheet's open effect sees 'add-info'.
            setTimeout(() => {
              setSwitcherInitialStep('add-info');
              setSwitcherVisible(true);
            }, 250);
          }}
        />
        <CurrencySheet visible={currencyVisible} onClose={() => setCurrencyVisible(false)} />
        <NotificationSheet
          visible={notificationsVisible}
          onClose={() => setNotificationsVisible(false)}
        />
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
        <SharedWalletWizardSheet
          visible={sharedWalletVisible}
          onClose={() => setSharedWalletVisible(false)}
        />

        <Box paddingHorizontal="m">
          {/* Account Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="m" style={{ marginLeft: 4 }}>
              Account
            </Text>
            <SettingItem
              icon="person-outline"
              label="My Profile"
              onPress={() => setAccountInfoVisible(true)}
              image={require('@/src/assets/icon/user.png')}
            />
            <SettingItem
              icon="people-outline"
              label="My Accounts"
              onPress={() => setSwitcherVisible(true)}
              image={require('@/src/assets/icon/users.png')}
            />
            <SettingItem
              icon="people-circle-outline"
              image={require('@/src/assets/icon/wallet-customer-group.png')}
              label="Multisig Wallets"
              onPress={() => setSharedWalletVisible(true)}
            />
            {/* {activeAccount.isMultisig && (
              <SettingItem
                icon="checkmark-done-outline"
                label="Approve a Request"
                onPress={() => {
                  if (activeAccount.isMultisig) {
                    closeDrawer();
                    router.push('/cosign-review');
                  }
                }}
              />
            )} */}
            <SettingItem
              icon="book-outline"
              label="Address Book"
              onPress={() => setAddressBookVisible(true)}
            />
            {!isPasskeyAccount && (
              <SettingItem
                icon="key-outline"
                label="Recovery Phrase"
                onPress={() => setRecoveryVisible(true)}
                image={require('@/src/assets/icon/key.png')}
              />
            )}
          </Box>

          {/* Security Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="m" style={{ marginLeft: 4 }}>
              Security
            </Text>
            {/* <SettingItem
              icon="finger-print-outline"
              label="Biometrics Authentication"
              showChevron={false}
              rightElement={
                <Switch value={biometricsEnabled} onValueChange={setBiometricsEnabled} />
              }
            /> */}
            <SettingItem
              icon="cloud-upload-outline"
              label="Wallet Backup"
              onPress={() => setBackupVisible(true)}
            />
            {/* <SettingItem
              icon="keypad-outline"
              label="Signers"
              onPress={() => setSignersVisible(true)}
              image={require('@/src/assets/icon/monitor-ipad-mobile.png')}
            /> */}
            <SettingItem
              icon="document-text-outline"
              label="Permissions"
              onPress={() => setPermissionsVisible(true)}
              image={require('@/src/assets/icon/mobile-shield-protection.png')}
            />
            {/* <SettingItem
              icon="options-outline"
              label="Policies"
              onPress={() => setPoliciesVisible(true)}
            /> */}
          </Box>

          {/* Preferences Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="m" style={{ marginLeft: 4 }}>
              Preferences
            </Text>
            {/* <SettingItem
              icon={isDark ? 'moon-outline' : 'sunny-outline'}
              label="Dark Mode"
              showChevron={false}
              rightElement={<Switch value={isDark} onValueChange={toggleTheme} />}
            /> */}
            <SettingItem
              icon="globe-outline"
              label="Network"
              value={networkLabel}
              onPress={() => setNetworkVisible(true)}
            />
            <SettingItem
              icon="cash-outline"
              label="Currency"
              value={selectedCurrency}
              onPress={() => setCurrencyVisible(true)}
            />
            <SettingItem
              icon="notifications-outline"
              label="Notifications"
              onPress={() => setNotificationsVisible(true)}
            />
          </Box>

          {/* Support Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="s" style={{ marginLeft: 4 }}>
              Support
            </Text>
            <SettingItem
              icon="help-circle-outline"
              label="Help & Support"
              onPress={() => setHelpSupportVisible(true)}
            />
            <SettingItem
              icon="information-circle-outline"
              label="About Latch"
              value="v1.0.0"
              onPress={() => setAboutVisible(true)}
            />
            <SettingItem
              icon="document-text-outline"
              label="Privacy Policy"
              onPress={() => setPrivacyVisible(true)}
            />
          </Box>

          <LogoutItem onPress={() => setLogoutVisible(true)} bottomInset={insets.bottom} />
        </Box>
      </ScrollView>
    </Box>
  );
};

export default Profile;
