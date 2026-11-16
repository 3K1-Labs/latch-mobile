import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isDepositIntentExpired } from '@/src/api/latch-auth';
import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import { PillField } from '@/src/components/shared/PillField';
import Text from '@/src/components/shared/Text';
import AppToast from '@/src/components/toast/AppToast';
import { useDepositIntentStatus } from '@/src/hooks/use-deposit';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import AddFundsHeader, { useAddFundsSheetStyles } from './AddFundsHeader';
import FundingStatusSheet from './FundingStatusSheet';

const COPY = require('@/src/assets/images/transaction/copy.svg');

interface Props {
  visible: boolean;
  onClose: () => void;
  cAddress: string;
  proxyAddress?: string;
  memo?: string;
  /** RFC3339 TTL of the funding intent the memo belongs to. */
  memoExpiresAt?: string;
  /** Mints a fresh intent after a failed deposit, so the user can send again under a new memo. */
  onRetry: () => void;
}

/** Renders "Unavailable" with no copy action when `value` is absent. */
const CopyField = ({ label, value, display }: { label: string; value?: string; display?: string }) => (
  <PillField label={label}>
    <Text
      fontSize={16}
      lineHeight={24}
      color={value ? 'textPrimary' : 'textSubheading'}
      numberOfLines={1}
      style={styles.value}
    >
      {value ? display : 'Unavailable'}
    </Text>
    {!!value && (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        hitSlop={10}
        onPress={() => copyToClipboard(value, label)}
      >
        <Image source={COPY} contentFit="contain" style={styles.copyIcon} />
      </TouchableOpacity>
    )}
  </PillField>
);

const FundWalletSheet = ({
  visible,
  onClose,
  cAddress,
  proxyAddress,
  memo,
  memoExpiresAt,
  onRetry,
}: Props) => {
  const insets = useSafeAreaInsets();
  const sheetStyles = useAddFundsSheetStyles();
  const [statusVisible, setStatusVisible] = useState(false);
  const [expired, setExpired] = useState(() => isDepositIntentExpired(memoExpiresAt));

  // The intent can lapse while the sheet is open. Nothing else would re-render
  // at that moment, so schedule the flip — leaving a dead memo on screen invites
  // a deposit the relayer sweeps to recovery instead of crediting the user.
  useEffect(() => {
    setExpired(isDepositIntentExpired(memoExpiresAt));
    if (!memoExpiresAt) return;
    const msLeft = Date.parse(memoExpiresAt) - Date.now();
    if (Number.isNaN(msLeft) || msLeft <= 0) return;
    const timer = setTimeout(() => setExpired(true), msLeft);
    return () => clearTimeout(timer);
  }, [memoExpiresAt]);

  const memoLive = !!memo && !expired;
  const showProxy = !!proxyAddress && memoLive;

  const { data: deposit } = useDepositIntentStatus(memo ?? null, statusVisible);

  const closeAll = () => {
    setStatusVisible(false);
    onClose();
  };

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        snapPoints={['92%']}
        scrollable
        backgroundStyle={sheetStyles.sheet}
        handleIndicatorStyle={sheetStyles.grabber}
        header={<AddFundsHeader onBack={onClose} onClose={onClose} />}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        {/* The pool address is only safe to deposit to while a live memo pairs
            with it, so both fields read "Unavailable" without one. */}
        <Box style={styles.fields}>
          <CopyField
            label="Proxy G-Address"
            value={showProxy ? proxyAddress : undefined}
            display={shortenAddress(proxyAddress ?? null)}
          />
          <CopyField label="Memo (required)" value={showProxy ? memo : undefined} display={memo} />
        </Box>

        <Box flexDirection="row" alignItems="center" style={styles.divider}>
          <Box flex={1} height={1} backgroundColor="inputOutline" />
          <Text fontSize={14} lineHeight={22} color="textSubheading">
            Or
          </Text>
          <Box flex={1} height={1} backgroundColor="inputOutline" />
        </Box>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Copy wallet address"
          activeOpacity={0.8}
          onPress={() => copyToClipboard(cAddress)}
          style={styles.qrCard}
        >
          <Box alignItems="center">
            <QRCode
              value={cAddress || ' '}
              size={224}
              logo={require('@/src/assets/token/stellar.png')}
              logoSize={44}
              logoBackgroundColor="transparent"
              logoMargin={1}
              logoBorderRadius={22}
            />
          </Box>
          <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" style={styles.qrCaption}>
            Scan code to copy address
          </Text>
        </TouchableOpacity>

        <Box style={styles.actions}>
          <SetupButton
            label="Check deposit status"
            disabled={!memoLive}
            onPress={() => setStatusVisible(true)}
          />
          {!showProxy && (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={onRetry}
              style={styles.retry}
            >
              <Text fontSize={14} lineHeight={22} color="textSubheading" textAlign="center">
                Couldn&apos;t get a deposit memo.{' '}
                <Text fontFamily="SFproMedium" color="textPrimary">
                  Try again
                </Text>
              </Text>
            </TouchableOpacity>
          )}
        </Box>
      </BottomSheet>

      <FundingStatusSheet
        visible={statusVisible}
        deposit={deposit}
        onBack={() => setStatusVisible(false)}
        onClose={closeAll}
        onRetry={() => {
          setStatusVisible(false);
          onRetry();
        }}
      />

      {/* Rendered after the sheet so it paints above it — the root <Toast/> sits
          below this subtree. Gated on `visible` because a BottomSheetModal stays
          mounted while dismissed, and an always-mounted instance would capture
          the library's ref stack and swallow toasts meant for other screens. */}
      {visible && <AppToast />}
    </>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  fields: {
    gap: 28,
  },
  value: {
    flex: 1,
  },
  copyIcon: {
    width: 16,
    height: 16,
  },
  divider: {
    gap: 24,
    marginTop: 28,
    marginBottom: 36,
  },
  // White regardless of theme: a QR code needs a light quiet zone to scan.
  qrCard: {
    alignSelf: 'center',
    width: 253,
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 14,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#F1F1F1',
    backgroundColor: '#FFFFFF',
  },
  qrCaption: {
    color: '#000000',
    marginTop: 9,
    paddingHorizontal: 3,
  },
  actions: {
    marginTop: 32,
  },
  retry: {
    paddingTop: 16,
  },
});

export default FundWalletSheet;
