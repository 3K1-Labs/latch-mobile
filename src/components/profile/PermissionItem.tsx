import React from 'react';
import { StyleSheet } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import type { SessionKey } from '@/src/store/permissions';
import ActionChip from './ActionChip';

interface Props {
  permission: SessionKey;
}

const Field = ({ label, children, flex }: { label: string; children: React.ReactNode; flex: number }) => (
  <Box flex={flex} gap="s">
    <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textSubheading">
      {label}
    </Text>
    <Box flexDirection="row" alignItems="center" justifyContent="space-between" style={styles.value}>
      {children}
    </Box>
  </Box>
);

const ValueText = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize={14} lineHeight={16} letterSpacing={0.14} color="textMuted" numberOfLines={1}>
    {children}
  </Text>
);

const PermissionItem = ({ permission }: Props) => {
  const expired = Date.now() > permission.expiresAt;
  return (
    <Box backgroundColor="inputBox" borderColor="inputOutline" borderWidth={1} gap="m" style={styles.card}>
      <Box gap="s">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
            {permission.name}
          </Text>
          {expired && (
            <Box style={styles.expired}>
              <Text fontSize={12} lineHeight={16} fontFamily="SFproMedium" color="textMuted">
                Expired
              </Text>
            </Box>
          )}
        </Box>
        {permission.allowedActions.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" gap="s">
            {permission.allowedActions.map((id) => (
              <ActionChip key={id} id={id} />
            ))}
          </Box>
        )}
      </Box>

      <Box height={1} backgroundColor="inputOutline" />

      <Box flexDirection="row" gap="l">
        <Field label="Expires" flex={1}>
          <ValueText>{expired ? 'Expired' : permission.durationLabel}</ValueText>
        </Field>
        <Field label="Limit" flex={1.3}>
          <ValueText>{permission.spendingLimit || '—'}</ValueText>
          <ValueText>{permission.spendingLimitAsset}</ValueText>
        </Field>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  expired: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 60,
    backgroundColor: '#1A1A1A',
  },
  value: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 60,
    gap: 8,
    backgroundColor: '#1A1A1A',
  },
});

export default PermissionItem;
