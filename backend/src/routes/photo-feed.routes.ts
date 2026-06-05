import { Router, Response, NextFunction, Request } from 'express';
import { Prisma } from '@prisma/client';
import archiver from 'archiver';
import { prisma } from '../config/database.js';
import { optionalAuth, requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_FILTER_ITEMS = 50;

type FeedSource = 'photo' | 'payout';
type FeedSort = 'newest' | 'random';

// cannoli-58292: the /photos feed is organized by EVENT YEAR. A photo's
// "effective year" is:
//   COALESCE(photo.photo_year,                       -- uploader override
//            <year parsed from photo.file_name>,      -- e.g. "...2024.png" => 2024
//            EXTRACT(YEAR FROM party.date)::int,      -- the event's year
//            EXTRACT(YEAR FROM photo.created_at)::int -- fallback (no event date)
//   )
// The filename-year term takes precedence over the event date (so a file like
// "Poster Pizza Party 2024.png" reads as 2024 even on a 2026 event) but NOT
// over the explicit photo_year override. The regex captures a single 4-digit
// year 20[1-2][0-9] bounded by a non-digit or string edge, so it pulls 2024
// from "IMG_20240523" and 2026 from "WhatsApp Image 2026-06-05" without
// matching inside longer digit runs. substring(... from pattern) returns the
// captured group or NULL, so COALESCE falls through when the name has no year.
// For payout_documents (no photo_year / file_name columns) it is dropped.
//
// Two filters apply UNIFORMLY to every year view (newest, random, ZIP):
//   1. effective_year = :year
//   2. after-event-start cutoff: party.date IS NULL OR photo.created_at >= party.date
// This SUPERSEDES the nduja-58291 prior-year filename-regex + photo_year OR
// exclusion, which has been removed.
const MIN_YEAR = 2015;
function currentYear(): number {
  return new Date().getFullYear();
}
// cannoli-58292: parse + validate the `year` query param. Defaults to the
// current calendar year; clamps the accepted range to [2015, currentYear+1].
function parseYear(raw: unknown): number {
  const cy = currentYear();
  if (typeof raw !== 'string' || !raw.trim()) return cy;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_YEAR || n > cy + 1) return cy;
  return n;
}

// cannoli-58292: shared photos-side "effective year" SQL expression, kept in
// ONE place so the four photo query paths (newest, random, ZIP, facets) can't
// drift. Assumes the photos table is aliased `p` and the joined party `pa`.
// The filename-year term (between photo_year and the event date) lets a file
// like "Poster Pizza Party 2024.png" read as 2024 even on a 2026 event, while
// still deferring to the explicit photo_year override. payout_documents have
// no file_name and keep their own (untouched) COALESCE.
const PHOTO_EFFECTIVE_YEAR = Prisma.sql`COALESCE(
        p.photo_year,
        NULLIF(substring(p.file_name from '(?:^|[^0-9])(20[1-2][0-9])(?:[^0-9]|$)'), '')::int,
        EXTRACT(YEAR FROM pa.date)::int,
        EXTRACT(YEAR FROM p.created_at)::int
      )`;

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

// cannoli-58292: buildPartyFilter (typed Prisma party predicate) was removed —
// every feed path (newest, random, ZIP) is now raw SQL and inlines the
// party-eligibility WHERE clauses (underboss_status / photos_public /
// photos_enabled + region/country/partnerTag) as parameter-bound fragments.

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

    // cannoli-58292: the requested event year (defaults to current calendar year).
    const year = parseYear(req.query.year);

    if (sort === 'random' && seed !== null) {
      return await handleRandomFeed(req, res, { limit, regions, countries, partnerTag, seed, year });
    }

    const cursor = parseCursor(req.query.cursor);

    const fetchSize = limit + 1;

    // cannoli-58292: the newest feed moved from two typed Prisma findMany calls
    // (merged in JS) to a single raw-SQL UNION ALL. Neither the
    // column-to-column after-event-start cutoff nor the effective-year COALESCE
    // is expressible in Prisma's typed `where`. We compute everything in SQL,
    // keyset-paginate over (created_at DESC, id DESC), and re-attach the
    // per-user vote flag via a LEFT JOIN on the source-appropriate votes table.
    //
    // Cursor format preserved from napoletana-58210: `<iso>_<source>_<id>`.
    // Legacy `<iso>_<id>` cursors parse with source=null. When the cursor has
    // an explicit source we still order the whole combined set by the same
    // (created_at, id) tuple, so a single keyset predicate over the UNION ALL
    // result is correct regardless of which source the boundary row came from.

    // -- shared party-eligibility predicate (parameter-bound) ----------------
    const regionFilter = regions.length > 0
      ? Prisma.sql`AND pa.region = ANY(${regions}::text[])`
      : Prisma.empty;
    const countryFilter = countries.length > 0
      ? Prisma.sql`AND pa.country = ANY(${countries}::text[])`
      : Prisma.empty;
    const partnerTagFilter = partnerTag
      ? Prisma.sql`AND ${partnerTag} = ANY(pa.event_tags)`
      : Prisma.empty;

    // cannoli-58292: keyset predicate. The boundary row's id orders within the
    // combined set; an explicit-source cursor and a legacy cursor behave
    // identically because the UNION ALL is ordered by the same tuple.
    const userId = req.userId ?? null;

    const photoVoteSelect = userId
      ? Prisma.sql`(pv.user_id IS NOT NULL)`
      : Prisma.sql`false`;
    const photoVoteJoin = userId
      ? Prisma.sql`LEFT JOIN photo_votes pv ON pv.photo_id = p.id AND pv.user_id = ${userId}`
      : Prisma.empty;
    const payoutVoteSelect = userId
      ? Prisma.sql`(pdv.user_id IS NOT NULL)`
      : Prisma.sql`false`;
    const payoutVoteJoin = userId
      ? Prisma.sql`LEFT JOIN payout_document_votes pdv ON pdv.payout_document_id = pd.id AND pdv.user_id = ${userId}`
      : Prisma.empty;

    const cursorPredicate = cursor
      ? Prisma.sql`WHERE (u.created_at < ${cursor.createdAt}
          OR (u.created_at = ${cursor.createdAt} AND u.id < ${cursor.id}))`
      : Prisma.empty;

    type RawFeedRow = {
      id: string;
      source: FeedSource;
      url: string;
      thumbnail_url: string | null;
      caption: string | null;
      mime_type: string;
      duration: number | null;
      width: number | null;
      height: number | null;
      created_at: Date;
      vote_count: number;
      voted_by_me: boolean;
      payout_id: string | null;
      party_id: string;
      party_name: string;
      custom_url: string | null;
      invite_code: string;
      city: string | null;
      country: string | null;
    };

    const rawRows = await prisma.$queryRaw<RawFeedRow[]>(Prisma.sql`
      SELECT * FROM (
        -- photos source ---------------------------------------------------
        SELECT
          p.id::text AS id,
          'photo'::text AS source,
          p.url AS url,
          p.thumbnail_url AS thumbnail_url,
          p.caption AS caption,
          p.mime_type AS mime_type,
          p.duration AS duration,
          p.width AS width,
          p.height AS height,
          p.created_at AS created_at,
          p.vote_count AS vote_count,
          ${photoVoteSelect} AS voted_by_me,
          NULL::uuid AS payout_id,
          pa.id::text AS party_id,
          pa.name AS party_name,
          pa.custom_url AS custom_url,
          pa.invite_code AS invite_code,
          pa.city AS city,
          pa.country AS country
        FROM photos p
        JOIN parties pa ON pa.id = p.party_id
        ${photoVoteJoin}
        WHERE p.status = 'approved'
          AND p.starred = true
          AND p.deleted_at IS NULL -- provolone-58931
          AND pa.underboss_status = 'approved'
          AND pa.photos_public = true
          AND pa.photos_enabled = true
          -- cannoli-58292: effective_year = :year (filename-year > event date,
          -- but photo_year override wins; see PHOTO_EFFECTIVE_YEAR)
          AND ${PHOTO_EFFECTIVE_YEAR} = ${year}
          -- cannoli-58292: after-event-start cutoff (no-op when event has no date)
          AND (pa.date IS NULL OR p.created_at >= pa.date)
          ${regionFilter}
          ${countryFilter}
          ${partnerTagFilter}

        UNION ALL

        -- payout pizza photos source (napoletana-58211: effectively empty in
        -- practice — mirrored docs have photo_id set — but kept for parity) --
        SELECT
          pd.id::text AS id,
          'payout'::text AS source,
          pd.url AS url,
          NULL::text AS thumbnail_url,
          NULL::text AS caption,
          pd.mime_type AS mime_type,
          NULL::double precision AS duration,
          NULL::int AS width,
          NULL::int AS height,
          pd.created_at AS created_at,
          pd.vote_count AS vote_count,
          ${payoutVoteSelect} AS voted_by_me,
          pd.payout_id AS payout_id,
          pa.id::text AS party_id,
          pa.name AS party_name,
          pa.custom_url AS custom_url,
          pa.invite_code AS invite_code,
          pa.city AS city,
          pa.country AS country
        FROM payout_documents pd
        JOIN parties pa ON pa.id = pd.party_id
        LEFT JOIN payouts po ON po.id = pd.payout_id
        ${payoutVoteJoin}
        WHERE pd.kind = 'pizza'
          AND pd.photo_id IS NULL -- napoletana-58211: avoid double-display
          AND (pd.payout_id IS NULL OR po.status <> 'rejected')
          AND pa.underboss_status = 'approved'
          AND pa.photos_public = true
          AND pa.photos_enabled = true
          -- cannoli-58292: effective_year = :year (no photo_year column here)
          AND COALESCE(
                EXTRACT(YEAR FROM pa.date)::int,
                EXTRACT(YEAR FROM pd.created_at)::int
              ) = ${year}
          -- cannoli-58292: after-event-start cutoff
          AND (pa.date IS NULL OR pd.created_at >= pa.date)
          ${regionFilter}
          ${countryFilter}
          ${partnerTagFilter}
      ) u
      ${cursorPredicate}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ${fetchSize}
    `);

    const merged: FeedItem[] = rawRows.map((r): FeedItem => ({
      id: r.id,
      source: r.source,
      url: r.url,
      thumbnailUrl: r.thumbnail_url,
      caption: r.caption,
      mimeType: r.mime_type,
      duration: r.duration,
      width: r.width,
      height: r.height,
      createdAt: r.created_at,
      voteCount: Number(r.vote_count),
      votedByMe: !!r.voted_by_me,
      payoutId: r.payout_id,
      party: {
        id: r.party_id,
        slug: r.custom_url || r.invite_code,
        name: r.party_name,
        city: r.city,
        country: r.country,
      },
    }));

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
    year: number; // cannoli-58292
  },
): Promise<void> {
  const { limit, regions, countries, partnerTag, seed, year } = opts;
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
      AND p.deleted_at IS NULL -- provolone-58931: exclude soft-deleted photos
      AND pa.underboss_status = 'approved'
      AND pa.photos_public = true
      AND pa.photos_enabled = true
      -- cannoli-58292: effective_year = :year (supersedes nduja-58291).
      -- filename-year > event date, photo_year override wins; see PHOTO_EFFECTIVE_YEAR.
      AND ${PHOTO_EFFECTIVE_YEAR} = ${year}
      -- cannoli-58292: after-event-start cutoff (no-op when event has no date).
      AND (pa.date IS NULL OR p.created_at >= pa.date)
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
        where: { id: { in: ids }, deletedAt: null }, // provolone-58931

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
        deletedAt: null, // provolone-58931
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
      // cannoli-58292: still return an (empty) years array for shape parity.
      return res.json({ countries: [], years: [] });
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

    // cannoli-58292: distinct effective years across feed-eligible photos,
    // applying the SAME base predicate as the feed (approved + starred +
    // not-deleted + party-eligible + after-event-start cutoff). Populates the
    // year dropdown. Raw SQL because effective_year and the cutoff are
    // column-to-column expressions Prisma's typed query can't express.
    const yearRows = await prisma.$queryRaw<{ year: number }[]>(Prisma.sql`
      -- cannoli-58292: filename-year > event date, photo_year override wins.
      SELECT DISTINCT ${PHOTO_EFFECTIVE_YEAR} AS year
      FROM photos p
      JOIN parties pa ON pa.id = p.party_id
      WHERE p.status = 'approved'
        AND p.starred = true
        AND p.deleted_at IS NULL
        AND pa.underboss_status = 'approved'
        AND pa.photos_public = true
        AND pa.photos_enabled = true
        AND (pa.date IS NULL OR p.created_at >= pa.date)
      ORDER BY year DESC
    `);
    const years = yearRows
      .map((r) => Number(r.year))
      .filter((y) => Number.isFinite(y));

    res.json({ countries, years });
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

// salame-58291: ZIP-download endpoint for partners. Streams the matching feed
// (same WHERE clauses as /feed) into a single .zip. Caps at 1000 photos and
// 15s per-photo fetch timeout. v1 only queries the `photos` table — after
// napoletana-58211 most payout pizzas are mirrored there, so the payout-docs
// UNION is intentionally dropped for the download path (simpler, matches the
// vast majority of partner photos).
const DOWNLOAD_MAX_PHOTOS = 1000;
const DOWNLOAD_PHOTO_TIMEOUT_MS = 15000;

function sanitizeForFilename(s: string): string {
  // Strip filesystem-unsafe + control chars, leading dots, then fall back to
  // 'photo' if nothing's left.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim() || 'photo';
}

router.get('/feed/download', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const regions = parseCsv(req.query.regions);
    const countries = parseCsv(req.query.countries);
    const partnerTagRaw = req.query.partnerTag;
    const partnerTag = typeof partnerTagRaw === 'string' && partnerTagRaw.trim()
      ? partnerTagRaw.trim()
      : null;
    // cannoli-58292: ZIP honors the same year + cutoff as the feed.
    const year = parseYear(req.query.year);

    const regionFilter = regions.length > 0
      ? Prisma.sql`AND pa.region = ANY(${regions}::text[])`
      : Prisma.empty;
    const countryFilter = countries.length > 0
      ? Prisma.sql`AND pa.country = ANY(${countries}::text[])`
      : Prisma.empty;
    const partnerTagFilter = partnerTag
      ? Prisma.sql`AND ${partnerTag} = ANY(pa.event_tags)`
      : Prisma.empty;

    // cannoli-58292: raw SQL so the ZIP mirrors /feed exactly — effective_year
    // = :year + after-event-start cutoff (column-to-column comparisons Prisma's
    // typed `where` can't express). Replaces the nduja-58292 prior-year
    // filename/photoYear exclusion. Photos table only (matches the prior
    // behavior — payout docs are mirrored into `photos` post-napoletana-58211).
    type DlRow = {
      id: string;
      url: string;
      file_name: string | null;
      mime_type: string;
      city: string | null;
      custom_url: string | null;
      invite_code: string;
      name: string;
    };
    const dlRows = await prisma.$queryRaw<DlRow[]>(Prisma.sql`
      SELECT
        p.id::text AS id,
        p.url AS url,
        p.file_name AS file_name,
        p.mime_type AS mime_type,
        pa.city AS city,
        pa.custom_url AS custom_url,
        pa.invite_code AS invite_code,
        pa.name AS name
      FROM photos p
      JOIN parties pa ON pa.id = p.party_id
      WHERE p.status = 'approved'
        AND p.starred = true
        AND p.deleted_at IS NULL -- provolone-58931
        AND pa.underboss_status = 'approved'
        AND pa.photos_public = true
        AND pa.photos_enabled = true
        -- cannoli-58292: filename-year > event date, photo_year override wins.
        AND ${PHOTO_EFFECTIVE_YEAR} = ${year}
        AND (pa.date IS NULL OR p.created_at >= pa.date)
        ${regionFilter}
        ${countryFilter}
        ${partnerTagFilter}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${DOWNLOAD_MAX_PHOTOS}
    `);

    // Map to the shape the archive worker pool expects (party nested object).
    const filtered = dlRows.map((r) => ({
      id: r.id,
      url: r.url,
      fileName: r.file_name,
      mimeType: r.mime_type,
      party: {
        city: r.city,
        customUrl: r.custom_url,
        inviteCode: r.invite_code,
        name: r.name,
      },
    }));

    if (filtered.length === 0) {
      return res.status(404).json({ error: { message: 'No photos match the filter' } });
    }

    const tag = partnerTag || 'photos';
    const dateStr = new Date().toISOString().slice(0, 10);
    const zipName = `${sanitizeForFilename(tag)}-photos-${dateStr}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('X-Photo-Count', String(filtered.length));

    // zlib level 1 — images are already compressed (JPEG/WebP/PNG); spending
    // CPU on level 6+ rarely shrinks the archive but adds significant latency.
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (err: Error) => {
      console.error('[salame-58291] archive error:', err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    archive.pipe(res);

    let added = 0;
    let skipped = 0;
    const usedNames = new Set<string>();

    // nduja-58295: parallelize photo fetches with a concurrency-10 worker pool.
    // Sequential fetches were the dominant timeout cause (97 photos × ~1s each
    // + occasional 15s slow fetches blew through Vercel's default 60s budget).
    // Buffer each photo fully via arrayBuffer() before calling archive.append
    // so multiple concurrent fetches don't interleave streams into the single
    // zip output. Per-photo 100MB cap keeps peak memory bounded
    // (10 × 100MB worst case is fine under Vercel's 1024MB lambda limit).
    const CONCURRENCY = 10;
    const PER_PHOTO_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

    const processOne = async (p: typeof filtered[number]) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), DOWNLOAD_PHOTO_TIMEOUT_MS);
        const r = await fetch(p.url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok || !r.body) {
          skipped++;
          return;
        }

        // Per-photo size cap (advisory via Content-Length; skipped if missing).
        const contentLen = parseInt(r.headers.get('content-length') || '0', 10);
        if (contentLen > PER_PHOTO_MAX_BYTES) {
          skipped++;
          return;
        }

        const slug = sanitizeForFilename(p.party.customUrl || p.party.inviteCode || 'unknown');
        const city = sanitizeForFilename(p.party.city || slug);
        const baseFromFile = p.fileName ? p.fileName.replace(/\.[^.]+$/, '') : null;
        const base = sanitizeForFilename(baseFromFile || p.id);
        const ext = (
          p.fileName?.split('.').pop() ||
          p.mimeType?.split('/').pop() ||
          'jpg'
        ).toLowerCase();

        // Buffer the whole photo before appending — keeps archive.append calls
        // atomic so the zip output stream isn't interleaved with concurrent
        // sources.
        const buf = Buffer.from(await r.arrayBuffer());

        // Avoid duplicate entry names within the archive (e.g. two payout
        // photos with the same generic original filename in the same city).
        // Resolve after fetch so name selection happens in the same critical
        // section as the append below.
        let entryName = `${city}/${base}.${ext}`;
        if (usedNames.has(entryName)) {
          entryName = `${city}/${base}-${p.id}.${ext}`;
        }
        usedNames.add(entryName);

        archive.append(buf, { name: entryName });
        added++;
      } catch (e) {
        skipped++;
      }
    };

    // Worker pool: keep CONCURRENCY fetches in flight; whenever one finishes,
    // pull the next item off the queue. Promise.race() returns when the next
    // inflight completes; the .finally() removes it from the inflight array.
    const queue = [...filtered];
    const inflight: Promise<void>[] = [];
    while (queue.length > 0 || inflight.length > 0) {
      while (inflight.length < CONCURRENCY && queue.length > 0) {
        const p = queue.shift()!;
        const promise = processOne(p).finally(() => {
          const idx = inflight.indexOf(promise);
          if (idx >= 0) inflight.splice(idx, 1);
        });
        inflight.push(promise);
      }
      if (inflight.length > 0) await Promise.race(inflight);
    }

    const readme = [
      `Pizza Party Photos - ${tag}`,
      `Generated: ${new Date().toISOString()}`,
      `Photos included: ${added}`,
      `Photos skipped (download error): ${skipped}`,
      `Total matching feed (capped at ${DOWNLOAD_MAX_PHOTOS}): ${filtered.length}`,
      '',
      'Source: https://www.rsv.pizza/photos',
    ].join('\n');
    archive.append(readme, { name: 'README.txt' });

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) next(error);
    else res.end();
  }
});

export default router;
