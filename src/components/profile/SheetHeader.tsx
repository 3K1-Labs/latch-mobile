import React from 'react';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

interface Props {
  title: React.ReactNode;
  /** Left action. Omit to leave the slot empty. */
  onBack?: () => void;
  /** Right-hand content (e.g. an add button). A spacer is rendered when absent. */
  right?: React.ReactNode;
}

/**
 * The shared header row for profile bottom sheets: a round back button, a
 * centred title, and a matching right-hand slot. Pass as the `header` prop of
 * `BottomSheet` so it stays pinned above the scrollable body.
 */
const SheetHeader = ({ title, onBack, right }: Props) => (
  <Box
    flexDirection="row"
    alignItems="center"
    justifyContent="space-between"
    paddingHorizontal="l"
    pt="sm"
    pb="l"
  >
    <Box width={40}>{onBack ? <RoundBackButton onPress={onBack} /> : null}</Box>

    {typeof title === 'string' ? (
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
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

export default SheetHeader;
