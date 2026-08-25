import AccountSwitcherSheet from '@/src/components/account/AccountSwitcherSheet';
import SharedWalletWizardSheet from '@/src/components/account/SharedWalletWizardSheet';
import AboutSheet from '@/src/components/profile/AboutSheet';
import AccountInfoSheet from '@/src/components/profile/AccountInfoSheet';
import AddressBookSheet from '@/src/components/profile/AddressBookSheet';
import BackupSheet from '@/src/components/profile/BackupSheet';
import DrawerProfileHeader from '@/src/components/profile/DrawerProfileHeader';
import HelpSupportSheet from '@/src/components/profile/HelpSupportSheet';
import LanguageSheet from '@/src/components/profile/LanguageSheet';
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
import { ACTIVE_NETWORK } from '@/src/constants/config';
import { useDrawer } from '@/src/context/drawer-context';
import { getCurrentLanguage, SUPPORTED_LANGUAGES } from '@/src/i18n/i18n';
import { ASYNC_KEYS, useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BIOMETRIC_ENABLED_KEY } from '../(auth)/biometric';

const Profile = () => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { clearAll, accounts, activeAccountIndex, avatars } = useWalletStore();
  const { closeDrawer } = useDrawer();
  // const { isDark, toggleTheme } = useAppTheme();
  const [accountInfoVisible, setAccountInfoVisible] = useState(false);
  // const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [signersVisible, setSignersVisible] = useState(false);
  const [permissionsVisible, setPermissionsVisible] = useState(false);
  // const [policiesVisible, setPoliciesVisible] = useState(false);
  const [addressBookVisible, setAddressBookVisible] = useState(false);
  const [networkVisible, setNetworkVisible] = useState(false);
  const [, forceNetworkLabelRefresh] = useState(0);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [backupVisible, setBackupVisible] = useState(false);
  const [sharedWalletVisible, setSharedWalletVisible] = useState(false);
  const [languageVisible, setLanguageVisible] = useState(false);

  const activeAccount = accounts[activeAccountIndex];
  const isPasskeyAccount = !activeAccount?.gAddress;

  // Get current language display name
  const currentLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === getCurrentLanguage());

  // One-shot nudge: if onboarding's backup upload failed, prompt for it here
  // instead of losing the failure silently — see BACKUP_PENDING and
  // deploy-account.tsx's Step 5.
  useEffect(() => {
    AsyncStorage.getItem(ASYNC_KEYS.BACKUP_PENDING).then((pending) => {
      if (pending === 'true') {
        AsyncStorage.removeItem(ASYNC_KEYS.BACKUP_PENDING);
        setBackupVisible(true);
      }
    });
  }, []);

  if (!activeAccount) return null;

  const handleLogout = async () => {
    await logout();
    await clearAll();
    await AsyncStorage.multiRemove([BIOMETRIC_ENABLED_KEY, 'latch_onboarding_complete']);
    router.replace('/onboarding');
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
          onClose={() => setSwitcherVisible(false)}
          onNeedsBackup={() => setBackupVisible(true)}
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
          onNetworkChanged={() => forceNetworkLabelRefresh((n) => n + 1)}
        />
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
          onNeedsBackup={() => setBackupVisible(true)}
        />
        <LanguageSheet visible={languageVisible} onClose={() => setLanguageVisible(false)} />

        <Box paddingHorizontal="m">
          {/* Account Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="m" style={{ marginLeft: 4 }}>
              {t('profile.sections.account')}
            </Text>
            <SettingItem
              icon="person-outline"
              label={t('profile.settings.myProfile')}
              onPress={() => setAccountInfoVisible(true)}
              image={require('@/src/assets/icon/user.png')}
            />
            <SettingItem
              icon="people-outline"
              label={t('profile.settings.myAccounts')}
              onPress={() => setSwitcherVisible(true)}
              image={require('@/src/assets/icon/users.png')}
            />
            <SettingItem
              icon="people-circle-outline"
              image={require('@/src/assets/icon/wallet-customer-group.png')}
              label={t('profile.settings.multisigWallets')}
              onPress={() => setSharedWalletVisible(true)}
            />
            {activeAccount.isMultisig && (
              <SettingItem
                icon="checkmark-done-outline"
                label={t('profile.settings.approveRequest')}
                onPress={() => {
                  if (activeAccount.isMultisig) {
                    closeDrawer();
                    router.push('/cosign-review');
                  }
                }}
              />
            )}
            <SettingItem
              icon="book-outline"
              label={t('profile.settings.addressBook')}
              onPress={() => setAddressBookVisible(true)}
            />
            {!isPasskeyAccount && (
              <SettingItem
                icon="key-outline"
                label={t('profile.settings.recoveryPhrase')}
                onPress={() => setRecoveryVisible(true)}
                image={require('@/src/assets/icon/key.png')}
              />
            )}
          </Box>

          {/* Security Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="m" style={{ marginLeft: 4 }}>
              {t('profile.sections.security')}
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
              label={t('profile.settings.walletBackup')}
              onPress={() => setBackupVisible(true)}
            />
            <SettingItem
              icon="keypad-outline"
              label={t('profile.settings.signers')}
              onPress={() => setSignersVisible(true)}
              image={require('@/src/assets/icon/monitor-ipad-mobile.png')}
            />
            <SettingItem
              icon="document-text-outline"
              label={t('profile.settings.permissions')}
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
              {t('profile.sections.preferences')}
            </Text>
            {/* <SettingItem
              icon={isDark ? 'moon-outline' : 'sunny-outline'}
              label="Dark Mode"
              showChevron={false}
              rightElement={<Switch value={isDark} onValueChange={toggleTheme} />}
            /> */}
            <SettingItem
              icon="globe-outline"
              label={t('profile.settings.network')}
              value={ACTIVE_NETWORK.network === 'TESTNET' ? t('profile.settings.networkTestnet') : t('profile.settings.networkPublic')}
              onPress={() => setNetworkVisible(true)}
            />
            <SettingItem
              icon="notifications-outline"
              label={t('profile.settings.notifications')}
              onPress={() => setNotificationsVisible(true)}
            />
            <SettingItem
              icon="language-outline"
              label={t('profile.settings.language')}
              value={currentLanguage?.nativeName || 'English'}
              onPress={() => {
                closeDrawer();
                setTimeout(() => setLanguageVisible(true), 200);
              }}
            />
          </Box>

          {/* Support Section */}
          <Box mb="l">
            <Text variant="p7" color="textSecondary" mb="s" style={{ marginLeft: 4 }}>
              {t('profile.sections.support')}
            </Text>
            <SettingItem
              icon="help-circle-outline"
              label={t('profile.settings.helpSupport')}
              onPress={() => setHelpSupportVisible(true)}
            />
            <SettingItem
              icon="information-circle-outline"
              label={t('profile.settings.aboutLatch')}
              value="v1.0.0"
              onPress={() => setAboutVisible(true)}
            />
            <SettingItem
              icon="document-text-outline"
              label={t('profile.settings.privacyPolicy')}
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
