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
          ? 'bg-[#ff393a]/15 border-[#ff393a]/40 text-theme-text'
          : 'bg-theme-surface border-theme-stroke text-theme-text-faint opacity-60',
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
