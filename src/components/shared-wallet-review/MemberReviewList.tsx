import OwnerRow from '@/src/components/multisig/OwnerRow';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import React from 'react';
import { StyleSheet } from 'react-native';

interface Member {
  id: string;
  name: string;
  value: string;
  status: 'pending' | 'added';
}

interface MemberReviewListProps {
  members: Member[];
  /** Kept for callers; the redesigned owner row has no subtitle. */
  selfEmail?: string | null;
}

const MemberReviewList: React.FC<MemberReviewListProps> = ({ members }) => (
  <Box style={styles.section}>
    <Text fontSize={14} lineHeight={22} letterSpacing={0.14} color="textSubheading">
      Owners
    </Text>
    <OwnerRow name="You" tag="default" />
    {members.map((member) => (
      <OwnerRow key={member.id} name={member.name} tag={member.status} />
    ))}
  </Box>
);

const styles = StyleSheet.create({
  section: {
    gap: 8,
    marginBottom: 16,
  },
});

export default MemberReviewList;
