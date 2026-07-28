import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DepositForward } from '@/src/api/latch-auth';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useDepositIntentStatus } from '@/src/hooks/use-deposit';
import AppToast from '@/src/components/toast/AppToast';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import FundInfoSheet from './FundInfoSheet';
import FundingStatusSheet, { type FundingStepStatus } from './FundingStatusSheet';

interface FundingStep {
  label: string;
  sublabel?: string;
  status: FundingStepStatus;
  time?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}:${ss}`;
}

function deriveStatusProps(forwards: DepositForward[]) {
  const latest = forwards[0];
  if (!latest) return null;

  const amount = parseFloat(latest.amount).toFixed(2);
  const unit = latest.asset === 'native' ? 'XLM' : latest.asset;
  const steps: FundingStep[] = [
    { label: 'Deposit\nInitiated', status: 'success', time: formatDate(latest.created_at) },
    { label: 'Deposit\nDetected', status: 'success' },
    {
      label: 'Forwarding to\nSmart Account',
      status: latest.status === 'done' ? 'success' : latest.status === 'failed' ? 'error' : 'inactive',
    },
    {
      label: 'Deposit\nCompleted',
      status: latest.status === 'done' ? 'success' : 'inactive',
      time: latest.status === 'done' ? formatDate(latest.created_at) : undefined,
    },
  ];

  return {
    amount: `+${amount} ${unit}`,
    statusLabel: latest.status === 'done' ? 'Completed' : latest.status === 'failed' ? 'Failed' : 'Pending',
    steps,
    txHash: latest.tx_hash,
  };
}

interface Props {
  visible: boolean;
  onClose: () => void;
  cAddress: string;
  proxyAddress?: string;
  memo?: string;
}

const FundWalletSheet = ({ visible, onClose, cAddress, proxyAddress, memo }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [infoVisible, setInfoVisible] = useState(false);
  const [statusVisible, setStatusVisible] = useState(false);

  const { data: depositStatusData } = useDepositIntentStatus(memo ?? null, statusVisible);
  const statusProps = depositStatusData?.forwards ? deriveStatusProps(depositStatusData.forwards) : null;



  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        snapPoints={['92%']}
        scrollable
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        {/* Header */}
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="m"
          py="m"
          mb="s"
        >
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text variant="h9" color="textPrimary" fontWeight="700">
            Fund Wallet
          </Text>
          <TouchableOpacity
            onPress={() => setInfoVisible(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="information-circle-outline" size={24} color={theme.colors.primary700} />
          </TouchableOpacity>
        </Box>

        <Box paddingHorizontal="m" mt="s">
          {/* Wallet Address (C-Address) */}
          <Box mb="l">
            <Text variant="p7" color="textPrimary" fontWeight="700" mb="s">
              Wallet Address
            </Text>
            <Box
              backgroundColor={isDark ? 'gray900' : 'btnDisabled'}
              borderRadius={12}
              padding="m"
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              minHeight={64}
            >
              <Box flex={1} marginRight="s">
                <Text variant="p7" color="textSecondary" numberOfLines={2}>
                  {cAddress}
                </Text>
              </Box>
              <TouchableOpacity onPress={() => copyToClipboard(cAddress)}>
                <Ionicons name="copy-outline" size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </Box>
          </Box>

          {/* Divider */}
          <Box flexDirection="row" alignItems="center" mb="l">
            <Box flex={1} height={1} backgroundColor="gray800" />
            <Text variant="p7" color="textSecondary" mx="m">
              OR
            </Text>
            <Box flex={1} height={1} backgroundColor="gray800" />
          </Box>

          {/* QR Code */}
          <Box alignItems="center" mb="l">
            <Box
              backgroundColor="white"
              padding="m"
              borderRadius={24}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
              }}
            >
              <QRCode
                value={cAddress || ' '}
                size={160}
                logo={require('@/src/assets/token/stellar.png')}
                logoSize={40}
                logoBackgroundColor="transparent"
                logoMargin={1}
                logoBorderRadius={20}
              />
            </Box>
            <Text variant="p6" color="textSecondary" textAlign="center" mt="l" lineHeight={22}>
              Use this address to fund tokens to{'\n'}your{' '}
              <Text fontWeight="700" color="textPrimary">
                Wallet
              </Text>
              .
            </Text>
          </Box>

          {/* Proxy G-Address (alternate funding path via relayer) */}
          {!!proxyAddress && (
            <>
              <Box flexDirection="row" alignItems="center" mb="l">
                <Box flex={1} height={1} backgroundColor="gray800" />
                <Text variant="p7" color="textSecondary" mx="m">
                  OR
                </Text>
                <Box flex={1} height={1} backgroundColor="gray800" />
              </Box>

              <Box mb="l">
                <Text variant="p7" color="textPrimary" fontWeight="700" mb="s">
                  Proxy G-Address
                </Text>
                <Box
                  backgroundColor={isDark ? 'gray900' : 'btnDisabled'}
                  borderRadius={12}
                  padding="m"
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  minHeight={64}
                >
                  <Box flex={1} marginRight="s">
                    <Text variant="p7" color="textSecondary" numberOfLines={2}>
                      {proxyAddress}
                    </Text>
                  </Box>
                  <TouchableOpacity onPress={() => copyToClipboard(proxyAddress)}>
                    <Ionicons name="copy-outline" size={20} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </Box>
              </Box>

              {!!memo && (
                <Box mb="l">
                  <Text variant="p7" color="textPrimary" fontWeight="700" mb="s">
                    Memo (Required)
                  </Text>
                  <Box
                    backgroundColor={isDark ? 'gray900' : 'btnDisabled'}
                    borderRadius={12}
                    padding="m"
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                    minHeight={56}
                  >
                    <Text variant="p7" color="textSecondary">
                      {memo}
                    </Text>
                    <TouchableOpacity onPress={() => copyToClipboard(memo, 'Memo')}>
                      <Ionicons name="copy-outline" size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  </Box>
                </Box>
              )}
            </>
          )}

          {/* Actions */}
          <Box gap="m">
            <TouchableOpacity activeOpacity={0.8} onPress={() => copyToClipboard(cAddress)}>
              <Box
                height={56}
                backgroundColor="primary"
                borderRadius={28}
                flexDirection="row"
                alignItems="center"
                justifyContent="center"
                gap="s"
              >
                <Text variant="h10" color="black" fontWeight="700">
                  Copy
                </Text>
                <Ionicons name="copy-outline" size={18} color="black" />
              </Box>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.8} onPress={() => setStatusVisible(true)}>
              <Box
                height={56}
                backgroundColor="bg11"
                borderRadius={28}
                justifyContent="center"
                alignItems="center"
                borderWidth={1}
                borderColor="gray800"
              >
                <Text variant="p6" color="textPrimary" fontWeight="700">
                  Check Deposit Status
                </Text>
              </Box>
            </TouchableOpacity>
          </Box>
        </Box>
      </BottomSheet>

      <FundInfoSheet visible={infoVisible} onClose={() => setInfoVisible(false)} />
      <FundingStatusSheet
        visible={statusVisible}
        onClose={() => setStatusVisible(false)}
        {...(statusProps ?? {})}
      />

      {/* Rendered after the sheet so it paints above it — the root <Toast/> sits
          below this subtree. Gated on `visible` because a BottomSheetModal stays
          mounted while dismissed, and an always-mounted instance would capture
          the library's ref stack and swallow toasts meant for other screens. */}
      {visible && <AppToast />}
    </>
  );
};

export default FundWalletSheet;
