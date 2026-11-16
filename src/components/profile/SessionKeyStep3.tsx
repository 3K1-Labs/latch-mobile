import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import ActionChip from './ActionChip';

interface Props {
  values: {
    name: string;
    duration: string;
    spendingLimit: string;
    spendingLimitAsset: string;
    allowedActions: string[];
  };
  onSubmit: () => void;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="m">
    <Text fontSize={14} lineHeight={22} color="textMuted">
      {label}
    </Text>
    {children}
  </Box>
);

const Value = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textPrimary" flexShrink={1}>
    {children}
  </Text>
);

const Divider = () => <Box height={1} backgroundColor="inputOutline" />;

const SessionKeyStep3 = ({ values, onSubmit }: Props) => (
  <Box flex={1}>
    <ScrollView bounces={false} contentContainerStyle={styles.scroll}>
      <Box
        backgroundColor="inputBox"
        borderColor="inputOutline"
        borderWidth={1}
        gap="m"
        style={styles.card}
      >
        <Row label="Session Name">
          <Value>{values.name || 'My Bot'}</Value>
        </Row>
        <Divider />
        <Row label="Duration">
          <Value>{values.duration}</Value>
        </Row>
        <Divider />
        <Row label="Spending Limit">
          <Value>
            {values.spendingLimit || '0.00'} {values.spendingLimitAsset || 'USDC'}
          </Value>
        </Row>
        <Divider />
        <Row label="Allowed actions">
          <Box flexDirection="row" flexWrap="wrap" justifyContent="flex-end" gap="s" flexShrink={1}>
            {values.allowedActions.length > 0 ? (
              values.allowedActions.map((id) => <ActionChip key={id} id={id} />)
            ) : (
              <Value>None</Value>
            )}
          </Box>
        </Row>
      </Box>

      <Box gap="xs" style={styles.warning}>
        <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" style={styles.warningTitle}>
          Security Warning
        </Text>
        <Text fontSize={14} lineHeight={22} color="textMuted">
          This session will be able to perform actions on your behalf without requiring your explicit
          approval each time.
        </Text>
      </Box>
    </ScrollView>

    <Box style={styles.footer}>
      <SetupButton label="Confirm & Create Key" onPress={onSubmit} />
    </Box>
  </Box>
);

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 24,
  },
  card: {
    borderRadius: 16,
    padding: 18,
  },
  warning: {
    marginTop: 16,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,197,8,0.16)',
    backgroundColor: 'rgba(255,197,8,0.06)',
  },
  warningTitle: {
    color: '#FFC508',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
});

export default SessionKeyStep3;
