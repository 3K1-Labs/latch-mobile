import OwnerRow from '@/src/components/multisig/OwnerRow';
import React from 'react';

/**
 * The wallet creator, shown as a fixed signer at the top of the owner list.
 * Display-only: the creator's signer is read from the local credential at
 * deploy time, so this row is never part of the removable `members` state.
 */
const SelfMemberCard: React.FC = () => <OwnerRow name="You" tag="default" />;

export default SelfMemberCard;
