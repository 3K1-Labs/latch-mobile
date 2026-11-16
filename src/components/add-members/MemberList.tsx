import Box from '@/src/components/shared/Box';
import React from 'react';
import MemberCard from './MemberCard';

export interface Member {
  id: string;
  name: string;
  value: string;
  status: 'pending' | 'added';
}

interface MemberListProps {
  members: Member[];
  onRemove: (id: string) => void;
}

const MemberList: React.FC<MemberListProps> = ({ members, onRemove }) => {
  return (
    <Box gap="m">
      {members.map((member) => (
        <MemberCard
          key={member.id}
          name={member.name}
          status={member.status}
          onRemove={() => onRemove(member.id)}
        />
      ))}
    </Box>
  );
};

export default MemberList;
