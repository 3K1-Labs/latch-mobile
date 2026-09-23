import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { BlurView } from 'expo-blur';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';

import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { copySecretToClipboard } from '@/src/utils/copy-to-clipboard';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const RecoveryPhraseSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { mnemonic } = useWalletStore();
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    if (visible) setIsRevealed(false);
  }, [visible]);

  const handleCopy = async () => {
    if (!mnemonic) return;
    await copySecretToClipboard(mnemonic);
  };

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="Recovery Phrase" onBack={onClose} titleVariant="h9" />}
      contentContainerStyle={{ flex: 1 }}
    >
      <Box paddingHorizontal="m" flex={1}>
        {/* Mnemonic Grid Container */}
        <Box
          backgroundColor="bg11"
          borderRadius={24}
          padding="l"
          minHeight={200}
          justifyContent="center"
          overflow="hidden"
        >
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between">
            {words.map((word, index) => (
              <Box key={index} width="32%" mb="m" flexDirection="row">
                <Text variant="h11" color="textSecondary" marginRight="xs">
                  {index + 1}.
                </Text>
                <Text variant="h11" color="textPrimary" fontWeight="600">
                  {word}
                </Text>
              </Box>
            ))}
          </Box>

          {!isRevealed && (
            <TouchableWithoutFeedback onPress={() => setIsRevealed(true)}>
              <Box style={StyleSheet.absoluteFill} justifyContent="center" alignItems="center">
                <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
                <Text variant="h10" color="textWhite" fontWeight="600">
                  Tap to reveal
                </Text>
              </Box>
            </TouchableWithoutFeedback>
          )}
        </Box>
      </Box>

      {/* Bottom Button */}
      <Box padding="m">
        <TouchableOpacity activeOpacity={0.7} onPress={handleCopy}>
          <Box
            height={64}
            backgroundColor="bg11"
            borderRadius={32}
            flexDirection="row"
            justifyContent="center"
            alignItems="center"
            gap="s"
          >
            <Text variant="h10" color="textPrimary" fontWeight="700">
              Copy To Clipboard
            </Text>
            <Ionicons name="copy-outline" size={20} color={theme.colors.textPrimary} />
          </Box>
        </TouchableOpacity>
      </Box>
    </BottomSheet>
  );
};

export default RecoveryPhraseSheet;
