import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import React from 'react';
import { StyleSheet } from 'react-native';

interface WalletNameCardProps {
  name: string;
}

const WalletNameCard: React.FC<WalletNameCardProps> = ({ name }) => (
  <Box style={styles.section}>
    <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
      Wallet Name
    </Text>
    <Box
      justifyContent="center"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      style={styles.box}
    >
      <Text fontSize={16} lineHeight={24} color="textPrimary" numberOfLines={1}>
        {name}
      </Text>
    </Box>
  </Box>
);

const styles = StyleSheet.create({
  section: {
    gap: 6,
    marginBottom: 16,
  },
  box: {
    height: 48,
    borderRadius: 60,
    paddingHorizontal: 20,
  },
});

export default WalletNameCard;
