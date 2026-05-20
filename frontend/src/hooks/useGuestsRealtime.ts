import { useEffect } from 'react';
import * as db from '../lib/supabase';
import type { DbGuest } from '../lib/supabase';
import { dbGuestToGuest } from '../contexts/PizzaContext';
import type { Guest } from '../types';

/**
 * Opt-in realtime guest updates. Call ONLY from host-side pages
 * (HostPage, host dashboards, check-in views). Do NOT call from public
 * pages (RSVPPage, EventPage, /partner, /map).
 *
 * Background: a global subscription used to live in PizzaContext and ran on
 * every party load — including public RSVPPage. Bulk-invite blasts opened
 * hundreds of simultaneous Supabase Realtime channels, churning the realtime
 * `subscription` table and pinning WAL processing to ~89% of DB exec time,
 * which exhausted the connection pool and took the site down on 2026-05-19.
 * See `plans/calabrese-58204-pool-exhaustion-fix.md`.
 */
export function useGuestsRealtime(
  partyId: string | undefined,
  onChange: (guests: Guest[]) => void,
) {
  useEffect(() => {
    if (!partyId) return;
    const unsubscribe = db.subscribeToGuests(partyId, (dbGuests: DbGuest[]) => {
      onChange(dbGuests.map(dbGuestToGuest));
    });
    return unsubscribe;
    // We intentionally do NOT depend on `onChange` — callers usually pass a
    // fresh arrow function each render, and re-subscribing on every render is
    // exactly the churn we're trying to avoid. Callers should treat `onChange`
    // as the snapshot taken at mount/partyId-change time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);
}
