import React from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, User } from 'lucide-react';
import { DonationPublicStats } from '../types';

interface DonorHighlightsProps {
  stats: DonationPublicStats;
}

// Deterministic palette for initials avatars, derived from the donor's name.
const AVATAR_PALETTE = [
  '#ff393a', // brand red
  '#f97316', // orange
  '#eab308', // amber
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatAmount(amount: number): string {
  // Donation amounts are stored in dollars (Decimal). Drop cents when whole.
  const hasCents = amount % 1 !== 0;
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export const DonorHighlights: React.FC<DonorHighlightsProps> = ({ stats }) => {
  const { t } = useTranslation('event');

  if (!stats.enabled || !stats.topDonors?.length) {
    return null;
  }

  const topDonors = stats.topDonors;
  const shown = topDonors.length;
  const donorCount = stats.donorCount ?? shown;
  const moreCount = Math.max(donorCount - shown, 0);

  return (
    <div className="mt-4 pt-4 border-t border-theme-stroke">
      <div className="flex items-center gap-2 mb-3">
        <Heart size={16} className="text-[#ff393a]" />
        <p className="text-theme-text font-medium text-sm">{t('supporters')}</p>
      </div>

      <ul className="space-y-2">
        {topDonors.map((donor, i) => {
          const isAnon = donor.isAnonymous || !donor.name;
          const displayName = isAnon ? t('anonymous') : (donor.name as string);
          const showAmount = stats.amountsPublic && donor.amount != null;

          return (
            <li key={i} className="flex items-center gap-3">
              {/* Avatar */}
              {donor.avatarUrl ? (
                <img
                  src={donor.avatarUrl}
                  alt={displayName}
                  className="w-8 min-w-8 h-8 min-h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : isAnon ? (
                <div className="w-8 min-w-8 h-8 min-h-8 rounded-full bg-theme-surface border border-theme-stroke flex items-center justify-center flex-shrink-0">
                  <User size={14} className="text-theme-text-muted" />
                </div>
              ) : (
                <div
                  className="w-8 min-w-8 h-8 min-h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold uppercase"
                  style={{ backgroundColor: colorForName(displayName) }}
                >
                  {displayName.trim().charAt(0) || '?'}
                </div>
              )}

              {/* Name + message */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-theme-text text-sm font-medium truncate">
                    {displayName}
                  </span>
                  {showAmount && (
                    <span className="text-[#ff393a] text-sm font-semibold flex-shrink-0">
                      {formatAmount(donor.amount as number)}
                    </span>
                  )}
                </div>
                {donor.message && (
                  <p
                    className="text-theme-text-muted text-xs truncate"
                    title={donor.message}
                  >
                    {donor.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {moreCount > 0 && (
        <p className="text-theme-text-muted text-xs mt-3">
          {t('moreSupporters', { count: moreCount })}
        </p>
      )}
    </div>
  );
};
