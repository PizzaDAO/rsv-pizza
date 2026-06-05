import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { DonationPublicStats } from '../types';
import { SupportersModal, DonorAvatar } from './SupportersModal';

interface DonorHighlightsProps {
  stats: DonationPublicStats;
}

// Amounts are stored in cents. Drop the cents (whole-dollar display).
function formatAmount(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// How many donors to inline in the row before collapsing to "+N more".
const INLINE_DONORS = 3;
const INLINE_AVATARS = 3;

export const DonorHighlights: React.FC<DonorHighlightsProps> = ({ stats }) => {
  const { t } = useTranslation('event');
  const [open, setOpen] = useState(false);

  if (!stats.enabled || !stats.donors?.length) {
    return null;
  }

  const donors = stats.donors;
  const donorCount = stats.donorCount ?? donors.length;
  const recipient = stats.recipient || t('thisEvent');
  const showAmounts = stats.amountsPublic === true;

  const inlineDonors = donors.slice(0, INLINE_DONORS);
  const avatarDonors = donors.slice(0, INLINE_AVATARS);
  const moreCount = Math.max(donorCount - inlineDonors.length, 0);

  return (
    <div className="mt-4 pt-4 border-t border-theme-stroke">
      <p className="text-theme-text-muted text-xs font-medium mb-2">
        {t('supportersOf', { recipient })}
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center gap-3 w-full text-left rounded-xl border border-theme-stroke bg-theme-surface hover:bg-theme-surface-hover transition-colors px-3 py-2"
      >
        {/* Overlapping avatars */}
        <div className="flex flex-shrink-0 -space-x-2">
          {avatarDonors.map((donor, i) => (
            <div key={i} className="ring-2 ring-theme-surface rounded-full">
              <DonorAvatar displayName={donor.displayName} avatarUrl={donor.avatarUrl} size={28} />
            </div>
          ))}
        </div>

        {/* Inline donor list */}
        <div className="min-w-0 flex-1 text-sm text-theme-text">
          <span className="truncate inline">
            {inlineDonors.map((donor, i) => {
              const showAmount = showAmounts && donor.amount != null;
              return (
                <span key={i}>
                  {i > 0 && <span className="text-theme-text-muted"> · </span>}
                  <span className="font-medium">{donor.displayName}</span>
                  {showAmount && (
                    <span className="text-[#ff393a] font-semibold"> {formatAmount(donor.amount as number)}</span>
                  )}
                </span>
              );
            })}
            {moreCount > 0 && (
              <span className="text-theme-text-muted"> · {t('moreSupporters', { count: moreCount })}</span>
            )}
          </span>
        </div>

        {/* Affordance */}
        <ChevronRight
          size={18}
          className="flex-shrink-0 text-theme-text-muted group-hover:text-theme-text transition-colors"
        />
      </button>

      {open && <SupportersModal stats={stats} onClose={() => setOpen(false)} />}
    </div>
  );
};
