import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import React from 'react';
import { StyleSheet } from 'react-native';

interface ApprovalRuleCardProps {
  approvals: number;
  total: number;
}

const ApprovalRuleCard: React.FC<ApprovalRuleCardProps> = ({ approvals, total }) => (
  <Box style={styles.section}>
    <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
      Approvals Required
    </Text>
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      backgroundColor="inputBox"
      borderColor="inputOutline"
      borderWidth={1}
      style={styles.box}
    >
      <Text fontSize={16} lineHeight={24} color="textPrimary">
        {approvals} of {total} owners
      </Text>
      <Text fontSize={14} lineHeight={22} color="textSubheading">
        to approve each transaction
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

export default ApprovalRuleCard;
