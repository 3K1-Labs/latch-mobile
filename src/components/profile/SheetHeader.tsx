import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { TouchableOpacity } from 'react-native';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

type TextVariant = React.ComponentProps<typeof Text>['variant'];

interface Props {
  title: React.ReactNode;
  /** Left action. Renders a back chevron by default; omit to leave the slot empty. */
  onBack?: () => void;
  /** Right-hand content (e.g. an add button or a step indicator). A spacer is rendered when absent. */
  right?: React.ReactNode;
  titleVariant?: TextVariant;
  iconSize?: number;
}

/**
 * The shared header row for profile bottom sheets: a back chevron, a centred
 * title, and a matching right-hand slot. Pass as the `header` prop of
 * `BottomSheet` so it stays pinned above the scrollable body.
 */
const SheetHeader = ({ title, onBack, right, titleVariant = 'h10', iconSize = 20 }: Props) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal="m"
      py="m"
      mb="m"
    >
      <Box width={40}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={iconSize} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        ) : null}
      </Box>

      {typeof title === 'string' ? (
        <Text variant={titleVariant} color="textPrimary" fontWeight="700">
          {title}
        </Text>
      ) : (
        title
      )}

      <Box width={40} alignItems="flex-end">
        {right}
      </Box>
    </Box>
  );
};

export default SheetHeader;
