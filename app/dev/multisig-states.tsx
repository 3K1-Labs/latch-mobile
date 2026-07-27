/**
 * /dev/multisig-states — dev-only sandbox previewing every UI state for
 * the shared-wallet activation flow. Components rendered here are the
 * real shipping components (src/components/multisig/) wired to mocked
 * MultisigWallet objects from src/lib/multisig-mocks.ts.
 *
 * Not linked from any production surface. Reach via `/dev/multisig-states`
 * directly. Gated on __DEV__ so accidental shipping builds 404 it.
 *
 * Also hosts a LIVE chain self-test (bottom of the screen): deploys a real
 * ed25519 2-of-2 multisig on testnet, funds it, and runs build → sign×2 →
 * submit through the actual shipping primitives (src/lib/multisig-send.ts,
 * including the enforcing-sim footprint fix). Lets the WebAuthn-free path be
 * tap-tested on a device without a second phone. Testnet + __DEV__ only.
 */

import {
  deployMultiSigSmartAccount,
  parseSimResult,
  sorobanCall,
  txToBase64,
} from '@/src/api/smart-account';
import AwaitingSetupRow from '@/src/components/multisig/AwaitingSetupRow';
import CancelledBanner from '@/src/components/multisig/CancelledBanner';
import DeployedAccountRow from '@/src/components/multisig/DeployedAccountRow';
import InvitationCard from '@/src/components/multisig/InvitationCard';
import PendingWalletCard from '@/src/components/multisig/PendingWalletCard';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  STELLAR_BUNDLER_SECRET,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import type { AccountSigner } from '@/src/lib/account-signers';
import {
  decryptForWallet,
  encryptForWallet,
  generateWalletCosignKey,
} from '@/src/lib/cosign-crypto';
import {
  mockCancelledWallet,
  mockDeployedWallet,
  mockInvitationForMe,
  mockPendingInvitesWallet,
  mockReadyToDeployWallet,
} from '@/src/lib/multisig-mocks';
import {
  aggregateAndSubmit,
  buildAssembledTransfer,
  signSharedEntry,
} from '@/src/lib/multisig-send';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import { loadAccount, toBaseUnits } from '@/src/services/send-token';
import { useWalletStore, type WalletAccount } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import {
  Address,
  Asset,
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Fund a freshly deployed multisig with native-SAC XLM from the bundler so the
 * self-test transfer has a balance to move. Mirrors the build/assemble/submit
 * pattern in multisig-send.ts but for a plain bundler-authorized SAC transfer.
 */
async function fundMultisigXlm(multisig: string, amount: string): Promise<void> {
  const bundler = Keypair.fromSecret(STELLAR_BUNDLER_SECRET);
  const source = await loadAccount(bundler.publicKey());
  const sac = new Contract(Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE));
  const tx = new TransactionBuilder(source, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      sac.call(
        'transfer',
        new Address(bundler.publicKey()).toScVal(),
        new Address(multisig).toScVal(),
        nativeToScVal(toBaseUnits(amount), { type: 'i128' }),
      ),
    )
    .setTimeout(120)
    .build();
  const raw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (raw.error) throw new Error(`fund sim: ${raw.error}`);
  const assembled = rpc.assembleTransaction(tx, parseSimResult(raw)).build();
  assembled.sign(bundler);
  const sent = await sorobanCall(STELLAR_RPC_URL, 'sendTransaction', {
    transaction: txToBase64(assembled),
  });
  if (sent.status === 'ERROR') {
    throw new Error(`fund send: ${sent.errorResultXdr ?? JSON.stringify(sent)}`);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await sorobanCall(STELLAR_RPC_URL, 'getTransaction', { hash: sent.hash });
    if (poll.status === 'SUCCESS') return;
    if (poll.status === 'FAILED') throw new Error('fund tx failed');
  }
  throw new Error('fund tx timed out');
}

const SectionHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <Box mt="l" mb="m">
    <Text variant="captionSemibold" color="primary" style={{ letterSpacing: 1.5 }}>
      {title.toUpperCase()}
    </Text>
    <Text variant="p7" color="textSecondary" mt="xs">
      {subtitle}
    </Text>
  </Box>
);

const RoleLabel: React.FC<{ role: 'creator' | 'invitee'; description: string }> = ({
  role,
  description,
}) => (
  <Box flexDirection="row" alignItems="center" mb="s">
    <Box
      backgroundColor={role === 'creator' ? 'primary50' : 'bg200'}
      borderRadius={8}
      paddingHorizontal="s"
      paddingVertical="xs"
      mr="s"
    >
      <Text
        variant="p8"
        color={role === 'creator' ? 'primary900' : 'textSecondary'}
        style={{ fontWeight: '600' }}
      >
        {role === 'creator' ? 'CREATOR VIEW' : 'INVITEE VIEW'}
      </Text>
    </Box>
    <Text variant="p8" color="textSecondary" style={{ flex: 1 }}>
      {description}
    </Text>
  </Box>
);

const MultisigStatesSandbox = () => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const router = useRouter();

  const pending = mockPendingInvitesWallet();
  const ready = mockReadyToDeployWallet();
  const deployed = mockDeployedWallet();
  const cancelled = mockCancelledWallet();
  const { wallet: invitationWallet } = mockInvitationForMe();

  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = (m: string) => setLogs((l) => [...l, m]);

  /**
   * Deploy a real ed25519 2-of-2 on testnet (both keys derived from the store
   * mnemonic at index 0/1), fund it, then drive the SHIPPING primitives
   * build → sign×2 → submit. aggregateAndSubmit runs the enforcing-sim that
   * captures the __check_auth footprint — this is the on-device proof of the
   * fix verified headless by scripts/verify-multisig-transfer.js.
   */
  const runSelfTest = async () => {
    setBusy(true);
    setLogs([]);
    try {
      const mnemonic = useWalletStore.getState().mnemonic;
      if (!mnemonic) throw new Error('No mnemonic in store — sign in with a seed wallet first.');

      const a = deriveWalletAtIndex(mnemonic, 0);
      const b = deriveWalletAtIndex(mnemonic, 1);
      addLog(`signers ${a.gAddress.slice(0, 6)}… + ${b.gAddress.slice(0, 6)}…`);

      const signers: AccountSigner[] = [
        { kind: 'ed25519', publicKeyHex: a.publicKeyHex },
        { kind: 'ed25519', publicKeyHex: b.publicKeyHex },
      ];
      addLog('deploying 2-of-2 multisig…');
      const deploy = await deployMultiSigSmartAccount(signers, 2);
      addLog(`✓ deployed ${deploy.smartAccountAddress.slice(0, 10)}…`);

      addLog('funding 5 XLM…');
      await fundMultisigXlm(deploy.smartAccountAddress, '5');
      addLog('✓ funded');

      const sac = Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE);
      const bundlerPk = Keypair.fromSecret(STELLAR_BUNDLER_SECRET).publicKey();

      addLog('building transfer (1 XLM → bundler)…');
      const assembled = await buildAssembledTransfer({
        multisigAddress: deploy.smartAccountAddress,
        sacContractId: sac,
        destinationAddress: bundlerPk,
        amount: '1',
      });

      const mk = (w: typeof a, index: number): WalletAccount =>
        ({
          index,
          name: `Self-test ${index}`,
          gAddress: w.gAddress,
          publicKeyHex: w.publicKeyHex,
          smartAccountAddress: '',
        }) as WalletAccount;

      addLog('signing with A, then B…');
      const e1 = await signSharedEntry(assembled.unsignedTxXdr, mk(a, 0), 0, mnemonic);
      const e2 = await signSharedEntry(assembled.unsignedTxXdr, mk(b, 1), 1, mnemonic);

      addLog('submitting (runs enforcing-sim)…');
      const { hash } = await aggregateAndSubmit(assembled.unsignedTxXdr, [e1, e2]);
      addLog(`✅ SUCCESS — ${hash.slice(0, 12)}…`);
    } catch (e) {
      addLog(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Exercise cosign-crypto (Phase 2 step 1) on the real QuickCrypto native path:
   * round-trip + wrong-key / wrong-account(AAD) / tampered all fail closed.
   */
  const runCryptoTest = () => {
    setBusy(true);
    setLogs([]);
    let pass = 0;
    let fail = 0;
    const ok = (name: string, cond: boolean) => {
      if (cond) pass += 1;
      else fail += 1;
      addLog(`${cond ? '✓' : '✗'} ${name}`);
    };
    try {
      const wck = generateWalletCosignKey();
      const account = 'CCSPCDD5BS2QBM5X7X5WB5RKK7BSFX5U6PBL3C5W7CAR6LAJFNEIW3FH';
      const pt = 'AAAAAgAAAAAt+/Z9PRO+abcDEF0123456789==';

      ok('WCK is 32 bytes', wck.length === 32);
      const env = encryptForWallet(wck, pt, account);
      ok('envelope v1 + url-safe', env.startsWith('v1:') && !/[+/= ]/.test(env.slice(3)));
      ok('round-trip', decryptForWallet(wck, env, account) === pt);
      ok(
        'unique ciphertext per call',
        encryptForWallet(wck, pt, account) !== encryptForWallet(wck, pt, account),
      );

      const expectThrow = (name: string, fn: () => void) => {
        try {
          fn();
          ok(name, false);
        } catch {
          ok(name, true);
        }
      };
      expectThrow('wrong key throws', () =>
        decryptForWallet(generateWalletCosignKey(), env, account),
      );
      expectThrow('wrong account (AAD) throws', () => decryptForWallet(wck, env, 'CWRONGADDRESS'));
      const tampered = env.slice(0, -4) + (env.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
      expectThrow('tampered ciphertext throws', () => decryptForWallet(wck, tampered, account));

      addLog(`${pass} passed, ${fail} failed`);
      addLog(fail === 0 ? '✅ cosign-crypto OK on device' : '❌ FAILURES');
    } catch (e) {
      addLog(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <LinearGradient
        colors={[theme.colors.gradientLight, theme.colors.gradientDark]}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style="light" />

      {/* Custom header */}
      <Box flexDirection="row" alignItems="center" px="m" py="s">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="headline" color="textPrimary" ml="s">
          Multisig states
        </Text>
      </Box>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Box px="m">
          <Text variant="p7" color="textSecondary" mt="xs" mb="m">
            Dev preview of every state in the shared-wallet activation flow. Components are the real
            shipping primitives — content is mocked.
          </Text>

          {/* ------- pending_invites ------- */}
          <SectionHeader
            title="Pending invites"
            subtitle="Wallet awaiting one or more invitees to accept."
          />

          <RoleLabel
            role="creator"
            description="Wallet sits in your Pending Wallets section with per-row status."
          />
          <PendingWalletCard wallet={pending} onCancel={() => undefined} />

          <RoleLabel
            role="invitee"
            description="You'll see this in Invitations after you tap the email link."
          />
          <InvitationCard
            wallet={invitationWallet}
            onAccept={() => undefined}
            onDecline={() => undefined}
          />

          {/* ------- ready_to_deploy ------- */}
          <SectionHeader
            title="Ready to deploy"
            subtitle="Every invitee accepted. Awaiting the creator to deploy."
          />

          <RoleLabel
            role="creator"
            description="Deploy CTA replaces the pending status; cancel still available."
          />
          <PendingWalletCard wallet={ready} onCancel={() => undefined} onDeploy={() => undefined} />

          <RoleLabel
            role="invitee"
            description="Wallet appears in your account list muted, address hidden (per P-2)."
          />
          <AwaitingSetupRow wallet={ready} />

          {/* ------- deployed ------- */}
          <SectionHeader
            title="Deployed"
            subtitle="Wallet is live on-chain. Address visible, set as active possible."
          />

          <RoleLabel
            role="creator"
            description="Same row used in the account switcher for everyone on the wallet."
          />
          <DeployedAccountRow wallet={deployed} onPress={() => undefined} />

          {/* ------- cancelled ------- */}
          <SectionHeader
            title="Cancelled"
            subtitle="Terminal state. Reason copy depends on path (decline / creator cancel / expired)."
          />

          <RoleLabel
            role="creator"
            description="Replaces the active card; banner stays until dismissed."
          />
          <CancelledBanner wallet={cancelled} onDismiss={() => undefined} />

          {/* ------- live chain self-test ------- */}
          <SectionHeader
            title="Live chain self-test"
            subtitle="Deploys a real ed25519 2-of-2 on testnet, funds it, then runs build → sign×2 → submit through the shipping primitives (incl. the enforcing-sim footprint fix). Testnet + __DEV__ only."
          />
          <TouchableOpacity disabled={busy} onPress={runSelfTest} activeOpacity={0.85}>
            <Box
              backgroundColor="primary50"
              borderRadius={16}
              padding="m"
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              opacity={busy ? 0.6 : 1}
            >
              {busy && (
                <ActivityIndicator color={theme.colors.primary900} style={{ marginRight: 8 }} />
              )}
              <Text variant="p6" color="primary900" style={{ fontWeight: '700' }}>
                {busy ? 'Running…' : 'Run 2-of-2 transfer self-test'}
              </Text>
            </Box>
          </TouchableOpacity>

          <SectionHeader
            title="Cosign crypto self-test"
            subtitle="Round-trips AES-256-GCM through react-native-quick-crypto on-device, and checks wrong-key / wrong-account / tampered all fail closed (Phase 2 step 1)."
          />
          <TouchableOpacity disabled={busy} onPress={runCryptoTest} activeOpacity={0.85}>
            <Box
              backgroundColor="bg200"
              borderRadius={16}
              padding="m"
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              opacity={busy ? 0.6 : 1}
            >
              <Text variant="p6" color="textPrimary" style={{ fontWeight: '700' }}>
                Run cosign-crypto self-test
              </Text>
            </Box>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              const { accounts, activeAccountIndex } = useWalletStore.getState();
              const acct = accounts[activeAccountIndex];
              if (acct?.isMultisig && acct.smartAccountAddress) {
                router.push({
                  pathname: '/cosign-key',
                  params: { account: acct.smartAccountAddress },
                });
              } else {
                setLogs([
                  'Active account is not a deployed multisig wallet — switch to one first.',
                ]);
              }
            }}
            activeOpacity={0.85}
            style={{ marginTop: 8 }}
          >
            <Box
              backgroundColor="bg200"
              borderRadius={16}
              padding="m"
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
            >
              <Text variant="p6" color="textPrimary" style={{ fontWeight: '700' }}>
                Open wallet-key share (active account)
              </Text>
            </Box>
          </TouchableOpacity>

          {logs.length > 0 && (
            <Box backgroundColor="bg11" borderRadius={12} padding="m" mt="s">
              {logs.map((line, i) => (
                <Text key={i} variant="p8" color="textSecondary" style={{ fontFamily: 'Courier' }}>
                  {line}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      </ScrollView>
    </Box>
  );
};

export default MultisigStatesSandbox;
