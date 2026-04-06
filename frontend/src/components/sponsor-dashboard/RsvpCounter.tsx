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
      <Users size={16} className="text-white/40 flex-shrink-0" />
      <div className="flex-1">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold text-white/90">{rsvpCount}</span>
          {maxGuests && (
            <>
              <span className="text-white/40">/</span>
              <span className="text-sm text-white/50">{maxGuests}</span>
            </>
          )}
          <span className="text-xs text-white/40 ml-1">RSVPs</span>
        </div>
        {percentage !== null && (
          <div className="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#ff393a] rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
