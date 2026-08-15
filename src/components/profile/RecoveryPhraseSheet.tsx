import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetHandle from '@/src/components/shared/BottomSheetHandle';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useWalletStore } from '@/src/store/wallet';
import { SHEET_HEIGHT } from '@/src/constants/constants';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { copySecretToClipboard } from '@/src/utils/copy-to-clipboard';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const RecoveryPhraseSheet = ({ visible, onClose }: Props) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { mnemonic } = useWalletStore();
  const [isRevealed, setIsRevealed] = useState(false);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      setIsRevealed(false);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 25,
        mass: 1,
        stiffness: 150,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const handleCopy = async () => {
    if (!mnemonic) return;
    await copySecretToClipboard(mnemonic);
  };

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
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
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Text variant="h9" color="textPrimary" fontWeight="700">
              Recovery Phrase
            </Text>
            <Box width={40} />
          </Box>

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
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
});

export default RecoveryPhraseSheet;
