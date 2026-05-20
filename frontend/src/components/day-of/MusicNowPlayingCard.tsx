import React, { useEffect, useState } from 'react';
import { Music, ChevronRight, Loader2 } from 'lucide-react';
import { Performer } from '../../types';
import { getPerformers } from '../../lib/api';

interface MusicNowPlayingCardProps {
  partyId: string;
  inviteCode: string;
  /**
   * If true, hide the "Open Music tab" link (e.g. on the /run mobile route
   * where the link would just navigate away from the day-of dashboard).
   */
  hideOpenTabLink?: boolean;
}

/**
 * Day-of snapshot of the music lineup. Lists confirmed performers; uses
 * the Music tab's existing data via getPerformers().
 */
export const MusicNowPlayingCard: React.FC<MusicNowPlayingCardProps> = ({
  partyId,
  inviteCode,
  hideOpenTabLink,
}) => {
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPerformers(partyId)
      .then((res) => {
        if (cancelled) return;
        setPerformers(res?.performers || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const upcoming = performers
    .filter((p) => p.status !== 'cancelled')
    .sort((a, b) => {
      if (a.setTime && b.setTime) return a.setTime.localeCompare(b.setTime);
      if (a.setTime) return -1;
      if (b.setTime) return 1;
      return a.sortOrder - b.sortOrder;
    })
    .slice(0, 4);

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={18} className="text-[#ff393a]" />
          <h3 className="text-lg font-semibold text-theme-text">Music</h3>
        </div>
        {!hideOpenTabLink && (
          <a
            href={`/host/${inviteCode}?tab=music`}
            className="inline-flex items-center text-sm text-theme-text-secondary hover:text-theme-text"
          >
            Open
            <ChevronRight size={14} />
          </a>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-theme-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading lineup…
        </div>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-theme-text-muted italic">No performers yet.</p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-text truncate">{p.name}</p>
                {p.genre && (
                  <p className="text-xs text-theme-text-muted truncate">{p.genre}</p>
                )}
              </div>
              {p.setTime && (
                <span className="text-xs font-mono text-theme-text-secondary whitespace-nowrap">
                  {p.setTime}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
