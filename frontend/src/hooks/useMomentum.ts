import { useMemo } from 'react';
import type { Guest, MomentumDelta } from '../types';

/**
 * quattro-71244: derives velocity stats from the guests list.
 *
 * - `lastHour`: guests submitted within the last 60 minutes.
 * - `today`: guests submitted with local date == today.
 * - `busiestHourLabel`: hour-of-day label (e.g. "7pm") with the most RSVPs.
 *   Returns null when fewer than 5 guests exist (not statistically meaningful).
 *
 * `Guest.submittedAt` is the canonical timestamp (see frontend/src/types.ts).
 * Invited rows have a `submittedAt` from when the invite landed; for v1 we
 * count all rows uniformly — host can hide the metric per-tile if it feels
 * misleading on a bulk-invite event.
 */

function hourLabel(hour: number): string {
  // 12-hour clock with am/pm.
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? 'am' : 'pm';
  return `${h12}${ampm}`;
}

export function useMomentum(guests: Guest[]): MomentumDelta {
  return useMemo<MomentumDelta>(() => {
    if (!Array.isArray(guests) || guests.length === 0) {
      return { lastHour: 0, today: 0, busiestHourLabel: null };
    }

    const now = new Date();
    const oneHourAgo = now.getTime() - 60 * 60 * 1000;
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();

    let lastHour = 0;
    let today = 0;
    const hourCounts: Record<number, number> = {};

    for (const g of guests) {
      if (!g.submittedAt) continue;
      const ts = Date.parse(g.submittedAt);
      if (Number.isNaN(ts)) continue;
      if (ts >= oneHourAgo) lastHour += 1;
      const d = new Date(ts);
      if (d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD) {
        today += 1;
      }
      const h = d.getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }

    // Busiest hour requires at least 5 dated guests to avoid noise.
    let busiestHourLabel: string | null = null;
    const datedCount = Object.values(hourCounts).reduce((sum, n) => sum + n, 0);
    if (datedCount >= 5) {
      let bestHour = -1;
      let bestCount = -1;
      for (const [hStr, count] of Object.entries(hourCounts)) {
        const h = Number(hStr);
        if (count > bestCount) {
          bestCount = count;
          bestHour = h;
        }
      }
      if (bestHour >= 0) busiestHourLabel = hourLabel(bestHour);
    }

    return { lastHour, today, busiestHourLabel };
  }, [guests]);
}
