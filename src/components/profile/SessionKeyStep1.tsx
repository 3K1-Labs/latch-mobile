import React from 'react';
import { StyleSheet } from 'react-native';

import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import { PillField, PillInput } from '@/src/components/shared/PillField';
import Text from '@/src/components/shared/Text';

interface Props {
  values: { name: string };
  errors: { name?: string };
  touched: { name?: boolean };
  setFieldValue: (field: string, value: any) => void;
  onNext: () => void;
}

const SessionKeyStep1 = ({ values, errors, touched, setFieldValue, onNext }: Props) => {
  const isEnabled = values.name.trim().length > 0;

  return (
    <Box flex={1} justifyContent="space-between" style={styles.body}>
      <Box gap="l">
        <Box
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          gap="xs"
          style={styles.card}
        >
          <Text fontSize={18} lineHeight={26} color="textPrimary">
            What is a Session Key?
          </Text>
          <Text fontSize={14} lineHeight={26} color="textMuted">
            Instead of giving an app full control, you create a temporary key that can only do exactly
            what you allow it to do. It automatically expires.
          </Text>
        </Box>

        <PillField label="Session Name" error={touched.name ? errors.name : undefined}>
          <PillInput
            placeholder="e.g., My trading bot"
            value={values.name}
            onChangeText={(text) => setFieldValue('name', text)}
            returnKeyType="next"
            onSubmitEditing={() => isEnabled && onNext()}
          />
        </PillField>
      </Box>

      <SetupButton label="Continue" onPress={onNext} disabled={!isEnabled} />
    </Box>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 24,
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
});

export default SessionKeyStep1;
