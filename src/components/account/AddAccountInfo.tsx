import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Formik } from 'formik';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import * as Yup from 'yup';

import { RoundBackButton, SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import { PillField, PillInput } from '@/src/components/shared/PillField';
import Text from '@/src/components/shared/Text';

const PROFILE_ADD = require('@/src/assets/images/multisig/profile-add.svg');

interface AddAccountInfoProps {
  defaultName: string;
  /** Omit to hide the header back button (e.g. when account creation is mandatory). */
  onBack?: () => void;
  onSubmit: (name: string, image: string | null) => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  /** Optional ghost button rendered under the primary action. */
  secondaryAction?: { label: string; onPress: () => void; disabled?: boolean };
}

const AddAccountInfoSchema = Yup.object().shape({
  walletName: Yup.string().trim().required('Account name is required'),
});

const AddAccountInfo = ({
  defaultName,
  onBack,
  onSubmit,
  isSubmitting,
  errorMessage,
  secondaryAction,
}: AddAccountInfoProps) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const handleImagePick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.3,
      base64: true,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setSelectedImage(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
    }
  };

  return (
    <Box flex={1} paddingBottom="m">
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" style={styles.header}>
        {onBack ? <RoundBackButton onPress={onBack} /> : <Box width={40} />}
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Create Account
        </Text>
        <Box width={40} />
      </Box>

      <Formik
        initialValues={{ walletName: '' }}
        validationSchema={AddAccountInfoSchema}
        onSubmit={(values) => onSubmit(values.walletName.trim() || defaultName, selectedImage)}
      >
        {({ handleChange, handleBlur, handleSubmit, values, errors, touched }) => (
          <Box flex={1} justifyContent="space-between" style={styles.body}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={selectedImage ? 'Change profile picture' : 'Add profile picture'}
                activeOpacity={0.8}
                onPress={handleImagePick}
              >
                <Box
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="inputBox"
                  borderColor="inputOutline"
                  borderWidth={1}
                  style={styles.avatarCard}
                >
                  {selectedImage ? (
                    <Image source={{ uri: selectedImage }} contentFit="cover" style={styles.avatar} />
                  ) : (
                    <Image source={PROFILE_ADD} contentFit="contain" style={styles.avatar} />
                  )}
                </Box>
              </TouchableOpacity>

              <Box style={styles.field}>
                <PillField
                  label="Account Name"
                  error={touched.walletName ? errors.walletName : undefined}
                >
                  <PillInput
                    placeholder="e.g. Savings, Trading, Daily Use"
                    value={values.walletName}
                    onChangeText={handleChange('walletName')}
                    onBlur={handleBlur('walletName')}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={() => handleSubmit()}
                  />
                </PillField>
              </Box>
            </ScrollView>

            <Box gap="sm">
              {errorMessage ? (
                <Text fontSize={12} lineHeight={18} color="inputError" textAlign="center">
                  {errorMessage}
                </Text>
              ) : null}
              <SetupButton
                label={isSubmitting ? 'Creating…' : 'Continue'}
                onPress={() => handleSubmit()}
                disabled={!values.walletName.trim() || isSubmitting}
              />
              {secondaryAction && (
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  onPress={secondaryAction.onPress}
                  disabled={secondaryAction.disabled}
                  style={[styles.secondary, secondaryAction.disabled && styles.disabled]}
                >
                  <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textSubheading">
                    {secondaryAction.label}
                  </Text>
                </TouchableOpacity>
              )}
            </Box>
          </Box>
        )}
      </Formik>
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    marginTop: 23,
    paddingHorizontal: 24,
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 30,
  },
  avatarCard: {
    height: 92,
    borderRadius: 16,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  field: {
    marginTop: 26,
  },
  secondary: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});

export default AddAccountInfo;
