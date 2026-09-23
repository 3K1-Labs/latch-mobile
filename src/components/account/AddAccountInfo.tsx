import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as ImagePicker from 'expo-image-picker';
import { Formik } from 'formik';
import React, { useState } from 'react';
import { Image, ScrollView, TouchableOpacity } from 'react-native';
import * as Yup from 'yup';

import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

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
  walletName: Yup.string().required('Account name is required'),
});

const AddAccountInfo = ({
  defaultName,
  onBack,
  onSubmit,
  isSubmitting,
  errorMessage,
  secondaryAction,
}: AddAccountInfoProps) => {
  const theme = useTheme<Theme>();
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
      const dataUri = asset.base64
        ? `data:image/jpeg;base64,${asset.base64}`
        : asset.uri;
      setSelectedImage(dataUri);
    }
  };

  return (
    <Box flex={1} paddingHorizontal="m" paddingBottom="xl">
      {/* Header */}
      <Box
        flexDirection={'row'}
        alignItems="center"
        justifyContent="space-between"
        py="m"
        mt={'s'}
        mb="l"
      >
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <Box width={40} />
        )}

        <Text variant="h10" color="textPrimary" fontWeight="800">
          Create Account
        </Text>
        <Box width={40} />
      </Box>

      <Formik
        initialValues={{ walletName: '' }}
        validationSchema={AddAccountInfoSchema}
        onSubmit={(values) => onSubmit(values.walletName || defaultName, selectedImage)}
      >
        {({ handleChange, handleBlur, handleSubmit, values, errors, touched }) => (
          <Box flex={1} justifyContent="space-between">
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {/* Profile Picture Card */}
              <TouchableOpacity activeOpacity={0.8} onPress={handleImagePick}>
                <Box
                  backgroundColor="bg11"
                  borderRadius={24}
                  paddingVertical="xl"
                  alignItems="center"
                  justifyContent="center"
                  mb="xl"
                >
                  <Box
                    width={56}
                    height={56}
                    borderRadius={28}
                    backgroundColor="gray900"
                    justifyContent="center"
                    alignItems="center"
                    mb="m"
                    overflow="hidden"
                  >
                    {selectedImage ? (
                      <Image
                        source={{ uri: selectedImage }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    ) : (
                      <Ionicons name="person-add-outline" size={24} color={theme.colors.gray500} />
                    )}
                  </Box>
                  <Text variant="h11" color="primary700" fontWeight="700">
                    Add Profile Picture
                  </Text>
                </Box>
              </TouchableOpacity>

              {/* Account Name Section */}
              <Box>
                <Text variant="h9" color="textPrimary" mb="m" fontWeight="700">
                  Account Name
                </Text>
                <Input
                  placeholder="e.g. Savings, Trading, Daily Use"
                  value={values.walletName}
                  onChangeText={handleChange('walletName')}
                  onBlur={handleBlur('walletName')}
                  status={touched.walletName && errors.walletName ? 'danger' : 'basic'}
                />
                {touched.walletName && errors.walletName && (
                  <Text variant="h12" color="inputError" mt="xs">
                    {errors.walletName}
                  </Text>
                )}
              </Box>
            </ScrollView>

            {/* Bottom Button */}
            <Box>
              {errorMessage && (
                <Text variant="h12" color="inputError" mb="m" textAlign="center">
                  {errorMessage}
                </Text>
              )}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => handleSubmit()}
                disabled={isSubmitting}
              >
                <Box
                  height={64}
                  backgroundColor="primary"
                  borderRadius={32}
                  justifyContent="center"
                  alignItems="center"
                  style={{ opacity: isSubmitting ? 0.6 : 1 }}
                >
                  <Text variant="h10" color="black" fontWeight="700">
                    {isSubmitting ? 'Creating...' : 'Create Smart Account'}
                  </Text>
                </Box>
              </TouchableOpacity>

              {secondaryAction && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={secondaryAction.onPress}
                  disabled={secondaryAction.disabled}
                  style={{ marginTop: 12 }}
                >
                  <Box height={52} justifyContent="center" alignItems="center">
                    <Text
                      variant="h11"
                      color="textSecondary"
                      fontWeight="700"
                      style={{ opacity: secondaryAction.disabled ? 0.5 : 1 }}
                    >
                      {secondaryAction.label}
                    </Text>
                  </Box>
                </TouchableOpacity>
              )}
            </Box>
          </Box>
        )}
      </Formik>
    </Box>
  );
};

export default AddAccountInfo;
