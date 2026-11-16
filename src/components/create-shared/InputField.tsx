import { PillField, PillInput } from '@/src/components/shared/PillField';
import Box from '@/src/components/shared/Box';
import React from 'react';
import { TextInputProps } from 'react-native';

interface InputFieldProps extends TextInputProps {
  label: string;
  isOptional?: boolean;
  status?: 'danger' | 'basic';
  error?: string;
  rightElement?: React.ReactNode;
}

const InputField: React.FC<InputFieldProps> = ({
  label,
  isOptional = false,
  status: _status,
  error,
  rightElement,
  style: _style,
  ...props
}) => (
  <Box width="100%" mb="m">
    <PillField label={isOptional ? `${label} (optional)` : label} error={error}>
      <PillInput {...props} />
      {rightElement}
    </PillField>
  </Box>
);

export default InputField;
