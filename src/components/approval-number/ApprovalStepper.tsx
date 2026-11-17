import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { TouchableOpacity } from 'react-native';

interface Props {
  value: number;
  total: number;
  onChange: (value: number) => void;
}

const BTN = 52;

const ApprovalStepper: React.FC<Props> = ({ value, total, onChange }) => {
  const theme = useTheme<Theme>();

  const step = (delta: number) => {
    const next = Math.max(1, Math.min(total, value + delta));
    if (next !== value) {
      Haptics.selectionAsync().catch(() => {});
      onChange(next);
    }
  };

  const atMin = value <= 1;
  const atMax = value >= total;

  const StepButton = ({
    icon,
    onPress,
    disabled,
    label,
  }: {
    icon: 'remove' | 'add';
    onPress: () => void;
    disabled: boolean;
    label: string;
  }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Box
        width={BTN}
        height={BTN}
        borderRadius={BTN / 2}
        justifyContent="center"
        alignItems="center"
        borderWidth={1.5}
        borderColor={disabled ? 'gray800' : 'primary700'}
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        <Ionicons name={icon} size={24} color={theme.colors.primary700} />
      </Box>
    </TouchableOpacity>
  );

  return (
    <Box backgroundColor="bg11" borderRadius={16} py="l" px="m" width="100%" alignItems="center">
      <Text variant="p7" color="textSecondary" mb="l">
        approvals required
      </Text>

      <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
        <StepButton
          icon="remove"
          onPress={() => step(-1)}
          disabled={atMin}
          label="Decrease approvals"
        />

        <Box flexDirection="row" alignItems="baseline">
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

        <StepButton
          icon="add"
          onPress={() => step(1)}
          disabled={atMax}
          label="Increase approvals"
        />
      </Box>
    </Box>
  );
};

export default ApprovalStepper;
