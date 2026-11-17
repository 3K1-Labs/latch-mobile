import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Linking, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';

import type { DepositStatus } from '@/src/api/latch-auth';
import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { getTransactionExplorerUrl } from '@/src/constants/config';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { usePrices } from '@/src/hooks/use-prices';
import AddFundsHeader, { useAddFundsSheetStyles } from './AddFundsHeader';

const OPEN = require('@/src/assets/images/transaction/open.svg');
const CAUTION = require('@/src/assets/images/fund/caution.svg');

const GREEN = '#76B101';
const RED = '#FB3748';

export type FundingStepStatus = 'success' | 'error' | 'inactive';
type Tone = 'pending' | 'failed' | 'completed';

interface FundingStep {
  label: string;
  status: FundingStepStatus;
  time?: string;
}

interface Derived {
  /** Null until a deposit has been seen against the memo. */
  amount: string | null;
  code: string;
  tone: Tone;
  statusLabel: string;
  steps: FundingStep[];
  txHash: string;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

const STEP_LABELS = [
  'Deposit Initiated',
  'Deposit Detected',
  'Forwarding to Smart Account',
  'Deposit Completed',
];

function derive(deposit: DepositStatus | undefined): Derived {
  const latest = deposit?.forwards[0];

  // No inbound payment yet. An intent that runs out its TTL first is terminal:
  // anything arriving against it is swept to recovery, not credited.
  if (!latest) {
    const dead = deposit?.status === 'expired' || deposit?.status === 'failed';
    return {
      amount: null,
      code: 'XLM',
      tone: dead ? 'failed' : 'pending',
      statusLabel: dead ? 'Expired' : 'Awaiting deposit',
      steps: STEP_LABELS.map((label, i) => ({
        label,
        status: i === 0 ? (dead ? 'error' : 'success') : 'inactive',
      })),
      txHash: '',
    };
  }

  // The relayer records a sweep-to-recovery as a failed forward, so a failed
  // row means the funds did not reach the user.
  const failed = latest.status === 'failed' || deposit?.status === 'failed';
  const done = latest.status === 'done';
  const statuses: FundingStepStatus[] = [
    'success',
    'success',
    done ? 'success' : failed ? 'error' : 'inactive',
    done ? 'success' : 'inactive',
  ];

  return {
    amount: latest.amount,
    code: latest.asset === 'native' ? 'XLM' : latest.asset.split(':')[0],
    tone: done ? 'completed' : failed ? 'failed' : 'pending',
    statusLabel: done ? 'Completed' : failed ? 'Failed' : 'Pending',
    steps: STEP_LABELS.map((label, i) => ({
      label,
      status: statuses[i],
      time:
        i === 0 ? formatTime(latest.created_at) : i === 3 && done ? formatTime(latest.created_at) : undefined,
    })),
    txHash: latest.forward_tx ?? latest.tx_hash,
  };
}

const TONES: Record<Tone, { color: string; bg: string }> = {
  pending: { color: '#F68B07', bg: 'rgba(246,139,7,0.08)' },
  failed: { color: RED, bg: 'rgba(251,55,72,0.08)' },
  completed: { color: '#27C11F', bg: 'rgba(39,193,31,0.08)' },
};

const StatusPill = ({ tone, label }: { tone: Tone; label: string }) => (
  <Box style={[styles.pill, { backgroundColor: TONES[tone].bg }]}>
    <Text fontSize={14} lineHeight={14} style={{ color: TONES[tone].color }}>
      {label}
    </Text>
  </Box>
);

/** Splits "$500.00" into "$500" and ".00" so the cents can be set smaller, as in the design. */
const splitCents = (text: string): [string, string] => {
  const m = text.match(/^(.*?)([.,]\d+)(\D*)$/);
  return m ? [m[1], m[2] + m[3]] : [text, ''];
};

// Rail geometry from the design: 18pt rings on a 52pt row pitch, joined by 22pt connectors.
const ROW_PITCH = 52;
const RING_R = 8.25;
const RAIL_TOP = 13;
const RAIL_X = 16;

const Rail = ({ steps }: { steps: FundingStep[] }) => {
  const theme = useTheme<Theme>();
  const RAIL_IDLE = theme.colors.inputOutline;
  const RAIL_FILL = theme.colors.inputBox;
  const lastReached = steps.reduce((acc, s, i) => (s.status === 'inactive' ? acc : i), 0);
  const ringColor = (s: FundingStepStatus) =>
    s === 'success' ? GREEN : s === 'error' ? RED : RAIL_IDLE;
  const errorIndex = steps.findIndex((s) => s.status === 'error');

  return (
    <Box style={styles.rail}>
      <LinearGradient
        colors={['rgba(118,177,1,0.18)', 'rgba(118,177,1,0)']}
        style={[styles.railGlow, { height: 51 + ROW_PITCH * lastReached }]}
      />
      <Svg width={32} height={180} style={StyleSheet.absoluteFill}>
        {steps.slice(1).map((s, i) => (
          <Line
            key={`l${i}`}
            x1={RAIL_X}
            x2={RAIL_X}
            y1={RAIL_TOP + ROW_PITCH * i + 15}
            y2={RAIL_TOP + ROW_PITCH * i + 37}
            stroke={s.status === 'inactive' ? RAIL_IDLE : GREEN}
            strokeWidth={1.5}
          />
        ))}
        {steps.map((s, i) => (
          <Circle
            key={`c${i}`}
            cx={RAIL_X}
            cy={RAIL_TOP + ROW_PITCH * i}
            r={RING_R}
            fill={RAIL_FILL}
            stroke={ringColor(s.status)}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
      {errorIndex >= 0 && (
        <Image
          source={CAUTION}
          contentFit="contain"
          style={[styles.caution, { top: RAIL_TOP + ROW_PITCH * errorIndex - 10.5 }]}
        />
      )}
    </Box>
  );
};

interface Props {
  visible: boolean;
  deposit?: DepositStatus;
  onBack: () => void;
  onClose: () => void;
  onRetry: () => void;
}

const FundingStatusSheet = ({ visible, deposit, onBack, onClose, onRetry }: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const sheetStyles = useAddFundsSheetStyles();
  const { data: prices } = usePrices();
  const { formatToken } = useDisplayFiat();
  const d = derive(deposit);

  let headline: [string, string] | null = null;
  if (d.amount) {
    const fiat = formatToken(d.amount, prices?.[d.code]?.price, { approx: false });
    headline = fiat.unpriced
      ? splitCents(`+${parseFloat(d.amount).toFixed(2)} ${d.code}`)
      : splitCents(`+${fiat.text}`);
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onBack}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={sheetStyles.sheet}
      handleIndicatorStyle={sheetStyles.grabber}
      header={<AddFundsHeader onBack={onBack} onClose={onClose} />}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 38 }]}
    >
      <Box alignItems="center" style={styles.hero}>
        <Box style={[styles.tokenBg, { backgroundColor: theme.colors.badgeBg }]}>
          <TokenIcon size={40} />
        </Box>
        <Box alignItems="center" style={styles.heroText}>
          {headline ? (
            <Text fontFamily="SFproSemibold" letterSpacing={-1.4} color="textPrimary" numberOfLines={1}>
              <Text fontSize={40} lineHeight={40}>
                {headline[0]}
              </Text>
              <Text fontSize={28} lineHeight={40} color="textSubheading">
                {headline[1]}
              </Text>
            </Text>
          ) : (
            <Text fontSize={24} lineHeight={40} fontFamily="SFproSemibold" color="textSubheading">
              --
            </Text>
          )}
          <StatusPill tone={d.tone} label={d.statusLabel} />
        </Box>
      </Box>

      <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textSubheading">
        Transaction Timeline
      </Text>
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="inputBox"
        borderColor="inputOutline"
        borderWidth={1}
        borderRadius={20}
        style={styles.timeline}
      >
        <Rail steps={d.steps} />
        <Box flex={1} style={styles.rows}>
          {d.steps.map((step) => (
            <Box
              key={step.label}
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              style={styles.row}
            >
              <Text
                fontSize={14}
                lineHeight={22}
                color={step.status === 'inactive' ? 'textSubheading' : 'textPrimary'}
                numberOfLines={1}
                style={styles.rowLabel}
              >
                {step.label}
              </Text>
              {step.status === 'error' ? (
                <StatusPill tone="failed" label="Failed" />
              ) : (
                <Text
                  fontSize={14}
                  lineHeight={22}
                  fontFamily="SFproSemibold"
                  color={step.status === 'inactive' ? 'textSubheading' : 'textPrimary'}
                >
                  {step.time ?? '--'}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {!!d.txHash && (
        <Box style={styles.hashSection}>
          <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textSubheading">
            Transaction Hash
          </Text>
          <Box
            flexDirection="row"
            alignItems="flex-start"
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            borderRadius={16}
            style={styles.hashBox}
          >
            <Text fontSize={16} lineHeight={24} color="textPrimary" style={styles.hashText}>
              {d.txHash}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="View on Stellar Explorer"
              hitSlop={10}
              onPress={() => Linking.openURL(getTransactionExplorerUrl(d.txHash))}
            >
              <Image source={OPEN} contentFit="contain" style={styles.openIcon} />
            </TouchableOpacity>
          </Box>
        </Box>
      )}

      <Box style={styles.actions}>
        {d.tone === 'failed' ? (
          <SetupButton label="Retry Payment" onPress={onRetry} />
        ) : (
          <SetupButton label="Back to Home" onPress={onClose} />
        )}
      </Box>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 34,
  },
  hero: {
    gap: 24,
    marginBottom: 48,
  },
  tokenBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    gap: 12,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 26,
  },
  timeline: {
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
  },
  rail: {
    width: 32,
    height: 180,
  },
  railGlow: {
    position: 'absolute',
    left: 5,
    top: 2,
    width: 22,
    borderRadius: 23,
  },
  caution: {
    position: 'absolute',
    left: RAIL_X - 10.5,
    width: 21,
    height: 21,
  },
  rows: {
    gap: 14,
  },
  row: {
    height: 38,
    gap: 12,
  },
  rowLabel: {
    flexShrink: 1,
  },
  hashSection: {
    marginTop: 28,
    gap: 12,
  },
  hashBox: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  hashText: {
    flex: 1,
  },
  openIcon: {
    width: 16,
    height: 16,
  },
  actions: {
    marginTop: 40,
  },
});

export default FundingStatusSheet;
