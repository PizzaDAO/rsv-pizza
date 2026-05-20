import { useEffect, useMemo, useRef } from 'react';
import type { HostGoals, Milestone, MilestoneId } from '../types';

/**
 * quattro-71244: deterministic milestone unlock computation for the gamified
 * dashboard.
 *
 * - `unlocked`: milestones currently met by `stats`.
 * - `justCrossed`: milestones newly unlocked since the previous render,
 *   excluding any already-celebrated in this session (sessionStorage dedup).
 * - `nextMilestone`: the smallest-threshold locked milestone, or null if all
 *   are unlocked.
 *
 * First-mount suppression: we initialize the prev-unlocked ref with the
 * current unlocked set so the very first render emits an empty `justCrossed`.
 * sessionStorage key `dashboardKPIs.celebrated.<partyId>` persists the set
 * across remounts within the same browser session.
 *
 * Hooks live at the top with no early returns to comply with rules-of-hooks.
 * SSR-safe: guards `typeof window !== 'undefined'` before touching storage.
 */

const STORAGE_PREFIX = 'dashboardKPIs.celebrated.';

// Hardcoded milestone list — order also controls "nextMilestone" priority.
export const ALL_MILESTONES: Milestone[] = [
  { id: 'firstRsvp',       statKey: 'totalRsvps',         threshold: 1,   labelKey: 'host.dashboard.kpis.milestones.firstRsvp' },
  { id: 'rsvps25',         statKey: 'totalRsvps',         threshold: 25,  labelKey: 'host.dashboard.kpis.milestones.rsvps25' },
  { id: 'rsvps50',         statKey: 'totalRsvps',         threshold: 50,  labelKey: 'host.dashboard.kpis.milestones.rsvps50' },
  { id: 'rsvps100',        statKey: 'totalRsvps',         threshold: 100, labelKey: 'host.dashboard.kpis.milestones.rsvps100' },
  { id: 'firstWallet',     statKey: 'walletAddresses',    threshold: 1,   labelKey: 'host.dashboard.kpis.milestones.firstWallet' },
  { id: 'firstNewsletter', statKey: 'newsletterSignups', threshold: 1,   labelKey: 'host.dashboard.kpis.milestones.firstNewsletter' },
  { id: 'firstPoap',       statKey: 'poapMints',          threshold: 1,   labelKey: 'host.dashboard.kpis.milestones.firstPoap' },
  // `goalReached` is computed dynamically — `statKey` and `threshold` here are
  // placeholders so the type still works; the hook resolves it specially.
  { id: 'goalReached',     statKey: '__goal__',           threshold: 1,   labelKey: 'host.dashboard.kpis.milestones.goalReached' },
];

// Map a HostGoals key to its corresponding stat key.
const GOAL_TO_STAT: Record<keyof HostGoals, string> = {
  rsvps: 'totalRsvps',
  attendees: 'attendees',
  newsletterSignups: 'newsletterSignups',
  walletAddresses: 'walletAddresses',
  poapMints: 'poapMints',
  pageViews: 'pageViews',
};

function readCelebrated(partyId: string): Set<MilestoneId> {
  if (typeof window === 'undefined' || !window.sessionStorage) return new Set();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + partyId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as MilestoneId[]);
    return new Set();
  } catch {
    return new Set();
  }
}

function writeCelebrated(partyId: string, ids: Set<MilestoneId>): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + partyId, JSON.stringify([...ids]));
  } catch {
    // Quota exceeded or storage disabled — silently no-op.
  }
}

function isGoalReached(
  stats: Record<string, number | null | undefined>,
  hostGoals: HostGoals | null | undefined,
): boolean {
  if (!hostGoals) return false;
  for (const [goalKey, target] of Object.entries(hostGoals)) {
    if (typeof target !== 'number' || target <= 0) continue;
    const statKey = GOAL_TO_STAT[goalKey as keyof HostGoals];
    if (!statKey) continue;
    const value = stats[statKey];
    if (typeof value === 'number' && value >= target) return true;
  }
  return false;
}

export function useMilestones(
  stats: Record<string, number | null | undefined>,
  partyId: string,
  hostGoals?: HostGoals | null,
): { unlocked: Milestone[]; justCrossed: Milestone[]; nextMilestone: Milestone | null } {
  // Compute currently-unlocked milestones from stats + goals.
  const unlocked = useMemo<Milestone[]>(() => {
    const list: Milestone[] = [];
    for (const m of ALL_MILESTONES) {
      if (m.id === 'goalReached') {
        if (isGoalReached(stats, hostGoals)) list.push(m);
        continue;
      }
      const v = stats[m.statKey];
      if (typeof v === 'number' && v >= m.threshold) list.push(m);
    }
    return list;
  }, [stats, hostGoals]);

  const nextMilestone = useMemo<Milestone | null>(() => {
    const unlockedIds = new Set(unlocked.map(m => m.id));
    for (const m of ALL_MILESTONES) {
      if (m.id === 'goalReached') continue; // skip in "next" rotation; surface via dedicated UI
      if (!unlockedIds.has(m.id)) return m;
    }
    return null;
  }, [unlocked]);

  // Track which milestones were unlocked on the previous render so we can
  // diff. On first render this is initialized to the *current* unlocked set
  // so we don't fire confetti for already-passed milestones.
  const prevUnlockedRef = useRef<Set<MilestoneId>>(new Set(unlocked.map(m => m.id)));

  // Read the persisted celebrated set ONCE per partyId mount.
  const celebratedRef = useRef<Set<MilestoneId>>(new Set());
  const lastPartyIdRef = useRef<string | null>(null);
  if (lastPartyIdRef.current !== partyId) {
    celebratedRef.current = readCelebrated(partyId);
    // Reset prev set when partyId changes — treat as a fresh first-mount.
    prevUnlockedRef.current = new Set(unlocked.map(m => m.id));
    lastPartyIdRef.current = partyId;
  }

  // Newly-crossed = currently unlocked but not in prev set AND not already celebrated.
  const justCrossed = useMemo<Milestone[]>(() => {
    const prev = prevUnlockedRef.current;
    const celebrated = celebratedRef.current;
    return unlocked.filter(m => !prev.has(m.id) && !celebrated.has(m.id));
  }, [unlocked]);

  // Commit the new prev + celebrated sets after render. Must be in an effect
  // so we don't mutate refs during render (would otherwise cause stale reads
  // in StrictMode double-invocation).
  useEffect(() => {
    if (justCrossed.length > 0) {
      const newCelebrated = new Set(celebratedRef.current);
      for (const m of justCrossed) newCelebrated.add(m.id);
      celebratedRef.current = newCelebrated;
      writeCelebrated(partyId, newCelebrated);
    }
    prevUnlockedRef.current = new Set(unlocked.map(m => m.id));
  }, [unlocked, justCrossed, partyId]);

  return { unlocked, justCrossed, nextMilestone };
}
