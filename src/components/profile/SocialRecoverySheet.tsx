/**
 * SocialRecoverySheet — the account owner's view of social recovery.
 *
 * Three states, and which one shows is decided by the chain, not by local
 * state:
 *
 *   unavailable  no recovery policy deployed for this network
 *   empty        recovery not set up — explain it, then let them set it up
 *   active       guardians listed; a pending recovery, if any, dominates
 *
 * A pending recovery is the screen's most important job. It means someone is
 * trying to take over the account, and the owner has a bounded window to stop
 * it. So it renders above everything else, in the danger colour, with the time
 * remaining and a single obvious action.
 *
 * This sheet is deliberately owner-only. Proposing and finalizing a recovery
 * are the guardians' actions, taken from their own devices against an account
 * they do not otherwise control, which is a separate flow.
 */

import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import AppToast from '@/src/components/toast/AppToast';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { isSocialRecoveryAvailable } from '@/src/constants/config';
import {
  authorizerFor,
  cancelRecovery,
  fetchRecoveryStatus,
  guardianKindFor,
  humanLedgers,
  MIN_DELAY_LEDGERS,
  pendingPhase,
  setUpRecovery,
  toGuardian,
  type Guardian,
  type GuardianKind,
  type RecoveryRule,
  type RecoveryStatus,
} from '@/src/services/social-recovery';
import {
  clearGuardianDraft,
  createGuardianInvite,
  loadGuardianDraft,
  saveGuardianDraft,
  verifyGuardianResponse,
} from '@/src/services/guardian-invite';
import { useWalletStore } from '@/src/store/wallet';
import { shareOrCopy } from '@/src/utils/share-or-copy';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Veto windows offered. The contract floors this at MIN_DELAY_LEDGERS (~1
 * hour); that option exists so the flow can be exercised end-to-end in a
 * sitting, and is labelled as such rather than presented as a real choice.
 * Ledgers close about every 5 seconds.
 */
const DELAY_OPTIONS = [
  { label: '1 hour', sublabel: 'for testing only', ledgers: MIN_DELAY_LEDGERS },
  { label: '1 day', sublabel: null, ledgers: 17280 },
  { label: '3 days', sublabel: 'recommended', ledgers: 51840 },
  { label: '7 days', sublabel: null, ledgers: 120960 },
];

type Step = 'status' | 'setup';

const GUARDIAN_LABEL: Record<GuardianKind, string> = {
  ed25519: 'Stellar account',
  passkey: 'Passkey',
  delegated: 'Smart account',
};

const GUARDIAN_ICON: Record<GuardianKind, keyof typeof Ionicons.glyphMap> = {
  ed25519: 'shield-checkmark-outline',
  passkey: 'finger-print-outline',
  delegated: 'wallet-outline',
};

/** Whichever value actually identifies a guardian on chain. */
function guardianIdentity(g: Guardian): string {
  return g.publicKeyHex ?? g.keyDataHex ?? g.address;
}

/**
 * Addresses are 56 characters; show enough of each end to compare by eye. A
 * passkey guardian's "address" is its guardian code, which is longer still and
 * has a fixed prefix — trim that first so the visible part is the key itself.
 */
function shortAddress(address: string): string {
  const value = address.replace(/^latch-guardian:v1:[a-z0-9]+:/i, '');
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SocialRecoverySheet = ({ visible, onClose }: Props) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { accounts, activeAccountIndex, mnemonic } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const smartAccountAddress = activeAccount?.smartAccountAddress ?? '';

  const [step, setStep] = useState<Step>('status');
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [guardianInput, setGuardianInput] = useState('');
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [delayLedgers, setDelayLedgers] = useState(DELAY_OPTIONS[2].ledgers);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const load = useCallback(async () => {
    if (!smartAccountAddress) return;
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await fetchRecoveryStatus(smartAccountAddress));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not read recovery settings');
    } finally {
      setLoading(false);
    }
  }, [smartAccountAddress]);

  useEffect(() => {
    if (visible) {
      setStep('status');
      setGuardianInput('');
      void load();
      // Collecting guardians can span days: replies arrive when they arrive.
      void loadGuardianDraft(smartAccountAddress).then((draft) => {
        if (!draft) return;
        setGuardians(draft.guardians);
        setDelayLedgers(draft.delayLedgers);
      });
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
  }, [visible, translateY, load, smartAccountAddress]);

  useEffect(() => {
    if (!visible || !smartAccountAddress) return;
    if (guardians.length === 0) return;
    void saveGuardianDraft({ account: smartAccountAddress, guardians, delayLedgers });
  }, [visible, smartAccountAddress, guardians, delayLedgers]);

  // ─── actions ──────────────────────────────────────────────────────────────

  const addGuardian = () => {
    const address = guardianInput.trim();
    if (!guardianKindFor(address)) {
      Toast.show({
        type: 'error',
        text1: 'That is not a valid guardian',
        text2:
          'Paste a Stellar account (G…), a smart account (C…), or the guardian code someone sent you.',
      });
      return;
    }
    // A guardian who is this account, or the key that already controls it, adds
    // nothing: recovery would depend on exactly what recovery exists to replace.
    if (address === activeAccount?.gAddress || address === smartAccountAddress) {
      Toast.show({
        type: 'error',
        text1: 'Pick someone else',
        text2: 'A guardian has to be someone other than this account.',
      });
      return;
    }
    if (guardians.some((g) => g.address === address)) {
      Toast.show({ type: 'error', text1: 'That guardian is already on the list' });
      return;
    }
    setGuardians((prev) => [...prev, toGuardian(address)]);
    setGuardianInput('');
  };

  /**
   * Add a guardian from a verified reply. The signature is checked against the
   * challenge this device issued, so a reply cannot name a key its sender does
   * not hold, and cannot be replayed from another invite.
   */
  const addFromReply = async () => {
    try {
      const guardian = await verifyGuardianResponse(replyInput);
      if (guardians.some((g) => guardianIdentity(g) === guardianIdentity(guardian))) {
        Toast.show({ type: 'error', text1: 'That guardian is already on the list' });
        return;
      }
      setGuardians((prev) => [...prev, guardian]);
      setReplyInput('');
      setInviteCode(null);
      Toast.show({ type: 'success', text1: 'Guardian verified and added' });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not add that guardian',
        text2: e instanceof Error ? e.message : undefined,
      });
    }
  };

  /** Majority: 2-of-3, 2-of-2, 3-of-5. One guardian is 1-of-1 by necessity. */
  const quorumFor = (n: number) => (n <= 1 ? 1 : Math.floor(n / 2) + 1);

  const submitSetUp = async () => {
    if (!activeAccount) return;
    setBusy(true);
    try {
      await setUpRecovery({
        smartAccountAddress,
        authorizer: authorizerFor(activeAccount, mnemonic, activeAccountIndex),
        guardians,
        threshold: quorumFor(guardians.length),
        delayLedgers,
      });
      await clearGuardianDraft();
      setGuardians([]);
      Toast.show({ type: 'success', text1: 'Social recovery is on' });
      setStep('status');
      await load();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not set up recovery',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async (ruleId: number) => {
    if (!activeAccount) return;
    setBusy(true);
    try {
      await cancelRecovery(
        smartAccountAddress,
        authorizerFor(activeAccount, mnemonic, activeAccountIndex),
        ruleId,
      );
      Toast.show({ type: 'success', text1: 'Recovery cancelled' });
      await load();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Could not cancel',
        text2: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  // ─── sections ─────────────────────────────────────────────────────────────

  /** One panel per rule with a live proposal — any of them can take the account. */
  const renderPending = (rule: RecoveryRule) => {
    if (!rule.pending || !status) return null;
    const phase = pendingPhase(rule.pending, status.currentLedger);
    if (phase === 'expired') return null;

    const remaining =
      phase === 'veto'
        ? rule.pending.readyAt - status.currentLedger
        : rule.pending.expiresAt - status.currentLedger;

    return (
      <Box
        key={`pending-${rule.ruleId}`}
        borderRadius={12}
        p="m"
        mb="l"
        style={{ backgroundColor: theme.colors.danger900 + '1A' }}
      >
        <Box flexDirection="row" alignItems="center" mb="s">
          <Ionicons name="warning-outline" size={18} color={theme.colors.danger900} />
          <Text variant="p5" color="danger900" fontWeight="700" ml="s">
            {phase === 'veto' ? 'Recovery requested' : 'Recovery ready to complete'}
          </Text>
        </Box>

        <Text variant="p7" color="textSecondary" mb="m">
          {phase === 'veto'
            ? `Your guardians have asked to add a new device to this account. It will go through in about ${humanLedgers(remaining)} unless you stop it.`
            : `The waiting period has passed. Your guardians can complete this for about another ${humanLedgers(remaining)}. You can still stop it until they do.`}
        </Text>

        <Text variant="p8" color="textSecondary" mb="m">
          If this was you, do nothing. If it was not, cancel it now and move your
          funds to a new account — someone has your guardians&apos; agreement.
        </Text>

        <Button
          label="Cancel this recovery"
          variant="outline"
          labelColor="danger900"
          loading={busy}
          onPress={() => submitCancel(rule.ruleId)}
        />
      </Box>
    );
  };

  const renderStatus = () => {
    if (loading) {
      return (
        <Box flex={1} alignItems="center" justifyContent="center" py="xl">
          <ActivityIndicator color={theme.colors.textPrimary} />
        </Box>
      );
    }

    if (loadError) {
      return (
        <Box px="m" py="l" alignItems="center">
          <Text variant="p6" color="textSecondary" textAlign="center" mb="m">
            {loadError}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void load()} />
        </Box>
      );
    }

    if (!isSocialRecoveryAvailable()) {
      return (
        <Box px="m" py="l">
          <Text variant="p6" color="textSecondary" textAlign="center">
            Social recovery is not available on this network yet.
          </Text>
        </Box>
      );
    }

    const rules = status?.rules ?? [];

    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {rules.map(renderPending)}

        {rules.length === 0 ? (
          <>
            <Text variant="p6" color="textSecondary" mb="m">
              Guardians are people you trust. If you lose this device, enough of
              them together can add a new one for you.
            </Text>
            <Text variant="p6" color="textSecondary" mb="l">
              They can never spend your money, and they can never act instantly —
              you get a waiting period to cancel anything you did not ask for.
            </Text>

            <Button label="Set up recovery" onPress={() => setStep('setup')} />
          </>
        ) : (
          <>
            {/* More than one guardian rule is not supposed to happen — setUp
                refuses to create a second — but an account can carry them, and
                each one can recover it on its own. Say so rather than showing
                the first and hiding the rest. */}
            {rules.length > 1 && (
              <Box
                borderRadius={12}
                p="m"
                mb="l"
                style={{ backgroundColor: theme.colors.danger900 + '1A' }}
              >
                <Text variant="p7" color="danger900" fontWeight="700" mb="xs">
                  {rules.length} separate guardian groups
                </Text>
                <Text variant="p8" color="textSecondary">
                  Any one of them can recover this account on its own. If you did
                  not mean to add them all, remove the ones you do not recognise.
                </Text>
              </Box>
            )}

            {rules.map((rule) => (
              <Box key={rule.ruleId} mb="l">
                <Box
                  borderRadius={12}
                  p="m"
                  mb="m"
                  style={{ backgroundColor: theme.colors.cardbg }}
                >
                  <Text variant="p7" color="textSecondary" mb="xs">
                    Waiting period before a recovery can complete
                  </Text>
                  <Text variant="p5" color="textPrimary" fontWeight="700">
                    {humanLedgers(rule.delayLedgers)}
                  </Text>
                </Box>

                <Text variant="p7" color="textSecondary" mb="m">
                  {rule.threshold > 0
                    ? `${rule.threshold} of these ${rule.guardians.length} guardians must agree`
                    : `${rule.guardians.length} guardians`}
                </Text>

                {rule.guardians.map((g) => (
                  <Box
                    key={g.address}
                    flexDirection="row"
                    alignItems="center"
                    py="m"
                    borderBottomWidth={StyleSheet.hairlineWidth}
                    borderBottomColor="bg800"
                  >
                    <Ionicons
                      name={GUARDIAN_ICON[g.kind]}
                      size={18}
                      color={theme.colors.textSecondary}
                    />
                    <Box ml="m" flex={1}>
                      <Text variant="p7" color="textPrimary" numberOfLines={1}>
                        {shortAddress(g.address)}
                      </Text>
                      <Text variant="p8" color="textSecondary">
                        {GUARDIAN_LABEL[g.kind]}
                      </Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            ))}
          </>
        )}
      </ScrollView>
    );
  };

  const renderSetup = () => (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="p7" color="textSecondary" mb="m">
        Add each person you trust — ask them for their address. A Stellar
        account starts with G, another Latch wallet with C. If they sign with a
        passkey they have no address, so they will send you a guardian code
        instead.
      </Text>

      {/* The verified path. Adding a raw address still works below, but this is
          what confirms someone is actually reachable and holds the key — the
          difference only shows up on the day recovery is needed, so it is worth
          leading with. */}
      <Box borderRadius={12} p="m" mb="l" style={{ backgroundColor: theme.colors.cardbg }}>
        <Text variant="p7" color="textPrimary" fontWeight="700" mb="xs">
          Invite a guardian
        </Text>
        <Text variant="p8" color="textSecondary" mb="m">
          Send them an invite. When they accept, they send a reply back that
          proves they hold the key — paste it here and they are added.
        </Text>

        <Box mb="m">
          <Button
            label={inviteCode ? 'Send invite again' : 'Create and send invite'}
            variant="outline"
            onPress={async () => {
              const code = inviteCode ?? (await createGuardianInvite(smartAccountAddress));
              setInviteCode(code);
              await shareOrCopy({
                title: 'Guardian invite',
                message:
                  'I would like you to be a guardian for my Latch wallet. Tap to accept:',
                payload: code,
                asLink: true,
              });
            }}
          />
        </Box>

        <Input
          placeholder="Paste their reply"
          autoCorrect={false}
          multiline
          value={replyInput}
          onChangeText={setReplyInput}
        />
        <Box mt="m">
          <Button
            label="Add this guardian"
            disabled={replyInput.trim().length === 0}
            onPress={addFromReply}
          />
        </Box>
      </Box>

      <Text variant="p8" color="textSecondary" mb="s">
        Or add someone by address, without asking them first:
      </Text>

      <Box flexDirection="row" alignItems="center" mb="m">
        <Box flex={1} mr="s">
          <Input
            placeholder="G…, C…, or a guardian code"
            autoCapitalize="characters"
            autoCorrect={false}
            value={guardianInput}
            onChangeText={setGuardianInput}
            onSubmitEditing={addGuardian}
          />
        </Box>
        <TouchableOpacity onPress={addGuardian} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="add-circle" size={32} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </Box>

      {guardians.map((g) => (
        <Box
          key={g.address}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          py="m"
          borderBottomWidth={StyleSheet.hairlineWidth}
          borderBottomColor="bg800"
        >
          <Box flex={1}>
            <Text variant="p7" color="textPrimary" numberOfLines={1}>
              {shortAddress(g.address)}
            </Text>
            <Text variant="p8" color="textSecondary">
              {GUARDIAN_LABEL[g.kind]}
            </Text>
          </Box>
          <TouchableOpacity
            onPress={() => setGuardians((prev) => prev.filter((x) => x.address !== g.address))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle-outline" size={20} color={theme.colors.danger900} />
          </TouchableOpacity>
        </Box>
      ))}

      {guardians.length > 0 && (
        <Text variant="p8" color="textSecondary" mt="m">
          {quorumFor(guardians.length)} of {guardians.length} will need to agree before a
          recovery can start.
        </Text>
      )}

      <Text variant="p5" color="textPrimary" fontWeight="700" mt="l" mb="s">
        Waiting period
      </Text>
      <Text variant="p8" color="textSecondary" mb="m">
        How long you get to cancel a recovery you did not ask for. Longer is
        safer; you only feel it if you actually lose your device.
      </Text>

      {DELAY_OPTIONS.map((opt) => {
        const selected = opt.ledgers === delayLedgers;
        return (
          <TouchableOpacity key={opt.ledgers} onPress={() => setDelayLedgers(opt.ledgers)}>
            <Box
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              py="m"
              px="m"
              mb="s"
              borderRadius={10}
              borderWidth={1}
              borderColor={selected ? 'textPrimary' : 'bg800'}
            >
              <Box>
                <Text variant="p6" color="textPrimary">
                  {opt.label}
                </Text>
                {opt.sublabel && (
                  <Text variant="p8" color="textSecondary">
                    {opt.sublabel}
                  </Text>
                )}
              </Box>
              {selected && (
                <Ionicons name="checkmark" size={18} color={theme.colors.textPrimary} />
              )}
            </Box>
          </TouchableOpacity>
        );
      })}

      <Box mt="l">
        <Button
          label="Turn on social recovery"
          loading={busy}
          disabled={guardians.length === 0 || busy}
          onPress={submitSetUp}
        />
      </Box>

      <Text variant="p8" color="textSecondary" mt="m" textAlign="center">
        Your guardians will not be told. Tell them yourself, and tell them what
        it means.
      </Text>
    </ScrollView>
  );

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
              onPress={() => (step === 'setup' ? setStep('status') : onClose())}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Text variant="h10" color="textPrimary" fontWeight="700">
              {step === 'setup' ? 'Choose guardians' : 'Social Recovery'}
            </Text>

            <Box width={20} />
          </Box>

          {step === 'setup' ? renderSetup() : renderStatus()}
        </Animated.View>
      </View>

      {/* A Modal is its own native window, so the root AppToast in _layout
          cannot paint over it — this sheet's toasts (invalid address, submit
          failures) would appear behind the sheet. Last child so it sits above
          the sheet body; gated on `visible` so a closed sheet never sits on top
          of the toast library's ref stack. See AppToast. */}
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

export default SocialRecoverySheet;
