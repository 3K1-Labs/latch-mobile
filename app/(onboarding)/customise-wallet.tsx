import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import {
  RoundBackButton,
  SetupButton,
  SetupTitle,
  StepIndicator,
} from '@/src/components/onboarding/SetupChrome';
import WalletCard from '@/src/components/onboarding/WalletCard';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { savePendingAppearance, WALLET_COLORS } from '@/src/lib/wallet-customisation';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Formik } from 'formik';
import React from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Yup from 'yup';

const schema = Yup.object({
  name: Yup.string().trim().max(24, 'Use 24 characters or fewer').required('Enter a wallet name'),
});

const initialValues: { name: string; image: string | null; color: string | null } = {
  name: '',
  image: null,
  color: null,
};

const pickImage = async () => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.3,
    base64: true,
  });
  const asset = result.canceled ? null : result.assets[0];
  return asset?.base64 ? `data:image/jpeg;base64,${asset.base64}` : null;
};

const CustomiseWallet = () => {
  const router = useRouter();
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />
      <Formik
        initialValues={initialValues}
        validationSchema={schema}
        onSubmit={async (values) => {
          await savePendingAppearance({ ...values, name: values.name.trim() });
          router.push({ pathname: '/(onboarding)/set-pin', params: { from: 'new-wallet' } });
        }}
      >
        {({ values, errors, touched, handleChange, handleBlur, handleSubmit, setFieldValue }) => (
          <KeyboardAwareScrollView
            bottomOffset={16}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.l,
              paddingTop: insets.top + 12,
              paddingBottom: Math.max(insets.bottom, 24),
            }}
          >
            <RoundBackButton onPress={() => router.canGoBack() && router.back()} />

            <Box style={styles.step}>
              <StepIndicator step={1} />
            </Box>
            <Box style={styles.title}>
              <SetupTitle title="Customise Wallet">
                Select how you want your wallet to look.
              </SetupTitle>
            </Box>

            <Box
              style={styles.preview}
              backgroundColor="inputBox"
              borderWidth={1}
              borderColor="inputOutline"
              borderRadius={28}
              p="m"
            >
              <Box alignSelf="flex-end" style={styles.previewChip} backgroundColor="inputOutline">
                <Text variant="p8" letterSpacing={0} color="textSubheading">
                  Wallet Preview
                </Text>
                <Ionicons
                  name="close-circle-outline"
                  size={14}
                  color={theme.colors.textSubheading}
                />
              </Box>
              <Box style={styles.previewCard}>
                <WalletCard
                  color={values.color}
                  name={values.name.trim() || 'Your Name'}
                  image={values.image}
                  address="Yourwalletaddress"
                  addressColor={values.color ? '#FFFFFF' : '#706F6F'}
                />
              </Box>
            </Box>

            <Box style={styles.addImage}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text style={styles.label}>Add Image</Text>
                <Text variant="p7" lineHeight={22} letterSpacing={0} color="textMuted">
                  (Optional)
                </Text>
              </Box>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add wallet image"
                style={styles.picker}
                onPress={async () => {
                  const image = await pickImage();
                  if (image) setFieldValue('image', image);
                }}
              >
                <Box
                  width={140}
                  height={140}
                  borderRadius={70}
                  overflow="hidden"
                  backgroundColor="inputOutline"
                >
                  {values.image && (
                    <Image source={{ uri: values.image }} contentFit="cover" style={styles.fill} />
                  )}
                </Box>
                <Box style={styles.plusRing} backgroundColor="surfaceBase">
                  <Box style={styles.plus} backgroundColor="inputBox">
                    <Ionicons name="add" size={28} color="#FFFFFF" />
                  </Box>
                </Box>
              </Pressable>
            </Box>

            <Box style={styles.section}>
              <Text style={styles.label}>Name Wallet</Text>
              <Box style={styles.input} backgroundColor="inputBox">
                <Ionicons name="person-outline" size={16} color={theme.colors.textMuted} />
                <TextInput
                  value={values.name}
                  onChangeText={handleChange('name')}
                  onBlur={handleBlur('name')}
                  placeholder="Enter a Username"
                  placeholderTextColor={theme.colors.textMuted}
                  maxLength={24}
                  autoCorrect={false}
                  returnKeyType="done"
                  style={[styles.inputText, values.name ? styles.value : styles.placeholder]}
                />
              </Box>
              {touched.name && errors.name ? (
                <Text variant="p7" color="danger900" mt="xs">
                  {errors.name}
                </Text>
              ) : null}
            </Box>

            <Box style={styles.section}>
              <Text style={styles.label}>Choose a Color</Text>
              <Box flexDirection="row" justifyContent="space-between" style={styles.colors}>
                {WALLET_COLORS.map((color) => {
                  const selected = values.color === color;
                  return (
                    <Pressable
                      key={color}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Wallet colour ${color}`}
                      onPress={() => setFieldValue('color', color)}
                    >
                      <Box
                        style={[
                          styles.swatch,
                          selected && styles.swatchSelected,
                          { backgroundColor: color },
                        ]}
                      />
                      {selected && (
                        <Box style={styles.check} backgroundColor="inputOutline">
                          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                        </Box>
                      )}
                    </Pressable>
                  );
                })}
              </Box>
            </Box>

            <SetupButton label="Continue" onPress={() => handleSubmit()} style={styles.continue} />
          </KeyboardAwareScrollView>
        )}
      </Formik>
    </Box>
  );
};

const styles = StyleSheet.create({
  step: {
    marginTop: 56,
  },
  title: {
    marginTop: 32,
  },
  preview: {
    marginTop: 38,
  },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
  },
  previewCard: {
    marginTop: 15,
  },
  addImage: {
    marginTop: 72,
  },
  section: {
    marginTop: 36,
  },
  continue: {
    marginTop: 70,
  },
  label: {
    fontFamily: 'SFproMedium',
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: -0.65,
    color: '#FFFFFF',
  },
  picker: {
    width: 148,
    marginTop: 12,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  plusRing: {
    position: 'absolute',
    left: 107,
    top: 92,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    marginTop: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
  },
  inputText: {
    flex: 1,
    padding: 0,
    fontFamily: 'SFproRegular',
  },
  placeholder: {
    fontSize: 14,
  },
  value: {
    fontSize: 16,
    color: '#706F6F',
  },
  colors: {
    marginTop: 16,
  },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#1A1A1A',
  },
  check: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CustomiseWallet;
