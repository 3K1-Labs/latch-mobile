/**
 * cosign-review.tsx — backend-free multisig approval surface
 * (docs/multisig-p2p-cosign.md, steps 4–5).
 *
 * Opened with:
 *   - ?id=<packetId>   → load a locally-held packet (creator, or after import)
 *   - ?data=<json>     → import a packet received from another device
 * If neither resolves, shows a paste field to import a shared packet.
 *
 * Actions: Approve (sign this device's member entry), Share (export the packet
 * to the next signer), Submit (once threshold is met).
 */

import { fetchDefaultContextRule } from '@/src/api/account-admin';
import NicknameModal from '@/src/components/cosign/NicknameModal';
import OwnerRow from '@/src/components/cosign/OwnerRow';
import SharePacketModal from '@/src/components/cosign/SharePacketModal';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import {
  decodePacketParam,
  decodeTransferSummary,
  type CosignPacket,
  type SwapMeta,
  type TransferSummary,
} from '@/src/lib/cosign-packet';
import { importPacket } from '@/src/lib/cosign-packet-flow';
import {
  approveAndMaybeSubmit,
  approvedKeyData,
  canApprove,
  getEntry,
  getMySignerKey,
  isBackendEnabled,
  submit,
} from '@/src/lib/cosign-transport';
import { assetCodeForSac } from '@/src/lib/sac-asset-code';
import { friendlyTxError } from '@/src/lib/tx-errors';
import { useSignerNicknames } from '@/src/store/signer-nicknames';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const truncate = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

// SAC base units use 7 decimals; render without trailing zeros.
function formatUnits(base: string): string {
  const neg = base.startsWith('-');
  const digits = (neg ? base.slice(1) : base).padStart(8, '0');
  const int = digits.slice(0, -7);
  const frac = digits.slice(-7).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

// A packet is safe to act on only when the review screen can fully describe what
// is being authorized. For transfers: the XDR must decode as a SAC transfer FROM
// this exact shared wallet. For swaps: the packet must carry swapMeta (provided
// by the initiator; display-only — the on-chain __check_auth enforces the auth
// entry against the signer set and threshold regardless). In both cases the
// on-chain __check_auth is the final backstop.
function isReviewable(packet: CosignPacket | null, summary: TransferSummary | null, swapMeta: SwapMeta | null): boolean {
  if (!packet) return false;
  if (packet.kind === 'swap') return !!swapMeta;
  return !!summary && summary.from === packet.smartAccountAddress;
}

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

interface OwnerVM {
  signerKey: string;
  keyDataHex: string;
  address?: string;
  isYou: boolean;
  approved: boolean;
}

// Fallback label for a signer with no nickname: a G-address for ed25519 keys,
// the contract/account address for delegated, else the raw key — all truncated.
function shortSignerLabel(o: OwnerVM): string {
  if (o.address) return truncate(o.address);
  if (o.keyDataHex.length === 64) {
    try {
      return truncate(StrKey.encodeEd25519PublicKey(Buffer.from(o.keyDataHex, 'hex')));
    } catch {
      /* not a valid ed25519 key — fall through to raw hex */
    }
  }
  return truncate(o.keyDataHex);
}

const CosignReview = () => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { id, data, d } = useLocalSearchParams<{ id?: string; data?: string; d?: string }>();

  const [packet, setPacket] = useState<CosignPacket | null>(null);
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [swapMeta, setSwapMeta] = useState<SwapMeta | null>(null);
  const [mayApprove, setMayApprove] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owners, setOwners] = useState<OwnerVM[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [editing, setEditing] = useState<OwnerVM | null>(null);
  const [showShare, setShowShare] = useState(false);

  const nicknames = useSignerNicknames((s) => s.nicknames);
  const setNickname = useSignerNicknames((s) => s.setNickname);
  const rehydrateNicknames = useSignerNicknames((s) => s.rehydrate);

  const assetCode = useMemo(
    () => (summary ? assetCodeForSac(summary.sacContractId) : null),
    [summary],
  );

  const apply = (p: CosignPacket) => {
    setPacket(p);
    if (p.kind === 'swap') {
      setSummary(null);
      setSwapMeta(p.swapMeta ?? null);
      setError(p.swapMeta ? null : 'Swap packet is missing display metadata.');
    } else {
      setSwapMeta(null);
      try {
        setSummary(decodeTransferSummary(p));
        setError(null);
      } catch (e) {
        setSummary(null);
        setError(e instanceof Error ? e.message : 'Could not read transfer details');
      }
    }
    canApprove(p)
      .then(setMayApprove)
      .catch(() => setMayApprove(false));
  };

  const goToSuccess = (p: CosignPacket, hash: string) => {
    let to = '';
    let amount = '';
    let asset = '';
    if (p.kind === 'swap' && p.swapMeta) {
      amount = p.swapMeta.amountIn;
      asset = p.swapMeta.fromCode;
    } else {
      try {
        const s = decodeTransferSummary(p);
        to = s.to;
        amount = formatUnits(s.amountBaseUnits);
        asset = assetCodeForSac(s.sacContractId) ?? '';
      } catch {
        /* couldn't decode — still show success with the hash */
      }
    }
    router.replace({
      pathname: '/cosign-success',
      params: { hash, from: p.smartAccountAddress, to, amount, asset, createdAt: p.createdAt },
    });
  };

  useEffect(() => {
    (async () => {
      try {
        if (d) {
          // latch://cosign?d=<base64url> deep link from "Share with next signer".
          apply(await importPacket(decodePacketParam(d)));
        } else if (data) {
          apply(await importPacket(data));
        } else if (id) {
          const p = await getEntry(id);
          // Opened on an already-executed request → straight to the success screen.
          if (p?.submittedTxHash) {
            goToSuccess(p, p.submittedTxHash);
            return;
          }
          if (p) apply(p);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load packet');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, data, d]);

  // Backend mode: other members' approvals (and the eventual execution) land
  // asynchronously — refresh every 15s so the progress tracks them AND a viewer
  // learns when someone else met the threshold and broadcast the tx. Polls until
  // executed (submittedTxHash), not just until threshold. P2P has nothing to poll.
  useEffect(() => {
    if (!isBackendEnabled() || !packet) return;
    if (packet.submittedTxHash) return;
    const t = setInterval(() => {
      getEntry(packet.id)
        .then((p) => {
          if (!p) return;
          if (p.submittedTxHash) {
            goToSuccess(p, p.submittedTxHash);
            return;
          }
          apply(p);
        })
        .catch(() => {
          /* transient poll failure — next tick retries */
        });
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packet?.id, packet?.signatures.length, packet?.submittedTxHash]);

  useEffect(() => {
    rehydrateNicknames();
  }, [rehydrateNicknames]);

  // Resolve the owner (signer) set from chain and mark who has approved. Re-runs
  // when a new signature lands so the list tracks incoming approvals. Delegated
  // signers are infrastructure (e.g. the bundler), not owners — filtered out.
  useEffect(() => {
    if (!packet) {
      setOwners([]);
      return;
    }
    let cancelled = false;
    setOwnersLoading(true);
    (async () => {
      try {
        const rule = await fetchDefaultContextRule(simParams(), packet.smartAccountAddress);
        const members = rule.signers.filter((s) => s.kind === 'ed25519' || s.kind === 'webauthn');
        const myKey = (await getMySignerKey())?.toLowerCase() ?? null;
        const approved = await approvedKeyData(
          packet,
          members.map((s) => s.keyDataHex),
        );
        if (cancelled) return;
        const vms: OwnerVM[] = members.map((s) => ({
          signerKey: s.signerKey,
          keyDataHex: s.keyDataHex,
          address: s.address,
          isYou: !!myKey && s.keyDataHex.toLowerCase() === myKey,
          approved: approved.has(s.keyDataHex),
        }));
        // You first, then approved, then pending — most relevant at the top.
        vms.sort(
          (a, b) => Number(b.isYou) - Number(a.isYou) || Number(b.approved) - Number(a.approved),
        );
        setOwners(vms);
      } catch {
        if (!cancelled) setOwners([]);
      } finally {
        if (!cancelled) setOwnersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packet?.id, packet?.signatures.length]);

  const handleImportPaste = async () => {
    setBusy(true);
    try {
      // Accept either the raw packet JSON or a latch://cosign?d=<base64url> link.
      const raw = pasteValue.trim();
      const dMatch = raw.match(/[?&]d=([^&\s]+)/);
      const payload = dMatch ? decodePacketParam(dMatch[1]) : raw;
      apply(await importPacket(payload));
      setPasteValue('');
    } catch (e) {
      setError(friendlyTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!packet || !isReviewable(packet, summary, swapMeta)) return;
    setBusy(true);
    try {
      const outcome = await approveAndMaybeSubmit(packet.id);
      if (outcome.submitted) {
        // This approval met the threshold and executed — show the success screen.
        goToSuccess(outcome.packet, outcome.submitted.hash);
        return;
      }
      apply(outcome.packet);
      // The approval landed; only the auto-submit failed. The manual Submit
      // button renders once thresholdMet, so the user still has a path.
      if (outcome.submitError) setError(outcome.submitError);
    } catch (e) {
      console.log({ e });
      setError(friendlyTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleShare = () => {
    if (!packet) return;
    // Open the share surface (QR + Share + Copy). The actual deep-link/blob
    // encoding lives in SharePacketModal.
    setShowShare(true);
  };

  const handleSubmit = async () => {
    if (!packet || !isReviewable(packet, summary, swapMeta)) return;
    setBusy(true);
    try {
      const { hash } = await submit(packet.id);
      goToSuccess(packet, hash);
    } catch (e) {
      console.log({ submit: e });
      setError(friendlyTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDone = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  const thresholdMet = !!packet && packet.signatures.length >= packet.threshold;
  const reviewable = isReviewable(packet, summary, swapMeta);

  return (
    <Box flex={1} backgroundColor="mainBackground" style={{ paddingTop: insets.top }}>
      <LinearGradient
        colors={[theme.colors.gradientLight, theme.colors.gradientDark]}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Box
        height={48}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        px="m"
        py="s"
      >
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={12}
          style={{ position: 'absolute', left: 16 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="headline" color="textPrimary">
          Approval Requested
        </Text>
      </Box>

      <Box flex={1} px="m">
        {loading ? (
          <Box flex={1} justifyContent="center" alignItems="center">
            <ActivityIndicator color={theme.colors.primary700} />
          </Box>
        ) : !packet ? (
          // No packet yet — scan the owner's QR, or paste the shared link.
          <Box mt="l">
            <Text variant="p6" color="textPrimary" mb="s">
              Approve a request
            </Text>
            <Text variant="p8" color="textSecondary" mb="m">
              Another owner of a shared wallet can send you a request to approve. Scan their QR
              code, or paste the link they shared.
            </Text>

            <Button
              label="Scan QR code"
              variant="primary"
              onPress={() => router.push('/qrcode-scan')}
              mb="m"
            />

            <Box flexDirection="row" alignItems="center" mb="m">
              <Box flex={1} height={1} backgroundColor="bg200" />
              <Text variant="p8" color="textSecondary" mx="m">
                or paste it
              </Text>
              <Box flex={1} height={1} backgroundColor="bg200" />
            </Box>

            <Box backgroundColor="bg11" borderRadius={14} p="s" mb="m">
              <TextInput
                value={pasteValue}
                onChangeText={setPasteValue}
                placeholder="latch://cosign?d=…  or  { …packet json… }"
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                style={{ color: theme.colors.textPrimary, minHeight: 100, fontSize: 12 }}
              />
            </Box>
            <Button
              label="Load packet"
              variant="outline"
              onPress={handleImportPaste}
              loading={busy}
              disabled={!pasteValue.trim()}
            />
            {error ? (
              <Text variant="p8" color="danger900" mt="m">
                {error}
              </Text>
            ) : null}
          </Box>
        ) : (
          <Box flex={1}>
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {/* Amount / Swap details */}
              <Box alignItems="center" mt="l" mb="xl">
                {swapMeta ? (
                  <>
                    <Text variant="p7" color="textSecondary" mb="s">
                      Swap
                    </Text>
                    <Text
                      color="textPrimary"
                      textAlign="center"
                      style={{ fontSize: 36, lineHeight: 44, fontWeight: '700' }}
                    >
                      {swapMeta.amountIn} {swapMeta.fromCode}
                    </Text>
                    <Text variant="p7" color="textSecondary" mt="xs">
                      for ~{swapMeta.amountOut} {swapMeta.toCode}
                    </Text>
                  </>
                ) : summary ? (
                  <>
                    <Text variant="p7" color="textSecondary" mb="s">
                      Transaction Amount
                    </Text>
                    <Text
                      color="textPrimary"
                      textAlign="center"
                      style={{ fontSize: 44, lineHeight: 52, fontWeight: '700' }}
                    >
                      {formatUnits(summary.amountBaseUnits)}
                      {assetCode ? ` ${assetCode}` : ''}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text variant="p7" color="textSecondary" mb="s">
                      Transaction Amount
                    </Text>
                    <Text variant="p7" color="danger900" textAlign="center">
                      {error ?? 'Could not decode the transfer.'}
                    </Text>
                  </>
                )}
              </Box>

              {/* Approval progress */}
              <Box borderRadius={20} p="m" mb="l" style={{ backgroundColor: '#2A2928' }}>
                <Box
                  p="sm"
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  mb="m"
                >
                  <Text variant="p6" color="textPrimary" fontFamily="SFproSemibold">
                    Approval Progress
                  </Text>
                  <Text
                    variant="p6"
                    color="primary700"
                    fontFamily="SFproSemibold"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {packet.signatures.length} of {packet.threshold}
                  </Text>
                </Box>
                <Box
                  height={8}
                  borderRadius={4}
                  backgroundColor="bg200"
                  style={{ overflow: 'hidden' }}
                >
                  <Box
                    height={8}
                    borderRadius={4}
                    backgroundColor="primary700"
                    style={{
                      width: `${
                        packet.threshold > 0
                          ? Math.min(
                              100,
                              Math.round((packet.signatures.length / packet.threshold) * 100),
                            )
                          : 0
                      }%`,
                    }}
                  />
                </Box>
              </Box>

              {/* Owners */}
              <Text variant="p6" color="textPrimary" fontFamily="SFproSemibold" mb="s">
                Owners
              </Text>
              {ownersLoading && owners.length === 0 ? (
                <Box py="l" alignItems="center">
                  <ActivityIndicator color={theme.colors.textSecondary} />
                </Box>
              ) : owners.length === 0 ? (
                <Text variant="p8" color="textSecondary" mb="s">
                  Couldn&apos;t load the owner list — the approval count above is the source of
                  truth.
                </Text>
              ) : (
                owners.map((o) => (
                  <OwnerRow
                    key={o.signerKey}
                    label={o.isYou ? 'You' : (nicknames[o.signerKey] ?? shortSignerLabel(o))}
                    isYou={o.isYou}
                    approved={o.approved}
                    onEditNickname={() => setEditing(o)}
                  />
                ))
              )}

              {error && summary ? (
                <Text variant="p8" color="danger900" mt="s">
                  {error}
                </Text>
              ) : null}
            </ScrollView>

            {/* Action bar — pinned below the scrollable detail */}
            <Box style={{ paddingBottom: insets.bottom + 12, paddingTop: 8 }}>
              {!reviewable ? (
                <Box backgroundColor="danger50" borderRadius={14} p="m">
                  <Text variant="p7" color="danger900" mb="xs" style={{ fontWeight: '700' }}>
                    Can&apos;t safely review this request
                  </Text>
                  <Text variant="p8" color="danger900">
                    This packet doesn&apos;t decode as a recognisable operation from this shared
                    wallet. Approving, submitting, and sharing are blocked. Only approve operations
                    you can read in full.
                  </Text>
                </Box>
              ) : (
                <>
                  {thresholdMet ? (
                    <Button
                      label={packet?.kind === 'swap' ? 'Submit swap' : 'Submit transfer'}
                      variant="primary"
                      onPress={handleSubmit}
                      loading={busy}
                      mb="s"
                    />
                  ) : mayApprove ? (
                    <Button
                      label="Approve"
                      variant="primary"
                      onPress={handleApprove}
                      loading={busy}
                      mb="s"
                    />
                  ) : (
                    // You've approved (or can't sign) — the owners list conveys the
                    // waiting state, so the action collapses to a dismiss.
                    <Button label="Done" variant="primary" onPress={handleDone} mb="s" />
                  )}
                  {/* P2P still needs a manual relay until the threshold is met. */}
                  {!isBackendEnabled() && !thresholdMet && (
                    <Button
                      label="Show QR / share"
                      variant="outline"
                      onPress={handleShare}
                      disabled={busy}
                    />
                  )}
                </>
              )}
            </Box>
          </Box>
        )}
      </Box>

      <NicknameModal
        visible={!!editing}
        signerLabel={editing ? shortSignerLabel(editing) : ''}
        initialName={editing ? (nicknames[editing.signerKey] ?? '') : ''}
        onSave={(name) => {
          if (editing) setNickname(editing.signerKey, name);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />

      <SharePacketModal
        visible={showShare}
        packet={packet}
        onClose={() => setShowShare(false)}
      />
    </Box>
  );
};

export default CosignReview;
