import React from 'react';
import { useTranslation } from 'react-i18next';
import { KPIBadge } from './KPIBadge';
import { ALL_MILESTONES } from '../../hooks/useMilestones';
import type { Milestone } from '../../types';

interface MilestoneBadgeStripProps {
  unlocked: Milestone[];
  // `next` is accepted but not currently surfaced in the strip — kept on the
  // prop signature so callers can pass it without ts errors when we add a
  // dedicated "next milestone" hint in v2.
  next?: Milestone | null;
}

/**
 * quattro-71244: horizontal scrollable row of milestone chips. Renders the
 * entire `ALL_MILESTONES` list — locked chips are visually muted, unlocked
 * chips pop in color. Title text comes from `host.dashboard.kpis.title`.
 */
export const MilestoneBadgeStrip: React.FC<MilestoneBadgeStripProps> = ({ unlocked }) => {
  const { t } = useTranslation('host');
  const unlockedIds = new Set(unlocked.map(m => m.id));

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-theme-text-secondary">
        {t('dashboard.kpis.title')}
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {ALL_MILESTONES.map(m => (
          <KPIBadge key={m.id} milestone={m} unlocked={unlockedIds.has(m.id)} />
        ))}
      </div>
    </div>
  );
};
