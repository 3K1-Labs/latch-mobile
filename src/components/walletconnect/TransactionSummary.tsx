import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useState } from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useAppTheme } from '@/src/theme/ThemeContext';
import type { Theme } from '@/src/theme/theme';
import type { RequestReview } from '@/src/lib/wc-request-review';

interface Props {
  review: RequestReview;
  /** The account the session was approved against, so it can be marked "(you)" */
  accountAddress?: string | null;
}

function truncate(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

function relativeExpiry(expiresAt?: string): string {
  if (!expiresAt) return 'Never';
  const minutes = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return 'Expired';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="m">
      <Text variant="p7" color="textSecondary">
        {label}
      </Text>
      <Text variant="p7" color="textPrimary" textAlign="right" style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </Box>
  );
}

export default function TransactionSummary({ review, accountAddress }: Props) {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const [showRaw, setShowRaw] = useState(false);

  const isOwnSource = accountAddress != null && review.source === accountAddress;

  return (
    <Box>
      <Text variant="p7" color="textSecondary" mb="s">
        Transaction
      </Text>

      <Box backgroundColor="cardBackground" borderRadius={16} padding="m" gap="m">
        {review.operations.map((op) => (
          <Box key={op.index}>
            <Text variant="p7" color="textPrimary" fontFamily="SFproSemibold">
              {op.label}
            </Text>
            {op.detail && (
              <Text variant="p7" color="textSecondary" mt="xs">
                {op.detail}
              </Text>
            )}
            {op.sourceOverride && (
              <Text variant="p7" color="textTertiary" mt="xs">
                on behalf of {truncate(op.sourceOverride)}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      <Text variant="p7" color="textSecondary" mt="l" mb="s">
        Details
      </Text>

      <Box backgroundColor="cardBackground" borderRadius={16} padding="m" gap="s">
        <DetailRow
          label="From"
          value={`${truncate(review.source)}${isOwnSource ? '  (you)' : ''}`}
        />
        <DetailRow label="Fee" value={`${review.fee} XLM`} />
        {review.memo && (
          <DetailRow label="Memo" value={`${review.memoType ?? 'memo'} · ${review.memo}`} />
        )}
        <DetailRow label="Expires" value={relativeExpiry(review.expiresAt)} />
      </Box>

      <TouchableOpacity onPress={() => setShowRaw((v) => !v)} activeOpacity={0.7}>
        <Box flexDirection="row" alignItems="center" mt="m" gap="xs">
          <Ionicons
            name={showRaw ? 'chevron-down' : 'chevron-forward'}
            size={14}
            color={theme.colors.textSecondary}
          />
          <Text variant="p7" color="textSecondary">
            {showRaw ? 'Hide raw XDR' : 'View raw XDR'}
          </Text>
        </Box>
      </TouchableOpacity>

      {showRaw && (
        <Box
          backgroundColor={isDark ? 'gray900' : 'gray100'}
          borderRadius={12}
          padding="m"
          mt="s"
        >
          <ScrollView style={{ maxHeight: 120 }} showsVerticalScrollIndicator={false}>
            <Text variant="p7" color="textPrimary" style={{ fontFamily: 'monospace' }}>
              {review.xdr}
            </Text>
          </ScrollView>
        </Box>
      )}
    </Box>
  );
}
