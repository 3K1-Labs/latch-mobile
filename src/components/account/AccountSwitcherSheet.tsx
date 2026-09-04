import {
  fetchDefaultContextRule,
  fetchFactoryVerifiers,
  isVerifierCompatible,
  type ChainSigner,
} from '@/src/api/account-admin';
import { deploySmartAccount as deploySmartAccountPasskey } from '@/src/api/passkey';
import {
  deployMultiSigSmartAccount,
  deploySmartAccount as deploySmartAccountEd25519,
} from '@/src/api/smart-account';
import AddMemberButton from '@/src/components/add-members/AddMemberButton';
import ChooseMethodSheet from '@/src/components/add-members/ChooseMethodSheet';
import AddMembersContinueButton from '@/src/components/add-members/ContinueButton';
import MemberList, { Member } from '@/src/components/add-members/MemberList';
import RemoveMemberSheet from '@/src/components/add-members/RemoveMemberSheet';
import ScanQRSheet from '@/src/components/add-members/ScanQRSheet';
import SelfMemberCard from '@/src/components/add-members/SelfMemberCard';
import ApprovalSlider from '@/src/components/approval-number/ApprovalSlider';
import ApprovalContinueButton from '@/src/components/approval-number/ContinueButton';
import CreateSharedContinueButton from '@/src/components/create-shared/ContinueButton';
import InputField from '@/src/components/create-shared/InputField';
import ApprovalRuleCard from '@/src/components/shared-wallet-review/ApprovalRuleCard';
import CreateWalletButton from '@/src/components/shared-wallet-review/CreateWalletButton';
import MemberReviewList from '@/src/components/shared-wallet-review/MemberReviewList';
import WalletNameCard from '@/src/components/shared-wallet-review/WalletNameCard';
import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import AppToast from '@/src/components/toast/AppToast';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { AccountSigner, computeMajorityThreshold } from '@/src/lib/account-signers';
import { addSharedWalletByAddress } from '@/src/lib/add-shared-wallet';
import { announceMembership } from '@/src/lib/membership';
import { multisigMembershipHash } from '@/src/lib/multisig-address';
import {
  notifyIfDeviceOnly,
  notifyIfWeakBiometricGate,
  provisionPasskeyAtIndex,
} from '@/src/lib/provision-passkey';
import { ensureWalletCosignKey, publishWckBundle } from '@/src/lib/wallet-cosign-key';
import {
  getPasskeyStorageKeys,
  SECURE_KEYS,
  useWalletStore,
  type WalletAccount,
} from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import QuickCrypto from 'react-native-quick-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import LoadingBlur from '../shared/LoadingBlur';
import AccountItem from './AccountItem';
import AccountSectionHeader from './AccountSectionHeader';
import AccountSheetHeader from './AccountSheetHeader';
import AddAccountInfo from './AddAccountInfo';
import AddAccountPrompt from './AddAccountPrompt';
import AddSharedWalletForm from './AddSharedWalletForm';
import MultisigSignersSection from './MultisigSignersSection';
import SharedWalletResultModal from './SharedWalletResultModal';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after a new account/multisig wallet is created, once this sheet
   * has closed, so the caller can prompt for the recovery password and back
   * it up (e.g. by opening BackupSheet) — uploadBackup() can't do this
   * itself post-onboarding, since the password session is gone by then. */
  onNeedsBackup?: () => void;
}

type SheetStep =
  | 'list'
  | 'add-prompt'
  | 'add-info'
  | 'add-shared'
  | 'signers'
  | 'multisig-name'
  | 'multisig-members'
  | 'multisig-threshold'
  | 'multisig-review';

interface MultisigResult {
  success: boolean;
  walletAddress: string;
  errorMessage?: string;
}

const MULTISIG_STEP_TITLES: Record<string, string> = {
  'multisig-name': 'Create Multisig Wallet',
  'multisig-members': 'Add Owners',
  'multisig-threshold': 'Require Approval',
  'multisig-review': 'Preview',
};

function describeMemberReadError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes('entry not found') ||
    m.includes('could not find') ||
    m.includes('no instance ledger') ||
    m.includes('not deployed')
  )
    return 'not deployed on this network';
  if (m.includes('no default context rule')) return 'not a Latch account';
  if (m.includes('unrecognized signer') || m.includes('unrecognised signer'))
    return 'unsupported signer type';
  return 'could not read account';
}

const AccountSwitcherSheet = ({ visible, onClose, onNeedsBackup }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();

  const {
    accounts,
    activeAccountIndex,
    avatars,
    mnemonic,
    switchAccount,
    addAccount,
    addPasskeyAccount,
    updateAccountSmartAddress,
    removeAccount,
    renameAccount,
    setAccountImage,
  } = useWalletStore();

  const [step, setStep] = useState<SheetStep>('list');
  const [deployingIndex, setDeployingIndex] = useState<number | null>(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);
  const [isAddingShared, setIsAddingShared] = useState(false);
  const [signersFor, setSignersFor] = useState<{ name: string; address: string } | null>(null);

  // Multisig wizard state
  const [walletName, setWalletName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [walletNameTouched, setWalletNameTouched] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [methodSheetVisible, setMethodSheetVisible] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState(1);
  const [selfEmail, setSelfEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [multisigResult, setMultisigResult] = useState<MultisigResult | null>(null);

  const totalSigners = Math.max(1, members.length) + 1;

  const memberAddresses = useMemo(
    () =>
      members
        .filter((m) => m.status === 'added' && StrKey.isValidContract(m.value))
        .map((m) => m.value),
    [members],
  );

  const existingSameMembers = useMemo(() => {
    if (memberAddresses.length === 0) return null;
    const hash = multisigMembershipHash(memberAddresses, approvals);
    return accounts.find((a) => a.multisigMembershipHash === hash) ?? null;
  }, [accounts, memberAddresses, approvals]);

  // Slide-up animation
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 25,
        mass: 1,
        stiffness: 150,
      }).start();
      SecureStore.getItemAsync(SECURE_KEYS.USER_EMAIL)
        .then(setSelfEmail)
        .catch(() => setSelfEmail(null));
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setTimeout(() => {
        setStep('list');
        resetMultisigState();
      }, 300);
    }
  }, [visible, translateY]);

  const resetMultisigState = () => {
    setWalletName('');
    setPurpose('');
    setWalletNameTouched(false);
    setMembers([]);
    setApprovals(1);
    setMultisigResult(null);
    setMethodSheetVisible(false);
    setScanVisible(false);
    setPendingRemoveId(null);
  };

  const handleMultisigBack = () => {
    if (step === 'multisig-name') {
      resetMultisigState();
      setStep('add-prompt');
    } else if (step === 'multisig-members') {
      setStep('multisig-name');
    } else if (step === 'multisig-threshold') {
      setStep('multisig-members');
    } else if (step === 'multisig-review') {
      setStep('multisig-threshold');
    }
  };

  const handleContinueName = () => {
    setWalletNameTouched(true);
    if (!walletName.trim()) return;
    setStep('multisig-members');
  };

  const handleContinueMembers = () => {
    if (members.length === 0) return;
    setApprovals((prev) => {
      const safeDefault = Math.min(
        Math.max(computeMajorityThreshold(totalSigners), 2),
        totalSigners,
      );
      return Math.min(Math.max(prev > 1 ? prev : safeDefault, 1), totalSigners);
    });
    setStep('multisig-threshold');
  };

  const handleContinueThreshold = () => {
    setStep('multisig-review');
  };

  const handleCreateMultisig = async () => {
    if (submitting) return;
    setSubmitting(true);

    const signers: AccountSigner[] = [];

    const { accounts: currentAccounts, activeAccountIndex: currentIndex } =
      useWalletStore.getState();
    const creator = currentAccounts[currentIndex];
    if (!creator?.smartAccountAddress) {
      setMultisigResult({
        success: false,
        walletAddress: '',
        errorMessage: 'Your personal account is not deployed yet. Finish setup first.',
      });
      setSubmitting(false);
      return;
    }
    if (creator.gAddress && creator.publicKeyHex) {
      signers.push({ kind: 'ed25519', publicKeyHex: creator.publicKeyHex });
    } else {
      let keyDataHex = await SecureStore.getItemAsync(
        getPasskeyStorageKeys(currentIndex).keyDataHex,
      );
      if (!keyDataHex && creator.publicKeyHex && creator.credentialId) {
        keyDataHex = creator.publicKeyHex + creator.credentialId;
      }
      if (!keyDataHex) {
        if (__DEV__) {
          console.log('[shared-wallet] creator key_data unresolved', {
            currentIndex,
            smartAccountAddress: creator.smartAccountAddress,
            hasPublicKeyHex: !!creator.publicKeyHex,
            hasCredentialId: !!creator.credentialId,
            isMultisig: !!creator.isMultisig,
          });
        }
        setMultisigResult({
          success: false,
          walletAddress: '',
          errorMessage: "Could not read this device's key. Finish biometric setup first.",
        });
        setSubmitting(false);
        return;
      }
      signers.push({ kind: 'webauthn', keyDataHex });
    }

    const simParams = {
      rpcUrl: STELLAR_RPC_URL,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      factoryAddress: STELLAR_FACTORY_ADDRESS,
    };
    const pendingInvites: string[] = [];
    const invalidAddresses: string[] = [];
    for (const m of members) {
      if (m.status === 'pending') {
        pendingInvites.push(m.name || m.value);
        continue;
      }
      if (!StrKey.isValidContract(m.value)) {
        invalidAddresses.push(m.name || m.value);
        continue;
      }
      try {
        const rule = await fetchDefaultContextRule(simParams, m.value);
        const ext = rule.signers.find(
          (s): s is ChainSigner & { kind: 'ed25519' | 'webauthn' } =>
            s.kind === 'ed25519' || s.kind === 'webauthn',
        );
        if (!ext) {
          invalidAddresses.push(`${m.name || m.value} (no device key on account)`);
          continue;
        }
        if (ext.foreignVerifier) {
          const compatible = await isVerifierCompatible(simParams, ext.verifierAddress!, ext.kind);
          if (__DEV__) {
            const fv = await fetchFactoryVerifiers(simParams).catch(() => null);
            console.log('[multisig] member foreign verifier', {
              member: m.value,
              memberKind: ext.kind,
              memberVerifier: ext.verifierAddress,
              factory: simParams.factoryAddress,
              factoryGetVerifier: ext.kind === 'ed25519' ? fv?.ed25519 : fv?.webauthn,
              compatible,
            });
          }
          if (!compatible) {
            invalidAddresses.push(
              `${m.name || m.value} (deployed under a different factory — recreate this account)`,
            );
            continue;
          }
        }
        if (ext.kind === 'ed25519') {
          signers.push({ kind: 'ed25519', publicKeyHex: ext.keyDataHex });
        } else {
          signers.push({ kind: 'webauthn', keyDataHex: ext.keyDataHex });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (__DEV__) console.warn(`[multisig] could not read member account ${m.value}:`, reason);
        invalidAddresses.push(`${m.name || m.value} (${describeMemberReadError(reason)})`);
      }
    }

    if (signers.length < 2) {
      const reasons: string[] = [];
      if (pendingInvites.length) reasons.push(`waiting on invitees: ${pendingInvites.join(', ')}`);
      if (invalidAddresses.length)
        reasons.push(`invalid addresses: ${invalidAddresses.join(', ')}`);
      const suffix = reasons.length ? ` (${reasons.join('; ')})` : '';
      setMultisigResult({
        success: false,
        walletAddress: '',
        errorMessage: `Add at least one other confirmed member to deploy a multisig wallet${suffix}.`,
      });
      setSubmitting(false);
      return;
    }

    const threshold = Math.min(Math.max(approvals, 1), signers.length);
    if (signers.length < approvals) {
      setMultisigResult({
        success: false,
        walletAddress: '',
        errorMessage: `Threshold ${approvals} can't be met with ${signers.length} confirmed signer${signers.length === 1 ? '' : 's'}. Resend pending invites or lower the threshold.`,
      });
      setSubmitting(false);
      return;
    }

    try {
      const deployResult = await deployMultiSigSmartAccount(signers, threshold);

      const newAccount: WalletAccount = {
        index: -1,
        name: walletName.trim() || 'Shared Wallet',
        gAddress: '',
        publicKeyHex: '',
        smartAccountAddress: deployResult.smartAccountAddress,
        image: null,
        isMultisig: true,
        multisigThreshold: threshold,
        multisigSigners: signers
          .filter((s): s is Extract<AccountSigner, { kind: 'delegated' }> => s.kind === 'delegated')
          .map((s) => s.address),
        multisigMembershipHash: multisigMembershipHash(memberAddresses, approvals),
        multisigNonceHex: deployResult.nonceHex,
      };

      await useWalletStore.getState().appendAccount(newAccount, true);

      ensureWalletCosignKey(deployResult.smartAccountAddress)
        .then(() => publishWckBundle(deployResult.smartAccountAddress))
        .catch((err) => {
          if (__DEV__) console.log('[wck] generate/publish failed:', err?.message);
        });

      announceMembership(deployResult.smartAccountAddress).catch((err) => {
        if (__DEV__) console.log('[membership] announce failed:', err?.message);
      });

      setMultisigResult({ success: true, walletAddress: deployResult.smartAccountAddress });
    } catch (err) {
      if (__DEV__) console.error('[multisig] deploy failed:', err);
      setMultisigResult({
        success: false,
        walletAddress: '',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const addMember = (name: string, value: string, status: 'pending' | 'added') => {
    setMembers((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, name, value, status }]);
  };

  const confirmRemove = () => {
    if (pendingRemoveId) {
      setMembers((prev) => prev.filter((m) => m.id !== pendingRemoveId));
    }
    setPendingRemoveId(null);
  };

  const handleMultisigResultClose = () => {
    const wasSuccess = multisigResult?.success;
    setMultisigResult(null);
    if (wasSuccess) {
      resetMultisigState();
      setStep('list');
      onClose();
      // Close this sheet's Modal before opening BackupSheet's — two Modals
      // changing presentation state in the same tick wedges the native
      // modal host on iOS (see handleSwitch below for the same constraint).
      onNeedsBackup?.();
    }
  };

  const handleSwitch = (listIndex: number) => {
    // Close the sheet's Modal first and let switchAccount fire in the background —
    // it already updates the store synchronously (see wallet.ts), and toggling a
    // second Modal (a loading blur) in the same tick as this Modal closing wedges
    // the native modal host on iOS (two Modals changing presentation state in one
    // commit), leaving the app unresponsive.
    onClose();
    if (listIndex === activeAccountIndex) return;
    switchAccount(listIndex).catch((err) => {
      if (__DEV__) console.error('[account] switch failed:', err);
    });
  };

  const handleCreateAccount = async (name: string, image: string | null) => {
    if (isAddingAccount) return;
    const currentLength = accounts.length;
    setIsAddingAccount(true);
    setCreateAccountError(null);
    let newAccount: WalletAccount | null = null;

    try {
      if (mnemonic) {
        newAccount = await addAccount();
        if (!newAccount) return;

        await renameAccount(currentLength, name);
        if (image) await setAccountImage(currentLength, image);

        const result = await deploySmartAccountEd25519(newAccount.publicKeyHex, {
          skipFunding: true,
        });
        await updateAccountSmartAddress(newAccount.index, result.smartAccountAddress);
      } else {
        const requiresBiometric = await SecureStore.getItemAsync(
          SECURE_KEYS.PASSKEY_REQUIRES_BIOMETRIC,
        );
        const useBiometric = requiresBiometric !== 'false';

        // Prefer a real platform passkey (synced via Google Password Manager /
        // iCloud Keychain) for this additional account, same as onboarding.
        const provisioned = await provisionPasskeyAtIndex(currentLength, {
          requireBiometric: useBiometric,
          displayName: name,
        });
        notifyIfDeviceOnly(provisioned);
        notifyIfWeakBiometricGate(provisioned);
        const { credentialId, publicKeyHex, keyDataHex } = provisioned;

        newAccount = await addPasskeyAccount(credentialId, publicKeyHex);

        await renameAccount(currentLength, name);
        if (image) await setAccountImage(currentLength, image);

        const result = await deploySmartAccountPasskey(credentialId, keyDataHex, true);
        if (result.error) throw new Error(result.error);
        await updateAccountSmartAddress(newAccount.index, result.smartAccountAddress);
      }

      switchAccount(currentLength);
      onClose();
      // This account's key material has never been backed up — prompt for
      // the recovery password via BackupSheet rather than silently skipping
      // it (uploadBackup() can't run here itself; see onNeedsBackup above).
      onNeedsBackup?.();
    } catch (err: any) {
      setCreateAccountError(err?.message || 'Failed to create account');
      if (newAccount) {
        try {
          await removeAccount(newAccount.index);
        } catch (rollbackErr) {
          if (__DEV__) console.error('[account] rollback failed:', rollbackErr);
        }
      }
    } finally {
      setIsAddingAccount(false);
    }
  };

  const handleAddSharedWallet = async (address: string, name: string) => {
    if (isAddingShared) return;
    setIsAddingShared(true);
    try {
      const account = await addSharedWalletByAddress(address, name);
      Toast.show({ type: 'success', text1: 'Multisig wallet added', text2: account.name });
      onClose();
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Could not add wallet',
        text2: err?.message || 'Failed to add multisig wallet',
      });
    } finally {
      setIsAddingShared(false);
    }
  };

  const handleDeploy = async (account: WalletAccount, listIndex: number) => {
    setDeployingIndex(listIndex);
    try {
      if (account.credentialId) {
        const keyDataHex = account.publicKeyHex + account.credentialId;
        const result = await deploySmartAccountPasskey(account.credentialId, keyDataHex, true);
        if (result.error) throw new Error(result.error);
        await updateAccountSmartAddress(account.index, result.smartAccountAddress);
      } else {
        if (!mnemonic) return;
        const result = await deploySmartAccountEd25519(account.publicKeyHex, { skipFunding: true });
        await updateAccountSmartAddress(account.index, result.smartAccountAddress);
      }

      Toast.show({ type: 'success', text1: 'Success', text2: 'Account deployed successfully' });
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: err?.message || 'Deployment failed',
      });
    } finally {
      setDeployingIndex(null);
    }
  };

  const renderMultisigStep = () => {
    switch (step) {
      case 'multisig-name':
        return (
          <>
            <KeyboardAwareScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1 }}
              bottomOffset={16}
            >
              <Box flex={1} px="m" justifyContent="flex-start" mt="xs">
                <Box width="100%" mt="s">
                  <InputField
                    label="Wallet Name"
                    placeholder="e.g., Treasury"
                    value={walletName}
                    onChangeText={(t) => setWalletName(t)}
                    onBlur={() => setWalletNameTouched(true)}
                    status={walletNameTouched && !walletName.trim() ? 'danger' : 'basic'}
                    error={
                      walletNameTouched && !walletName.trim()
                        ? 'Wallet name is required'
                        : undefined
                    }
                    autoFocus
                    style={{
                      flex: 1,
                      color: theme.colors.textPrimary,
                      fontFamily: 'SFproRegular',
                      fontSize: 16,
                      letterSpacing: -0.32,
                      padding: 0,
                    }}
                  />
                  <InputField
                    label="Purpose"
                    isOptional
                    placeholder="What will this wallet be used for?"
                    value={purpose}
                    onChangeText={(t) => setPurpose(t)}
                  />
                </Box>
              </Box>
            </KeyboardAwareScrollView>
            <Box px="m" style={{ paddingTop: 12, paddingBottom: 12 }}>
              <CreateSharedContinueButton
                disabled={!walletName.trim()}
                onPress={handleContinueName}
              />
            </Box>
          </>
        );

      case 'multisig-members':
        return (
          <>
            <Box flex={1} px="m">
              <AddMemberButton onPress={() => setMethodSheetVisible(true)} />
              <SelfMemberCard />
              <MemberList members={members} onRemove={(id) => setPendingRemoveId(id)} />
            </Box>
            <Box px="m" style={{ paddingTop: 12, paddingBottom: 12 }}>
              <AddMembersContinueButton
                disabled={members.length === 0}
                onPress={handleContinueMembers}
              />
            </Box>
          </>
        );

      case 'multisig-threshold':
        return (
          <>
            <Box flex={1} px="m" mt="xs">
              <ApprovalSlider value={approvals} total={totalSigners} onChange={setApprovals} />
              {approvals === totalSigners && totalSigners > 2 && (
                <Box mt="s" px="m">
                  <Text variant="p7" color="textSecondary" textAlign="center">
                    Recommended: require fewer approvals than total members so one offline member
                    doesn&apos;t lock the wallet.
                  </Text>
                </Box>
              )}
            </Box>
            <Box px="m" style={{ paddingTop: 12, paddingBottom: 12 }}>
              <ApprovalContinueButton onPress={handleContinueThreshold} />
            </Box>
          </>
        );

      case 'multisig-review':
        return (
          <>
            <ScrollView
              contentContainerStyle={{ flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Box flex={1} px="m">
                <WalletNameCard name={walletName} />
                <MemberReviewList members={members} selfEmail={selfEmail} />
                <ApprovalRuleCard approvals={approvals} total={totalSigners} />
                {existingSameMembers && (
                  <Box flexDirection="row" backgroundColor="bg11" borderRadius={14} p="m" mt="m">
                    <Ionicons
                      name="information-circle-outline"
                      size={18}
                      color={theme.colors.textSecondary}
                      style={{ marginRight: 8, marginTop: 1 }}
                    />
                    <Text variant="p8" color="textSecondary" style={{ flex: 1 }} lineHeight={18}>
                      You already have a shared wallet ({existingSameMembers.name}) with these
                      members and threshold. You can still create a separate one.
                    </Text>
                  </Box>
                )}
              </Box>
            </ScrollView>
            <Box px="m" style={{ paddingTop: 12, paddingBottom: 12 }}>
              <CreateWalletButton onPress={handleCreateMultisig} loading={submitting} />
            </Box>
          </>
        );

      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (step) {
      case 'add-prompt':
        return (
          <AddAccountPrompt
            onBack={() => setStep('list')}
            onCreatePress={() => setStep('add-info')}
            onAddSharedPress={() => setStep('add-shared')}
            onCreateMultisigPress={() => setStep('multisig-name')}
          />
        );
      case 'add-shared':
        return (
          <AddSharedWalletForm
            onBack={() => setStep('add-prompt')}
            onSubmit={handleAddSharedWallet}
            isSubmitting={isAddingShared}
          />
        );
      case 'signers':
        return signersFor ? (
          <MultisigSignersSection
            walletName={signersFor.name}
            address={signersFor.address}
            onBack={() => setStep('list')}
          />
        ) : null;
      case 'add-info':
        return (
          <AddAccountInfo
            defaultName={`Account ${accounts.length + 1}`}
            onBack={() => {
              setCreateAccountError(null);
              setStep('add-prompt');
            }}
            onSubmit={handleCreateAccount}
            isSubmitting={isAddingAccount}
            errorMessage={createAccountError}
          />
        );

      case 'multisig-name':
      case 'multisig-members':
      case 'multisig-threshold':
      case 'multisig-review':
        return (
          <Box flex={1}>
            <Box
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal="m"
              py="xs"
              mb="m"
            >
              <TouchableOpacity
                onPress={handleMultisigBack}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text variant="h10" color="textPrimary" fontWeight="800">
                {MULTISIG_STEP_TITLES[step]}
              </Text>
              <Box width={40} />
            </Box>
            <View style={{ flex: 1 }}>{renderMultisigStep()}</View>
          </Box>
        );

      default: {
        // Split into regular and multisig groups while preserving each
        // account's ORIGINAL array position — handleSwitch/handleDeploy/isActive
        // all key off listIndex, so the index must survive the grouping.
        const regular: { account: WalletAccount; listIndex: number }[] = [];
        const multisig: { account: WalletAccount; listIndex: number }[] = [];
        accounts.forEach((account, listIndex) => {
          (account.isMultisig ? multisig : regular).push({ account, listIndex });
        });

        const renderAccount = ({
          account,
          listIndex,
        }: {
          account: WalletAccount;
          listIndex: number;
        }) => (
          <AccountItem
            key={listIndex}
            account={account}
            isActive={listIndex === activeAccountIndex}
            onPress={() => handleSwitch(listIndex)}
            onDeploy={() => handleDeploy(account, listIndex)}
            onShowSigners={
              account.isMultisig && account.smartAccountAddress
                ? () => {
                    setSignersFor({
                      name: account.name,
                      address: account.smartAccountAddress as string,
                    });
                    setStep('signers');
                  }
                : undefined
            }
            isDeploying={deployingIndex === listIndex}
            avatarDataUri={avatars[account.publicKeyHex]}
          />
        );

        return (
          <>
            <AccountSheetHeader onClose={onClose} onAdd={() => setStep('add-prompt')} />
            <KeyboardAwareScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              style={{ flexShrink: 1 }}
              bottomOffset={16}
            >
              {regular.length > 0 && (
                <>
                  <AccountSectionHeader label="Regular accounts" count={regular.length} />
                  {regular.map(renderAccount)}
                </>
              )}
              {multisig.length > 0 && (
                <>
                  <AccountSectionHeader label="Multisig accounts" count={multisig.length} />
                  {multisig.map(renderAccount)}
                </>
              )}
            </KeyboardAwareScrollView>
          </>
        );
      }
    }
  };

  const isMultisigStep = step.startsWith('multisig-');

  return (
    <>
      {/* Hide the sheet while the result modal is up — RN presents only one
          Modal at a time on iOS; a sibling result Modal can't appear over a
          still-visible sheet. On error, result→null brings the sheet back
          at the review step so the user can retry. */}
      <Modal
        transparent
        visible={visible && multisigResult === null}
        animationType="none"
        onRequestClose={onClose}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY }],
                flex: 1,
                marginTop: SCREEN_HEIGHT - SHEET_HEIGHT,
              },
            ]}
          >
            <BottomSheetHandle />
            {renderContent()}
            <LoadingBlur
              visible={isAddingAccount || deployingIndex !== null}
              text="Creating Account..."
              subText="Deploying your new Smart Account to the Stellar network. This only takes a moment."
            />
          </Animated.View>
        </View>

        {isMultisigStep && (
          <>
            <ChooseMethodSheet
              visible={methodSheetVisible}
              onClose={() => setMethodSheetVisible(false)}
              onScanQR={() => {
                setMethodSheetVisible(false);
                setTimeout(() => setScanVisible(true), 300);
              }}
              onMemberAdded={(name, value, status) => {
                addMember(name, value, status);
                setMethodSheetVisible(false);
              }}
            />

            <ScanQRSheet
              visible={scanVisible}
              onClose={() => setScanVisible(false)}
              onMemberAdded={(name, address) => {
                addMember(name, address, 'added');
                setScanVisible(false);
              }}
            />

            <RemoveMemberSheet
              visible={pendingRemoveId !== null}
              onCancel={() => setPendingRemoveId(null)}
              onConfirm={confirmRemove}
            />
          </>
        )}

        {/* This sheet is a Modal stacked on top of the drawer's Modal, and each
            Modal is its own native window — so neither the root host nor the
            drawer's can paint over it. Last child so it sits above the sheet
            body; gated on the same condition as the Modal so a closed sheet
            never sits on top of the toast library's ref stack. */}
        {visible && multisigResult === null && <AppToast />}
      </Modal>

      <SharedWalletResultModal
        visible={multisigResult !== null}
        success={multisigResult?.success ?? false}
        walletAddress={multisigResult?.walletAddress ?? ''}
        errorMessage={multisigResult?.errorMessage}
        onClose={handleMultisigResultClose}
      />
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    width: '100%',
    minHeight: 300,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default AccountSwitcherSheet;
