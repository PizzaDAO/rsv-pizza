import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Guest } from '../../types';

interface LiveRSVPTickerProps {
  guests: Guest[];
}

const VISIBLE_LIMIT = 5;
const DIRECT_RSVP_SOURCES = new Set(['link', 'rsvp', 'api']);
const REFRESH_INTERVAL_MS = 30_000;

function initialsFromName(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/**
 * tartufo-49271: live RSVP ticker for the host dashboard.
 *
 * Reads from the `guests` prop already flowing through PizzaContext. The
 * realtime subscription is mounted at HostPage via `useGuestsRealtime` — this
 * component never subscribes on its own. Filters to direct-RSVP sources
 * (link/rsvp/api) but accepts `submittedVia === undefined` so legacy rows
 * still surface. Newly-arrived rows animate in with a staggered slide.
 *
 * Renders `null` when there's nothing to show.
 */
export const LiveRSVPTicker: React.FC<LiveRSVPTickerProps> = ({ guests }) => {
  const { t } = useTranslation('host');

  // Tick every 30s to refresh relative timestamps between live events.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Track previously-seen guest identities so newly-arrived rows animate in.
  const seenIdsRef = useRef<Set<string>>(new Set());

  const visibleGuests = useMemo<Guest[]>(() => {
    const filtered = guests.filter(g => {
      if (g.submittedVia === undefined) return true;
      return DIRECT_RSVP_SOURCES.has(g.submittedVia);
    });
    const sorted = filtered.slice().sort((a, b) => {
      const aTs = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const bTs = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return bTs - aTs;
    });
    return sorted.slice(0, VISIBLE_LIMIT);
  }, [guests]);

  // Determine which rows in the current visible window are "new" so we only
  // animate fresh arrivals (not the initial mount of an already-populated
  // list).
  const newKeysThisRender = useMemo(() => {
    const fresh = new Set<string>();
    if (seenIdsRef.current.size === 0) {
      // First render: don't animate the initial backfill; just remember them.
      return fresh;
    }
    for (const g of visibleGuests) {
      const key = g.id ?? `${g.submittedAt ?? ''}__${g.name}`;
      if (!seenIdsRef.current.has(key)) fresh.add(key);
    }
    return fresh;
  }, [visibleGuests]);

  // Commit the current visible keys to the "seen" set after each render so
  // the next realtime delta only animates truly-new entries.
  useEffect(() => {
    for (const g of visibleGuests) {
      const key = g.id ?? `${g.submittedAt ?? ''}__${g.name}`;
      seenIdsRef.current.add(key);
    }
  }, [visibleGuests]);

  if (visibleGuests.length === 0) {
    return null;
  }

  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-white/50 mb-3">
        {t('dashboard.ticker.recentRsvps')}
      </div>
      <ul
        className="space-y-2"
        onMouseEnter={(e) => e.currentTarget.setAttribute('data-paused', 'true')}
        onMouseLeave={(e) => e.currentTarget.removeAttribute('data-paused')}
        onFocus={(e) => e.currentTarget.setAttribute('data-paused', 'true')}
        onBlur={(e) => e.currentTarget.removeAttribute('data-paused')}
      >
        {visibleGuests.map((g, index) => {
          const key = g.id ?? `${g.submittedAt ?? ''}__${g.name}`;
          const isNew = newKeysThisRender.has(key);
          const ago = g.submittedAt
            ? formatDistanceToNowStrict(new Date(g.submittedAt), { addSuffix: true })
            : t('dashboard.ticker.justNow');
          return (
            <li
              key={key}
              className={`flex items-center gap-3 ${isNew ? 'animate-ticker-in' : ''}`}
              style={isNew ? { animationDelay: `${index * 60}ms` } : undefined}
            >
              <div
                aria-hidden="true"
                className="flex-shrink-0 h-8 w-8 rounded-full bg-theme-surface-hover flex items-center justify-center text-xs font-semibold text-white/80"
              >
                {initialsFromName(g.name)}
              </div>
              <div className="min-w-0 flex-1 flex items-baseline gap-2">
                <div className="truncate text-sm text-white/90">{g.name || '—'}</div>
                <div className="flex-shrink-0 text-xs text-white/40">{ago}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
