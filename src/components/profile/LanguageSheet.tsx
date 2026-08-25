import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TouchableOpacity } from 'react-native';

import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { changeLanguage, getCurrentLanguage, SUPPORTED_LANGUAGES, type LanguageCode } from '@/src/i18n/i18n';
import { Theme } from '@/src/theme/theme';

interface LanguageSheetProps {
  visible: boolean;
  onClose: () => void;
}

const LanguageSheet = ({ visible, onClose }: LanguageSheetProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(getCurrentLanguage());
  const [isChanging, setIsChanging] = useState(false);

  const handleLanguageSelect = async (languageCode: LanguageCode) => {
    if (languageCode === selectedLanguage || isChanging) return;

    setIsChanging(true);
    try {
      await changeLanguage(languageCode);
      setSelectedLanguage(languageCode);
      // Give the UI a moment to update before closing
      setTimeout(() => {
        setIsChanging(false);
        onClose();
      }, 300);
    } catch (error) {
      console.error('Failed to change language:', error);
      setIsChanging(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoints={['50%']} scrollable>
      <Box flex={1} paddingHorizontal="m">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" mb="l">
          <Text variant="h7" color="textPrimary">
            {t('profile.settings.language')}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </Box>

        <Box>
          {SUPPORTED_LANGUAGES.map((language) => {
            const isSelected = language.code === selectedLanguage;

            return (
              <TouchableOpacity
                key={language.code}
                onPress={() => handleLanguageSelect(language.code)}
                disabled={isChanging}
                activeOpacity={0.7}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  paddingVertical="m"
                  paddingHorizontal="m"
                  backgroundColor="bg11"
                  borderRadius={16}
                  mb="s"
                  opacity={isChanging && !isSelected ? 0.5 : 1}
                >
                  <Box flex={1}>
                    <Text variant="p7" color="textPrimary" mb="xs">
                      {language.nativeName}
                    </Text>
                    <Text variant="p9" color="textSecondary">
                      {language.name}
                    </Text>
                  </Box>

                  {isSelected && (
                    <Box
                      width={24}
                      height={24}
                      borderRadius={12}
                      backgroundColor="primary"
                      justifyContent="center"
                      alignItems="center"
                    >
                      <Ionicons name="checkmark" size={16} color={theme.colors.white} />
                    </Box>
                  )}
                </Box>
              </TouchableOpacity>
            );
          })}
        </Box>

        <Box paddingVertical="m" marginTop="m">
          <Text variant="p9" color="textSecondary" textAlign="center">
            {/* Language changes apply immediately without restart */}
            The selected language will be applied immediately
          </Text>
        </Box>
      </Box>
    </BottomSheet>
  );
};

export default LanguageSheet;
