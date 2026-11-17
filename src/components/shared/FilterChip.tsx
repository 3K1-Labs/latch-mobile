import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useAppTheme } from '@/src/theme/ThemeContext';
import React from 'react';
import { TouchableOpacity } from 'react-native';

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

const FilterChip = ({ label, selected, onPress }: FilterChipProps) => {
  const { isDark } = useAppTheme();
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Box
        px="m"
        py="s"
        borderRadius={16}
        backgroundColor={selected ? 'transparent' : 'chipBg'}
        borderWidth={selected ? 1.5 : 1}
        borderColor={selected ? 'primary' : isDark ? 'gray800' : 'gray400'}
        mr="s"
      >
        <Text
          variant="p7"
          color={selected ? 'textPrimary' : 'textSecondary'}
          fontWeight={selected ? '700' : '500'}
        >
          {label}
        </Text>
      </Box>
    </TouchableOpacity>
  );
};

export default FilterChip;
