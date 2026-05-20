import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';

/**
 * quattro-71244: peer leaderboard for the gamified host dashboard.
 *
 * Mounted at `/api/parties` so the full path is
 *   GET /api/parties/:partyId/leaderboard-rank?metric=<key>
 *
 * Scope:
 *   - if the party has a season tag (e.g. `gpp2026` — any tag matching
 *     /^gpp\d{4}$/), rank within `eventType='gpp' AND eventTags has <tag>`.
 *   - otherwise fall back to all `eventType='gpp'` (so a brand-new GPP event
 *     missing the season tag still shows a sane pill instead of breaking).
 *
 * Cache:
 *   In-memory `Map`, 5-minute TTL, keyed by `(metric, scopeFingerprint)` so
 *   parties in the same scope share the same cache entry (the per-party rank
 *   is derived from the cached counts list).
 *
 * IMPORTANT: per `architecture_router_use_at_shared_prefix`, this router must
 * NOT install a path-less `router.use(...)` middleware — that would block
 * every other `/api/parties/*` request mounted at the same prefix. Auth is
 * applied per-route via `requireAuth` only.
 */

type Metric = 'totalRsvps';

const SUPPORTED_METRICS: ReadonlySet<string> = new Set<Metric>(['totalRsvps']);

interface ScopeFingerprint {
  /** `'gpp-season'` when filtered by a season tag, `'gpp-all'` for fallback. */
  kind: 'gpp-season' | 'gpp-all';
  /** The season tag string, if applicable (e.g. `gpp2026`). */
  tag?: string;
}

interface CacheEntry {
  expiresAt: number;
  /** Map of partyId -> count for the requested metric. */
  counts: Map<string, number>;
}

const TTL_MS = 5 * 60 * 1000;
// In-process cache resets naturally on every Vercel redeploy — no manual
// invalidation needed when the universe filter changes (see tomato-71832).
const cache = new Map<string, CacheEntry>();

function cacheKey(metric: Metric, scope: ScopeFingerprint): string {
  return `${metric}::${scope.kind}::${scope.tag ?? ''}`;
}

/** Find a season tag like `gpp2026` on the party. */
function findSeasonTag(eventTags: string[] | null | undefined): string | undefined {
  if (!Array.isArray(eventTags)) return undefined;
  return eventTags.find(t => typeof t === 'string' && /^gpp\d{4}$/i.test(t));
}

/**
 * Aggregate the requested metric for every party in scope.
 *
 * v1 supports `totalRsvps` only — count of `guests` rows per party. We use
 * a Prisma `groupBy` for efficiency vs N round trips. Stubbed as a dispatcher
 * so future metrics (newsletter signups, wallet addresses, page views, etc.)
 * can plug in without restructuring the cache or rank math.
 */
async function aggregateCounts(metric: Metric, scope: ScopeFingerprint): Promise<Map<string, number>> {
  if (metric === 'totalRsvps') {
    // Gather candidate party IDs in scope first so we can also include
    // zero-RSVP parties in the leaderboard (groupBy on `guests` would skip
    // them — they'd silently be "off-leaderboard" otherwise).
    //
    // tomato-71832: narrow the universe to approved events only so the pill's
    // denominator reflects approved GPP hosts (not pending/rejected). The
    // approval field is `underbossStatus` (default `'pending'`), NOT `status`.
    const partyWhere: any = { eventType: 'gpp', underbossStatus: 'approved' };
    if (scope.kind === 'gpp-season' && scope.tag) {
      partyWhere.eventTags = { has: scope.tag };
    }
    const parties = await prisma.party.findMany({
      where: partyWhere,
      select: { id: true },
    });

    const counts = new Map<string, number>();
    for (const p of parties) counts.set(p.id, 0);

    if (parties.length === 0) return counts;

    const grouped = await prisma.guest.groupBy({
      by: ['partyId'],
      where: { partyId: { in: parties.map(p => p.id) } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      counts.set(g.partyId, (g._count?._all as number | undefined) ?? 0);
    }
    return counts;
  }

  // Unsupported metric — return empty (caller validates first; this is defensive).
  return new Map();
}

async function getCounts(metric: Metric, scope: ScopeFingerprint): Promise<Map<string, number>> {
  const key = cacheKey(metric, scope);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.counts;
  }
  const counts = await aggregateCounts(metric, scope);
  cache.set(key, { expiresAt: now + TTL_MS, counts });
  return counts;
}

/**
 * Compute the rank of `partyId` within `counts`.
 *
 * We use **standard competition ranking** ("1224"): ties share the same rank,
 * and the next non-tied party gets `1 + (number of strictly-higher parties)`.
 * For an `N`-event leaderboard with all-zero counts, every party is rank 1.
 *
 * `topPercent` is `Math.round(100 * rank / total)`; rank 1 in 100 parties =
 * top 1%, rank 50 in 100 parties = top 50%. Always rounds half away from zero
 * via `Math.round`.
 */
function computeRank(counts: Map<string, number>, partyId: string): {
  rank: number;
  total: number;
  topPercent: number;
} {
  const total = counts.size;
  const myCount = counts.get(partyId) ?? 0;
  let strictlyHigher = 0;
  for (const count of counts.values()) {
    if (count > myCount) strictlyHigher += 1;
  }
  const rank = strictlyHigher + 1;
  const topPercent = total > 0 ? Math.round((100 * rank) / total) : 0;
  return { rank, total, topPercent };
}

const router = Router();

router.get(
  '/:partyId/leaderboard-rank',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const metricRaw = (req.query.metric as string | undefined) ?? 'totalRsvps';

      // Same can-edit gate the dashboard KPI block uses; do not expose to anon.
      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
      }

      if (!SUPPORTED_METRICS.has(metricRaw)) {
        throw new AppError(
          `Unsupported metric '${metricRaw}'. Supported: ${[...SUPPORTED_METRICS].join(', ')}`,
          400,
          'VALIDATION_ERROR',
        );
      }
      const metric = metricRaw as Metric;

      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: { eventType: true, eventTags: true },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // Scope is GPP-only for v1. Non-GPP events get an empty leaderboard.
      const seasonTag = party.eventType === 'gpp'
        ? findSeasonTag(party.eventTags as string[] | null)
        : undefined;
      const scope: ScopeFingerprint = seasonTag
        ? { kind: 'gpp-season', tag: seasonTag }
        : { kind: 'gpp-all' };

      const counts = await getCounts(metric, scope);
      const { rank, total, topPercent } = computeRank(counts, partyId);

      res.json({ rank, total, topPercent, scope: scope.kind });
    } catch (error) {
      next(error);
    }
  },
);

// Exported for tests.
export const __testing = {
  cache,
  cacheKey,
  computeRank,
  findSeasonTag,
};

export default router;
