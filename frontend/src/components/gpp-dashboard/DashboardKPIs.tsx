import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Party, Guest, EventReport, HostGoals, MomentumDelta } from '../../types';
import { getReport, getPageViewStats, updateHostGoals } from '../../lib/api';
import type { PageViewStats } from '../../types';
import { ReportKPIs } from '../report/ReportKPIs';
import { LeaderboardPill } from './LeaderboardPill';
import { MilestoneBadgeStrip } from './MilestoneBadgeStrip';
import { useMilestones } from '../../hooks/useMilestones';
import { useMomentum } from '../../hooks/useMomentum';
import { useConfetti } from '../../hooks/useConfetti';

interface DashboardKPIsProps {
  party: Party;
  guests: Guest[];
}

/**
 * quattro-71244: gamified host-dashboard KPIs wrapper.
 *
 * Composes:
 *  - LeaderboardPill (current-season GPP rank)
 *  - MilestoneBadgeStrip (8 milestones, color/grey)
 *  - ReportKPIs in read-only `gamified` mode (real grid + goals + deltas)
 *  - ConfettiOverlay (fires once per newly-crossed milestone; single burst on batch)
 *
 * Hooks live above any conditional return per project convention.
 * Realtime is NOT subscribed here — the parent (GPPDashboardTab) inherits the
 * existing per-page subscription via `useGuestsRealtime` from HostPage.
 */
export const DashboardKPIs: React.FC<DashboardKPIsProps> = ({ party, guests }) => {
  // Hooks: all at the top, before any conditional return.
  const [report, setReport] = useState<EventReport | null>(null);
  const [pageViewStats, setPageViewStats] = useState<PageViewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [localGoals, setLocalGoals] = useState<HostGoals>(party.hostGoals ?? {});
  const [pulseKeys, setPulseKeys] = useState<Set<string>>(new Set());

  const prevGuestCountRef = useRef<number>(guests.length);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confettiFiredRef = useRef<Set<string>>(new Set());

  const { fireFromCenter, ConfettiOverlay } = useConfetti();

  // Keep local goals in sync if party.hostGoals changes externally.
  useEffect(() => {
    setLocalGoals(party.hostGoals ?? {});
  }, [party.hostGoals]);

  // Fetch report + page-view stats once per partyId.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([
      getReport(party.id),
      getPageViewStats(party.id).catch(() => null),
    ]).then(([reportResult, viewsResult]) => {
      if (cancelled) return;
      if (!reportResult || !reportResult.report) {
        // Auth/permission failure — graceful hide.
        setLoadFailed(true);
        setLoading(false);
        return;
      }
      setReport(reportResult.report);
      setPageViewStats(viewsResult);
      // Hydrate local goals from the report if the party prop didn't carry them.
      if (reportResult.report.hostGoals && Object.keys(localGoals).length === 0) {
        setLocalGoals(reportResult.report.hostGoals);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // We intentionally exclude `localGoals` — it should not refetch when the
    // user edits a goal locally. Re-fetch only on partyId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party.id]);

  // Stats map mirrors ReportKPIs' `allStats` key set.
  const stats = useMemo<Record<string, number | null | undefined>>(() => {
    if (!report) return {};
    return {
      pageViews: pageViewStats?.totalViews ?? null,
      uniqueVisitors: pageViewStats?.uniqueViews ?? null,
      socialPostViews: null, // not surfaced through this code path in v1
      socialPosts: report.socialPosts?.length ?? null,
      totalRsvps: report.stats?.totalRsvps ?? 0,
      attendees: report.stats?.approvedGuests ?? 0,
      newsletterSignups: report.stats?.mailingListSignups ?? 0,
      walletAddresses: report.stats?.walletAddresses ?? 0,
      poapMints: report.poapMints ?? 0,
      poapMoments: report.poapMoments ?? 0,
    };
  }, [report, pageViewStats]);

  const { unlocked, justCrossed, nextMilestone } = useMilestones(stats, party.id, localGoals);

  const momentum = useMomentum(guests);
  const deltas = useMemo<Record<string, MomentumDelta>>(() => ({
    totalRsvps: momentum,
  }), [momentum]);

  // Pulse the RSVP tile when guests count grows between renders.
  useEffect(() => {
    if (guests.length > prevGuestCountRef.current) {
      setPulseKeys(new Set(['totalRsvps']));
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setPulseKeys(new Set()), 700);
    }
    prevGuestCountRef.current = guests.length;
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, [guests.length]);

  // Confetti — fire once per newly-crossed milestone. If multiple cross at the
  // same time, batch into a single centered burst (per plan risk #5).
  useEffect(() => {
    if (justCrossed.length === 0) return;
    const fingerprint = justCrossed.map(m => m.id).sort().join(',');
    if (confettiFiredRef.current.has(fingerprint)) return;
    confettiFiredRef.current.add(fingerprint);
    fireFromCenter();
  }, [justCrossed, fireFromCenter]);

  // Goal-set handler — optimistic update with revert on failure.
  const handleSetGoal = async (statKey: string, newGoal: number | null) => {
    if (!report) return;
    const goalKey = (
      statKey === 'totalRsvps' ? 'rsvps' :
      statKey === 'attendees' ? 'attendees' :
      statKey === 'newsletterSignups' ? 'newsletterSignups' :
      statKey === 'walletAddresses' ? 'walletAddresses' :
      statKey === 'poapMints' ? 'poapMints' :
      statKey === 'pageViews' ? 'pageViews' :
      null
    ) as keyof HostGoals | null;
    if (!goalKey) return;

    const prev = localGoals;
    const next: HostGoals = { ...prev };
    if (newGoal == null) {
      delete next[goalKey];
    } else {
      next[goalKey] = newGoal;
    }
    setLocalGoals(next);
    try {
      await updateHostGoals(party.id, next);
    } catch (error) {
      console.error('Failed to save host goals — reverting:', error);
      setLocalGoals(prev);
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="h-4 w-32 bg-theme-surface-hover rounded animate-pulse mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="h-3 w-16 bg-theme-surface-hover rounded animate-pulse mb-2" />
              <div className="h-7 w-12 bg-theme-surface-hover rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadFailed || !report) {
    // Graceful hide — host page handles auth gating elsewhere.
    return null;
  }

  // Hand the report a hydrated copy with the local goals echoed in so the
  // gamified prop and the report share the same view of "current goals".
  const reportForKpis: EventReport = { ...report, hostGoals: localGoals };

  const socialPostViews = (report.socialPosts || []).reduce(
    (sum, p) => sum + (p.views ?? 0),
    0,
  );
  const socialPostCount = (report.socialPosts || []).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <LeaderboardPill partyId={party.id} />
      </div>
      <MilestoneBadgeStrip unlocked={unlocked} next={nextMilestone} />
      <ReportKPIs
        report={reportForKpis}
        onChange={() => { /* noop — gamified mode is read-only for stat config */ }}
        editable={false}
        pageViewStats={pageViewStats}
        socialPostViews={socialPostViews}
        socialPostCount={socialPostCount}
        gamified={{
          goals: localGoals,
          deltas,
          pulseKeys,
          onSetGoal: handleSetGoal,
        }}
      />
      {ConfettiOverlay}
    </div>
  );
};
