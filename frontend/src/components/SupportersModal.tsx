import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, User } from 'lucide-react';
import { DonationPublicStats } from '../types';

interface SupportersModalProps {
  stats: DonationPublicStats;
  onClose: () => void;
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

// Amounts are stored in cents. Drop the cents when the value is whole.
function formatAmount(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface AvatarProps {
  displayName: string;
  avatarUrl: string | null;
  size?: number;
}

export const DonorAvatar: React.FC<AvatarProps> = ({ displayName, avatarUrl, size = 36 }) => {
  const isAnon = displayName === 'Anon';
  const dim = { width: size, height: size, minWidth: size, minHeight: size };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className="rounded-full object-cover flex-shrink-0"
        style={dim}
      />
    );
  }
  if (isAnon) {
    return (
      <div
        className="rounded-full bg-theme-surface border border-theme-stroke flex items-center justify-center flex-shrink-0"
        style={dim}
      >
        <User size={Math.round(size * 0.45)} className="text-theme-text-muted" />
      </div>
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold uppercase"
      style={{ ...dim, backgroundColor: colorForName(displayName), fontSize: Math.round(size * 0.4) }}
    >
      {displayName.trim().charAt(0) || '?'}
    </div>
  );
};

export const SupportersModal: React.FC<SupportersModalProps> = ({ stats, onClose }) => {
  const { t } = useTranslation('event');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const donors = stats.donors ?? [];
  const recipient = stats.recipient || t('thisEvent');
  const donorCount = stats.donorCount ?? donors.length;
  const showAmounts = stats.amountsPublic === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card p-6 max-w-md w-full relative max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
          aria-label="Close"
        >
          <X size={24} />
        </button>

        {/* Header */}
        <div className="mb-4 pr-8">
          <h2 className="text-xl font-bold text-theme-text">
            {t('supportersOf', { recipient })}
          </h2>
          <p className="text-theme-text-muted text-sm mt-1">
            {t('supportersCount', { count: donorCount })}
            {showAmounts && stats.totalAmount != null && (
              <> · {t('raised', { amount: (stats.totalAmount / 100).toLocaleString(undefined, { maximumFractionDigits: 0 }) })}</>
            )}
          </p>
        </div>

        {/* Donor list */}
        <ul className="space-y-3 max-h-[70vh] overflow-y-auto -mr-2 pr-2">
          {donors.map((donor, i) => {
            const showAmount = showAmounts && donor.amount != null;
            return (
              <li key={i} className="flex items-start gap-3">
                <DonorAvatar displayName={donor.displayName} avatarUrl={donor.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text text-sm font-medium truncate">
                      {donor.displayName}
                    </span>
                    {showAmount && (
                      <span className="text-[#ff393a] text-sm font-semibold flex-shrink-0">
                        {formatAmount(donor.amount as number)}
                      </span>
                    )}
                  </div>
                  {donor.message && (
                    <p className="text-theme-text-muted text-xs mt-0.5 break-words">
                      {donor.message}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
