import React from 'react';

import Box from '@/src/components/shared/Box';
import SwipeableRow from '@/src/components/shared/SwipeableRow';
import Text from '@/src/components/shared/Text';
import { maskAddress } from '@/src/utils';

interface Signer {
  id: string;
  name: string;
  address: string;
  isPrimary?: boolean;
}

interface Props {
  signer: Signer;
  onDelete?: (id: string) => void;
}

const SwipeableSignerItem = ({ signer, onDelete }: Props) => {
  const Content = (
    <Box
      backgroundColor="bg11"
      borderRadius={24}
      padding="l"
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      mb="m"
    >
      <Box>
        <Text variant="h11" color="textPrimary" fontWeight="700" mb="xs">
          {signer.name}
        </Text>
        <Text variant="p7" color="textSecondary">
          C:{maskAddress(signer.address)}
        </Text>
      </Box>

      {signer.isPrimary && (
        <Box
          paddingHorizontal="m"
          paddingVertical="xs"
          borderRadius={8}
          style={{ backgroundColor: 'rgba(212, 175, 55, 0.15)' }}
        >
          <Text variant="h12" color="primary700" fontWeight="700">
            Primary
          </Text>
        </Box>
      )}
    </Box>
  );

  return (
    <SwipeableRow disabled={signer.isPrimary} onDelete={() => onDelete?.(signer.id)}>
      {Content}
    </SwipeableRow>
  );
};

export default SwipeableSignerItem;
