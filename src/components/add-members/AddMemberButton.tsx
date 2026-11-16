import Box from '@/src/components/shared/Box';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

const ICON = require('@/src/assets/images/multisig/profile-add.svg');

interface AddMemberButtonProps {
  onPress: () => void;
}

const AddMemberButton: React.FC<AddMemberButtonProps> = ({ onPress }) => (
  <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel="Add owner"
    activeOpacity={0.7}
    onPress={onPress}
  >
    <Box backgroundColor="inputBox" alignItems="center" justifyContent="center" style={styles.card}>
      <Image source={ICON} contentFit="contain" style={styles.icon} />
    </Box>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    height: 92,
    borderRadius: 14,
  },
  icon: {
    width: 40,
    height: 40,
  },
});

export default AddMemberButton;
