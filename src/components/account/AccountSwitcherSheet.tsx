import {
  fetchDefaultContextRule,
  fetchFactoryVerifiers,
  isVerifierCompatible,
  type ChainSigner,
} from '@/src/api/account-admin';
import { deploySmartAccount as deploySmartAccountPasskey } from '@/src/api/passkey';
import { lookupWalletByPasskey } from '@/src/api/passkey-credential';
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
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import AppToast from '@/src/components/toast/AppToast';
import {
  getNetworkId,
  MAINNET_NETWORK,
  PASSKEY_RP_ID,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
  TESTNET_NETWORK,
} from '@/src/constants/config';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { AccountSigner, computeMajorityThreshold } from '@/src/lib/account-signers';
import { addSharedWalletByAddress } from '@/src/lib/add-shared-wallet';
import { announceMembership } from '@/src/lib/membership';
import { multisigMembershipHash } from '@/src/lib/multisig-address';
import { switchActiveNetwork } from '@/src/lib/network-switch';
import { storePlatformPasskeyCredentialAtIndex } from '@/src/lib/passkey-webauthn';
import { isPlatformPasskeySupported } from '@/src/lib/platform-passkey';
import {
  getStoredPasskeyLabel,
  notifyIfDeviceOnly,
  notifyIfWeakBiometricGate,
  provisionPasskeyAtIndex,
  storePasskeyLabel,
} from '@/src/lib/provision-passkey';
import { signInToExistingWalletWithPlatformPasskey } from '@/src/lib/wallet-auth';
import { ensureWalletCosignKey, publishWckBundle } from '@/src/lib/wallet-cosign-key';
import {
  accountUsableOnNetwork,
  getPasskeyStorageKeys,
  SECURE_KEYS,
  useWalletStore,
  type WalletAccount,
} from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import LoadingBlur from '../shared/LoadingBlur';
import AccountItem from './AccountItem';
import AccountSectionHeader from './AccountSectionHeader';
import AccountSheetHeader from './AccountSheetHeader';
import AddAccountInfo from './AddAccountInfo';
import AddAccountPrompt from './AddAccountPrompt';
import AddPasskeyAccount from './AddPasskeyAccount';
import AddSharedWalletForm from './AddSharedWalletForm';
import MultisigSignersSection from './MultisigSignersSection';
import SharedWalletResultModal from './SharedWalletResultModal';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export type SheetStep =
  | 'list'
  | 'add-prompt'
  | 'add-info'
  | 'add-shared'
  | 'add-passkey'
  | 'signers'
  | 'multisig-name'
  | 'multisig-members'
  | 'multisig-threshold'
  | 'multisig-review';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after a new account/multisig wallet is created, once this sheet
   * has closed, so the caller can prompt for the recovery password and back
   * it up (e.g. by opening BackupSheet) — uploadBackup() can't do this
   * itself post-onboarding, since the password session is gone by then. */
  onNeedsBackup?: () => void;
  /** Step to land on when the sheet opens. Defaults to the account list; pass
   * e.g. 'add-info' to open straight into account creation. */
  initialStep?: SheetStep;
  /** When true the sheet can't be dismissed — no back chevron, no backdrop tap,
   * no Android back. The only ways out are creating the account or `onSwitchBack`.
   * Used when the active network has no usable account. */
  mandatory?: boolean;
  /** The escape hatch shown in `mandatory` mode: revert to the previous network. */
  onSwitchBack?: () => void;
  switchBackLabel?: string;
}

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

const AccountSwitcherSheet = ({
  visible,
  onClose,
  onNeedsBackup,
  initialStep,
  mandatory = false,
  onSwitchBack,
  switchBackLabel,
}: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();

  const {
    accounts,
    activeAccountIndex,
    activeNetwork,
    avatars,
    mnemonic,
    switchAccount,
    addAccount,
    addPasskeyAccount,
    updateAccountSmartAddress,
    removeAccount,
    renameAccount,
    setAccountImage,
    resolveUnknownAccountNetworks,
  } = useWalletStore();

  const [step, setStep] = useState<SheetStep>(initialStep ?? 'list');
  const [deployingIndex, setDeployingIndex] = useState<number | null>(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);
  const [isAddingShared, setIsAddingShared] = useState(false);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [addPasskeyError, setAddPasskeyError] = useState<string | null>(null);
  const [signersFor, setSignersFor] = useState<{ name: string; address: string } | null>(null);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);

  const platformPasskeySupported = isPlatformPasskeySupported();

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
  // Tracks whether the sheet is currently open, so the close-branch reset only
  // runs on a real open→close transition — not when `initialStep` changes while
  // the sheet is still closed, which would schedule a stray setStep('list') that
  // clobbers the initialStep the sheet then opens with.
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible) {
      wasVisible.current = true;
      setStep(initialStep ?? 'list');
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
      // Stamp the network on any older account records so they fall into the
      // right (this-network / other-network) bucket below.
      void resolveUnknownAccountNetworks();
    } else if (wasVisible.current) {
      wasVisible.current = false;
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setTimeout(() => {
        setStep('list');
        setAddPasskeyError(null);
        resetMultisigState();
      }, 300);
    }
  }, [visible, initialStep, translateY, resolveUnknownAccountNetworks]);

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

  // Jump to the network the hidden accounts live on. reconcileActiveAccountForNetwork
  // (fired inside switchActiveNetwork) re-points the active account and updates
  // activeNetwork, so this sheet re-renders with the other network's list.
  const handleSwitchToOtherNetwork = async () => {
    if (switchingNetwork) return;
    setSwitchingNetwork(true);
    try {
      await switchActiveNetwork(activeNetwork === 'testnet' ? MAINNET_NETWORK : TESTNET_NETWORK);
    } catch (err) {
      if (__DEV__) console.error('[account] network switch failed:', err);
    } finally {
      setSwitchingNetwork(false);
    }
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
          accountLabel: name,
        });
        notifyIfDeviceOnly(provisioned);
        notifyIfWeakBiometricGate(provisioned);
        const { credentialId, publicKeyHex, keyDataHex, passkeyName, seq } = provisioned;

        newAccount = await addPasskeyAccount(credentialId, publicKeyHex);

        await renameAccount(currentLength, name);
        if (image) await setAccountImage(currentLength, image);

        const result = await deploySmartAccountPasskey(
          credentialId,
          keyDataHex,
          true,
          passkeyName,
          seq,
        );
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

  /**
   * Add a Latch account this user already has a synced passkey for — the
   * in-app equivalent of the onboarding sign-in-passkey screen. One discovery
   * ceremony (no address, no allowCredentials) resolves whichever synced Latch
   * passkey answers to its wallet via latch-api's passkey-credentials index;
   * a second ceremony proves control and reads the account's on-chain webauthn
   * signer. The account is only ever trusted from the chain — never from
   * anything this device claims locally.
   *
   * Mirrors completeSignIn in app/(onboarding)/sign-in-passkey.tsx, minus the
   * onboarding-complete flag and the router.replace: here the wallet already
   * exists on the device and this just appends another account to the list.
   */
  const handleAddPasskeyAccount = async () => {
    if (isAddingPasskey) return;
    setIsAddingPasskey(true);
    setAddPasskeyError(null);
    try {
      const found = await lookupWalletByPasskey();

      // Already in the list — switch to it instead of running a second
      // ceremony and letting appendAccount's dedupe silently no-op.
      const existingIndex = accounts.findIndex(
        (a) => a.smartAccountAddress === found.smartAccountAddress,
      );
      if (existingIndex >= 0) {
        Toast.show({
          type: 'info',
          text1: 'Already added',
          text2: accounts[existingIndex].name,
        });
        handleSwitch(existingIndex);
        return;
      }

      const result = await signInToExistingWalletWithPlatformPasskey(found.smartAccountAddress);

      const listIndex = accounts.length;
      // signInToExistingWalletWithPlatformPasskey ran under PASSKEY_RP_ID, so
      // that is the RP this credential answers to.
      await storePlatformPasskeyCredentialAtIndex(
        { credentialId: result.credentialId, keyDataHex: result.keyDataHex },
        listIndex,
        PASSKEY_RP_ID,
      );
      if (found.label) {
        await storePasskeyLabel(getPasskeyStorageKeys(listIndex), found.label, found.seq);
      }

      const appended = await useWalletStore.getState().appendAccount(
        {
          index: -1,
          name: found.label || `Account ${listIndex + 1}`,
          gAddress: '',
          publicKeyHex: '',
          smartAccountAddress: found.smartAccountAddress,
          image: null,
          credentialId: result.credentialId,
          network: result.network,
        },
        true,
      );

      // The account is added stamped with the network it's actually deployed
      // on (result.network). If that isn't the network the app is on, it won't
      // show in the list until the user switches — say so rather than leaving
      // them looking for it.
      const addedOnOtherNetwork = result.network && result.network !== activeNetwork;
      Toast.show({
        type: 'success',
        text1: 'Account added',
        text2: addedOnOtherNetwork
          ? `${appended.name} is on ${result.network === 'testnet' ? 'Testnet' : 'Public Network'} — switch networks to view it`
          : appended.name,
      });
      setStep('list');
      onClose();
    } catch (e: any) {
      // Every discovery/sign-in failure — no synced credential, expired nonce,
      // bad signature — is reported identically by latch-api on purpose, so the
      // message here stays generic. The C-address is a public identifier and is
      // what makes a Sentry report actionable.
      Sentry.captureException(e instanceof Error ? e : new Error(String(e?.message ?? e)), {
        tags: { scope: 'account-switcher-add-passkey', network: getNetworkId() },
      });
      setAddPasskeyError(
        e?.message ??
          "Couldn't add that account. Make sure you're signed in to the same Google or iCloud account.",
      );
    } finally {
      setIsAddingPasskey(false);
    }
  };

  const handleDeploy = async (account: WalletAccount, listIndex: number) => {
    setDeployingIndex(listIndex);
    try {
      if (account.credentialId) {
        const keyDataHex = account.publicKeyHex + account.credentialId;
        const stored = await getStoredPasskeyLabel(listIndex);
        const result = await deploySmartAccountPasskey(
          account.credentialId,
          keyDataHex,
          true,
          stored?.passkeyName,
          stored?.seq,
        );
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
            onAddPasskeyPress={() => {
              setAddPasskeyError(null);
              setStep('add-passkey');
            }}
            platformPasskeySupported={platformPasskeySupported}
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
      case 'add-passkey':
        return (
          <AddPasskeyAccount
            onBack={() => {
              setAddPasskeyError(null);
              setStep('add-prompt');
            }}
            onFind={handleAddPasskeyAccount}
            isSubmitting={isAddingPasskey}
            errorMessage={addPasskeyError}
            platformSupported={platformPasskeySupported}
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
            onBack={
              mandatory
                ? undefined
                : () => {
                    setCreateAccountError(null);
                    setStep('add-prompt');
                  }
            }
            onSubmit={handleCreateAccount}
            isSubmitting={isAddingAccount}
            errorMessage={createAccountError}
            secondaryAction={
              mandatory && onSwitchBack
                ? {
                    label: switchBackLabel ?? 'Switch back',
                    onPress: onSwitchBack,
                    disabled: isAddingAccount,
                  }
                : undefined
            }
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
        // Only show accounts that live on the network the app is pointed at —
        // a smart account on the other network can't be read or spent from
        // here. Unknown-network (older records, probe pending) and not-yet-
        // deployed accounts stay visible on both. Split into regular and
        // multisig groups while preserving each account's ORIGINAL array
        // position — handleSwitch/handleDeploy/isActive all key off listIndex,
        // so the index must survive the filter + grouping.
        const regular: { account: WalletAccount; listIndex: number }[] = [];
        const multisig: { account: WalletAccount; listIndex: number }[] = [];
        accounts.forEach((account, listIndex) => {
          if (!accountUsableOnNetwork(account, activeNetwork)) return;
          (account.isMultisig ? multisig : regular).push({ account, listIndex });
        });

        const offNetworkCount = accounts.filter(
          (a) => a.smartAccountAddress && a.network && a.network !== activeNetwork,
        ).length;
        const thisNetworkLabel = activeNetwork === 'testnet' ? 'Testnet' : 'Public Network';
        const otherNetworkLabel = activeNetwork === 'testnet' ? 'Public Network' : 'Testnet';

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
            <AccountSheetHeader
              onClose={onClose}
              onAdd={() => setStep('add-prompt')}
              label={activeNetwork === 'testnet' ? 'Testnet' : 'Mainnet '}
            />
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

              {regular.length === 0 && multisig.length === 0 && (
                <Box py="l" alignItems="center">
                  <Text variant="p7" color="textSecondary" textAlign="center">
                    No accounts on {thisNetworkLabel}
                  </Text>
                </Box>
              )}

              {offNetworkCount > 0 && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  disabled={switchingNetwork}
                  onPress={handleSwitchToOtherNetwork}
                >
                  <Box
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                    backgroundColor="bg11"
                    borderRadius={16}
                    padding="m"
                    mt="s"
                  >
                    <Box flex={1} pr="s">
                      <Text variant="p7" color="textPrimary" fontWeight="600">
                        {offNetworkCount} account{offNetworkCount === 1 ? '' : 's'} on{' '}
                        {otherNetworkLabel}
                      </Text>
                      <Text variant="p8" color="textSecondary" mt="xs">
                        {switchingNetwork ? 'Switching…' : `Tap to switch to ${otherNetworkLabel}`}
                      </Text>
                    </Box>
                    <Ionicons name="swap-horizontal" size={18} color={theme.colors.textSecondary} />
                  </Box>
                </TouchableOpacity>
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
        // In mandatory mode the wallet has no account on this network, so nothing
        // dismisses the sheet — not the backdrop, not Android back. The only ways
        // out are creating the account or the explicit "switch back" button.
        onRequestClose={mandatory ? () => {} : onClose}
      >
        <TouchableWithoutFeedback onPress={mandatory ? undefined : onClose} disabled={mandatory}>
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
            <LoadingBlur visible={isAddingPasskey} text="Adding your account…" />
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
