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

const CHIP = 48;

const ApprovalNumberChips: React.FC<Props> = ({ value, total, onChange }) => {
  const theme = useTheme<Theme>();

  const select = (n: number) => {
    const clamped = Math.max(1, Math.min(total, n));
    if (clamped !== value) {
      Haptics.selectionAsync().catch(() => {});
      onChange(clamped);
    }
  };

  return (
    <Box backgroundColor="bg11" borderRadius={16} py="l" px="m" width="100%" alignItems="center">
      <Text variant="p7" color="textSecondary" mb="xs">
        Approvals required
      </Text>
      <Text variant="p8" color="textSecondary" mb="l" textAlign="center">
        How many owners must approve each transaction
      </Text>

      <Box flexDirection="row" flexWrap="wrap" justifyContent="center" gap="s">
        {Array.from({ length: total }).map((_, i) => {
          const n = i + 1;
          const selected = n === value;
          return (
            <TouchableOpacity
              key={n}
              activeOpacity={0.8}
              onPress={() => select(n)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${n} of ${total} approvals`}
            >
              <Box
                width={CHIP}
                height={CHIP}
                borderRadius={CHIP / 2}
                justifyContent="center"
                alignItems="center"
                borderWidth={1.5}
                borderColor={selected ? 'primary700' : 'gray800'}
                style={{
                  backgroundColor: selected ? theme.colors.primary700 : 'transparent',
                }}
              >
                <Text
                  variant="h10"
                  fontWeight="700"
                  color={selected ? 'black' : 'textPrimary'}
                >
                  {n}
                </Text>
              </Box>
            </TouchableOpacity>
          );
        })}
      </Box>

      <Text variant="p7" color="textSecondary" mt="l">
        <Text variant="p7" color="textPrimary" fontWeight="700">
          {value}
        </Text>{' '}
        of {total}
      </Text>
    </Box>
  );
};

export default ApprovalNumberChips;
