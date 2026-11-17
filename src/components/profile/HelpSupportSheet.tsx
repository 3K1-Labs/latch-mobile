import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { Linking, StyleSheet } from 'react-native';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import SupportItem from '@/src/components/profile/SupportItem';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';

// Same address as the privacy policy.
const SUPPORT_EMAIL = 'support@getlatch.co';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const openSupportEmail = async () => {
  try {
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  } catch {
    // No mail app configured — hand over the address instead.
    await copyToClipboard(SUPPORT_EMAIL, 'Support email');
  }
};

const HelpSupportSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={[styles.sheet, { backgroundColor: theme.colors.surfaceBase }]}
      handleIndicatorStyle={[styles.grabber, { backgroundColor: theme.colors.inputOutline }]}
      header={
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          style={styles.header}
        >
          <RoundBackButton onPress={onClose} />
          <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
            Help &amp; Support
          </Text>
          <Box width={40} />
        </Box>
      }
      contentContainerStyle={styles.content}
    >
      <Box gap="s" mb="l">
        <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
          Need a hand?
        </Text>
        <Text fontSize={14} lineHeight={20} letterSpacing={0.14} color="textSubheading">
          Reach the Latch team and we&apos;ll get back to you. We will never ask for your recovery
          phrase, PIN or password.
        </Text>
      </Box>

      <SupportItem
        title="Email Support"
        description={SUPPORT_EMAIL}
        icon="mail-outline"
        onPress={openSupportEmail}
      />
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
  },
  grabber: {
    width: 126,
    height: 8,
    borderRadius: 69,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 36,
  },
});

export default HelpSupportSheet;
