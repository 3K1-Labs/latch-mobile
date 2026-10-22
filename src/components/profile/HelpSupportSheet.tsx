import { useTheme } from '@shopify/restyle';
import React from 'react';

import SheetHeader from '@/src/components/profile/SheetHeader';
import SupportItem from '@/src/components/profile/SupportItem';
import BottomSheet from '@/src/components/shared/BottomSheet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const HelpSupportSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="Help & Support" onBack={onClose} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}
    >
      <SupportItem
        title="Live Chat Support"
        description="Chat with our support team"
        icon="chatbubble-outline"
        image={require('@/src/assets/icon/chatbubble.png')}
        onPress={() => {}}
      />
      <SupportItem
        title="Email Support"
        description="support@latch.com"
        icon="mail-outline"
        onPress={() => {}}
      />
    </BottomSheet>
  );
};

export default HelpSupportSheet;
