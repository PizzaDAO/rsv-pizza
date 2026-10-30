import { canonicalCityName, cityKeyFromPartyName } from '../helpers/underbossScope.js';

/**
 * bellpepper-36121: pure check logic for the GPP27 RSVP-page verification tool.
 *
 * `runChecks(party, ctx)` turns one party record (+ bulk-loaded context) into a
 * list of pass / warn / fail results. No I/O here, so it is trivially testable;
 * the route loads everything with a fixed number of queries and calls this per row.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type CheckId =
  | 'page-resolves'
  | 'rsvp-open'
  | 'date'
  | 'venue'
  | 'image'
  | 'capacity'
  | 'description'
  | 'year'
  | 'duplicate'
  | 'host'
  | 'nft'
  | 'approval';

export interface CheckResult {
  id: CheckId;
  label: string;
  status: CheckStatus;
  reason: string;
}

export interface VerificationParty {
  id: string;
  name: string;
  inviteCode: string;
  customUrl: string | null;
  date: Date | null;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  addressIsCityDefault: boolean;
  eventImageUrl: string | null;
  description: string | null;
  maxGuests: number | null;
  venueCapacity: number | null;
  expectedGuests: number | null;
  rsvpClosedAt: Date | null;
  cancelledAt: Date | null;
  requireApproval: boolean;
  nftEnabled: boolean;
  eventTags: string[];
  city: string | null;
  country: string | null;
  coHosts: unknown;
  hostEmail: string | null;
  hostName: string | null;
}

export interface VerificationContext {
  now: Date;
  /** The GPP year being verified (e.g. 2027). */
  year: number;
  /** Tag stamped on pre-launch events of that year (e.g. 'gpp2027'). */
  yearTag: string;
  /** Lower-cased slugs that other parties own as an inviteCode (the resolver checks inviteCode first). */
  otherInviteCodes: ReadonlySet<string>;
  /** Slugs that are top-level app routes. */
  reservedSlugs: ReadonlySet<string>;
  /** ids of OTHER approved/listed, non-cancelled parties for the same city. */
  duplicateIds: readonly string[];
}

/** Top-level paths served by the SPA/backend before the `/:slug` event route. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'login', 'new', 'gpp', 'gpp27', 'side', 'pizza-index', 'events', 'map', 'partners', 'leaderboard',
  'tax-form', 'payments', 'photos', 'account', 'auth', 'report', 'venue-report', 'rsvp', 'host', 'run',
  'checkin', 'dj', 'display', 'underboss', 'shipping', 'admin', 'suggestions', 'partner',
  'partner-dashboard', 'sponsor-dashboard', 'partner-intake', 'invoice', 'mou', 'sponsor-intake',
  'graphics', 'post', 'onesheet', 'survey', 'host-survey', 'series', 'api', 'assets', 'static',
  'favicon.ico', 'robots.txt', 'sitemap.xml',
]);

const SYSTEM_COHOST_EMAIL = 'hello@rarepizzas.com';

function nonEmpty(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

/** Stable city identity used for duplicate detection: canonical city + country. */
export function cityIdentity(p: Pick<VerificationParty, 'city' | 'name' | 'country'>): string {
  const city = canonicalCityName(p.city || cityKeyFromPartyName(p.name) || '');
  if (!city) return '';
  return `${city}|${(p.country || '').trim().toLowerCase()}`;
}

/**
 * Row status = worst check. The `approval` check is informational (GPP events
 * default to requireApproval=true), so it is shown but never colors the row.
 */
export function worstStatus(results: readonly CheckResult[]): CheckStatus {
  const counted = results.filter((r) => r.id !== 'approval');
  if (counted.some((r) => r.status === 'fail')) return 'fail';
  if (counted.some((r) => r.status === 'warn')) return 'warn';
  return 'pass';
}

export function runChecks(p: VerificationParty, ctx: VerificationContext): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (id: CheckId, label: string, status: CheckStatus, reason: string) =>
    out.push({ id, label, status, reason });

  // 1. Page resolves
  {
    const label = 'Page resolves';
    const slug = (p.customUrl || '').trim().toLowerCase();
    if (!slug) {
      add('page-resolves', label, 'warn', 'No custom URL; page only resolves via the invite-code link');
    } else if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 3 || slug.length > 50) {
      add('page-resolves', label, 'fail', `Custom URL "${slug}" is invalid (3-50 chars, a-z 0-9 -)`);
    } else if (ctx.reservedSlugs.has(slug)) {
      add('page-resolves', label, 'fail', `"/${slug}" is a reserved app route`);
    } else if (ctx.otherInviteCodes.has(slug)) {
      add('page-resolves', label, 'fail', `"/${slug}" matches another event's invite code, which wins`);
    } else {
      add('page-resolves', label, 'pass', `/${slug} resolves to this event`);
    }
  }

  // 2. RSVP open
  {
    const label = 'RSVP open';
    if (p.cancelledAt) add('rsvp-open', label, 'fail', 'Event is cancelled');
    else if (p.rsvpClosedAt) add('rsvp-open', label, 'fail', 'RSVPs are closed');
    else if (!p.date) add('rsvp-open', label, 'fail', 'No date set');
    else if (p.date.getTime() <= ctx.now.getTime()) add('rsvp-open', label, 'fail', 'Event date has passed');
    else add('rsvp-open', label, 'pass', 'RSVPs are open');
  }

  // 3. Date/time
  {
    const label = 'Date & time';
    if (!p.date) add('date', label, 'fail', 'No date/time set');
    else if (!nonEmpty(p.timezone)) add('date', label, 'warn', 'Date set but no timezone');
    else add('date', label, 'pass', 'Date and timezone set');
  }

  // 4. Venue / location
  {
    const label = 'Venue';
    const hasAddress = nonEmpty(p.address);
    const hasVenue = nonEmpty(p.venueName);
    if (!hasAddress && !hasVenue) add('venue', label, 'fail', 'No venue or address');
    else if (!hasAddress) add('venue', label, 'fail', 'Venue name but no address');
    else if (p.addressIsCityDefault || !hasVenue) add('venue', label, 'warn', 'Only a city-level location (no venue name yet)');
    else add('venue', label, 'pass', 'Venue name and address set');
  }

  // 5. Flyer / image
  add('image', 'Flyer image', nonEmpty(p.eventImageUrl) ? 'pass' : 'fail',
    nonEmpty(p.eventImageUrl) ? 'Event image set' : 'No flyer/event image');

  // 6. Capacity
  {
    const cap = [p.maxGuests, p.venueCapacity, p.expectedGuests].find((n) => typeof n === 'number' && n > 0);
    add('capacity', 'Capacity', cap ? 'pass' : 'warn',
      cap ? `Capacity/guest cap ${cap}` : 'No capacity, guest cap or expected guests');
  }

  // 7. Description
  add('description', 'Description', nonEmpty(p.description) ? 'pass' : 'fail',
    nonEmpty(p.description) ? 'Description set' : 'No description');

  // 8. Correct year
  {
    const label = 'Correct year';
    const slug = (p.customUrl || '').toLowerCase();
    const yy = String(ctx.year).slice(2);
    const dateYear = p.date ? p.date.getUTCFullYear() : null;
    const suffix = slug.match(/^.+?(\d{2})(?:-\d+)?$/);
    const problems: string[] = [];
    if (dateYear !== null && dateYear !== ctx.year) problems.push(`date is in ${dateYear}, not ${ctx.year}`);
    if (suffix && suffix[1] !== yy) problems.push(`slug ends in "${suffix[1]}", expected "${yy}" or no year suffix`);
    if (problems.length) add('year', label, 'fail', problems.join('; '));
    else if (!p.eventTags.some((t) => t.toLowerCase() === ctx.yearTag.toLowerCase())) {
      add('year', label, 'warn', `Missing "${ctx.yearTag}" tag`);
    } else add('year', label, 'pass', `${ctx.year} event`);
  }

  // 9. Duplicates
  add('duplicate', 'No duplicate', ctx.duplicateIds.length ? 'fail' : 'pass',
    ctx.duplicateIds.length
      ? `${ctx.duplicateIds.length} other approved ${ctx.year} event(s) for the same city`
      : 'Only approved event for this city');

  // 10. Host
  {
    const label = 'Host present';
    const email = (p.hostEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      add('host', label, 'fail', 'No host account/email');
    } else {
      const coHosts = Array.isArray(p.coHosts) ? (p.coHosts as any[]) : [];
      const hostListed = coHosts.some(
        (h) => h && typeof h.email === 'string' && h.email.toLowerCase() === email && h.canEdit !== false,
      );
      const realOthers = coHosts.filter(
        (h) => h && typeof h.email === 'string' && h.email.toLowerCase() !== email
          && h.email.toLowerCase() !== SYSTEM_COHOST_EMAIL && !h.isUnderboss,
      );
      if (!nonEmpty(p.hostName)) add('host', label, 'warn', 'Host has no name');
      else if (!hostListed) add('host', label, 'warn', 'Host is not in the co-host list with edit access');
      else add('host', label, 'pass', `Host ${email}${realOthers.length ? ` + ${realOthers.length} co-host(s)` : ''}`);
    }
  }

  // 11. NFT
  if (p.nftEnabled && !nonEmpty(p.eventImageUrl)) {
    add('nft', 'NFT mint', 'fail', 'NFT enabled but no event image (mint requires it)');
  } else {
    add('nft', 'NFT mint', 'pass', p.nftEnabled ? 'NFT enabled with image' : 'NFT not enabled');
  }

  // 12. Approval flag (informational; does not color the row)
  add('approval', 'Guest approval', p.requireApproval ? 'warn' : 'pass',
    p.requireApproval ? 'Requires approval (guests wait for host OK)' : 'Open RSVP, no approval needed');

  return out;
}
