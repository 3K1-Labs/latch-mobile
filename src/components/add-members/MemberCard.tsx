import OwnerRow from '@/src/components/multisig/OwnerRow';
import React from 'react';

interface MemberCardProps {
  name: string;
  status: 'pending' | 'added';
  onRemove: () => void;
}

const MemberCard: React.FC<MemberCardProps> = ({ name, status, onRemove }) => (
  <OwnerRow name={name} tag={status} onRemove={onRemove} />
);

export default MemberCard;
