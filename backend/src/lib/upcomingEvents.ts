/**
 * Upcoming curated events for PizzaDAO's member app (service-to-service), used to invite members to events
 * near their city. HTTP surface and auth live in routes/service.routes.ts (POST /api/service/upcoming-events).
 *
 * An event is returned only when ALL hold:
 *   - it is curated: underboss_status is 'approved' or 'listed', and it is a Global Pizza Party (event_type
 *     'gpp') or belongs to an event series (kind 'gpp' / 'series')
 *   - it is public: not event_type 'private', no password
 *   - it is not cancelled, starts after now and no later than `until`, and has coordinates
 *
 * The result is data-minimal: id, public link, name, start, timezone, city, coordinates, whether the
 * coordinates are only a city centre, whether it is full or closed, and the kind. Never the street address,
 * host, guests, counts, emails or wallets. "Full" is computed from a guest COUNT only.
 */
import { prisma } from '../config/database.js';
import { brandUrl } from '../config/brand.js';
import { IdentifierError } from './gppHostLookup.js';

export const UPCOMING_STATUSES = ['approved', 'listed'] as const;
export const MAX_UPCOMING_EVENTS = 500;
export const DEFAULT_UPCOMING_DAYS = 45;
export const MAX_UPCOMING_DAYS = 120;
const DAY_MS = 24 * 3600 * 1000;

export interface UpcomingQuery {
  until: Date;
  limit: number;
}

export interface UpcomingEvent {
  eventId: string;
  url: string;
  name: string;
  date: string;
  timezone: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  addressIsCityDefault: boolean;
  full: boolean;
  rsvpClosed: boolean;
  kind: 'gpp' | 'series';
}

/** Validate the body: { until?: ISO date, limit?: 1..500 }. Throws IdentifierError (400) on bad input. */
export function parseUpcomingQuery(body: unknown, now = new Date()): UpcomingQuery {
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    throw new IdentifierError('Body must be a JSON object');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const cap = new Date(now.getTime() + MAX_UPCOMING_DAYS * DAY_MS);
  let until = new Date(now.getTime() + DEFAULT_UPCOMING_DAYS * DAY_MS);
  if (b.until !== undefined) {
    if (typeof b.until !== 'string' || b.until.length > 40) throw new IdentifierError('until must be an ISO date');
    const d = new Date(b.until);
    if (Number.isNaN(d.getTime())) throw new IdentifierError('until must be an ISO date');
    until = d > cap ? cap : d;
  }
  let limit = MAX_UPCOMING_EVENTS;
  if (b.limit !== undefined) {
    if (typeof b.limit !== 'number' || !Number.isInteger(b.limit) || b.limit < 1 || b.limit > MAX_UPCOMING_EVENTS) {
      throw new IdentifierError(`limit must be an integer from 1 to ${MAX_UPCOMING_EVENTS}`);
    }
    limit = b.limit;
  }
  return { until, limit };
}

/** The visibility predicate, exported so the tests pin it. */
export function upcomingWhere(now: Date, until: Date) {
  return {
    underbossStatus: { in: [...UPCOMING_STATUSES] },
    cancelledAt: null,
    password: null,
    date: { gt: now, lte: until },
    latitude: { not: null },
    longitude: { not: null },
    AND: [
      { OR: [{ eventType: null }, { eventType: { not: 'private' } }] },
      { OR: [{ eventType: 'gpp' }, { eventSeriesId: { not: null } }] },
    ],
  };
}

export async function findUpcomingEvents(q: UpcomingQuery, now = new Date(), db = prisma): Promise<UpcomingEvent[]> {
  const parties = await db.party.findMany({
    where: upcomingWhere(now, q.until),
    orderBy: { date: 'asc' },
    take: q.limit,
    select: {
      id: true,
      name: true,
      inviteCode: true,
      customUrl: true,
      date: true,
      timezone: true,
      city: true,
      latitude: true,
      longitude: true,
      addressIsCityDefault: true,
      maxGuests: true,
      rsvpClosedAt: true,
      eventType: true,
    },
  });

  // Capacity from a guest COUNT per event only (never guest rows): confirmed or pending, not declined.
  const capped = parties.filter((p) => p.maxGuests && p.maxGuests > 0).map((p) => p.id);
  const counts = new Map<string, number>();
  if (capped.length) {
    const rows = await db.guest.groupBy({
      by: ['partyId'],
      where: {
        partyId: { in: capped },
        status: { in: ['CONFIRMED', 'PENDING'] },
        OR: [{ approved: null }, { approved: true }],
      },
      _count: { _all: true },
    });
    for (const r of rows) counts.set(r.partyId, r._count._all);
  }

  const out: UpcomingEvent[] = [];
  for (const p of parties) {
    if (!p.date || p.latitude === null || p.longitude === null) continue;
    out.push({
      eventId: p.id,
      url: brandUrl(p.customUrl || p.inviteCode),
      name: p.name,
      date: p.date.toISOString(),
      timezone: p.timezone ?? null,
      city: p.city ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
      addressIsCityDefault: p.addressIsCityDefault,
      full: !!p.maxGuests && (counts.get(p.id) ?? 0) >= p.maxGuests,
      rsvpClosed: p.rsvpClosedAt !== null,
      kind: p.eventType === 'gpp' ? 'gpp' : 'series',
    });
  }
  return out;
}
