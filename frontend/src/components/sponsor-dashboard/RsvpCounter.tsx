import React from 'react';
import { Users } from 'lucide-react';

interface RsvpCounterProps {
  rsvpCount: number;
  maxGuests: number | null;
}

export const RsvpCounter: React.FC<RsvpCounterProps> = ({ rsvpCount, maxGuests }) => {
  const percentage = maxGuests && maxGuests > 0
    ? Math.min(100, Math.round((rsvpCount / maxGuests) * 100))
    : null;

  return (
    <div className="flex items-center gap-3">
      <Users size={16} className="text-theme-text-muted flex-shrink-0" />
      <div className="flex-1">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold text-theme-text">{rsvpCount}</span>
          {maxGuests && (
            <>
              <span className="text-theme-text-muted">/</span>
              <span className="text-sm text-theme-text-secondary">{maxGuests}</span>
            </>
          )}
          <span className="text-xs text-theme-text-muted ml-1">RSVPs</span>
        </div>
        {percentage !== null && (
          <div className="mt-1 h-1.5 bg-theme-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-[#E52828] rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
