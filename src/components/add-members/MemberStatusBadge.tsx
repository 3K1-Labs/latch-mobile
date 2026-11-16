import { OwnerTagPill } from '@/src/components/multisig/OwnerRow';
import React from 'react';

interface MemberStatusBadgeProps {
  status: 'pending' | 'added';
}

const MemberStatusBadge: React.FC<MemberStatusBadgeProps> = ({ status }) => (
  <OwnerTagPill tag={status} />
);

export default MemberStatusBadge;
