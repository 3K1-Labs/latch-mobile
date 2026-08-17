/**
 * GuardianRecoverySheet — the guardian's side of social recovery.
 *
 * Separate from SocialRecoverySheet because the roles are opposites. That sheet
 * is the owner protecting their own account: see the guardians, veto a
 * recovery. This one is a guardian acting on SOMEONE ELSE'S account, which they
 * do not otherwise control and whose address they must be told.
 *
 * The flow is deliberately slow and explicit. A guardian starting a recovery is
 * beginning a process that ends with a new key on another person's wallet, so
 * every screen names whose account it is and what will happen, and the confirm
 * step spells out the wait before anything takes effect.
 */

import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import React, { useEffect, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import AppToast from '@/src/components/toast/AppToast';
import { isSocialRecoveryAvailable } from '@/src/constants/config';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import {
  fetchRecoveryStatus,
  finalizeRecovery,
  findLocalGuardian,
  humanLedgers,
  localPasskeyGuardianCode,
  pendingPhase,
  proposeRecovery,
  type GuardianMatchFailure,
  type LocalGuardian,
} from '@/src/services/social-recovery';
import { serializePacket, type CosignPacket } from '@/src/lib/cosign-packet';
import { importPacket } from '@/src/lib/cosign-packet-flow';
import {
  acceptGuardianInvite,
  classifyGuardianPayload,
  decodeStartRecovery,
  readGuardianInvite,
} from '@/src/services/guardian-invite';
import {
  approveRecoveryPacket,
  createRecoveryPacket,
  submitRecoveryPacket,
} from '@/src/services/recovery-cosign';
import { shareOrCopy } from '@/src/utils/share-or-copy';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type Step = 'find' | 'act';

/**
 * Why a lookup did not produce an actionable guardian. Each says what is
 * actually true rather than a generic failure — "unlock your wallet" is wrong
 * and confusing when the wallet is unlocked and simply has no seed phrase.
 */
const MATCH_FAILURE_COPY: Record<GuardianMatchFailure, { text1: string; text2: string }> = {
  'not-a-guardian': {
    text1: 'You are not a guardian for this account',
    text2: 'Check the address, or ask them to add you.',
  },
  'no-seed': {
    text1: 'This wallet cannot act as a guardian',
    text2: 'It has no recovery phrase and no passkey to sign with.',
  },
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Payload from a latch://guardian link — handled on open, no paste needed. */
  initialPayload?: string;
}

const GuardianRecoverySheet = ({ visible, onClose, initialPayload }: Props) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { mnemonic, accounts, activeAccountIndex: activeIndex } = useWalletStore();

  // Identity this device can prove: its seed keys (absent on a passkey wallet)
  // and every smart account it controls, for delegated guardians.
  const identity = {
    mnemonic,
    ownedAccounts: accounts
      .map((a, listIndex) => ({
        address: a.smartAccountAddress ?? '',
        listIndex,
        bip44Index: a.index,
      }))
      .filter((a) => a.address.length > 0),
    passkeySlots: accounts.length,
  };

  const [step, setStep] = useState<Step>('find');
  const [accountInput, setAccountInput] = useState('');
  const [account, setAccount] = useState('');
  const [local, setLocal] = useState<LocalGuardian | null>(null);
  const [currentLedger, setCurrentLedger] = useState(0);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [myGuardianCode, setMyGuardianCode] = useState<string | null>(null);
  const [pendingPacket, setPendingPacket] = useState<CosignPacket | null>(null);
  const [inboxInput, setInboxInput] = useState('');
  const [inboxBusy, setInboxBusy] = useState(false);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      setStep('find');
      setAccountInput('');
      setAccount('');
      setLocal(null);
      setNewKeyInput('');
      setPendingPacket(null);
      // Arriving from a link: act on it straight away rather than showing an
      // empty box the person has to paste into.
      if (initialPayload) void handleInbox(initialPayload);
      // Only a passkey wallet needs a code; a seed wallet shares its G-address.
      void localPasskeyGuardianCode(activeIndex).then(setMyGuardianCode);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 25,
        mass: 1,
        stiffness: 150,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
    // handleInbox is stable enough for this one-shot; re-running on every
    // render would re-act on the same link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, translateY, activeIndex, initialPayload]);

  // ─── actions ──────────────────────────────────────────────────────────────

  const lookUp = async (override?: string) => {
    // Guard the type: passing this straight to onPress hands it a press event,
    // which TypeScript accepts because an optional param satisfies `() => void`.
    const source = typeof override === 'string' ? override : accountInput;
    const address = source.trim();
    if (!StrKey.isValidContract(address)) {
      Toast.show({
        type: 'error',
        text1: 'That is not a wallet address',
        text2: 'Ask them for their account address — it starts with C.',
      });
      return;
    }
    setLoading(true);
    try {
      const status = await fetchRecoveryStatus(address);
      const match = await findLocalGuardian(status, identity);
      if (!match.ok) {
        Toast.show({ type: 'error', ...MATCH_FAILURE_COPY[match.reason] });
        return;
      }
      setAccount(address);
      setLocal(match.local);
      setCurrentLedger(status.currentLedger);
      setStep('act');
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not read that account',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Accept an invitation to become someone's guardian.
   *
   * Signs their challenge with this device's key — raising the biometric prompt
   * on a passkey wallet — and puts the reply on the clipboard. Nothing is
   * written on chain here: the owner adds the guardian, this only proves to
   * them that the key is real and held.
   */
  const acceptInvite = async (payload: string) => {
    try {
      const details = readGuardianInvite(payload);
      const reply = await acceptGuardianInvite(payload, {
        mnemonic,
        accountIndex: activeIndex,
      });
      await shareOrCopy({
        title: 'Guardian reply',
        message: 'Here is my guardian reply — paste it into Latch to add me.',
        payload: reply,
      });
      Toast.show({
        type: 'success',
        text1: 'Reply sent — they add you with it',
        text2: details.account
          ? `You will be a guardian for ${details.account.slice(0, 8)}…`
          : undefined,
      });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not accept that invite',
        text2: e instanceof Error ? e.message : undefined,
      });
    }
  };

  /**
   * Open a request another guardian sent, agree to it, and submit if that
   * completes the quorum.
   *
   * Approve and submit are one action deliberately: a guardian who has just
   * agreed has no further decision to make, and leaving a fully-signed request
   * sitting unsent is the failure mode that wastes the whole veto window.
   */
  const openRequest = async (payload: string) => {
    try {
      const packet = await importPacket(payload.trim());
      if (packet.kind !== 'recovery' || !packet.recoveryMeta) {
        Toast.show({ type: 'error', text1: 'That is not a recovery request' });
        return;
      }

      const approved = await approveRecoveryPacket(packet.id, identity);
      setAccount(packet.smartAccountAddress);
      setPendingPacket(approved);

      if (approved.signatures.length >= approved.threshold) {
        const { hash } = await submitRecoveryPacket(approved.id, identity);
        setPendingPacket(null);
        Toast.show({
          type: 'success',
          text1:
            packet.recoveryMeta.action === 'propose'
              ? 'Recovery requested'
              : 'Recovery complete',
          text2: hash.slice(0, 12),
        });
      } else {
        Toast.show({
          type: 'success',
          text1: 'You agreed to this recovery',
          text2: `${approved.signatures.length} of ${approved.threshold}. Send it on to the next guardian.`,
        });
      }
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not open that request',
        text2: e instanceof Error ? e.message : undefined,
      });
    }
  };

  /**
   * Route one pasted payload to whatever it turns out to be.
   *
   * The classification is on the payload's own prefix, not on which field it
   * was typed into — which is what lets there be one field. An account address
   * falls through to the existing lookup, so the "I know whose account it is"
   * path still works without its own box.
   */
  const handleInbox = async (raw: string) => {
    const payload = raw.trim();
    setInboxBusy(true);
    try {
      switch (classifyGuardianPayload(payload)) {
        case 'invite':
          await acceptInvite(payload);
          setInboxInput('');
          break;
        case 'recovery-request':
          await openRequest(payload);
          setInboxInput('');
          break;
        case 'start-recovery': {
          const req = decodeStartRecovery(payload);
          setAccountInput(req.account);
          setNewKeyInput(req.newDeviceAddress);
          await lookUp(req.account);
          setInboxInput('');
          break;
        }
        case 'account':
          setAccountInput(payload);
          await lookUp(payload);
          break;
        case 'reply':
          Toast.show({
            type: 'error',
            text1: 'That is a guardian reply',
            text2: 'It goes to the person who invited you, not here.',
          });
          break;
        default:
          Toast.show({
            type: 'error',
            text1: 'That is not something this screen handles',
            text2: 'Paste an invitation, a recovery request, or an account address.',
          });
      }
    } finally {
      setInboxBusy(false);
    }
  };

  /** Re-read after acting, so the panel reflects the chain and not a guess. */
  const refresh = async () => {
    if (!account) return;
    const status = await fetchRecoveryStatus(account);
    const match = await findLocalGuardian(status, identity);
    setLocal(match.ok ? match.local : null);
    setCurrentLedger(status.currentLedger);
  };

  const newSignerHex = (() => {
    const v = newKeyInput.trim();
    if (!StrKey.isValidEd25519PublicKey(v)) return null;
    return Buffer.from(StrKey.decodeEd25519PublicKey(v)).toString('hex');
  })();

  /**
   * One guardian is enough only when the group's quorum is 1. Above that, this
   * device can produce exactly one of the required signatures, so it freezes the
   * request into a packet for the other guardians to approve instead of
   * submitting something that would be rejected.
   */
  const runGuardianAction = async (action: 'propose' | 'finalize') => {
    if (!local || !newSignerHex) return;

    if (local.rule.threshold > 1) {
      const packet = await createRecoveryPacket({
        smartAccountAddress: account,
        rule: local.rule,
        guardian: local,
        action,
        newDeviceAddress: newKeyInput.trim(),
        newSignerPublicKeyHex: newSignerHex,
      });
      setPendingPacket(packet);
      Toast.show({
        type: 'success',
        text1: 'Request created',
        text2: `Send it to the other guardians — ${packet.signatures.length} of ${local.rule.threshold} so far.`,
      });
      return;
    }

    if (action === 'propose') {
      await proposeRecovery({
        smartAccountAddress: account,
        mnemonic,
        rule: local.rule,
        guardian: local,
        newSignerPublicKeyHex: newSignerHex,
      });
      Toast.show({
        type: 'success',
        text1: 'Recovery requested',
        text2: 'The waiting period has started.',
      });
    } else {
      await finalizeRecovery({
        smartAccountAddress: account,
        mnemonic,
        rule: local.rule,
        guardian: local,
        newSignerPublicKeyHex: newSignerHex,
      });
      Toast.show({ type: 'success', text1: 'Recovery complete' });
    }
    await refresh();
  };

  const submitPropose = async () => {
    if (!local || !newSignerHex) return;
    setBusy(true);
    try {
      await runGuardianAction('propose');
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not request recovery',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const submitFinalize = async () => {
    if (!local) return;
    // The proposal pins the exact call, so finalize must present the same key.
    // Read it back from the input rather than storing it: a guardian may well
    // finalize days later, from a fresh launch.
    if (!newSignerHex) {
      Toast.show({
        type: 'error',
        text1: 'Enter the new device key again',
        text2: 'It has to match the one that was requested, exactly.',
      });
      return;
    }
    setBusy(true);
    try {
      await runGuardianAction('finalize');
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not complete recovery',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  // ─── steps ────────────────────────────────────────────────────────────────

  const renderFind = () => (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="p6" color="textSecondary" mb="m">
        Anything sent to you as a guardian goes here — an invitation to become
        one, or a request to approve someone&apos;s recovery.
      </Text>
      <Text variant="p6" color="textSecondary" mb="l">
        You cannot spend their money, and nothing happens immediately — they get
        a waiting period to stop it if the request was not theirs.
      </Text>

      <Text variant="p7" color="textPrimary" fontWeight="700" mb="s">
        Their wallet address
      </Text>
      <Box mb="l">
        <Input
          placeholder="C…"
          autoCapitalize="characters"
          autoCorrect={false}
          value={accountInput}
          onChangeText={setAccountInput}
          onSubmitEditing={() => lookUp()}
        />
      </Box>

      <Button label="Continue" loading={loading} disabled={loading} onPress={() => lookUp()} />

      {/* One field, not three.
          A guardian receives three unrelated things — an invitation to the
          role, a request to approve a recovery, and sometimes just an account
          address — often months apart, and cannot reasonably be expected to
          know which is which. Every payload carries a distinct prefix, so the
          app can tell them apart; asking the person to was the wrong half of
          the problem to solve. */}
      <Box mt="xl" pt="l" borderTopWidth={StyleSheet.hairlineWidth} borderTopColor="bg800">
        <Text variant="p7" color="textPrimary" fontWeight="700" mb="xs">
          Were you sent something?
        </Text>
        <Text variant="p8" color="textSecondary" mb="m">
          Paste it here — an invitation to become a guardian, or a recovery to
          approve. Tapping the link they sent does this for you.
        </Text>
        <Box mb="m">
          <Input
            placeholder="Paste it here"
            autoCorrect={false}
            multiline
            value={inboxInput}
            onChangeText={setInboxInput}
          />
        </Box>
        <Button
          label="Continue"
          variant="outline"
          loading={inboxBusy}
          disabled={inboxBusy || inboxInput.trim().length === 0}
          onPress={() => handleInbox(inboxInput)}
        />
      </Box>

      {/* A passkey has no address, so a passkey guardian cannot simply be told
          "send them your G address". This is the thing they send instead. */}
      {myGuardianCode && (
        <Box mt="xl" pt="l" borderTopWidth={StyleSheet.hairlineWidth} borderTopColor="bg800">
          <Text variant="p7" color="textPrimary" fontWeight="700" mb="xs">
            Want someone to make you their guardian?
          </Text>
          <Text variant="p8" color="textSecondary" mb="m">
            This device signs with a passkey, which has no address. Send them
            this code instead — it is safe to share.
          </Text>
          <Button
            label="Send my guardian code"
            variant="outline"
            onPress={async () => {
              await shareOrCopy({
                title: 'Guardian code',
                message: 'This is my guardian code — add it in Latch under Social Recovery.',
                payload: myGuardianCode,
              });
            }}
          />
        </Box>
      )}
    </ScrollView>
  );

  const renderAct = () => {
    if (!local) return null;
    const { rule } = local;
    const pending = rule.pending;
    const phase = pending ? pendingPhase(pending, currentLedger) : null;

    return (
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* A quorum request cannot be submitted from here — it has to travel to
            the other guardians and come back with their signatures. Surfacing
            the count and the share action is the whole interaction. */}
        {pendingPacket && (
          <Box
            borderRadius={12}
            p="m"
            mb="l"
            style={{ backgroundColor: theme.colors.cardbg }}
          >
            <Text variant="p6" color="textPrimary" fontWeight="700" mb="xs">
              Waiting for other guardians
            </Text>
            <Text variant="p8" color="textSecondary" mb="m">
              {pendingPacket.signatures.length} of {pendingPacket.threshold} have agreed.
              Send this request to the others; whoever holds it when the last
              guardian agrees can submit it.
            </Text>
            <Button
              label="Send request"
              variant="outline"
              onPress={async () => {
                await shareOrCopy({
                  title: 'Recovery request',
                  message: 'Please approve this recovery. Tap to review it:',
                  payload: serializePacket(pendingPacket),
                  asLink: true,
                });
              }}
            />
          </Box>
        )}

        <Box borderRadius={12} p="m" mb="l" style={{ backgroundColor: theme.colors.cardbg }}>
          <Text variant="p8" color="textSecondary" mb="xs">
            You are a guardian for
          </Text>
          <Text variant="p7" color="textPrimary" numberOfLines={1}>
            {account.slice(0, 10)}…{account.slice(-6)}
          </Text>
        </Box>

        {phase === 'veto' && pending && (
          <Box borderRadius={12} p="m" mb="l" style={{ backgroundColor: theme.colors.cardbg }}>
            <Text variant="p6" color="textPrimary" fontWeight="700" mb="s">
              Waiting period in progress
            </Text>
            <Text variant="p7" color="textSecondary">
              A recovery has been requested. It can be completed in about{' '}
              {humanLedgers(pending.readyAt - currentLedger)}. Until then the
              owner can still cancel it.
            </Text>
          </Box>
        )}

        {phase === 'expired' && (
          <Box borderRadius={12} p="m" mb="l" style={{ backgroundColor: theme.colors.cardbg }}>
            <Text variant="p7" color="textSecondary">
              The previous request ran out of time and can no longer be used.
              Request the recovery again to restart it.
            </Text>
          </Box>
        )}

        <Text variant="p7" color="textPrimary" fontWeight="700" mb="s">
          Their new device&apos;s address
        </Text>
        <Text variant="p8" color="textSecondary" mb="m">
          Ask them to install Latch on the new device and send you the address it
          shows. It starts with G.
        </Text>
        <Box mb="l">
          <Input
            placeholder="G…"
            autoCapitalize="characters"
            autoCorrect={false}
            value={newKeyInput}
            onChangeText={setNewKeyInput}
          />
        </Box>

        {phase === 'enforceable' && pending ? (
          <>
            <Text variant="p8" color="textSecondary" mb="m">
              The waiting period is over. Completing this adds the device above to
              their wallet. It must be the same one that was requested.
            </Text>
            <Button
              label="Complete recovery"
              loading={busy}
              disabled={busy || !newSignerHex}
              onPress={submitFinalize}
            />
          </>
        ) : phase === 'veto' ? null : (
          <>
            <Text variant="p8" color="textSecondary" mb="m">
              Requesting starts a wait of about {humanLedgers(rule.delayLedgers)}.
              Nothing changes on their wallet until that passes and you complete
              it, and they can cancel at any point.
            </Text>
            {rule.threshold > 1 && (
              <Text variant="p8" color="textSecondary" mb="m">
                This group needs {rule.threshold} guardians to agree, so this
                creates a request for the others to approve rather than starting
                the wait straight away.
              </Text>
            )}
            <Button
              label={rule.threshold > 1 ? 'Create request' : 'Request recovery'}
              loading={busy}
              disabled={busy || !newSignerHex}
              onPress={submitPropose}
            />
          </>
        )}
      </ScrollView>
    );
  };

  const renderBody = () => {
    if (!isSocialRecoveryAvailable()) {
      return (
        <Box px="m" py="l">
          <Text variant="p6" color="textSecondary" textAlign="center">
            Social recovery is not available on this network yet.
          </Text>
        </Box>
      );
    }
    return step === 'act' ? renderAct() : renderFind();
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
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
              height: SHEET_HEIGHT,
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
            mb="s"
          >
            <TouchableOpacity
              onPress={() => (step === 'act' ? setStep('find') : onClose())}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Text variant="h10" color="textPrimary" fontWeight="700">
              {step === 'act' ? 'Help Someone Recover' : 'Guardian Requests'}
            </Text>

            <Box width={20} />
          </Box>

          {renderBody()}
        </Animated.View>
      </View>

      {/* A Modal is its own native window, so the root AppToast cannot paint
          over it. Gated on `visible` so a closed sheet never captures toasts
          meant for whatever is on screen. See AppToast. */}
      {visible && <AppToast />}
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
});

export default GuardianRecoverySheet;
