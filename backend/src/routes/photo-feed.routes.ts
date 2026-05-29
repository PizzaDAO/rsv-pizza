import { Router, Response, NextFunction, Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_FILTER_ITEMS = 50;

type FeedSource = 'photo' | 'payout';
type FeedSort = 'newest' | 'random';

// nduja-58291: exclude GPP 2025 (and prior) legacy uploads from the global
// /photos feed. Two-pronged filter:
//   1. photo_year column: NULL or >= 2026 (catches Athens/Bratislava which
//      explicitly set photo_year=2024/2025).
//   2. file_name regex: reject names containing a 2021-2025 year string
//      preceded by start-of-string or a non-digit. Catches WhatsApp/iPhone
//      timestamp-prefixed filenames (e.g. IMG-20250523-WA0069.jpg) without
//      false-negatives on 2026 timestamps. Per-party PhotoGallery is NOT
//      filtered — hosts may legitimately want prior-year photos on their
//      own event page.
const PRIOR_YEAR_FILENAME_RE = /(^|[^0-9])(2021|2022|2023|2024|2025)/;

// napoletana-58210: cursor format extended to include the source discriminator
// so the (createdAt, id) tuple is unambiguous when merging two tables. Format:
// `<iso>_<source>_<id>`. Legacy cursors (`<iso>_<id>`) are still accepted and
// default to `photo` source — important because the feed shipped without the
// source segment historically and clients may have stale cursors in their URL
// or localStorage.
function parseCursor(raw: unknown): { createdAt: Date; source: FeedSource | null; id: string } | null {
  if (typeof raw !== 'string' || !raw.includes('_')) return null;
  const parts = raw.split('_');
  // <iso>_<source>_<id> => at least 3 parts (iso may itself contain underscores? no — ISO 8601 doesn't)
  // Strip trailing pieces from the right: last segment is id, prior is source candidate, rest is iso.
  if (parts.length >= 3) {
    const id = parts[parts.length - 1];
    const sourceCandidate = parts[parts.length - 2];
    if (sourceCandidate === 'photo' || sourceCandidate === 'payout') {
      const ts = parts.slice(0, parts.length - 2).join('_');
      const d = new Date(ts);
      if (Number.isNaN(d.getTime()) || !id) return null;
      return { createdAt: d, source: sourceCandidate, id };
    }
  }
  // Legacy: `<iso>_<id>`
  const sepIdx = raw.lastIndexOf('_');
  const ts = raw.slice(0, sepIdx);
  const id = raw.slice(sepIdx + 1);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime()) || !id) return null;
  return { createdAt: d, source: null, id };
}

function buildCursorString(createdAt: Date, source: FeedSource, id: string): string {
  return `${createdAt.toISOString()}_${source}_${id}`;
}

// sicilian-58195: random-sort cursor format = `<md5hash>_<id>`. The md5 hash is
// 32 lowercase hex chars (no underscores) and the id is a UUID (no underscores
// either), so `_` is an unambiguous separator. The hash is the keyset's primary
// component; id is the tiebreak for the rare md5 collision case.
function parseRandomCursor(raw: unknown): { hash: string; id: string } | null {
  if (typeof raw !== 'string') return null;
  const sepIdx = raw.indexOf('_');
  if (sepIdx <= 0) return null;
  const hash = raw.slice(0, sepIdx);
  const id = raw.slice(sepIdx + 1);
  // md5 hash must be exactly 32 hex chars; reject otherwise so a malformed/
  // newest-mode cursor that's accidentally sent doesn't break the query.
  if (!/^[0-9a-f]{32}$/.test(hash) || !id) return null;
  return { hash, id };
}

// sicilian-58129: parse comma-separated query param, dedupe, trim, cap length.
function parseCsv(raw: unknown, cap = MAX_FILTER_ITEMS): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(',')) {
    const v = piece.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

// Build the shared "feed-eligible" party filter (mirrored across /feed and /feed/facets).
function buildPartyFilter(opts: { regions: string[]; countries: string[]; partnerTag: string | null }) {
  const partyFilter: any = {
    underbossStatus: 'approved',
    photosPublic: true,
    photosEnabled: true,
  };
  if (opts.regions.length > 0) {
    partyFilter.region = { in: opts.regions };
  }
  if (opts.countries.length > 0) {
    partyFilter.country = { in: opts.countries };
  }
  if (opts.partnerTag) {
    partyFilter.eventTags = { has: opts.partnerTag };
  }
  return partyFilter;
}

// napoletana-58210: shape returned per feed item. `source` discriminates
// between the curated `photos` table and the uncurated `payout_documents`
// (kind='pizza') source. Payout-sourced items always have payoutId populated;
// photo-sourced items have payoutId=null.
interface FeedItem {
  id: string;
  source: FeedSource;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  mimeType: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
  voteCount: number;
  votedByMe: boolean;
  payoutId: string | null;
  party: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
  };
}

router.get('/feed', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(
      Math.max(parseInt((req.query.limit as string) || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const regions = parseCsv(req.query.regions);
    const countries = parseCsv(req.query.countries);
    const partnerTagRaw = req.query.partnerTag;
    const partnerTag = typeof partnerTagRaw === 'string' && partnerTagRaw.trim()
      ? partnerTagRaw.trim()
      : null;

    // sicilian-58195: random shuffle sort. When sort=random, the seed deter-
    // mines the order so cursor pagination + filters stay consistent across
    // requests. Order is MD5(id::text || seed::text) ASC (tiebreak: id ASC).
    // We skip the payout-docs UNION in random mode — after napoletana-58211
    // every kind='pizza' payout doc has photo_id set, so the payout side is
    // effectively empty in practice. (Documented limitation.)
    const sort: FeedSort = req.query.sort === 'random' ? 'random' : 'newest';
    const seed = sort === 'random'
      ? String(parseInt((req.query.seed as string) || '', 10) || 0)
      : null;

    if (sort === 'random' && seed !== null) {
      return await handleRandomFeed(req, res, { limit, regions, countries, partnerTag, seed });
    }

    const cursor = parseCursor(req.query.cursor);

    const partyFilter = buildPartyFilter({ regions, countries, partnerTag });

    // napoletana-58210: each source queries `limit + 1` rows so we can detect
    // hasMore deterministically after the merge. We over-fetch slightly (each
    // side gets `limit + 1`) rather than `limit*2` because the merge picks at
    // most `limit + 1` from the combined pool; pulling `limit*2` per side would
    // waste rows. The trade-off: if one source dominates the time window the
    // cursor straddles, the next page may need a follow-up query — fine for an
    // infinite-scroll UX.
    //
    // nduja-58291: over-fetch on the photos side to compensate for the
    // post-query filename regex filter (some rows will drop). Capped at 100 so
    // a pathological filter doesn't run away.
    const fetchSize = limit + 1;
    const photoFetchSize = Math.min(limit * 2 + 1, 100);

    // -- photos source ----------------------------------------------------
    const photoWhere: any = {
      status: 'approved',
      starred: true,
      // nduja-58291: column-level prior-year exclusion.
      OR: [
        { photoYear: null },
        { photoYear: { gte: 2026 } },
      ],
      party: { is: partyFilter },
    };
    if (cursor) {
      // When cursor source is explicit, only paginate within that source for
      // strict tuple ordering. When legacy (source=null), apply the cursor to
      // both sides so behavior is backwards-compatible.
      //
      // nduja-58291: the year-OR is already on `photoWhere.OR`. Move it into
      // an AND clause alongside the cursor-OR so both compose without one
      // clobbering the other.
      if (cursor.source === 'photo' || cursor.source === null) {
        photoWhere.AND = [
          { OR: photoWhere.OR },
          {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
            ],
          },
        ];
        delete photoWhere.OR;
      } else {
        // Cursor is in the other source — pull photos strictly older than the
        // cursor timestamp (id tiebreak doesn't apply across sources).
        photoWhere.createdAt = { lte: cursor.createdAt };
      }
    }

    // -- payout pizza photos source ---------------------------------------
    const payoutDocWhere: any = {
      kind: 'pizza',
      // napoletana-58211: rows already mirrored into the `photos` table are
      // represented on the photo side of the union — exclude them here to
      // avoid double-display. New uploads always create both rows
      // atomically (see POST /:partyId/payouts), and the backfill script
      // links existing pizza docs to a canonical photos row.
      photoId: null,
      // exclude docs whose payout was rejected. payout_id is nullable on the
      // schema but in practice always set for pizza docs (verified during
      // implementation). The nested `payout: { isNot: { status: 'rejected' } }`
      // handles both states.
      OR: [
        { payoutId: null },
        { payout: { isNot: { status: 'rejected' } } },
      ],
      party: { is: partyFilter },
    };
    if (cursor) {
      if (cursor.source === 'payout' || cursor.source === null) {
        // Strict tuple ordering within the payout source.
        const tupleClause = [
          { createdAt: { lt: cursor.createdAt } },
          { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
        ];
        payoutDocWhere.AND = [
          { OR: payoutDocWhere.OR },
          { OR: tupleClause },
        ];
        delete payoutDocWhere.OR;
      } else {
        // Cursor is in the photo source — pull payouts at-or-older than the
        // cursor timestamp; id tiebreak doesn't cross sources.
        payoutDocWhere.AND = [
          { OR: payoutDocWhere.OR },
          { createdAt: { lte: cursor.createdAt } },
        ];
        delete payoutDocWhere.OR;
      }
    }

    const [photoRows, payoutRows] = await Promise.all([
      prisma.photo.findMany({
        where: photoWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // nduja-58291: over-fetch on the photos side to absorb post-query
        // filename-regex dropouts (no equivalent for payout docs — those
        // have no fileName column, so the regex doesn't apply).
        take: photoFetchSize,
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
          caption: true,
          mimeType: true,
          duration: true,
          width: true,
          height: true,
          createdAt: true,
          voteCount: true,
          fileName: true,
          votes: req.userId
            ? { where: { userId: req.userId }, select: { id: true } }
            : false,
          party: {
            select: {
              id: true,
              name: true,
              customUrl: true,
              inviteCode: true,
              city: true,
              country: true,
            },
          },
        },
      }),
      prisma.payoutDocument.findMany({
        where: payoutDocWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchSize,
        select: {
          id: true,
          url: true,
          mimeType: true,
          createdAt: true,
          payoutId: true,
          voteCount: true,
          votes: req.userId
            ? { where: { userId: req.userId }, select: { id: true } }
            : false,
          party: {
            select: {
              id: true,
              name: true,
              customUrl: true,
              inviteCode: true,
              city: true,
              country: true,
            },
          },
        },
      }),
    ]);

    // nduja-58291: filename-regex pass. Drops legacy GPP 2025 uploads with
    // WhatsApp/iPhone/Android timestamp-prefix filenames (e.g.
    // IMG-20250523-WA0069.jpg) that don't have photo_year set.
    const filteredPhotoRows = photoRows.filter(
      (p) => !p.fileName || !PRIOR_YEAR_FILENAME_RE.test(p.fileName),
    );

    // Merge into a single list, sorted by (createdAt desc, id desc) tiebreak.
    const merged: FeedItem[] = [
      ...filteredPhotoRows.map((p): FeedItem => {
        const votes = (p as typeof p & { votes?: { id: string }[] }).votes;
        return {
          id: p.id,
          source: 'photo',
          url: p.url,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          mimeType: p.mimeType,
          duration: p.duration,
          width: p.width,
          height: p.height,
          createdAt: p.createdAt,
          voteCount: p.voteCount,
          votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
          payoutId: null,
          party: {
            id: p.party.id,
            slug: p.party.customUrl || p.party.inviteCode,
            name: p.party.name,
            city: p.party.city,
            country: p.party.country,
          },
        };
      }),
      ...payoutRows.map((pd): FeedItem => {
        const votes = (pd as typeof pd & { votes?: { id: string }[] }).votes;
        return {
          id: pd.id,
          source: 'payout',
          url: pd.url,
          // Payout docs don't have thumbnails / captions / dimensions.
          thumbnailUrl: null,
          caption: null,
          mimeType: pd.mimeType,
          duration: null,
          width: null,
          height: null,
          createdAt: pd.createdAt,
          voteCount: pd.voteCount,
          votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
          payoutId: pd.payoutId,
          party: {
            id: pd.party.id,
            slug: pd.party.customUrl || pd.party.inviteCode,
            name: pd.party.name,
            city: pd.party.city,
            country: pd.party.country,
          },
        };
      }),
    ];

    merged.sort((a, b) => {
      const tDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (tDiff !== 0) return tDiff;
      // Tiebreak by id desc to match the per-table orderBy.
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    const hasMore = merged.length > limit;
    const page = hasMore ? merged.slice(0, limit) : merged;
    const last = page.length > 0 ? page[page.length - 1] : null;
    const nextCursor = hasMore && last
      ? buildCursorString(last.createdAt, last.source, last.id)
      : null;

    res.json({
      photos: page.map((p) => ({
        id: p.id,
        source: p.source,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        mimeType: p.mimeType,
        duration: p.duration,
        width: p.width,
        height: p.height,
        createdAt: p.createdAt,
        voteCount: p.voteCount,
        votedByMe: p.votedByMe,
        payoutId: p.payoutId,
        party: p.party,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

// sicilian-58195: random-shuffle handler. ORDER BY MD5(id::text || seed::text)
// gives a deterministic shuffle for a given seed; keyset pagination over the
// (md5_hash, id) tuple keeps subsequent pages aligned with page 1 even as the
// underlying photo set grows. We fetch ids+hash in one raw query (Prisma's
// typed builder can't ORDER BY arbitrary SQL expressions), then re-fetch the
// rows via the normal Prisma select so the response shape matches newest mode.
async function handleRandomFeed(
  req: AuthRequest,
  res: Response,
  opts: {
    limit: number;
    regions: string[];
    countries: string[];
    partnerTag: string | null;
    seed: string;
  },
): Promise<void> {
  const { limit, regions, countries, partnerTag, seed } = opts;
  const cursor = parseRandomCursor(req.query.cursor);
  const fetchSize = limit + 1;

  // Build optional WHERE fragments using Prisma.sql so values are parameter-
  // bound (no SQL-injection surface).
  const regionFilter = regions.length > 0
    ? Prisma.sql`AND pa.region = ANY(${regions}::text[])`
    : Prisma.empty;
  const countryFilter = countries.length > 0
    ? Prisma.sql`AND pa.country = ANY(${countries}::text[])`
    : Prisma.empty;
  const partnerTagFilter = partnerTag
    ? Prisma.sql`AND ${partnerTag} = ANY(pa.event_tags)`
    : Prisma.empty;
  const cursorFilter = cursor
    ? Prisma.sql`AND (
        MD5(p.id::text || ${seed}::text) > ${cursor.hash}
        OR (MD5(p.id::text || ${seed}::text) = ${cursor.hash} AND p.id::text > ${cursor.id})
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<{ id: string; sort_hash: string }[]>(Prisma.sql`
    SELECT p.id::text AS id, MD5(p.id::text || ${seed}::text) AS sort_hash
    FROM photos p
    JOIN parties pa ON pa.id = p.party_id
    WHERE p.starred = true
      AND p.status = 'approved'
      AND pa.underboss_status = 'approved'
      AND pa.photos_public = true
      AND pa.photos_enabled = true
      -- nduja-58291: exclude prior-year (2025-and-earlier) legacy uploads.
      -- Column filter catches Athens/Bratislava (explicit photo_year); regex
      -- catches Natal etc. where filename embeds a year preceded by a
      -- non-digit (WhatsApp/iPhone/Android timestamp filenames). Mirrored in
      -- the newest-sort Prisma path via PRIOR_YEAR_FILENAME_RE.
      AND (p.photo_year IS NULL OR p.photo_year >= 2026)
      AND p.file_name !~ '(^|[^0-9])(2021|2022|2023|2024|2025)'
      ${regionFilter}
      ${countryFilter}
      ${partnerTagFilter}
      ${cursorFilter}
    ORDER BY MD5(p.id::text || ${seed}::text) ASC, p.id::text ASC
    LIMIT ${fetchSize}
  `);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const ids = pageRows.map((r) => r.id);

  // Re-fetch the full photo rows (with party + vote relations) using the same
  // select shape as newest mode so the response is identical apart from order.
  const photos = ids.length > 0
    ? await prisma.photo.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
          caption: true,
          mimeType: true,
          duration: true,
          width: true,
          height: true,
          createdAt: true,
          voteCount: true,
          votes: req.userId
            ? { where: { userId: req.userId }, select: { id: true } }
            : false,
          party: {
            select: {
              id: true,
              name: true,
              customUrl: true,
              inviteCode: true,
              city: true,
              country: true,
            },
          },
        },
      })
    : [];

  // Map by id and re-emit in the random sort order from the raw query.
  const byId = new Map(photos.map((p) => [p.id, p]));
  const sorted = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
  const nextCursor = hasMore && lastRow
    ? `${lastRow.sort_hash}_${lastRow.id}`
    : null;

  res.json({
    photos: sorted.map((p) => {
      const votes = (p as typeof p & { votes?: { id: string }[] }).votes;
      return {
        id: p.id,
        source: 'photo' as const,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        mimeType: p.mimeType,
        duration: p.duration,
        width: p.width,
        height: p.height,
        createdAt: p.createdAt,
        voteCount: p.voteCount,
        votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
        payoutId: null,
        party: {
          id: p.party.id,
          slug: p.party.customUrl || p.party.inviteCode,
          name: p.party.name,
          city: p.party.city,
          country: p.party.country,
        },
      };
    }),
    nextCursor,
  });
}

// sicilian-58129: facets endpoint — returns distinct country values among
// feed-eligible photos (approved + party-eligible) with photo counts.
// Used by the /photos filter bar to populate the country dropdown.
//
// napoletana-58210 v1 LIMITATION: this endpoint still only counts the
// `photos` table — countries that have ONLY payout pizza photos won't appear
// in the country dropdown. Acceptable for v1 because (a) the feed itself
// shows payout photos regardless of dropdown choice, and (b) most cities with
// payout photos also have photos-table entries.
router.get('/feed/facets', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const grouped = await prisma.photo.groupBy({
      by: ['partyId'],
      where: {
        status: 'approved',
        party: {
          is: {
            underbossStatus: 'approved',
            photosPublic: true,
            photosEnabled: true,
          },
        },
      },
      _count: { _all: true },
    });

    if (grouped.length === 0) {
      return res.json({ countries: [] });
    }

    const partyIds = grouped.map((g) => g.partyId);
    const parties = await prisma.party.findMany({
      where: { id: { in: partyIds } },
      select: { id: true, country: true },
    });
    const countryByPartyId = new Map<string, string | null>();
    parties.forEach((p) => countryByPartyId.set(p.id, p.country));

    const countryCounts = new Map<string, number>();
    grouped.forEach((g) => {
      const country = countryByPartyId.get(g.partyId);
      if (!country || !country.trim()) return;
      const key = country.trim();
      countryCounts.set(key, (countryCounts.get(key) || 0) + g._count._all);
    });

    const countries = Array.from(countryCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    res.json({ countries });
  } catch (error) {
    next(error);
  }
});

// sicilian-58129: returns the distinct partner-tags for the logged-in user's
// active SponsorUser records. Anonymous callers get { tags: [] }.
router.get('/feed/my-partner-tags', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail;
    if (!email) {
      return res.json({ tags: [] });
    }
    const rows = await prisma.sponsorUser.findMany({
      where: { email: email.toLowerCase(), isActive: true },
      select: { tag: true },
    });
    const tags = Array.from(new Set(rows.map((r) => r.tag).filter(Boolean)));
    tags.sort((a, b) => a.localeCompare(b));
    res.json({ tags });
  } catch (error) {
    next(error);
  }
});

export default router;
