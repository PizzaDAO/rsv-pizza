import React, { useEffect, useState } from 'react';
import { Clock, Users } from 'lucide-react';
import { Party, Guest } from '../../types';

interface StatusHeaderProps {
  party: Party;
  guests: Guest[];
}

function formatDelta(ms: number): { label: string; value: string } {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) {
    const remainingHours = hours - days * 24;
    return { label: '', value: `${days}d ${remainingHours}h` };
  }
  if (hours >= 1) {
    const remainingMins = minutes - hours * 60;
    return { label: '', value: `${hours}h ${remainingMins}m` };
  }
  return { label: '', value: `${minutes}m` };
}

/**
 * Day-of status header: time-relative-to-start + checked-in/capacity counter.
 * Re-renders every 30s while mounted.
 */
export const StatusHeader: React.FC<StatusHeaderProps> = ({ party, guests }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  const startMs = party.date ? new Date(party.date).getTime() : null;
  const checkedIn = guests.filter((g) => g.checkedInAt).length;
  const confirmed = guests.filter((g) => g.approved !== false && g.status !== 'WAITLISTED').length;
  const capacity = party.maxGuests || null;

  let timeBlock: React.ReactNode = null;
  if (startMs !== null) {
    const delta = startMs - now;
    const isFuture = delta > 0;
    const { value } = formatDelta(delta);
    timeBlock = (
      <div className="flex items-center gap-2">
        <Clock size={18} className="text-[#ff393a]" />
        <div>
          <p className="text-xs uppercase tracking-wide text-theme-text-muted">
            {isFuture ? 'Starts in' : 'Elapsed'}
          </p>
          <p className="text-lg font-mono font-semibold text-theme-text">{value}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-wrap items-center justify-between gap-4">
      {timeBlock}
      <div className="flex items-center gap-2">
        <Users size={18} className="text-[#ff393a]" />
        <div>
          <p className="text-xs uppercase tracking-wide text-theme-text-muted">
            Checked in
          </p>
          <p className="text-lg font-mono font-semibold text-theme-text">
            {checkedIn}
            <span className="text-theme-text-muted"> / {capacity ?? confirmed}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
