import React from 'react';
import { Party } from '../../types';
import { DayOfDashboard } from './DayOfDashboard';

interface DayOfTabProps {
  party: Party;
}

/**
 * Thin wrapper used on the HostPage `day-of` tab. The mobile route at
 * /run/:inviteCode renders DayOfDashboard directly with layout="mobile".
 */
export const DayOfTab: React.FC<DayOfTabProps> = ({ party }) => {
  return <DayOfDashboard party={party} layout="desktop" />;
};
