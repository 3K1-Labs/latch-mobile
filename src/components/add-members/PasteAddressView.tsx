import PopupHeader from '@/src/components/multisig/PopupHeader';
import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import { PillField, PillInput } from '@/src/components/shared/PillField';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Formik } from 'formik';
import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import * as Yup from 'yup';

const PASTE = require('@/src/assets/images/send/paste.svg');

const schema = Yup.object().shape({
  name: Yup.string().trim().required('Owner name is required'),
  address: Yup.string()
    .trim()
    .required('Wallet address is required')
    .matches(/^C[A-Z2-7]{55}$/, 'Enter a valid Stellar smart account C-address'),
});

interface PasteAddressViewProps {
  onClose: () => void;
  onAdd: (name: string, address: string) => void;
}

/** "Owner Details": a name and the owner's smart-account C-address. */
const PasteAddressView: React.FC<PasteAddressViewProps> = ({ onClose, onAdd }) => (
  <Formik
    initialValues={{ name: '', address: '' }}
    validationSchema={schema}
    onSubmit={(values) => onAdd(values.name.trim(), values.address.trim())}
  >
    {({ handleChange, handleBlur, handleSubmit, setFieldValue, values, errors, touched }) => (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false}>
        <PopupHeader title="Owner Details" onClose={onClose} />

        <Box style={styles.fields}>
          <PillField label="Owner Name" error={touched.name ? errors.name : undefined}>
            <PillInput
              placeholder="e.g., Crownz"
              value={values.name}
              onChangeText={handleChange('name')}
              onBlur={handleBlur('name')}
              autoCapitalize="words"
            />
          </PillField>

          <PillField label="Wallet Address" error={touched.address ? errors.address : undefined}>
            <PillInput
              placeholder="C..."
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
          </PillField>
        </Box>

        <SetupButton
          label="Add"
          disabled={!values.name.trim() || !values.address.trim()}
          onPress={() => handleSubmit()}
        />
      </ScrollView>
    )}
  </Formik>
);

const styles = StyleSheet.create({
  fields: {
    gap: 12,
    marginTop: 32,
    marginBottom: 24,
  },
  pasteIcon: {
    width: 16,
    height: 16,
  },
});

export default PasteAddressView;
