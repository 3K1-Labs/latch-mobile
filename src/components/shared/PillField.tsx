import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';

interface PillFieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}

/** Label above a 48pt rounded input box, with an optional error line below. */
export const PillField = ({ label, error, children }: PillFieldProps) => (
  <Box style={styles.field}>
    <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textSubheading">
      {label}
    </Text>
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor="inputBox"
      borderColor={error ? 'inputError' : 'inputOutline'}
      borderWidth={1}
      borderRadius={40}
      style={styles.box}
    >
      {children}
    </Box>
    {error ? (
      <Text fontSize={12} lineHeight={18} color="inputError" style={styles.error}>
        {error}
      </Text>
    ) : null}
  </Box>
);

export const PillInput = ({ style, ...props }: TextInputProps) => {
  const theme = useTheme<Theme>();
  return (
    <TextInput
      placeholderTextColor={theme.colors.textSubheading}
      autoCorrect={false}
      {...props}
      style={[styles.input, { color: theme.colors.textPrimary }, style]}
    />
  );
};

const styles = StyleSheet.create({
  field: {
    gap: 12,
  },
  box: {
    height: 48,
    paddingHorizontal: 20,
    gap: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    // Keeps the bundled SF Pro vertically centred in an iOS TextInput.
    lineHeight: 20,
    fontFamily: 'SFproRegular',
  },
  error: {
    marginTop: -4,
    paddingHorizontal: 8,
  },
});
