// soppressata-72251: per-partner BizDev industry report at GET /api/bizdev?partner={tag}.
//
// Serves a companies-only (NO PII — no guest names/emails) breakdown of which
// COMPANIES (inferred from email domain) RSVP'd across APPROVED GPP events,
// bucketed by industry and shown through each partner's lens.
//
// Scope (same for every partner): event_type='gpp' AND underboss_status='approved'.
// The partner only changes which buckets are FEATURED, not the event universe.
//
// Access control (authoritative = server-side, per-route — NEVER a path-less
// router.use gate, which would leak to sibling /api routers):
//   requireAuth, then allow if isAdmin || isUnderboss || (caller's active
//   SponsorUser.tag === requested partner's tag). Other partner's tag -> 403.
//   Unknown partner -> 404. Logged-out -> 401 (via requireAuth).

import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { BUCKETS, classifyDomain } from '../lib/industryTaxonomy.js';
import { BIZDEV_PARTNERS, resolveBizdevPartner } from '../lib/bizdevPartners.js';

const router = Router();

type Confidence = 'high' | 'medium';

interface CompanyAccumulator {
  company: string;
  bucket: string;
  confidence: Confidence;
  rsvpCount: number;
  eventIds: Set<string>;
}

interface CompanyOut {
  company: string;
  rsvpCount: number;
  eventCount: number;
  confidence: Confidence;
}

interface BucketOut {
  bucketId: string;
  label: string;
  companies: CompanyOut[];
}

interface BizdevCache {
  buckets: Map<string, BucketOut>; // bucketId -> bucket with companies
  coverage: {
    events: number;
    totalEmails: number;
    matched: number;
    personal: number;
    internal: number;
    distinctCompanies: number;
  };
  computedAt: number;
}

const CACHE_TTL_MS = 45 * 60 * 1000; // ~45 min
let cache: BizdevCache | null = null;
let inFlight: Promise<BizdevCache> | null = null;

// Classification is partner-independent: compute the full bucketed result ONCE
// (deduped to distinct companies per bucket with rsvpCount + distinct
// eventCount), cache it, and filter cached buckets per partner on each request.
async function buildBizdevCache(): Promise<BizdevCache> {
  // Pull every approved-GPP guest email + its party id. The filter lives in
  // `where` (NOT a take-then-filter) so rare matches are never dropped.
  const guests = await prisma.guest.findMany({
    where: {
      email: { not: null },
      party: { eventType: 'gpp', underbossStatus: 'approved' },
    },
    select: { email: true, partyId: true },
  });

  // company key (lowercased company name within a bucket) -> accumulator
  const byCompany = new Map<string, CompanyAccumulator>();
  const eventIds = new Set<string>();

  let totalEmails = 0;
  let matched = 0;
  let personalOrUnmatched = 0;

  for (const g of guests) {
    const email = g.email;
    if (!email) continue;
    const at = email.lastIndexOf('@');
    if (at < 0) continue;
    const domain = email.slice(at + 1).trim().toLowerCase();
    if (!domain) continue;

    totalEmails += 1;
    eventIds.add(g.partyId);

    const cls = classifyDomain(domain);
    if (!cls) {
      // Personal/freemail/internal OR unknown domain with no keyword match.
      personalOrUnmatched += 1;
      continue;
    }
    matched += 1;

    const key = `${cls.bucket}::${cls.company.toLowerCase()}`;
    const existing = byCompany.get(key);
    if (existing) {
      existing.rsvpCount += 1;
      existing.eventIds.add(g.partyId);
      // Prefer the higher-confidence label if any row was 'high'.
      if (cls.confidence === 'high') existing.confidence = 'high';
    } else {
      byCompany.set(key, {
        company: cls.company,
        bucket: cls.bucket,
        confidence: cls.confidence,
        rsvpCount: 1,
        eventIds: new Set([g.partyId]),
      });
    }
  }

  // Group companies into buckets, sorted by rsvpCount desc then name asc.
  const buckets = new Map<string, BucketOut>();
  for (const acc of byCompany.values()) {
    let bucket = buckets.get(acc.bucket);
    if (!bucket) {
      bucket = {
        bucketId: acc.bucket,
        label: BUCKETS[acc.bucket] || acc.bucket,
        companies: [],
      };
      buckets.set(acc.bucket, bucket);
    }
    bucket.companies.push({
      company: acc.company,
      rsvpCount: acc.rsvpCount,
      eventCount: acc.eventIds.size,
      confidence: acc.confidence,
    });
  }
  for (const bucket of buckets.values()) {
    bucket.companies.sort(
      (a, b) => b.rsvpCount - a.rsvpCount || a.company.localeCompare(b.company)
    );
  }

  // `personal` and `internal` are reported together in `personal` for the
  // coverage banner caveat ("counts are a floor"); classifyDomain doesn't
  // distinguish them in its null return, so personal here = freemail + internal
  // + unknown-unmatched. Keep `internal` as 0 to avoid implying a precision we
  // don't have; the banner copy explains the floor.
  return {
    buckets,
    coverage: {
      events: eventIds.size,
      totalEmails,
      matched,
      personal: personalOrUnmatched,
      internal: 0,
      distinctCompanies: byCompany.size,
    },
    computedAt: Date.now(),
  };
}

async function getBizdevCache(): Promise<BizdevCache> {
  if (cache && Date.now() - cache.computedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = buildBizdevCache()
    .then((c) => {
      cache = c;
      return c;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * GET /api/bizdev?partner={tag}
 * Auth: requireAuth, then admin OR underboss OR own-tag sponsor.
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail; // requireAuth guarantees this (else 401)

    const partner = resolveBizdevPartner(req.query?.partner as string | undefined);
    if (!partner) {
      throw new AppError('Unknown partner', 404, 'PARTNER_NOT_FOUND');
    }

    // OR gate — DO NOT use a sponsor middleware that hard-403s underbosses.
    const [admin, underboss] = await Promise.all([
      isAdmin(email),
      isUnderboss(email),
    ]);

    let authorized = admin || underboss;
    if (!authorized && email) {
      // Caller must have an ACTIVE SponsorUser row whose tag matches THIS
      // partner's real tag. Any other tag -> 403.
      const sponsor = await prisma.sponsorUser.findFirst({
        where: { email: email.toLowerCase(), tag: partner.tag, isActive: true },
        select: { id: true },
      });
      authorized = !!sponsor;
    }

    if (!authorized) {
      throw new AppError('Not authorized for this partner', 403, 'FORBIDDEN');
    }

    const data = await getBizdevCache();

    // Filter cached buckets through this partner's lens.
    const lensSet = new Set(partner.lensBuckets);
    const featured: BucketOut[] = [];
    for (const bucketId of partner.lensBuckets) {
      const bucket = data.buckets.get(bucketId);
      if (bucket && bucket.companies.length > 0) featured.push(bucket);
    }
    // `other` = buckets with matches NOT in the lens, in canonical BUCKETS order.
    const other: BucketOut[] = [];
    for (const bucketId of Object.keys(BUCKETS)) {
      if (lensSet.has(bucketId)) continue;
      const bucket = data.buckets.get(bucketId);
      if (bucket && bucket.companies.length > 0) other.push(bucket);
    }

    res.set('Cache-Control', 'private, max-age=300');
    res.json({
      tag: partner.id,
      label: partner.label,
      blurb: partner.blurb,
      scope: 'approved-gpp',
      coverage: data.coverage,
      featured,
      other,
    });
  } catch (e) {
    next(e);
  }
});

// Exported for tests / introspection.
export const BIZDEV_PARTNER_IDS = BIZDEV_PARTNERS.map((p) => p.id);

export default router;
