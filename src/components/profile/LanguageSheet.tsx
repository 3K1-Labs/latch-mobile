import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { useLocale } from '@/src/hooks/use-locale';
import { SUPPORTED_LOCALES, SupportedLocale } from '@/src/i18n/i18n';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const LanguageSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();
  const { locale, setLocale, t } = useLocale();

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 90,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const handleClose = () => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const handleSelect = async (code: SupportedLocale) => {
    if (code === locale) return;
    await setLocale(code);
    // Close after a short delay so the user sees the selection confirm.
    setTimeout(handleClose, 150);
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [{ translateY }],
            height: SHEET_HEIGHT,
          },
        ]}
      >
        <BottomSheetHandle />

        {/* Header */}
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="m"
          py="m"
          mb="m"
        >
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          <Text variant="h10" color="textPrimary" fontWeight="700">
            {t('languageSheet.title')}
          </Text>

          <Box width={40} />
        </Box>

        {/* Subtitle */}
        <Box paddingHorizontal="m" mb="m">
          <Text variant="p8" color="textSecondary">
            {t('languageSheet.subtitle')}
          </Text>
        </Box>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}>
          {SUPPORTED_LOCALES.map((code) => (
            <TouchableOpacity
              key={code}
              activeOpacity={0.7}
              onPress={() => void handleSelect(code)}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                backgroundColor="bg11"
                borderRadius={16}
                padding="m"
                mb="s"
                borderWidth={1}
                borderColor={locale === code ? 'primary' : 'transparent'}
              >
                {/* Language icon placeholder */}
                <Box
                  width={36}
                  height={36}
                  borderRadius={10}
                  style={{ backgroundColor: isDark ? '#1E1E1E' : theme.colors.gray200 }}
                  justifyContent="center"
                  alignItems="center"
                  mr="m"
                >
                  <Ionicons name="language-outline" size={20} color={theme.colors.textPrimary} />
                </Box>

                <Box flex={1}>
                  <Text variant="h11" color="textPrimary" fontWeight="700">
                    {t(`languageSheet.languages.${code}`)}
                  </Text>
                  <Text variant="p8" color="textSecondary" mt="xs">
                    {/* Native name (always in the target language) */}
                    {NATIVE_NAMES[code]}
                  </Text>
                </Box>

                {locale === code && (
                  <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                )}
              </Box>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

/**
 * The name of each language written in that language itself (so a Spanish
 * speaker always recognises their option even if the UI is currently in
 * English).
 */
const NATIVE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    width: '100%',
    position: 'absolute',
    bottom: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default LanguageSheet;
