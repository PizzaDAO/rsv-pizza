import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GPP_REGIONS } from '../../types';
import type { UnderbossEvent } from '../../types';

interface RegionBreakdownProps {
  events: UnderbossEvent[];
}

interface RegionRow {
  regionId: string;
  label: string;
  totalEvents: number;
  venuePct: number;
  budgetPct: number;
  kitPct: number;
  teamPct: number;
  sponsorsPct: number;
  socialPct: number;
  thrownPct: number;
}

export function RegionBreakdown({ events }: RegionBreakdownProps) {
  const { t } = useTranslation('partner');

  const rows = useMemo<RegionRow[]>(() => {
    const groups = new Map<string, UnderbossEvent[]>();
    for (const e of events) {
      const region = e.region;
      if (!region) continue;
      const list = groups.get(region) ?? [];
      list.push(e);
      groups.set(region, list);
    }

    const result: RegionRow[] = [];
    for (const [regionId, group] of groups) {
      const approvedEvents = group.filter(
        (e) => e.underbossStatus === 'approved' && !e.cancelledAt
      );
      const totalEvents = approvedEvents.length;
      if (totalEvents === 0) continue;

      let eventsWithVenue = 0;
      let eventsWithBudget = 0;
      let eventsWithKit = 0;
      let eventsWithTeam = 0;
      let eventsWithSponsors = 0;
      let eventsWithSocial = 0;
      let eventsWithThrown = 0;

      for (const e of approvedEvents) {
        if (e.progress.hasVenue) eventsWithVenue++;
        if (e.progress.hasBudget) eventsWithBudget++;
        if (e.progress.hasPartyKit) eventsWithKit++;
        if (e.progress.hasCoHosts) eventsWithTeam++;
        if (e.progress.hasSponsors) eventsWithSponsors++;
        if (e.progress.hasSocialPosts) eventsWithSocial++;
        if (e.progress.hasThrown) eventsWithThrown++;
      }

      const pct = (n: number) => (totalEvents > 0 ? Math.round((n / totalEvents) * 100) : 0);

      result.push({
        regionId,
        label: GPP_REGIONS.find((r) => r.id === regionId)?.label || regionId,
        totalEvents,
        venuePct: pct(eventsWithVenue),
        budgetPct: pct(eventsWithBudget),
        kitPct: pct(eventsWithKit),
        teamPct: pct(eventsWithTeam),
        sponsorsPct: pct(eventsWithSponsors),
        socialPct: pct(eventsWithSocial),
        thrownPct: pct(eventsWithThrown),
      });
    }

    result.sort((a, b) => b.totalEvents - a.totalEvents);
    return result;
  }, [events]);

  if (rows.length === 0) return null;

  return (
    <div className="card p-4">
      <h2 className="text-xs text-theme-text-muted uppercase tracking-wider mb-3">
        {t('regionBreakdown.title')}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-stroke">
              <th className="py-2 px-3 text-left text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionBreakdown.region')}
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionBreakdown.approved')}
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.venue')} %
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.budget')} %
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.kit')} %
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.team')} %
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.sponsors')} %
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.social')} %
              </th>
              <th className="py-2 px-3 text-right text-xs uppercase tracking-wider text-theme-text-faint">
                {t('regionStats.thrown')} %
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.regionId}
                className="border-b border-theme-stroke/50 hover:bg-theme-surface/50 transition-colors"
              >
                <td className="py-2 px-3 text-theme-text font-medium">{row.label}</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.totalEvents}</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.venuePct}%</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.budgetPct}%</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.kitPct}%</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.teamPct}%</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.sponsorsPct}%</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.socialPct}%</td>
                <td className="py-2 px-3 text-right text-theme-text-secondary">{row.thrownPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
