import type { Guest, CoHost } from '../../../types';

/**
 * A printable badge. Deliberately has NO email field: guest emails are only read inside
 * buildBadges (to detect co-hosts) and can never reach the DOM through a Badge.
 */
export interface Badge {
  key: string;
  name: string;
  /** Host / Co-host / Partner / RSVP role. */
  role?: string;
  blank?: boolean;
}

export type GuestSource = 'going' | 'approved' | 'checkedIn' | 'none';

export interface BuildBadgesOptions {
  source: GuestSource;
  includeWaitlist?: boolean;
  /** Show a role line (Host / Co-host / Partner / first RSVP role). */
  roleLine?: boolean;
  roleLabels: { host: string; coHost: string; partner: string };
  hostName?: string | null;
  sort?: 'name' | 'rsvp';
  locale?: string;
}

const EMAIL_RE = /\S+@\S+\.\S+/;

/** Never print an email: if a guest typed one as their name, keep only the part before the "@". */
export function safeName(raw: string | undefined | null): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  if (EMAIL_RE.test(name) || name.includes('@')) return name.split('@')[0].trim();
  return name;
}

function included(g: Guest, source: GuestSource, includeWaitlist: boolean): boolean {
  if (source === 'none') return false;
  if (g.approved === false) return false;
  const waitlisted = g.status === 'WAITLISTED';
  if (waitlisted && !includeWaitlist) return false;
  if (source === 'approved') return g.approved === true;
  if (source === 'checkedIn') return !!g.checkedInAt;
  return true;
}

export function buildBadges(guests: Guest[], coHosts: CoHost[], opts: BuildBadgesOptions): Badge[] {
  const { source, includeWaitlist = false, roleLine = false, roleLabels, hostName, sort = 'name', locale } = opts;
  const coHostByEmail = new Map<string, CoHost>();
  for (const c of coHosts) if (c.email) coHostByEmail.set(c.email.trim().toLowerCase(), c);
  const host = (hostName ?? '').trim().toLowerCase();

  const seen = new Set<string>();
  const rows: { badge: Badge; at: number }[] = [];
  guests.forEach((g, i) => {
    if (!included(g, source, includeWaitlist)) return;
    const id = g.id ?? `idx-${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    const name = safeName(g.name);
    if (!name) return;

    let role: string | undefined;
    if (roleLine) {
      const ch = g.email ? coHostByEmail.get(g.email.trim().toLowerCase()) : undefined;
      if (ch?.isPartner) role = roleLabels.partner;
      else if (ch) role = roleLabels.coHost;
      else if (host && name.toLowerCase() === host) role = roleLabels.host;
      else if (g.roles?.[0]) role = safeName(g.roles[0]);
    }
    rows.push({ badge: { key: `g-${id}`, name, role }, at: g.submittedAt ? Date.parse(g.submittedAt) || 0 : 0 });
  });

  if (sort === 'rsvp') rows.sort((a, b) => a.at - b.at);
  else {
    const collator = new Intl.Collator(locale || undefined, { sensitivity: 'base' });
    rows.sort((a, b) => collator.compare(a.badge.name, b.badge.name));
  }
  return rows.map((r) => r.badge);
}

/** One badge per non-empty line of typed text. */
export function typedBadges(text: string): Badge[] {
  return text
    .split('\n')
    .map((l) => safeName(l))
    .filter(Boolean)
    .map((name, i) => ({ key: `t-${i}`, name }));
}

export function blankBadges(n: number): Badge[] {
  const count = Math.max(0, Math.min(48, Math.floor(n) || 0));
  return Array.from({ length: count }, (_, i) => ({ key: `b-${i}`, name: '', blank: true }));
}
