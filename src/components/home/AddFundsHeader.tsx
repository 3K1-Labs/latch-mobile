import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';

const CLOSE = require('@/src/assets/images/swap/close.svg');

interface Props {
  onBack: () => void;
  onClose: () => void;
}

const AddFundsHeader = ({ onBack, onClose }: Props) => {
  const theme = useTheme<Theme>();
  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      style={styles.header}
    >
      <RoundBackButton onPress={onBack} />
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
        Add Funds
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Close"
        activeOpacity={0.7}
        hitSlop={8}
        onPress={onClose}
        style={[styles.close, { backgroundColor: theme.colors.inputOutline }]}
      >
        <Image
          source={CLOSE}
          contentFit="contain"
          tintColor={theme.colors.iconPrimary}
          style={styles.closeIcon}
        />
      </TouchableOpacity>
    </Box>
  );
};

/** Sheet surface + grabber for the Add Funds sheets, in the active theme. */
export function useAddFundsSheetStyles() {
  const theme = useTheme<Theme>();
  return {
    sheet: [addFundsSheetStyles.sheet, { backgroundColor: theme.colors.surfaceBase }],
    grabber: [addFundsSheetStyles.grabber, { backgroundColor: theme.colors.inputOutline }],
  };
}

const addFundsSheetStyles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
  },
  grabber: {
    width: 126,
    height: 8,
    borderRadius: 69,
  },
});

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
});

export default AddFundsHeader;
