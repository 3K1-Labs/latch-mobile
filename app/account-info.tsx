import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Formik } from 'formik';
import React, { useState } from 'react';
import {
  ImageSourcePropType,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Yup from 'yup';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { avatarKey, useWalletStore } from '@/src/store/wallet';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';

const ICONS = {
  mascot: require('@/src/assets/images/profile/mascot-grey.svg'),
  plus: require('@/src/assets/images/profile/plus.svg'),
  person: require('@/src/assets/images/profile/person.svg'),
  smartKey: require('@/src/assets/images/profile/smart-key.svg'),
  editChip: require('@/src/assets/images/profile/edit-chip.svg'),
  copy: require('@/src/assets/images/profile/copy.svg'),
};
const ICON_GREEN = '#8BB101';

const NameSchema = Yup.object().shape({
  walletName: Yup.string().trim().required('Name is required'),
});

const InfoCard = ({
  icon,
  iconSize,
  label,
  children,
  action,
}: {
  icon: ImageSourcePropType;
  iconSize: { width: number; height: number };
  label: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) => (
  <Box
    flexDirection="row"
    alignItems="flex-start"
    gap="sm"
    backgroundColor="inputBox"
    borderRadius={16}
    style={styles.card}
  >
    <Box
      width={24}
      height={24}
      borderRadius={12}
      backgroundColor="inputOutline"
      justifyContent="center"
      alignItems="center"
    >
      <Image source={icon} contentFit="contain" style={iconSize} />
    </Box>
    <Box flex={1} gap="xs">
      <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
        {label}
      </Text>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="sm">
        <Box flex={1}>{children}</Box>
        {action}
      </Box>
    </Box>
  </Box>
);

const AccountInfo = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accounts, activeAccountIndex, renameAccount, setAccountImage, avatars } =
    useWalletStore();
  const [editing, setEditing] = useState(false);

  const activeAccount = accounts[activeAccountIndex];
  if (!activeAccount) return null;

  const avatar = avatars[avatarKey(activeAccount)] ?? null;
  const address = activeAccount.smartAccountAddress || activeAccount.gAddress || '';

  const handleImagePick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.3,
      base64: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const dataUri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
    try {
      await setAccountImage(activeAccountIndex, dataUri);
      Toast.show({ type: 'success', text1: 'Profile photo updated' });
    } catch {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update profile photo' });
    }
  };

  const handleRename = async ({ walletName }: { walletName: string }) => {
    const name = walletName.trim();
    if (name === activeAccount.name) {
      setEditing(false);
      return;
    }
    try {
      await renameAccount(activeAccountIndex, name);
      setEditing(false);
      Toast.show({ type: 'success', text1: 'Name updated' });
    } catch {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update name' });
    }
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />

      <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
        <RoundBackButton onPress={() => router.back()} style={styles.back} />
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Profile
        </Text>
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <Box alignSelf="center" style={styles.avatarWrap}>
          <Box backgroundColor="inputOutline" style={styles.avatar}>
            {avatar ? (
              <Image source={{ uri: avatar }} contentFit="cover" style={StyleSheet.absoluteFill} />
            ) : (
              <Image source={ICONS.mascot} contentFit="contain" style={styles.mascot} />
            )}
          </Box>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            activeOpacity={0.8}
            hitSlop={8}
            onPress={handleImagePick}
            style={styles.plus}
          >
            <Image source={ICONS.plus} contentFit="contain" style={styles.plusIcon} />
          </TouchableOpacity>
        </Box>

        <Box gap="sm">
          <Formik
            initialValues={{ walletName: activeAccount.name || '' }}
            validationSchema={NameSchema}
            onSubmit={handleRename}
            enableReinitialize
          >
            {({ values, errors, handleChange, handleSubmit, resetForm, isSubmitting }) => (
              <InfoCard
                icon={ICONS.person}
                iconSize={styles.personIcon}
                label="Full Name"
                action={
                  editing ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Save name"
                      activeOpacity={0.7}
                      hitSlop={8}
                      disabled={isSubmitting}
                      onPress={() => handleSubmit()}
                      style={styles.chip}
                    >
                      <Ionicons name="checkmark" size={18} color={ICON_GREEN} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Edit name"
                      activeOpacity={0.7}
                      hitSlop={8}
                      onPress={() => {
                        resetForm();
                        setEditing(true);
                      }}
                    >
                      <Image source={ICONS.editChip} contentFit="contain" style={styles.chipSize} />
                    </TouchableOpacity>
                  )
                }
              >
                {editing ? (
                  <>
                    <TextInput
                      value={values.walletName}
                      onChangeText={handleChange('walletName')}
                      onSubmitEditing={() => handleSubmit()}
                      autoFocus
                      autoCorrect={false}
                      returnKeyType="done"
                      maxLength={32}
                      style={styles.nameInput}
                    />
                    {errors.walletName && (
                      <Text fontSize={12} lineHeight={18} color="inputError">
                        {errors.walletName}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text
                    fontSize={18}
                    lineHeight={26}
                    fontFamily="SFproMedium"
                    color="textPrimary"
                    numberOfLines={1}
                  >
                    {activeAccount.name}
                  </Text>
                )}
              </InfoCard>
            )}
          </Formik>

          <InfoCard
            icon={ICONS.smartKey}
            iconSize={styles.keyIcon}
            label="Smart Account Address"
            action={
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Copy address"
                activeOpacity={0.7}
                hitSlop={8}
                onPress={() => address && copyToClipboard(address)}
                style={styles.chip}
              >
                <Image source={ICONS.copy} contentFit="contain" style={styles.copyIcon} />
              </TouchableOpacity>
            }
          >
            <Text
              fontSize={18}
              lineHeight={26}
              fontFamily="SFproMedium"
              color="textPrimary"
              numberOfLines={1}
            >
              {shortenAddress(address)}
            </Text>
          </InfoCard>
        </Box>
      </ScrollView>
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 64,
    marginTop: 4,
    paddingHorizontal: 24,
  },
  back: {
    position: 'absolute',
    left: 24,
  },
  content: {
    paddingHorizontal: 24,
  },
  avatarWrap: {
    width: 124,
    height: 124,
    marginTop: 40,
    marginBottom: 69,
  },
  avatar: {
    width: 124,
    height: 124,
    borderRadius: 62,
    overflow: 'hidden',
  },
  mascot: {
    position: 'absolute',
    left: 62 - 17.03 - 123.938 / 2,
    top: 17,
    width: 123.938,
    height: 130,
  },
  plus: {
    position: 'absolute',
    left: 93,
    top: 96,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFC508',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIcon: {
    width: 21,
    height: 21,
  },
  card: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  personIcon: {
    width: 18,
    height: 18,
  },
  keyIcon: {
    width: 17.39,
    height: 15.56,
  },
  chip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(241,246,225,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSize: {
    width: 28,
    height: 28,
  },
  copyIcon: {
    width: 15.75,
    height: 15.75,
  },
  nameInput: {
    height: 26,
    padding: 0,
    fontSize: 18,
    // Keeps the bundled SF Pro vertically centred in an iOS TextInput.
    lineHeight: 22,
    fontFamily: 'SFproMedium',
    color: '#FFFFFF',
  },
});

export default AccountInfo;
