import {
  fetchDefaultContextRule,
  fetchFactoryVerifiers,
  isVerifierCompatible,
  type ChainSigner,
} from '@/src/api/account-admin';
import { deployMultiSigSmartAccount } from '@/src/api/smart-account';
import { multisigMembershipHash } from '@/src/lib/multisig-address';
import { announceMembership } from '@/src/lib/membership';
import { ensureWalletCosignKey, publishWckBundle } from '@/src/lib/wallet-cosign-key';
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
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { AccountSigner, computeMajorityThreshold } from '@/src/lib/account-signers';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SharedWalletResultModal from './SharedWalletResultModal';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type Step = 'name' | 'members' | 'threshold' | 'review';

interface ResultState {
  success: boolean;
  walletAddress: string;
  errorMessage?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after the new multisig wallet is created, once this sheet has
   * closed, so the caller can prompt for the recovery password and back it
   * up (e.g. by opening BackupSheet) — uploadBackup() can't do this itself
   * post-onboarding, since the password session is gone by then. */
  onNeedsBackup?: () => void;
}

const STEP_TITLES: Record<Step, string> = {
  name: 'Create Multisig Wallet',
  members: 'Add Owners',
  threshold: 'Require Approval',
  review: 'Preview',
};

/** Map a raw member-account read error to a short, user-facing reason. */
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

const SharedWalletWizardSheet = ({ visible, onClose, onNeedsBackup }: Props) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  const [step, setStep] = useState<Step>('name');
  const [walletName, setWalletName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [walletNameTouched, setWalletNameTouched] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [methodSheetVisible, setMethodSheetVisible] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const totalSigners = Math.max(1, members.length) + 1;
  const [approvals, setApprovals] = useState(1);

  const [selfEmail, setSelfEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);

  const accounts = useWalletStore((s) => s.accounts);

  // Member account C-addresses — the user-facing "members" identity, used to
  // warn about re-creating a wallet with the same people. Independent of the
  // per-wallet deploy nonce, so it stays stable across distinct wallets.
  const memberAddresses = useMemo(
    () =>
      members
        .filter((m) => m.status === 'added' && StrKey.isValidContract(m.value))
        .map((m) => m.value),
    [members],
  );

  // An existing shared wallet with this exact member set + threshold, if any.
  const existingSameMembers = useMemo(() => {
    if (memberAddresses.length === 0) return null;
    const hash = multisigMembershipHash(memberAddresses, approvals);
    return accounts.find((a) => a.multisigMembershipHash === hash) ?? null;
  }, [accounts, memberAddresses, approvals]);

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
    }
  }, [visible, translateY]);

  const resetAndClose = () => {
    setStep('name');
    setWalletName('');
    setPurpose('');
    setWalletNameTouched(false);
    setMembers([]);
    setApprovals(1);
    setResult(null);
    onClose();
  };

  const handleHeaderBack = () => {
    if (step === 'name') {
      resetAndClose();
      return;
    }
    if (step === 'members') setStep('name');
    else if (step === 'threshold') setStep('members');
    else if (step === 'review') setStep('threshold');
  };

  const handleContinueName = () => {
    setWalletNameTouched(true);
    if (!walletName.trim()) return;
    setStep('members');
  };

  const handleContinueMembers = () => {
    if (members.length === 0) return;
    // Default to a safe majority (≥2) so a user who breezes past the slider
    // never deploys a 1-of-N "multisig" any single member can drain. A value
    // the user already raised above the old default of 1 is preserved.
    setApprovals((prev) => {
      const safeDefault = Math.min(
        Math.max(computeMajorityThreshold(totalSigners), 2),
        totalSigners,
      );
      return Math.min(Math.max(prev > 1 ? prev : safeDefault, 1), totalSigners);
    });
    setStep('threshold');
  };

  const handleContinueThreshold = () => {
    setStep('review');
  };

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);

    const signers: AccountSigner[] = [];

    // The creator is registered as an EXTERNAL device-key signer (their own
    // passkey / ed25519 key), not Delegated(C-address). This keeps the wallet
    // on the single-entry authorization model: a transfer produces one auth
    // entry on the multisig whose AuthPayload holds each member's signature
    // directly (verifier.verify), which the existing cosign-sign /
    // aggregateAuthEntries code can drive. Delegated signers instead require a
    // two-level nested-auth construction we can't yet build reliably — see
    // docs/multisig-contract-analysis.md. A device change is handled by an
    // admin re-add (the Gnosis Safe model).
    const { accounts, activeAccountIndex } = useWalletStore.getState();
    const creator = accounts[activeAccountIndex];
    if (!creator?.smartAccountAddress) {
      setResult({
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
      // Resolve the creator's WebAuthn signer key_data. Prefer the SecureStore
      // copy (what signing actually reads), but fall back to reconstructing it
      // from the account record — key_data is exactly `publicKeyHex + credentialId`
      // (see passkey-webauthn.ts). This survives SecureStore index drift, e.g.
      // when removing an account re-indexes the list and orphans the
      // `latch_key_data_hex_<n>` slot, which is why creation worked for some
      // passkey accounts but not others.
      let keyDataHex = await SecureStore.getItemAsync(
        getPasskeyStorageKeys(activeAccountIndex).keyDataHex,
      );
      if (!keyDataHex && creator.publicKeyHex && creator.credentialId) {
        keyDataHex = creator.publicKeyHex + creator.credentialId;
      }
      if (!keyDataHex) {
        if (__DEV__) {
          console.log('[shared-wallet] creator key_data unresolved', {
            activeAccountIndex,
            smartAccountAddress: creator.smartAccountAddress,
            hasPublicKeyHex: !!creator.publicKeyHex,
            hasCredentialId: !!creator.credentialId,
            isMultisig: !!creator.isMultisig,
          });
        }
        setResult({
          success: false,
          walletAddress: '',
          errorMessage: 'Could not read this device’s key. Finish biometric setup first.',
        });
        setSubmitting(false);
        return;
      }
      signers.push({ kind: 'webauthn', keyDataHex });
    }

    // Members are still ADDED by account C-address (unchanged UX). For the
    // External model we resolve each member account's primary device key
    // on-chain and register THAT as the signer — so the shared wallet's rule
    // holds device keys, not Delegated(C-address). Snapshot semantics: a member
    // who later rotates their device is re-added via an admin op (Gnosis Safe
    // model). See docs/multisig-contract-analysis.md §7.
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
        // Take the member's primary External device key (option A: one key per
        // member, so the threshold counts people, not devices).
        const ext = rule.signers.find(
          (s): s is ChainSigner & { kind: 'ed25519' | 'webauthn' } =>
            s.kind === 'ed25519' || s.kind === 'webauthn',
        );
        if (!ext) {
          invalidAddresses.push(`${m.name || m.value} (no device key on account)`);
          continue;
        }
        // A member deployed under a different factory references a foreign
        // verifier contract. Only re-register their key if that verifier is
        // byte-identical (same wasm) to our current verifier of the same kind —
        // otherwise their device signatures may not verify under our verifier.
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
      setResult({
        success: false,
        walletAddress: '',
        errorMessage: `Add at least one other confirmed member to deploy a multisig wallet${suffix}.`,
      });
      setSubmitting(false);
      return;
    }

    const threshold = Math.min(Math.max(approvals, 1), signers.length);
    if (signers.length < approvals) {
      setResult({
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

      // appendAccount dedupes by smart-account address and switches to it — a
      // re-add of the same address can never duplicate the list.
      await useWalletStore.getState().appendAccount(newAccount, true);

      // Generate this wallet's encryption key (WCK) and publish the sealed
      // bundle server-side so members pick it up automatically (zero-touch
      // bootstrap; latch://cosign-key stays as the manual fallback). Non-fatal:
      // wallet creation succeeds even if either step hiccups.
      ensureWalletCosignKey(deployResult.smartAccountAddress)
        .then(() => publishWckBundle(deployResult.smartAccountAddress))
        .catch((err) => {
          if (__DEV__) console.log('[wck] generate/publish failed:', err?.message);
        });

      // Announce membership so the other signers' devices auto-discover this
      // wallet on their next launch. Non-fatal; manual add stays the fallback.
      announceMembership(deployResult.smartAccountAddress).catch((err) => {
        if (__DEV__) console.log('[membership] announce failed:', err?.message);
      });

      setResult({
        success: true,
        walletAddress: deployResult.smartAccountAddress,
      });
    } catch (err) {
      if (__DEV__) console.error('[multisig] deploy failed:', err);
      setResult({
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

  const handleResultClose = () => {
    const wasSuccess = result?.success;
    setResult(null);
    if (wasSuccess) {
      resetAndClose();
      // Close this sheet's Modal before opening BackupSheet's — two Modals
      // changing presentation state in the same tick wedges the native
      // modal host on iOS.
      onNeedsBackup?.();
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'name':
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
                {/* <CreateSharedTitleSection /> */}
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

      case 'members':
        return (
          <>
            <Box flex={1} px="m">
              {/* <AddMembersTitleSection /> */}
              <AddMemberButton onPress={() => setMethodSheetVisible(true)} />
              <SelfMemberCard />
              {/* {members.length === 0 ? (
                <EmptyState />
              ) : ( */}
              <MemberList members={members} onRemove={(id) => setPendingRemoveId(id)} />
              {/* )} */}
            </Box>
            <Box px="m" style={{ paddingTop: 12, paddingBottom: 12 }}>
              <AddMembersContinueButton
                disabled={members.length === 0}
                onPress={handleContinueMembers}
              />
            </Box>
          </>
        );

      case 'threshold':
        return (
          <>
            <Box flex={1} px="m" mt="xs">
              {/* <ApprovalTitleSection /> */}
              <ApprovalSlider value={approvals} total={totalSigners} onChange={setApprovals} />
              {/* <ApprovalSegmentedBar
                value={approvals}
                total={totalSigners}
                onChange={setApprovals}
              /> */}
              {/* <ApprovalStepper value={approvals} total={totalSigners} onChange={setApprovals} /> */}
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

      case 'review':
        return (
          <>
            <ScrollView
              contentContainerStyle={{ flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Box flex={1} px="m">
                {/* <ReviewTitleSection /> */}
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
              <CreateWalletButton onPress={handleCreate} loading={submitting} />
            </Box>
          </>
        );
    }
  };

  return (
    <>
      {/* Hide the wizard while the result modal is up — RN presents only one
          Modal at a time on iOS, so a sibling result Modal can't appear over
          a still-visible wizard. On error close, result→null brings the
          wizard back with the user's data intact to retry. */}
      <Modal
        transparent
        visible={visible && result === null}
        animationType="none"
        onRequestClose={resetAndClose}
      >
        <TouchableWithoutFeedback onPress={resetAndClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                height: SHEET_HEIGHT,
                backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY }],
              },
            ]}
          >
            <BottomSheetHandle />

            <Box
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal="m"
              py="m"
            >
              <TouchableOpacity
                onPress={handleHeaderBack}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={step === 'name' ? 'close' : 'chevron-back'}
                  size={24}
                  color={theme.colors.textPrimary}
                />
              </TouchableOpacity>
              <Text variant="h9" color="textPrimary" fontWeight="700">
                {STEP_TITLES[step]}
              </Text>
              <Box width={24} />
            </Box>

            <View style={{ flex: 1 }}>{renderStep()}</View>
          </Animated.View>
        </View>

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
      </Modal>

      <SharedWalletResultModal
        visible={result !== null}
        success={result?.success ?? false}
        walletAddress={result?.walletAddress ?? ''}
        errorMessage={result?.errorMessage}
        onClose={handleResultClose}
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default SharedWalletWizardSheet;
