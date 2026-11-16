import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import React from 'react';
import { StyleSheet } from 'react-native';

export const SummaryCard = ({ children }: { children: React.ReactNode }) => (
  <>
    <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textMuted">
      Summary
    </Text>
    <Box
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      borderRadius={20}
      style={styles.card}
    >
      {children}
    </Box>
  </>
);

export const SummaryRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="sm">
    <Text fontSize={16} lineHeight={24} color="textSubheading">
      {label}
    </Text>
    {children}
  </Box>
);

export const SummaryValue = ({ children }: { children: React.ReactNode }) => (
  <Text
    fontSize={16}
    lineHeight={24}
    fontFamily="SFproMedium"
    color="textPrimary"
    numberOfLines={1}
    flexShrink={1}
  >
    {children}
  </Text>
);

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 20,
    gap: 24,
  },
});
