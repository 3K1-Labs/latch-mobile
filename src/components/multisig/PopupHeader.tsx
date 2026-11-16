import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

const CLOSE = require('@/src/assets/images/swap/close.svg');

/** Grabber, centred title and a round close button — the top of every multisig pop-up. */
const PopupHeader = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <Box>
    <Box alignItems="center" style={styles.grabberWrap}>
      <Box width={126} height={8} borderRadius={69} backgroundColor="inputOutline" />
    </Box>
    <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
      <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
        {title}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
        onPress={onClose}
        style={styles.close}
      >
        <Image source={CLOSE} contentFit="contain" style={styles.closeIcon} />
      </TouchableOpacity>
    </Box>
  </Box>
);

const styles = StyleSheet.create({
  grabberWrap: {
    paddingTop: 10,
  },
  header: {
    marginTop: 24,
    height: 40,
  },
  close: {
    position: 'absolute',
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
});

export default PopupHeader;
