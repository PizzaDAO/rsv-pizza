import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Lock } from 'lucide-react';
import type { Milestone } from '../../types';

interface KPIBadgeProps {
  milestone: Milestone;
  unlocked: boolean;
}

/**
 * quattro-71244: single milestone chip rendered inside MilestoneBadgeStrip.
 * Unlocked = colored trophy + bright label.
 * Locked   = muted + lock icon + low-opacity label.
 */
export const KPIBadge: React.FC<KPIBadgeProps> = ({ milestone, unlocked }) => {
  const { t } = useTranslation('host');
  // Strip the `host.` prefix because useTranslation('host') is already scoped.
  const key = milestone.labelKey.replace(/^host\./, '');
  const label = t(key);

  return (
    <div
      className={[
        'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs whitespace-nowrap transition-all',
        unlocked
          ? 'bg-theme-card border-[#ff393a]/60 text-theme-text shadow-sm'
          : 'bg-theme-card border-theme-stroke text-theme-text-secondary opacity-80',
      ].join(' ')}
      title={label}
    >
      {unlocked ? (
        <Trophy size={12} className="text-[#ff393a]" />
      ) : (
        <Lock size={12} className="text-theme-text-faint" />
      )}
      <span>{label}</span>
    </div>
  );
};
