import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Formik, FormikHelpers } from 'formik';
import React from 'react';
import { StyleSheet, TextInput, TextInputProps, TouchableOpacity } from 'react-native';
import * as Yup from 'yup';

const PASTE = require('@/src/assets/images/send/paste.svg');

const AddressBookSchema = Yup.object().shape({
  label: Yup.string().trim().required('Give this address a label'),
  address: Yup.string()
    .trim()
    .required('Enter a wallet address')
    .test(
      'stellar-address',
      'Enter a valid Stellar G-address or C-address',
      (value) => StrKey.isValidEd25519PublicKey(value ?? '') || StrKey.isValidContract(value ?? ''),
    ),
});

export type AddressBookValues = { label: string; address: string };

interface AddressBookFormProps {
  onSubmit: (values: AddressBookValues, helpers: FormikHelpers<AddressBookValues>) => void;
  initialAddress?: string;
  initialLabel?: string;
  isEditing?: boolean;
}

const Field = ({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) => (
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

const FieldInput = (props: TextInputProps) => {
  const theme = useTheme<Theme>();
  return (
    <TextInput
      placeholderTextColor={theme.colors.textSubheading}
      autoCorrect={false}
      {...props}
      style={styles.input}
    />
  );
};

const AddressBookForm = ({
  onSubmit,
  initialAddress,
  initialLabel,
  isEditing,
}: AddressBookFormProps) => (
  <Formik<AddressBookValues>
    initialValues={{ label: initialLabel ?? '', address: initialAddress ?? '' }}
    validationSchema={AddressBookSchema}
    validateOnMount={!!initialAddress}
    onSubmit={onSubmit}
  >
    {({ handleChange, handleBlur, handleSubmit, values, setFieldValue, errors, touched, isValid, dirty, isSubmitting }) => {
      const canSave = isValid && (dirty || !!initialAddress) && !isSubmitting;
      return (
        <Box flex={1} style={styles.body}>
          <Box style={styles.fields}>
            {/* Latch only stores Stellar addresses, so the network is fixed. */}
            <Field label="Network">
              <Text flex={1} fontSize={16} lineHeight={24} color="textPrimary">
                Stellar
              </Text>
            </Field>

            <Field label="Label" error={touched.label ? errors.label : undefined}>
              <FieldInput
                placeholder="Label your address"
                value={values.label}
                onChangeText={handleChange('label')}
                onBlur={handleBlur('label')}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </Field>

            <Field label="Wallet Address" error={touched.address ? errors.address : undefined}>
              <FieldInput
                placeholder="Input an address"
                value={values.address}
                onChangeText={handleChange('address')}
                onBlur={handleBlur('address')}
                autoCapitalize="characters"
              />
              {!values.address && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Paste address"
                  hitSlop={10}
                  onPress={async () => {
                    const text = (await Clipboard.getStringAsync()).trim();
                    if (text) setFieldValue('address', text, true);
                  }}
                >
                  <Image source={PASTE} contentFit="contain" style={styles.pasteIcon} />
                </TouchableOpacity>
              )}
            </Field>
          </Box>

          <SetupButton
            label={isEditing ? 'Save Changes' : 'Save Address'}
            onPress={() => handleSubmit()}
            disabled={!canSave}
          />
        </Box>
      );
    }}
  </Formik>
);

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  fields: {
    gap: 16,
  },
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
    color: '#FFFFFF',
  },
  pasteIcon: {
    width: 16,
    height: 16,
  },
  error: {
    marginTop: -4,
    paddingHorizontal: 8,
  },
});

export default AddressBookForm;
