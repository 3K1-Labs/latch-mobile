import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useAppTheme } from '@/src/theme/ThemeContext';
import type { Theme } from '@/src/theme/theme';
import type { RequestWarning } from '@/src/lib/wc-request-review';

interface Props {
  warnings: RequestWarning[];
}

// Deliberately does not gate the Approve button. These findings are risky but
// legitimate — a transaction from another account or one that changes signers
// can be exactly what the user asked for. State the risk plainly and let them
// decide.
export default function RequestWarnings({ warnings }: Props) {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  if (warnings.length === 0) return null;

  return (
    <Box mb="l" gap="s">
      {warnings.map((warning) => (
        <Box
          key={warning.id}
          flexDirection="row"
          backgroundColor={isDark ? 'gray900' : 'gray100'}
          borderRadius={12}
          padding="m"
          gap="s"
        >
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color={theme.colors.primaryOrange}
            style={{ marginTop: 1 }}
          />
          <Box flex={1}>
            <Text variant="p7" color="textPrimary" fontFamily="SFproSemibold" mb="xs">
              {warning.title}
            </Text>
            <Text variant="p7" color="textSecondary">
              {warning.detail}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
