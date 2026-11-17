import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import { PillField, PillInput } from '@/src/components/shared/PillField';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import SessionKeyTokenPicker, { largestBalanceCode, useHeldTokens } from './SessionKeyTokenPicker';

interface Props {
  values: {
    duration: string;
    spendingLimit: string;
    spendingLimitAsset: string;
    allowedActions: string[];
  };
  setFieldValue: (field: string, value: any) => void;
  onNext: () => void;
}

const GREEN = '#76B101';
const DURATIONS = ['1 Hour', '1 Day', '1 Week', '1 Month'];
const ACTIONS = [
  { id: 'transfer', title: 'Transfer Tokens', description: 'Allow sending funds within limit' },
  { id: 'swap', title: 'Swap Tokens', description: 'Allow trading tokens on DEX' },
  { id: 'offers', title: 'Manage Offers', description: 'Create or cancel trade offers' },
];

const SectionLabel = ({ children }: { children: string }) => (
  <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textSubheading">
    {children}
  </Text>
);

const SessionKeyStep2 = ({ values, setFieldValue, onNext }: Props) => {
  const theme = useTheme<Theme>();
  const tokens = useHeldTokens();
  const [pickerVisible, setPickerVisible] = useState(false);

  // Default the spending-limit token to the wallet's largest holding once
  // balances load, unless the user has already picked one.
  useEffect(() => {
    if (!values.spendingLimitAsset && tokens.length > 0) {
      setFieldValue('spendingLimitAsset', largestBalanceCode(tokens));
    }
  }, [tokens, values.spendingLimitAsset, setFieldValue]);

  const toggleAction = (id: string) => {
    const current = [...values.allowedActions];
    const index = current.indexOf(id);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(id);
    }
    setFieldValue('allowedActions', current);
  };

  return (
    <Box flex={1}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Box gap="s">
          <SectionLabel>Duration</SectionLabel>
          <Box flexDirection="row" flexWrap="wrap" style={styles.grid}>
            {DURATIONS.map((d) => {
              const selected = values.duration === d;
              return (
                <TouchableOpacity
                  key={d}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  activeOpacity={0.7}
                  onPress={() => setFieldValue('duration', d)}
                  style={[
                    styles.duration,
                    {
                      borderColor: theme.colors.inputOutline,
                      backgroundColor: theme.colors.inputBox,
                    },
                    selected && styles.durationSelected,
                  ]}
                >
                  <Text
                    fontSize={14}
                    lineHeight={22}
                    fontFamily="SFproMedium"
                    color={selected ? 'textPrimary' : 'textMuted'}
                  >
                    {d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Box>
        </Box>

        <Box style={styles.section}>
          <PillField label="Total Spending Limit">
            <PillInput
              placeholder="0.00"
              value={values.spendingLimit}
              onChangeText={(text) => setFieldValue('spendingLimit', text)}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Choose spending limit token"
              activeOpacity={0.7}
              onPress={() => setPickerVisible(true)}
              style={styles.assetChip}
            >
              <Text fontSize={14} lineHeight={16} fontFamily="SFproMedium" color="textPrimary">
                {values.spendingLimitAsset || 'USDC'}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </PillField>
        </Box>

        <Box gap="s" style={styles.section}>
          <SectionLabel>Allowed Actions</SectionLabel>
          <Box
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            style={styles.actionsCard}
          >
            {ACTIONS.map((action, i) => {
              const selected = values.allowedActions.includes(action.id);
              const next = ACTIONS[i + 1];
              const linked = selected && !!next && values.allowedActions.includes(next.id);
              return (
                <TouchableOpacity
                  key={action.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  activeOpacity={0.7}
                  onPress={() => toggleAction(action.id)}
                  style={styles.actionRow}
                >
                  <Box alignItems="center" style={styles.rail}>
                    <Box
                      alignItems="center"
                      justifyContent="center"
                      style={[
                        styles.radio,
                        { borderColor: theme.colors.inputOutline },
                        selected && styles.radioSelected,
                      ]}
                    >
                      {selected && <Box style={styles.radioDot} />}
                    </Box>
                    {next && (
                      <Box
                        style={[
                          styles.connector,
                          { backgroundColor: theme.colors.inputOutline },
                          linked && styles.connectorLinked,
                        ]}
                      />
                    )}
                  </Box>
                  <Box flex={1} gap="xs" style={styles.actionText}>
                    <Text
                      fontSize={14}
                      lineHeight={22}
                      color={selected ? 'textPrimary' : 'textMuted'}
                    >
                      {action.title}
                    </Text>
                    <Text fontSize={14} lineHeight={18} color="textMuted">
                      {action.description}
                    </Text>
                  </Box>
                </TouchableOpacity>
              );
            })}
          </Box>
        </Box>
      </ScrollView>

      <Box style={styles.footer}>
        <SetupButton label="Continue" onPress={onNext} />
      </Box>

      <SessionKeyTokenPicker
        visible={pickerVisible}
        tokens={tokens}
        onClose={() => setPickerVisible(false)}
        onSelect={(token) => {
          setFieldValue('spendingLimitAsset', token.code);
          setPickerVisible(false);
        }}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 24,
  },
  grid: {
    gap: 8,
  },
  duration: {
    width: '48.6%',
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 60,
    borderWidth: 1,
  },
  durationSelected: {
    borderColor: GREEN,
  },
  section: {
    marginTop: 24,
  },
  // Sits 4pt inside the pill's right edge, as in the design.
  assetChip: {
    height: 40,
    minWidth: 68,
    marginRight: -16,
    paddingHorizontal: 14,
    borderRadius: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(118,177,1,0.16)',
  },
  actionsCard: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  actionRow: {
    flexDirection: 'row',
  },
  rail: {
    width: 24,
    paddingTop: 9,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  radioSelected: {
    borderColor: GREEN,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GREEN,
  },
  connector: {
    flex: 1,
    width: 2,
    minHeight: 24,
    marginVertical: 4,
    borderRadius: 1,
  },
  connectorLinked: {
    backgroundColor: GREEN,
  },
  actionText: {
    marginLeft: 16,
    paddingVertical: 8,
    paddingBottom: 18,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
});

export default SessionKeyStep2;
