import React from 'react';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

interface AccountSectionHeaderProps {
  label: string;
  count: number;
}

const AccountSectionHeader = ({ label, count }: AccountSectionHeaderProps) => (
  <Box flexDirection="row" alignItems="center" gap="xs" mb="sm">
    <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
      {label} · {count}
    </Text>
  </Box>
);

export default AccountSectionHeader;
