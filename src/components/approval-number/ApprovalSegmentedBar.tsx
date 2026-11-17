import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { TouchableOpacity } from 'react-native';

interface Props {
  value: number;
  total: number;
  onChange: (value: number) => void;
}

const SEGMENT_HEIGHT = 10;
const HIT_HEIGHT = 44; // tappable area meets the 44pt minimum

const ApprovalSegmentedBar: React.FC<Props> = ({ value, total, onChange }) => {
  const theme = useTheme<Theme>();

  const select = (n: number) => {
    const clamped = Math.max(1, Math.min(total, n));
    if (clamped !== value) {
      Haptics.selectionAsync().catch(() => {});
      onChange(clamped);
    }
  };

  return (
    <Box backgroundColor="bg11" borderRadius={16} py="l" px="m" width="100%">
      {/* Counter display */}
      <Box flexDirection="row" alignItems="baseline" justifyContent="center" mb="xs">
        <Text
          style={{
            fontSize: 56,
            lineHeight: 64,
            fontFamily: 'SFproBold',
            color: theme.colors.textPrimary,
          }}
        >
          {value}
        </Text>
        <Text variant="p5" color="textSecondary" style={{ marginHorizontal: 6 }}>
          of {total}
        </Text>
      </Box>

      <Text variant="p7" color="textSecondary" textAlign="center" mb="l">
        approvals required
      </Text>

      {/* Segments */}
      <Box flexDirection="row" justifyContent="space-between">
        {Array.from({ length: total }).map((_, i) => {
          const n = i + 1;
          const filled = n <= value;
          return (
            <TouchableOpacity
              key={n}
              activeOpacity={0.8}
              onPress={() => select(n)}
              accessibilityRole="button"
              accessibilityState={{ selected: filled }}
              accessibilityLabel={`Set ${n} of ${total} approvals`}
              style={{
                flex: 1,
                height: HIT_HEIGHT,
                justifyContent: 'center',
                marginHorizontal: 3,
              }}
            >
              <Box
                height={SEGMENT_HEIGHT}
                borderRadius={SEGMENT_HEIGHT / 2}
                style={{
                  backgroundColor: filled ? theme.colors.primary700 : theme.colors.gray900,
                }}
              />
            </TouchableOpacity>
          );
        })}
      </Box>

      {/* Min / max labels */}
      <Box flexDirection="row" justifyContent="space-between" mt="xs">
        <Text variant="p8" color="textSecondary">
          1
        </Text>
        <Text variant="p8" color="textSecondary">
          {total}
        </Text>
      </Box>
    </Box>
  );
};

export default ApprovalSegmentedBar;
