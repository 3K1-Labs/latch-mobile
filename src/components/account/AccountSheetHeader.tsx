import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

const PLUS = require('@/src/assets/images/address-book/plus.svg');

interface AccountSheetHeaderProps {
  onClose: () => void;
  onAdd: () => void;
  label?: string;
}

const AccountSheetHeader = ({ onClose, onAdd, label }: AccountSheetHeaderProps) => {
  const theme = useTheme<Theme>();
  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      style={styles.header}
    >
      <RoundBackButton onPress={onClose} />
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
        {label ? `${label} Accounts` : 'Accounts'}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Add account"
        activeOpacity={0.7}
        hitSlop={8}
        onPress={onAdd}
        style={[styles.add, { backgroundColor: theme.colors.inputOutline }]}
      >
        <Image source={PLUS} contentFit="contain" style={styles.addIcon} />
      </TouchableOpacity>
    </Box>
  );
};

const styles = StyleSheet.create({
  header: {
    marginTop: 23,
    marginBottom: 36,
    paddingHorizontal: 24,
  },
  add: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    width: 20,
    height: 20,
  },
});

export default AccountSheetHeader;
