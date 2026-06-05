import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { getCountryCode } from '../lib/countryCode.js';
import { getScoringWeights } from '../lib/privateConfig.js';

/**
 * panzerotti-58931 (Phase 2.1): worldwide scorecard ("check-in game") leaderboard.
 *
 * Mounted at `/api/scorecard-leaderboard` so the full path is
 *   GET /api/scorecard-leaderboard
 *
 * Distinct from `publicLeaderboard.routes.ts` (the GPP RSVP/check-in/photo
 * composite board). This board ranks by the *game* score:
 *
 *   guestScore   = completed scorecard items + winsCount * BEST_OF_BONUS
 *   partyScore   = Σ guestScore over the party's checked-in guests
 *   countryScore = Σ partyScore grouped by trimmed/case-insensitive country
 *
 * A "win" is a `superlative_submissions` row with status='winner' for the guest.
 *
 * Scope: every checked-in, non-rejected guest of any party — no GPP/approved
 * gate, since the game runs at all events. Mirrors `findGuestForUser` in
 * scorecard.routes.ts: checkedInAt IS NOT NULL AND (approved IS TRUE OR
 * approved IS NULL).
 *
 * Cache: in-memory, 5-minute TTL, plus `Cache-Control: public, max-age=300`.
 */

// Single tunable bonus per Best Of win, resolved from `app_config`
// (private.scoring_weights → leaderboard.bestOfBonus). Imported by
// scorecard.routes.ts so the per-party board and the global board agree.
//
// The real value is seeded to prod; committed source carries a NON-SENSITIVE
// placeholder (1 = a Best Of win is worth one item, never NaN/zero-collapse)
// so the math stays well-defined if the config row is briefly absent.
export const BEST_OF_BONUS_PLACEHOLDER = 1;

/**
 * Resolve the Best Of bonus from the seeded leaderboard scoring weights.
 * Call this at each handler's async entry, then use the returned number.
 */
export async function getBestOfBonus(): Promise<number> {
  const raw = (await getScoringWeights()).leaderboard.bestOfBonus;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : BEST_OF_BONUS_PLACEHOLDER;
}

// ---- types ----

export interface ScorecardGuestRow {
  rank: number;
  name: string; // privacy "First L."
  city: string | null;
  country: string | null;
  countryCode: string | null;
  score: number;
}

export interface ScorecardPartyRow {
  rank: number;
  partyId: string;
  name: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  slug: string;
  score: number;
}

export interface ScorecardCountryRow {
  rank: number;
  country: string;
  countryCode: string | null;
  partyCount: number;
  score: number;
}

export interface ScorecardGlobalLeaderboardResponse {
  guests: ScorecardGuestRow[];
  parties: ScorecardPartyRow[];
  countries: ScorecardCountryRow[];
  computedAt: string;
}

// Raw row shape returned by the aggregate query (one row per checked-in guest).
interface RawGuestRow {
  guest_id: string;
  name: string | null;
  party_id: string;
  party_name: string | null;
  city: string | null;
  country: string | null;
  custom_url: string | null;
  invite_code: string | null;
  item_count: bigint | number;
  win_count: bigint | number;
}

// ---- cache ----
const TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  expiresAt: number;
  data: ScorecardGlobalLeaderboardResponse;
}
let cache: CacheEntry | null = null;

// ---- helpers ----

function privacyName(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'Guest';
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;
}

function toNum(v: bigint | number): number {
  return typeof v === 'bigint' ? Number(v) : v;
}

export async function computeScorecardLeaderboard(): Promise<ScorecardGlobalLeaderboardResponse> {
  // Resolve the Best Of bonus once at entry (cached 60s in privateConfig).
  const bestOfBonus = await getBestOfBonus();

  // One pass over checked-in guests. COUNT(DISTINCT ...) FILTER avoids join
  // fan-out between scorecard items and superlative submissions.
  const rows = await prisma.$queryRaw<RawGuestRow[]>`
    SELECT
      g.id                                                              AS guest_id,
      g.name                                                            AS name,
      p.id                                                              AS party_id,
      p.name                                                            AS party_name,
      p.city                                                            AS city,
      p.country                                                         AS country,
      p.custom_url                                                      AS custom_url,
      p.invite_code                                                     AS invite_code,
      COUNT(DISTINCT i.id) FILTER (WHERE i.completed)                   AS item_count,
      COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'winner')           AS win_count
    FROM guests g
    JOIN parties p ON p.id = g.party_id
    LEFT JOIN guest_scorecard_items i ON i.guest_id = g.id
    LEFT JOIN superlative_submissions s ON s.guest_id = g.id
    WHERE g.checked_in_at IS NOT NULL
      AND (g.approved IS TRUE OR g.approved IS NULL)
    GROUP BY g.id, g.name, p.id, p.name, p.city, p.country, p.custom_url, p.invite_code
  `;

  // ---- per-guest score ----
  interface GuestAcc {
    guestId: string;
    name: string;
    city: string | null;
    country: string | null;
    score: number;
  }
  const guestAccs: GuestAcc[] = rows.map((r) => ({
    guestId: r.guest_id,
    name: privacyName(r.name),
    city: r.city,
    country: r.country,
    score: toNum(r.item_count) + toNum(r.win_count) * bestOfBonus,
  }));

  // ---- per-party aggregation ----
  interface PartyAcc {
    partyId: string;
    name: string;
    city: string | null;
    country: string | null;
    slug: string;
    score: number;
  }
  const partyMap = new Map<string, PartyAcc>();
  for (const r of rows) {
    const guestScore = toNum(r.item_count) + toNum(r.win_count) * bestOfBonus;
    let acc = partyMap.get(r.party_id);
    if (!acc) {
      acc = {
        partyId: r.party_id,
        name: r.party_name || 'Untitled',
        city: r.city,
        country: r.country,
        slug: r.custom_url || r.invite_code || r.party_id,
        score: 0,
      };
      partyMap.set(r.party_id, acc);
    }
    acc.score += guestScore;
  }

  // ---- per-country aggregation (case-insensitive trimmed) ----
  interface CountryAcc {
    spellingCounts: Map<string, number>;
    firstSpelling: string;
    score: number;
    partyCount: number;
  }
  const countryMap = new Map<string, CountryAcc>();
  for (const party of partyMap.values()) {
    if (!party.country) continue;
    const trimmed = party.country.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    let acc = countryMap.get(key);
    if (!acc) {
      acc = { spellingCounts: new Map(), firstSpelling: trimmed, score: 0, partyCount: 0 };
      countryMap.set(key, acc);
    }
    acc.spellingCounts.set(trimmed, (acc.spellingCounts.get(trimmed) || 0) + 1);
    acc.score += party.score;
    acc.partyCount += 1;
  }

  // ---- guest rows: top 100, score desc, name asc tiebreak ----
  const guests: ScorecardGuestRow[] = guestAccs
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 100)
    .map((g, i) => ({
      rank: i + 1,
      name: g.name,
      city: g.city,
      country: g.country,
      countryCode: getCountryCode(g.country),
      score: g.score,
    }));

  // ---- party rows: score desc, name asc tiebreak ----
  const parties: ScorecardPartyRow[] = Array.from(partyMap.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.name || '').localeCompare(b.name || '');
    })
    .map((p, i) => ({
      rank: i + 1,
      partyId: p.partyId,
      name: p.name,
      city: p.city,
      country: p.country,
      countryCode: getCountryCode(p.country),
      slug: p.slug,
      score: p.score,
    }));

  // ---- country rows: pick canonical spelling, score desc ----
  const countries: ScorecardCountryRow[] = [];
  for (const acc of countryMap.values()) {
    let best = acc.firstSpelling;
    let bestCount = 0;
    for (const [spelling, count] of acc.spellingCounts.entries()) {
      if (count > bestCount) {
        best = spelling;
        bestCount = count;
      }
    }
    countries.push({
      rank: 0,
      country: best,
      countryCode: getCountryCode(best),
      partyCount: acc.partyCount,
      score: acc.score,
    });
  }
  countries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.partyCount !== a.partyCount) return b.partyCount - a.partyCount;
    return a.country.localeCompare(b.country);
  });
  countries.forEach((c, i) => {
    c.rank = i + 1;
  });

  return {
    guests,
    parties,
    countries,
    computedAt: new Date().toISOString(),
  };
}

async function getCached(nocache: boolean): Promise<ScorecardGlobalLeaderboardResponse> {
  const now = Date.now();
  if (!nocache && cache && cache.expiresAt > now) {
    return cache.data;
  }
  const data = await computeScorecardLeaderboard();
  cache = { expiresAt: now + TTL_MS, data };
  return data;
}

// ---- router ----

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nocache = !!req.query.nocache;
    const data = await getCached(nocache);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Exported for tests.
export const __testing = {
  computeScorecardLeaderboard,
  reset: () => {
    cache = null;
  },
};

export default router;
