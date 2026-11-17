import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { Formik } from 'formik';
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Yup from 'yup';

const Schema = Yup.object().shape({
  name: Yup.string().max(24, 'Name is too long'),
});

interface Props {
  visible: boolean;
  /** Truncated address/key shown as context for which signer is being named. */
  signerLabel: string;
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet editor for a co-signer's local nickname. Saving an empty value
 * clears the nickname (falls back to the address). Formik-backed per project
 * form conventions.
 */
const NicknameModal: React.FC<Props> = ({ visible, signerLabel, initialName, onSave, onClose }) => (
  <Modal
    visible={visible}
    transparent
    animationType="slide"
    statusBarTranslucent
    onRequestClose={onClose}
  >
    <View style={styles.overlay}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <Box
          backgroundColor="sheetBg"
          borderTopLeftRadius={32}
          borderTopRightRadius={32}
          paddingHorizontal="m"
          pb="xxl"
        >
          <Box alignItems="center" pt="m" mb="l">
            <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
          </Box>

          <Text variant="h8" color="textPrimary" fontWeight="700" textAlign="center" mb="s">
            Name this owner
          </Text>
          <Text variant="h12" color="textSecondary" textAlign="center" mb="xl">
            {signerLabel}
          </Text>

          <Formik
            initialValues={{ name: initialName }}
            enableReinitialize
            validationSchema={Schema}
            onSubmit={(values) => onSave(values.name.trim())}
          >
            {({ handleChange, handleBlur, handleSubmit, values, errors, touched }) => (
              <>
                <Input
                  value={values.name}
                  onChangeText={handleChange('name')}
                  onBlur={handleBlur('name')}
                  placeholder="e.g. Crownz"
                  autoFocus
                  status={touched.name && errors.name ? 'danger' : 'basic'}
                />
                {touched.name && errors.name && (
                  <Text variant="h12" color="inputError" mt="xs">
                    {errors.name}
                  </Text>
                )}

                <Button
                  label="Save"
                  variant="primary"
                  onPress={() => handleSubmit()}
                  mt="l"
                  mb="m"
                />
                <Button label="Cancel" variant="ghost" onPress={onClose} />
              </>
            )}
          </Formik>
        </Box>
      </KeyboardAwareScrollView>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});

export default NicknameModal;
