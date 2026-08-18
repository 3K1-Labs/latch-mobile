import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StrKey } from '@stellar/stellar-sdk';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uploadBackup } from '@/src/api/latch-auth';
import { deployMultiSigSmartAccount } from '@/src/api/smart-account';
import ApprovalRuleCard from '@/src/components/shared-wallet-review/ApprovalRuleCard';
import CreateWalletButton from '@/src/components/shared-wallet-review/CreateWalletButton';
import Header from '@/src/components/shared-wallet-review/Header';
import MemberReviewList from '@/src/components/shared-wallet-review/MemberReviewList';
import TitleSection from '@/src/components/shared-wallet-review/TitleSection';
import WalletNameCard from '@/src/components/shared-wallet-review/WalletNameCard';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { AccountSigner } from '@/src/lib/account-signers';
import { announceMembership } from '@/src/lib/membership';
import { multisigMembershipHash } from '@/src/lib/multisig-address';
import { ensureWalletCosignKey, publishWckBundle } from '@/src/lib/wallet-cosign-key';
import { ASYNC_KEYS, SECURE_KEYS, useWalletStore, type WalletAccount } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { LinearGradient } from 'expo-linear-gradient';

interface Member {
  id: string;
  name: string;
  value: string;
  status: 'pending' | 'added';
}

const SharedWalletReview = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();

  const params = useLocalSearchParams<{
    walletName: string;
    purpose: string;
    approvals: string;
    memberCount: string;
    members: string;
  }>();

  const approvals = parseInt(params.approvals ?? '1', 10);
  const memberCount = parseInt(params.memberCount ?? '1', 10);
  const members: Member[] = params.members ? JSON.parse(params.members) : [];
  const [submitting, setSubmitting] = useState(false);
  const [selfEmail, setSelfEmail] = useState<string | null>(null);

  const accounts = useWalletStore((s) => s.accounts);

  // Member account C-addresses — the "members" identity used to warn about
  // re-creating a wallet with the same people (stable across the deploy nonce).
  const memberAddresses = useMemo(
    () =>
      (params.members ? (JSON.parse(params.members) as Member[]) : [])
        .filter((m) => m.status === 'added' && StrKey.isValidContract(m.value))
        .map((m) => m.value),
    [params.members],
  );

  // An existing shared wallet with this exact member set + threshold, if any.
  const existingSameMembers = useMemo(() => {
    if (memberAddresses.length === 0) return null;
    const hash = multisigMembershipHash(memberAddresses, approvals);
    return accounts.find((a) => a.multisigMembershipHash === hash) ?? null;
  }, [accounts, memberAddresses, approvals]);

  useEffect(() => {
    SecureStore.getItemAsync(SECURE_KEYS.USER_EMAIL)
      .then((value) => setSelfEmail(value))
      .catch(() => setSelfEmail(null));
  }, []);

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);

    // Members come in two flavours from the add-members flow:
    //   - status='added'   → the user pasted/scanned a Stellar contract
    //                        (C-address) belonging to an existing Latch
    //                        smart account. These contribute on-chain
    //                        signers via Delegated(C-address).
    //   - status='pending' → an email invite that hasn't been resolved
    //                        to an account yet. These can't contribute
    //                        a signer until backend invite resolution
    //                        lands. Filtered out at deploy time.
    const signers: AccountSigner[] = [];

    // The creator is registered as a Delegated(C-address) signer using their
    // own personal smart-account contract (deployed earlier in onboarding by
    // deploy-account.tsx). Signature verification cascades to that account's
    // __check_auth, so credential rotation / device restore on the personal
    // account keeps multisig membership intact. Registering the raw WebAuthn
    // key here would pin the creator to one device for the life of the wallet.
    const selfSmartAccount = await SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT);
    if (!selfSmartAccount || !StrKey.isValidContract(selfSmartAccount)) {
      router.replace({
        pathname: '/(onboarding)/shared-wallet-result',
        params: {
          success: 'false',
          walletAddress: '',
          errorMessage: 'Your personal account is not deployed yet. Finish setup first.',
        },
      });
      return;
    }
    signers.push({ kind: 'delegated', address: selfSmartAccount });

    const pendingInvites: string[] = [];
    const invalidAddresses: string[] = [];
    for (const m of members) {
      if (m.status === 'pending') {
        pendingInvites.push(m.name || m.value);
        continue;
      }
      if (StrKey.isValidContract(m.value)) {
        signers.push({ kind: 'delegated', address: m.value });
      } else {
        invalidAddresses.push(m.name || m.value);
      }
    }

    if (signers.length < 2) {
      const reasons: string[] = [];
      if (pendingInvites.length) {
        reasons.push(`waiting on invitees: ${pendingInvites.join(', ')}`);
      }
      if (invalidAddresses.length) {
        reasons.push(`invalid addresses: ${invalidAddresses.join(', ')}`);
      }
      const suffix = reasons.length ? ` (${reasons.join('; ')})` : '';
      router.replace({
        pathname: '/(onboarding)/shared-wallet-result',
        params: {
          success: 'false',
          walletAddress: '',
          errorMessage: `Add at least one other confirmed member to deploy a multisig wallet${suffix}.`,
        },
      });
      return;
    }

    // Clamp approvals into the valid range now that the eligible signer
    // count is known. The approval slider was bounded by the total member
    // count, which may have included pending invites we just filtered out.
    const threshold = Math.min(Math.max(approvals, 1), signers.length);
    if (signers.length < approvals) {
      router.replace({
        pathname: '/(onboarding)/shared-wallet-result',
        params: {
          success: 'false',
          walletAddress: '',
          errorMessage: `Threshold ${approvals} can't be met with ${signers.length} confirmed signer${signers.length === 1 ? '' : 's'}. Resend pending invites or lower the threshold.`,
        },
      });
      return;
    }

    try {
      const result = await deployMultiSigSmartAccount(signers, threshold);

      // The multisig has no local mnemonic / passkey of its own on this device —
      // gAddress + publicKeyHex stay empty and index uses the -1 sentinel
      // (mirroring the passkey convention) since there's no BIP-44 derivation.
      const newAccount: WalletAccount = {
        index: -1,
        name: params.walletName?.trim() || 'Multisig Wallet',
        gAddress: '',
        publicKeyHex: '',
        smartAccountAddress: result.smartAccountAddress,
        image: null,
        multisigMembershipHash: multisigMembershipHash(memberAddresses, approvals),
        multisigNonceHex: result.nonceHex,
      };

      // ── Account model: PERSONAL + MULTISIG (current product decision) ─────────
      // The creator's personal account was already deployed + persisted by
      // deploy-account earlier in the shared flow. Append the multisig as an
      // additional account and make it active so the user lands on the wallet
      // they just created. We intentionally do NOT touch SECURE_KEYS.SMART_ACCOUNT:
      // that legacy key tracks account 0 (the personal account) and is read by
      // unlock/cosign flows — see docs/multisig-onboarding.md.
      // appendAccount dedupes by smart-account address and switches to it — a
      // re-add of the same address can never duplicate the list.
      await useWalletStore.getState().appendAccount(newAccount, true);

      // ── Account model: MULTISIG ONLY (commented out — swap if product decides) ─
      // Replaces the account list with just the multisig. Restore this block (and
      // remove the append block above) to make the shared wallet the user's sole
      // account. Note: this overwrites any pre-existing accounts, so it should only
      // be used with a shared-only onboarding flow that does NOT deploy a personal
      // account first. See docs/multisig-onboarding.md for the full trade-off.
      // await Promise.all([
      //   SecureStore.setItemAsync(SECURE_KEYS.ACCOUNTS, JSON.stringify([newAccount])),
      //   SecureStore.setItemAsync(SECURE_KEYS.ACTIVE_ACCOUNT_INDEX, '0'),
      //   SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, result.smartAccountAddress),
      // ]);

      // Generate this wallet's encryption key (WCK) and publish the sealed
      // bundle server-side so members pick it up automatically (zero-touch
      // bootstrap; latch://cosign-key stays as the manual fallback). Non-fatal,
      // same contract as the wizard path.
      ensureWalletCosignKey(result.smartAccountAddress)
        .then(() => publishWckBundle(result.smartAccountAddress))
        .catch((err) => {
          if (__DEV__) console.log('[wck] generate/publish failed:', err?.message);
        });

      // Announce membership so the other signers' devices auto-discover this
      // wallet on their next launch. Non-fatal; manual add stays the fallback.
      announceMembership(result.smartAccountAddress).catch((err) => {
        if (__DEV__) console.log('[membership] announce failed:', err?.message);
      });

      // Upload the encrypted backup now that the multisig is in ACCOUNTS, so
      // the creator's signer credential and this wallet are recoverable.
      // Awaited so a failure is known before navigating away — this screen
      // can't show a retry action once we've replaced it with the result
      // screen, so a failure here leaves BACKUP_PENDING for Profile to pick
      // up (same contract as deploy-account.tsx's onboarding backup step).
      try {
        await uploadBackup();
      } catch (err: any) {
        if (__DEV__) console.log('[backup] upload failed:', err?.message);
        await AsyncStorage.setItem(ASYNC_KEYS.BACKUP_PENDING, 'true');
      }

      router.replace({
        pathname: '/(onboarding)/shared-wallet-result',
        params: {
          success: 'true',
          walletAddress: result.smartAccountAddress,
        },
      });
    } catch (err) {
      if (__DEV__) console.error('[multisig] deploy failed:', err);
      router.replace({
        pathname: '/(onboarding)/shared-wallet-result',
        params: {
          success: 'false',
          walletAddress: '',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground">
      <LinearGradient
        colors={[theme.colors.gradientLight, theme.colors.gradientDark]}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style="light" />

      <Header />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Box flex={1} px="m">
          <TitleSection />
          <WalletNameCard name={params.walletName ?? ''} />
          <MemberReviewList members={members} selfEmail={selfEmail} />
          <ApprovalRuleCard approvals={approvals} total={memberCount} />
          {existingSameMembers && (
            <Box flexDirection="row" backgroundColor="bg11" borderRadius={14} p="m" mt="m">
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={theme.colors.textSecondary}
                style={{ marginRight: 8, marginTop: 1 }}
              />
              <Text variant="p8" color="textSecondary" style={{ flex: 1 }} lineHeight={18}>
                You already have a shared wallet ({existingSameMembers.name}) with these members and
                threshold. You can still create a separate one.
              </Text>
            </Box>
          )}
        </Box>
      </ScrollView>

      <Box
        px="m"
        style={{
          paddingBottom: Math.max(insets.bottom, 20),
          paddingTop: 12,
        }}
      >
        <CreateWalletButton onPress={handleCreate} />
      </Box>
    </Box>
  );
};

export default SharedWalletReview;
