import type { UserPartyListItem } from './api';

export interface GroupedEvents {
  hosting: UserPartyListItem[];
  attending: UserPartyListItem[];
  tbd: UserPartyListItem[];
}

/** Split the user's events into Hosting / Attending (dated) and a separate Date TBD bucket. */
export function groupEvents(
  parties: UserPartyListItem[],
  opts: { filter: 'upcoming' | 'past'; query: string; now?: Date },
): GroupedEvents {
  const now = opts.now ?? new Date();
  const q = opts.query.trim().toLowerCase();
  const out: GroupedEvents = { hosting: [], attending: [], tbd: [] };
  for (const p of parties) {
    const d = p.date ? new Date(p.date) : null;
    const isUpcoming = !d || d >= now;
    if (opts.filter === 'upcoming' ? !isUpcoming : isUpcoming) continue;
    if (q && !`${p.name ?? ''} ${p.address ?? ''}`.toLowerCase().includes(q)) continue;
    if (!d) out.tbd.push(p);
    else if (p.role === 'guest') out.attending.push(p);
    else out.hosting.push(p);
  }
  return out;
}

/** Apply a "show N at a time" limit across hosting then attending (TBD is its own collapsed group). */
export function paginateGroups(
  g: GroupedEvents,
  limit: number,
): { hosting: UserPartyListItem[]; attending: UserPartyListItem[]; total: number } {
  const total = g.hosting.length + g.attending.length;
  const hosting = g.hosting.slice(0, limit);
  const attending = g.attending.slice(0, Math.max(0, limit - hosting.length));
  return { hosting, attending, total };
}

/** Like "Thu, Nov 19, 7:00 PM"; includes the year when it isn't the current year. */
export function formatPartyDate(dateStr: string | null, tbdLabel: string, now: Date = new Date()): string {
  if (!dateStr) return tbdLabel;
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });
}
