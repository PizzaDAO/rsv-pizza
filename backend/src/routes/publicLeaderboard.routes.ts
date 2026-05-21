import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { getCountryCode } from '../lib/countryCode.js';

/**
 * stromboli-71593: public leaderboard for GPP parties + countries.
 *
 * Mounted at `/api/leaderboard` so the full path is
 *   GET /api/leaderboard?window=all|year&limit=&offset=
 *
 * Scope is hardcoded:
 *   - underbossStatus='approved'
 *   - eventType='gpp'
 *
 * Composite party score (per stromboli-71593 plan + Snax review):
 *   1.0 * link_rsvps   (submittedVia in {'link','rsvp','api'}, status != 'INVITED', approved != false)
 * + 0.3 * invite_rsvps (submittedVia = 'invite' that converted: status != 'INVITED', approved != false)
 * + 2.0 * check_ins    (checkedInAt IS NOT NULL)
 * + 0.5 * photos       (photos.status='approved', capped at 100 per party)
 *
 * Country score = SUM(party.score) over parties grouped by case-insensitive,
 * trimmed `parties.country`. Parties with NULL country are excluded from the
 * country board but still appear on the party board.
 *
 * NOT to be confused with the quattro-71244 private "where am I ranked" pill
 * at /api/parties/:partyId/leaderboard-rank (see leaderboard.routes.ts).
 *
 * Cache: in-memory, 5-minute TTL, plus `Cache-Control: public, max-age=300`.
 */

// ---- scoring weights ----
const W_LINK = 1.0;
const W_INVITE = 0.3;
const W_CHECKIN = 2.0;
const W_PHOTO = 0.5;
const PHOTO_CAP = 100;

// Link-like submittedVia values count as "real RSVPs". `host` and `host-checkin`
// are excluded (auto-self-RSVP + host-side flows). See
// architecture_submitted_via_values.md.
const LINK_VIAS = new Set(['link', 'rsvp', 'api']);
const INVITE_VIA = 'invite';

// ---- types ----
type WindowKey = 'all' | 'year';

export interface LeaderboardPartyRow {
  rank: number;
  id: string;
  name: string;
  hostName: string | null;
  city: string | null;
  slug: string;
  url: string;
  country: string | null;
  countryCode: string | null;
  eventImageUrl: string | null;
  score: number;
  breakdown: {
    linkRsvps: number;
    inviteRsvps: number;
    checkIns: number;
    photos: number;
  };
}

export interface LeaderboardCountryRow {
  rank: number;
  country: string;
  countryCode: string | null;
  partyCount: number;
  score: number;
}

export interface LeaderboardResponse {
  window: WindowKey;
  computedAt: string;
  parties: {
    rows: LeaderboardPartyRow[];
    total: number;
    limit: number;
    offset: number;
  };
  countries: {
    rows: LeaderboardCountryRow[];
    total: number;
  };
}

// ---- cache ----
const TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  expiresAt: number;
  /** Full computed response *without* limit/offset slicing (we slice per request). */
  data: {
    window: WindowKey;
    computedAt: string;
    parties: LeaderboardPartyRow[];
    countries: LeaderboardCountryRow[];
  };
}
const cache = new Map<WindowKey, CacheEntry>();

function cacheKey(windowKey: WindowKey): WindowKey {
  return windowKey;
}

// ---- score helpers ----

/** Round to 1 decimal place to keep the JSON tidy + comparable across calls. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface PartyShape {
  id: string;
  name: string;
  customUrl: string | null;
  inviteCode: string;
  city: string | null;
  country: string | null;
  eventImageUrl: string | null;
  createdAt: Date;
  date: Date | null;
  coHosts: any; // JSON
  user: { name: string | null } | null;
  guests: Array<{
    submittedVia: string;
    status: string;
    approved: boolean | null;
    checkedInAt: Date | null;
  }>;
  photos: Array<{ id: string }>;
}

/**
 * Resolve a display host name for the leaderboard row.
 *
 *   1. First non-hidden co-host (showOnEvent !== false) that has a name.
 *   2. Fallback: party.user.name.
 *   3. null if neither is available.
 *
 * Co-host order is the insertion order of the JSON array (we don't have a
 * sortOrder/sortIndex in the JSON shape; mirrors how EventPage renders them).
 */
function resolveHostName(party: PartyShape): string | null {
  const coHosts: any[] = Array.isArray(party.coHosts) ? party.coHosts : [];
  for (const ch of coHosts) {
    if (!ch || typeof ch !== 'object') continue;
    if (ch.showOnEvent === false) continue;
    if (typeof ch.name === 'string' && ch.name.trim().length > 0) {
      return ch.name.trim();
    }
  }
  if (party.user?.name && party.user.name.trim().length > 0) {
    return party.user.name.trim();
  }
  return null;
}

/** Compute the composite score + breakdown for a single party. */
export function scoreParty(party: PartyShape): {
  score: number;
  breakdown: { linkRsvps: number; inviteRsvps: number; checkIns: number; photos: number };
} {
  let linkRsvps = 0;
  let inviteRsvps = 0;
  let checkIns = 0;
  for (const g of party.guests) {
    if (g.checkedInAt) checkIns += 1;
    // Reject hard-declined and INVITED-but-not-yet-converted rows. `approved`
    // can be null (pending) — we count those as link RSVPs since they're real
    // form submissions.
    if (g.approved === false) continue;
    if (g.status === 'INVITED') continue;
    if (LINK_VIAS.has(g.submittedVia)) {
      linkRsvps += 1;
    } else if (g.submittedVia === INVITE_VIA) {
      inviteRsvps += 1;
    }
  }
  const photos = Math.min(party.photos.length, PHOTO_CAP);
  const score =
    W_LINK * linkRsvps +
    W_INVITE * inviteRsvps +
    W_CHECKIN * checkIns +
    W_PHOTO * photos;
  return {
    score: round1(score),
    breakdown: { linkRsvps, inviteRsvps, checkIns, photos },
  };
}

/**
 * Tiebreaker comparator for two rows with metadata.
 *
 * Order: score DESC, checkIns DESC, linkRsvps DESC, createdAt ASC
 * (older event wins so the board churns less).
 */
function compareRows(
  a: { score: number; breakdown: { checkIns: number; linkRsvps: number }; createdAt: Date },
  b: { score: number; breakdown: { checkIns: number; linkRsvps: number }; createdAt: Date },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.breakdown.checkIns !== a.breakdown.checkIns) return b.breakdown.checkIns - a.breakdown.checkIns;
  if (b.breakdown.linkRsvps !== a.breakdown.linkRsvps) return b.breakdown.linkRsvps - a.breakdown.linkRsvps;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Group party rows into country rows. Case-insensitive + trimmed match.
 * Display the most common original-case spelling per group (ties → first seen).
 */
export function aggregateCountries(parties: LeaderboardPartyRow[]): LeaderboardCountryRow[] {
  interface Acc {
    /** original-case spelling counts so we can pick the canonical name */
    spellingCounts: Map<string, number>;
    /** first spelling encountered (used to tie-break when no clear winner) */
    firstSpelling: string;
    score: number;
    partyCount: number;
  }
  const groups = new Map<string, Acc>();
  for (const p of parties) {
    if (!p.country) continue;
    const trimmed = p.country.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        spellingCounts: new Map(),
        firstSpelling: trimmed,
        score: 0,
        partyCount: 0,
      };
      groups.set(key, acc);
    }
    acc.spellingCounts.set(trimmed, (acc.spellingCounts.get(trimmed) || 0) + 1);
    acc.score += p.score;
    acc.partyCount += 1;
  }
  const rows: LeaderboardCountryRow[] = [];
  for (const acc of groups.values()) {
    if (acc.score <= 0) continue; // hide score-0 countries
    // Pick the most-frequent spelling; ties → firstSpelling.
    let best = acc.firstSpelling;
    let bestCount = 0;
    for (const [spelling, count] of acc.spellingCounts.entries()) {
      if (count > bestCount) {
        best = spelling;
        bestCount = count;
      }
    }
    rows.push({
      rank: 0, // assigned after sort
      country: best,
      countryCode: getCountryCode(best),
      partyCount: acc.partyCount,
      score: round1(acc.score),
    });
  }
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.partyCount !== a.partyCount) return b.partyCount - a.partyCount;
    return a.country.localeCompare(b.country);
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

/** Build the canonical event slug + URL pair for a party. */
function partyUrl(customUrl: string | null, inviteCode: string): { slug: string; url: string } {
  const slug = customUrl || inviteCode;
  return { slug, url: `https://rsv.pizza/${slug}` };
}

// ---- core computation ----

export async function computeLeaderboard(windowKey: WindowKey): Promise<{
  window: WindowKey;
  computedAt: string;
  parties: LeaderboardPartyRow[];
  countries: LeaderboardCountryRow[];
}> {
  const where: any = {
    underbossStatus: 'approved',
    eventType: 'gpp',
  };
  if (windowKey === 'year') {
    // calendar 2026 by parties.date — un-dated GPP events drop from year view.
    where.date = {
      gte: new Date(Date.UTC(2026, 0, 1)),
      lt: new Date(Date.UTC(2027, 0, 1)),
    };
  }

  const parties = (await prisma.party.findMany({
    where,
    select: {
      id: true,
      name: true,
      customUrl: true,
      inviteCode: true,
      city: true,
      country: true,
      eventImageUrl: true,
      createdAt: true,
      date: true,
      coHosts: true,
      user: { select: { name: true } },
      guests: {
        select: {
          submittedVia: true,
          status: true,
          approved: true,
          checkedInAt: true,
        },
      },
      photos: {
        where: { status: 'approved' },
        select: { id: true },
      },
    },
  })) as unknown as PartyShape[];

  // Score every party, then drop score-0.
  const scored: Array<{
    party: PartyShape;
    score: number;
    breakdown: { linkRsvps: number; inviteRsvps: number; checkIns: number; photos: number };
  }> = [];
  for (const party of parties) {
    const { score, breakdown } = scoreParty(party);
    if (score <= 0) continue;
    scored.push({ party, score, breakdown });
  }

  scored.sort((a, b) =>
    compareRows(
      { score: a.score, breakdown: a.breakdown, createdAt: a.party.createdAt },
      { score: b.score, breakdown: b.breakdown, createdAt: b.party.createdAt },
    ),
  );

  const partyRows: LeaderboardPartyRow[] = scored.map(({ party, score, breakdown }, i) => {
    const { slug, url } = partyUrl(party.customUrl, party.inviteCode);
    return {
      rank: i + 1,
      id: party.id,
      name: party.name,
      hostName: resolveHostName(party),
      city: party.city,
      slug,
      url,
      country: party.country,
      countryCode: getCountryCode(party.country),
      eventImageUrl: party.eventImageUrl,
      score,
      breakdown,
    };
  });

  const countryRows = aggregateCountries(partyRows);

  return {
    window: windowKey,
    computedAt: new Date().toISOString(),
    parties: partyRows,
    countries: countryRows,
  };
}

async function getCached(windowKey: WindowKey, nocache: boolean) {
  const key = cacheKey(windowKey);
  const now = Date.now();
  if (!nocache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.data;
  }
  const data = await computeLeaderboard(windowKey);
  cache.set(key, { expiresAt: now + TTL_MS, data });
  return data;
}

// ---- router ----

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawWindow = (req.query.window as string | undefined) ?? 'all';
    const windowKey: WindowKey = rawWindow === 'year' ? 'year' : 'all';

    const rawLimit = parseInt((req.query.limit as string) ?? '50', 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 50));
    const rawOffset = parseInt((req.query.offset as string) ?? '0', 10);
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    const nocache = !!req.query.nocache;

    const data = await getCached(windowKey, nocache);

    const partyRowsSlice = data.parties.slice(offset, offset + limit);

    const body: LeaderboardResponse = {
      window: data.window,
      computedAt: data.computedAt,
      parties: {
        rows: partyRowsSlice,
        total: data.parties.length,
        limit,
        offset,
      },
      countries: {
        rows: data.countries,
        total: data.countries.length,
      },
    };

    // gpp.routes.ts precedent: public + 5min.
    res.set('Cache-Control', 'public, max-age=300');
    res.json(body);
  } catch (error) {
    next(error);
  }
});

// Exported for tests.
export const __testing = {
  cache,
  computeLeaderboard,
  scoreParty,
  aggregateCountries,
};

export default router;
