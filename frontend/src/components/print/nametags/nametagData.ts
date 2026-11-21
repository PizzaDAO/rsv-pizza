import type { Guest, CoHost } from '../../../types';

/**
 * A printable badge. Deliberately has NO email field: guest emails are only read inside
 * buildBadges (to detect co-hosts) and can never reach the DOM through a Badge.
 */
export interface NametagMember {
  memberId: string;
  name: string;
  pfpUrl: string;
  crews?: { id: string; label: string; emoji?: string }[];
  city?: string;
  levelCompleted?: number;
  levelTitle?: string;
}

export interface Badge {
  key: string;
  name: string;
  /** PizzaDAO member details (from the member lookup). Never carries an email or wallet. */
  member?: NametagMember;
  /** Host / Co-host / Partner / RSVP role. */
  role?: string;
  blank?: boolean;
}

/** 'pick' starts from "everyone going"; the builder then filters it by the checklist. */
export type GuestSource = 'going' | 'approved' | 'checkedIn' | 'pick' | 'none';

export interface BuildBadgesOptions {
  source: GuestSource;
  includeWaitlist?: boolean;
  /** Show a role line (Host / Co-host / Partner / first RSVP role). */
  roleLine?: boolean;
  roleLabels: { host: string; coHost: string; partner: string };
  hostName?: string | null;
  sort?: 'name' | 'rsvp';
  locale?: string;
  /** guest id -> PizzaDAO member (from GET /api/parties/:id/nametags). Matched guests print as member tags. */
  members?: Record<string, NametagMember>;
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
  const { source, includeWaitlist = false, roleLine = false, roleLabels, hostName, sort = 'name', locale, members } = opts;
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
    const member = g.id ? members?.[g.id] : undefined;
    const name = (member && safeName(member.name)) || safeName(g.name);
    if (!name) return;

    let role: string | undefined;
    if (roleLine) {
      const ch = g.email ? coHostByEmail.get(g.email.trim().toLowerCase()) : undefined;
      if (ch?.isPartner) role = roleLabels.partner;
      else if (ch) role = roleLabels.coHost;
      else if (host && name.toLowerCase() === host) role = roleLabels.host;
      else if (g.roles?.[0]) role = safeName(g.roles[0]);
    }
    rows.push({ badge: { key: `g-${id}`, name, role, ...(member ? { member } : {}) }, at: g.submittedAt ? Date.parse(g.submittedAt) || 0 : 0 });
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
  // Keys are name + occurrence (not line index), so per-badge pronouns stay with the right
  // badge when other lines are added, removed or reordered.
  const counts = new Map<string, number>();
  return text
    .split('\n')
    .map((l) => safeName(l))
    .filter(Boolean)
    .map((name) => {
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      return { key: `t-${name}-${n}`, name };
    });
}

/** Letters we are confident about splitting on: Latin script (with marks, apostrophes, hyphens, dots). */
const LATIN_NAME_RE = /^[\p{Script=Latin}\p{M}'’.\-\s]+$/u;

/**
 * "First name big, last name small". Splits on the first space for Latin-script names with
 * at least two words. Single names, names in other scripts (CJK, Arabic, ...) and anything
 * unclear return null, meaning "print the name whole".
 */
export function splitName(name: string): { first: string; last: string } | null {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n || !LATIN_NAME_RE.test(n)) return null;
  const i = n.indexOf(' ');
  if (i < 1) return null;
  const first = n.slice(0, i);
  const last = n.slice(i + 1).trim();
  if (!/\p{L}/u.test(first) || !/\p{L}/u.test(last)) return null;
  return { first, last };
}

export function blankBadges(n: number): Badge[] {
  const count = Math.max(0, Math.min(48, Math.floor(n) || 0));
  return Array.from({ length: count }, (_, i) => ({ key: `b-${i}`, name: '', blank: true }));
}

/** Info lines printed under a member's name: "#12 · Level 3 Sous Chef" and "Crew, Crew · City". */
export function memberInfoLines(member: NametagMember, levelLabel = 'Level'): string[] {
  const level = typeof member.levelCompleted === 'number' ? `${levelLabel} ${member.levelCompleted}${member.levelTitle ? ` ${member.levelTitle}` : ''}` : '';
  const crews = (member.crews ?? []).map((c) => `${c.emoji ? `${c.emoji} ` : ''}${c.label}`).join(', ');
  return [[`#${member.memberId}`, level].filter(Boolean).join(' · '), [crews, member.city].filter(Boolean).join(' · ')].filter(Boolean);
}
