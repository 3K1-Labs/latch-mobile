import { useTheme } from '@shopify/restyle';
import React from 'react';
import { Image } from 'react-native';

import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const AboutSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="About" onBack={onClose} />}
      contentContainerStyle={{ flex: 1 }}
    >
      <Box flex={1} alignItems="center">
        <Image
          source={require('@/src/assets/images/latch-version.png')}
          style={{ width: 110, height: 103, marginTop: 50 }}
          resizeMode="contain"
        />

        <Text variant="h4" color="textPrimary" fontWeight="700" mt="m">
          Latch
        </Text>
        <Text variant="p6" color="textSecondary" mt="s">
          Version 1.0.0
        </Text>
      </Box>
    </BottomSheet>
  );
};

export default AboutSheet;
