import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Formik } from 'formik';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Toast from 'react-native-toast-message';
import * as Yup from 'yup';

import ProfileImageSection from '@/src/components/profile/ProfileImageSection';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const AccountInfoSchema = Yup.object().shape({
  walletName: Yup.string().required('Wallet name is required'),
});

const AccountInfoSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { accounts, activeAccountIndex, renameAccount, setAccountImage, avatars } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const activeAvatar = activeAccount ? (avatars[activeAccount.publicKeyHex] ?? null) : null;

  const [selectedImage, setSelectedImage] = useState<string | null>(activeAvatar);

  useEffect(() => {
    if (visible) setSelectedImage(activeAvatar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const initialValues = {
    walletName: activeAccount?.name || '',
    address: activeAccount?.smartAccountAddress || activeAccount?.gAddress || '',
  };

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

  const handleSave = async (values: any) => {
    try {
      await renameAccount(activeAccountIndex, values.walletName);
      await setAccountImage(activeAccountIndex, selectedImage);

      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Account information updated',
      });

      onClose();
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update account information',
      });
    }
  };

  if (!activeAccount && visible) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      keyboardBehavior="extend"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          paddingHorizontal="m"
          py="m"
        >
          <Text variant="h9" color="textPrimary" fontWeight="700">
            Account Information
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </Box>
      }
      contentContainerStyle={{ flex: 1 }}
    >
      <Formik
        initialValues={initialValues}
        validationSchema={AccountInfoSchema}
        onSubmit={handleSave}
        enableReinitialize
      >
        {({ handleChange, handleBlur, handleSubmit, values, errors, touched, dirty }) => {
          const canSave = dirty || selectedImage !== activeAvatar;

          return (
            <View style={{ flex: 1 }}>
              <KeyboardAwareScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                bounces={false}
                bottomOffset={16}
              >
                <ProfileImageSection
                  imageSource={
                    selectedImage
                      ? { uri: selectedImage }
                      : require('@/src/assets/token/user.png')
                  }
                  onChangePress={handleImagePick}
                />

                <Box mb="l">
                  <Text variant="h10" color="textPrimary" mb="s" fontWeight="700">
                    Wallet Name
                  </Text>
                  <Input
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

                <Box mb="l">
                  <Text variant="h10" color="textPrimary" mb="s" fontWeight="700">
                    Smart Account Address
                  </Text>
                  <Box
                    backgroundColor="bg11"
                    borderRadius={14}
                    padding="m"
                    borderWidth={1}
                    borderColor="gray800"
                    minHeight={60}
                  >
                    <Text variant="h11" color="textPrimary" lineHeight={22}>
                      {values.address}
                    </Text>
                  </Box>
                </Box>
              </KeyboardAwareScrollView>

              <Box padding="m">
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => handleSubmit()}
                  disabled={!canSave}
                >
                  <Box
                    height={64}
                    backgroundColor={canSave ? 'primary700' : 'bg11'}
                    borderRadius={32}
                    justifyContent="center"
                    alignItems="center"
                    style={{ opacity: canSave ? 1 : 0.6 }}
                  >
                    <Text
                      variant="h10"
                      color={canSave ? 'black' : 'textSecondary'}
                      fontWeight="700"
                    >
                      Save Changes
                    </Text>
                  </Box>
                </TouchableOpacity>
              </Box>
            </View>
          );
        }}
      </Formik>
    </BottomSheet>
  );
};

export default AccountInfoSheet;
