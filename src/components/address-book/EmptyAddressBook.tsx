import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet } from 'react-native';

const MASCOT = require('@/src/assets/images/address-book/empty-mascot.svg');

/** The "+" in the sheet header is the add action, so there's no button here. */
const EmptyAddressBook = () => (
  <Box flex={1} alignItems="center" justifyContent="center" style={styles.wrap}>
    <Box alignItems="center" style={styles.content}>
      <Image source={MASCOT} contentFit="contain" style={styles.mascot} />
      <Box alignItems="center" gap="xs">
        <Text
          fontSize={16}
          lineHeight={20}
          letterSpacing={0.16}
          fontFamily="SFproMedium"
          color="textPrimary"
          textAlign="center"
        >
          Empty Address Book
        </Text>
        <Text
          fontSize={14}
          lineHeight={20}
          letterSpacing={0.14}
          color="textMuted"
          textAlign="center"
        >
          Tap the &quot;Add Icon&quot; to start saving your frequently used addresses.
        </Text>
      </Box>
    </Box>
  </Box>
);

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 120,
  },
  content: {
    width: 182,
    gap: 20,
  },
  mascot: {
    width: 133,
    height: 127,
  },
});

export default EmptyAddressBook;
