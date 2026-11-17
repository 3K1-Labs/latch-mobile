import { useTheme } from '@shopify/restyle';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { ActivityIndicator, TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import Input from '../shared/Input';

interface URLInputSheetProps {
  url: string;
  onChangeUrl: (text: string) => void;
  onConnect: () => void;
  isConnecting?: boolean;
}

const URLInputSheet = ({ url, onChangeUrl, onConnect, isConnecting = false }: URLInputSheetProps) => {
  const theme = useTheme<Theme>();

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    onChangeUrl(text);
  };

  return (
    <Box
      backgroundColor="sheetBg"
      borderTopLeftRadius={32}
      borderTopRightRadius={32}
      padding="m"
      paddingBottom="xl"
    >
      <Text variant="p6" color="textPrimary" fontWeight="700" mb="m">
        Input URL
      </Text>

      <Box mb="l">
        <Input
          placeholder="https://latch.co/"
          placeholderTextColor={theme.colors.textSecondary}
          value={url}
          onChangeText={onChangeUrl}
          rightElement={
            <TouchableOpacity activeOpacity={0.7} onPress={handlePaste}>
              <Box backgroundColor="primary" px="m" py="xs" borderRadius={8}>
                <Text variant="p8" color="black" fontWeight="700">
                  Paste
                </Text>
              </Box>
            </TouchableOpacity>
          }
          style={{
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: 16,
            fontFamily: 'SFproRegular',
            width: '100%',
          }}
        />
      </Box>

      <TouchableOpacity activeOpacity={0.8} onPress={onConnect} disabled={isConnecting || !url}>
        <Box
          height={56}
          backgroundColor={url && !isConnecting ? 'primary' : 'btnDisabled'}
          borderRadius={28}
          justifyContent="center"
          alignItems="center"
        >
          {isConnecting ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text variant="p6" color="black" fontWeight="700">
              Connect
            </Text>
          )}
        </Box>
      </TouchableOpacity>
    </Box>
  );
};

export default URLInputSheet;
