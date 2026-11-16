import { useTheme } from '@shopify/restyle';
import React from 'react';
import { TouchableOpacity } from 'react-native';

import NetworkItem from '@/src/components/network/NetworkItem';
import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import type { AppearancePreference } from '@/src/store/appearance';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const OPTIONS: { value: AppearancePreference; name: string; description: string }[] = [
  { value: 'system', name: 'System', description: "Match your phone's appearance" },
  { value: 'light', name: 'Light', description: 'Always use light mode' },
  { value: 'dark', name: 'Dark', description: 'Always use dark mode' },
];

const AppearanceSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark, preference, setPreference } = useAppTheme();

  const handleSelect = (value: AppearancePreference) => {
    if (value !== preference) setPreference(value);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="Appearance" onBack={onClose} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}
    >
      {OPTIONS.map((option) => (
        <TouchableOpacity
          key={option.value}
          activeOpacity={0.7}
          onPress={() => handleSelect(option.value)}
        >
          <NetworkItem
            name={option.name}
            description={option.description}
            isSelected={preference === option.value}
          />
        </TouchableOpacity>
      ))}
    </BottomSheet>
  );
};

export default AppearanceSheet;
