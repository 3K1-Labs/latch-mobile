import { Ionicons } from '@expo/vector-icons';
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

const OPTIONS: {
  value: AppearancePreference;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: 'system',
    name: 'System',
    description: "Match your phone's appearance",
    icon: 'phone-portrait-outline',
  },
  { value: 'light', name: 'Light', description: 'Always use light mode', icon: 'sunny-outline' },
  { value: 'dark', name: 'Dark', description: 'Always use dark mode', icon: 'moon-outline' },
];

const AppearanceSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { preference, setPreference } = useAppTheme();

  const handleSelect = (value: AppearancePreference) => {
    if (value !== preference) setPreference(value);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      backgroundStyle={{ backgroundColor: theme.colors.surfaceBase }}
      header={<SheetHeader title="Appearance" onBack={onClose} />}
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 }}
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
            icon={<Ionicons name={option.icon} size={22} color={theme.colors.tileGlyph} />}
          />
        </TouchableOpacity>
      ))}
    </BottomSheet>
  );
};

export default AppearanceSheet;
