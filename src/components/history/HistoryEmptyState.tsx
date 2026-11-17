import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import Box from '../shared/Box';
import Text from '../shared/Text';

const EMPTY_MASCOT = require('@/src/assets/images/home/empty-mascot.svg');

/** Empty state shared by every History filter, so they sit at the same height. */
const HistoryEmptyState = ({ title, subtitle }: { title: string; subtitle: string }) => {
  const { height } = useWindowDimensions();
  return (
    <Box height={height / 2} justifyContent="center" alignItems="center" paddingHorizontal="xl" gap="xs">
      <Image source={EMPTY_MASCOT} contentFit="contain" style={styles.mascot} />
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary" textAlign="center">
        {title}
      </Text>
      <Text fontSize={14} lineHeight={22} color="textSubheading" textAlign="center">
        {subtitle}
      </Text>
    </Box>
  );
};

const styles = StyleSheet.create({
  mascot: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
});

export default HistoryEmptyState;
