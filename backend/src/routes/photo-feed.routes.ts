import { Router, Response, NextFunction, Request } from 'express';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_FILTER_ITEMS = 50;

function parseCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== 'string' || !raw.includes('_')) return null;
  const sepIdx = raw.lastIndexOf('_');
  const ts = raw.slice(0, sepIdx);
  const id = raw.slice(sepIdx + 1);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime()) || !id) return null;
  return { createdAt: d, id };
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

router.get('/feed', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(
      Math.max(parseInt((req.query.limit as string) || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const cursor = parseCursor(req.query.cursor);

    const regions = parseCsv(req.query.regions);
    const countries = parseCsv(req.query.countries);
    const partnerTagRaw = req.query.partnerTag;
    const partnerTag = typeof partnerTagRaw === 'string' && partnerTagRaw.trim()
      ? partnerTagRaw.trim()
      : null;

    const where: any = {
      status: 'approved',
      party: {
        is: buildPartyFilter({ regions, countries, partnerTag }),
      },
    };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
      ];
    }

    const rows = await prisma.photo.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
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
        // salame-58195
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
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${page[page.length - 1].createdAt.toISOString()}_${page[page.length - 1].id}`
      : null;

    res.json({
      photos: page.map((p) => {
        const votes = (p as typeof p & { votes?: { id: string }[] }).votes;
        return {
          id: p.id,
          url: p.url,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          mimeType: p.mimeType,
          duration: p.duration,
          width: p.width,
          height: p.height,
          createdAt: p.createdAt,
          // salame-58195
          voteCount: p.voteCount,
          votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
          party: {
            // Include id so the client can hit the per-party vote endpoint.
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
  } catch (error) {
    next(error);
  }
});

// sicilian-58129: facets endpoint — returns distinct country values among
// feed-eligible photos (approved + party-eligible) with photo counts.
// Used by the /photos filter bar to populate the country dropdown.
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
