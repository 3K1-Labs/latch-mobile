import React from 'react';
import { StyleSheet } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

const LABELS: Record<string, string> = {
  transfer: 'Transfer',
  swap: 'Swap',
  offers: 'Offers',
};

/** Green pill naming one action a session key is allowed to perform. */
const ActionChip = ({ id }: { id: string }) => (
  <Box alignItems="center" justifyContent="center" style={styles.chip}>
    <Text fontSize={12} lineHeight={16} letterSpacing={-0.12} fontFamily="SFproMedium" style={styles.label}>
      {LABELS[id] ?? id}
    </Text>
  </Box>
);

const styles = StyleSheet.create({
  chip: {
    height: 30,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: 60,
    backgroundColor: 'rgba(118,177,1,0.12)',
  },
  label: {
    color: '#76B101',
  },
});

export default ActionChip;
