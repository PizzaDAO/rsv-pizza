import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { isAdmin } from '../middleware/auth.js';
import { getGppGlobalEditors } from '../lib/privateConfig.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import { resolveGppByYear, isGpp27Hidden } from '../helpers/gpp27.js';
import { isEventHiddenFrom } from '../helpers/eventVisibility.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { publicTags } from '../lib/eventTags.js';
import { isBoothGloballyOn } from '../lib/boothSettings.js';

const PIZZADAO_AVATAR_URL = 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/profile-pictures/cmkgpzby50002f8y1d8md1dzn/1768937020563.jpg';

const EVENT_SELECT = {
    id: true,
    name: true,
    inviteCode: true,
    customUrl: true,
    date: true,
    duration: true,
    timezone: true,
    pizzaStyle: true,
    availableBeverages: true,
    availableToppings: true,
    availableDietaryOptions: true,
    showToppingsOnRsvp: true,
    address: true,
    latitude: true,
    longitude: true,
    placeId: true,
    venueName: true,
    country: true,
    city: true,
    region: true, // soppressata-50927: needed for the GPP27 pre-launch scope gate
    maxGuests: true,
    hideGuests: true,
    eventImageUrl: true,
    description: true,
    rsvpClosedAt: true,
    // porchetta-81402: public event page renders a cancelled banner +
    // disables the RSVP form when cancelledAt is non-null. The optional
    // free-text reason is shown below the banner.
    cancelledAt: true,
    cancellationReason: true,
    coHosts: true,
    selectedPizzerias: true,
    eventType: true,
    eventSeriesId: true,
    eventTags: true,
    labels: true,
    donationEnabled: true,
    donationRecipient: true,
    donationRecipientUrl: true,
    donationGoal: true,
    donationMessage: true,
    suggestedAmounts: true,
    donationEthAddress: true,
    shareToUnlock: true,
    shareTweetText: true,
    photoModeration: true,
    nftEnabled: true,
    nftChain: true,
    quizEnabled: true,
    photosEnabled: true,
    photosPublic: true,
    hiddenGppPhotos: true,
    extraGppPhotos: true,
    telegramGroup: true,
    turtleRolesEnabled: true,
    underbossStatus: true,
    reimbursementCapUsd: true,
    oneSheetConfig: true, // focaccina-58550
    hackathon: { select: { publishedAt: true, disabledAt: true } }, // hackathon PR 2: section flag only
    password: true, // Just to check if it exists
    userId: true,
    user: {
      select: {
        name: true,
        profilePictureUrl: true,
        website: true,
        twitter: true,
        instagram: true,
        youtube: true,
        tiktok: true,
        linkedin: true,
      },
    },
    _count: {
      // mushroom-31723: exclude rejected guests (approved=false) from the public count.
      // anchovy-59118: see rsvp.routes.ts capacity-gate comment for why we use OR/null.
      select: { guests: { where: { OR: [{ approved: true }, { approved: null }] } } },
    },
} satisfies Prisma.PartySelect;

const router = Router();

// In-process cache for the one-sheet page-view stats (two COUNT queries per event load otherwise).
const PAGE_VIEW_STATS_TTL_MS = 60_000;
const pageViewStatsCache = new Map<string, { at: number; value: { totalViews: number; uniqueVisitors: number } }>();

async function getPageViewStats(partyId: string) {
  const hit = pageViewStatsCache.get(partyId);
  if (hit && Date.now() - hit.at < PAGE_VIEW_STATS_TTL_MS) return hit.value;
  const [totalViews, uniqueVisitorsResult] = await Promise.all([
    prisma.pageView.count({ where: { partyId } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT visitor_hash) as count
      FROM page_views
      WHERE party_id = ${partyId}::uuid AND visitor_hash IS NOT NULL
    `,
  ]);
  const value = { totalViews, uniqueVisitors: Number(uniqueVisitorsResult[0]?.count ?? 0) };
  if (pageViewStatsCache.size > 500) pageViewStatsCache.clear();
  pageViewStatsCache.set(partyId, { at: Date.now(), value });
  return value;
}

// GET /api/events/:slug - Get public event details with host profile (public)
// soppressata-50927: optionalAuth so the pre-launch GPP27 gate can recognize
// admins / in-scope underbosses and let them preview 2027 events.
router.get('/:slug', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug.toLowerCase();

    // soppressata-50927: year-aware GPP resolution. When a `?year=YYYY` query
    // param is present (or for a bare city slug that has multiple GPP editions),
    // resolve the GPP party by (citySlug, year-from-date). Bare slug => latest
    // year. This is PURELY ADDITIVE: when no GPP candidate matches we fall
    // through to the exact inviteCode/customUrl lookup below, so every existing
    // (non-GPP and 2026) link keeps resolving unchanged.
    const yearParam = typeof req.query.year === 'string' ? parseInt(req.query.year, 10) : NaN;
    const requestedYear = Number.isInteger(yearParam) && yearParam > 1900 && yearParam < 3000 ? yearParam : null;
    // Perf + safety guard: only invoke the (GPP-only) year resolver when there's
    // a `?year=` param OR the slug carries a trailing 2-digit suffix (the only
    // shape a raw year-suffixed GPP customUrl like `austin27` takes). This keeps
    // the common bare-slug path (every non-GPP + 2026 link) on the exact lookup
    // with zero extra queries, while still ENFORCING the pre-launch 2027 gate
    // both for `/{city}?year=2027` and for direct `/{city}27` access. Post-
    // launch, drop this guard to enable "bare /{city} => latest year".
    const slugHasYearSuffix = /^(.+?)\d{2}$/.test(slug);
    let resolvedSlugOverride: string | null = null;
    if (requestedYear != null || slugHasYearSuffix) {
      const yearMatch = await resolveGppByYear(slug, requestedYear);
      if (yearMatch) {
        // Pre-launch gate: hide 2027 events from out-of-scope viewers (treat as 404).
        const hidden = await isGpp27Hidden(yearMatch, req.userEmail);
        if (hidden) {
          throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
        }
        // Look the resolved party up via its canonical slug, reusing the exact
        // existing select shape below.
        resolvedSlugOverride = (yearMatch.customUrl || yearMatch.inviteCode || '').toLowerCase();
      }
    }

    const lookupSlug = resolvedSlugOverride || slug;

    // Find party by invite code OR custom URL in one query (invite code wins if both match
    // different parties, same precedence as the old two-step lookup).
    const candidates = await prisma.party.findMany({
      where: { OR: [{ inviteCode: lookupSlug }, { customUrl: lookupSlug }] },
      select: EVENT_SELECT,
      take: 2,
    });
    const party = candidates.find((c) => c.inviteCode === lookupSlug) ?? candidates[0] ?? null;

    // If not found by either method, check slug_aliases for a redirect
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: slug },
        select: { party: { select: { customUrl: true, inviteCode: true } } },
      });
      if (alias?.party) {
        const newSlug = alias.party.customUrl || alias.party.inviteCode;
        return res.status(301).json({ redirect: true, slug: newSlug, url: `/${newSlug}` });
      }
    }

    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // soppressata-50927: pre-launch safety net. Even when the year resolver was
    // skipped (e.g. a brand-new 2027 city whose customUrl is the bare slug, with
    // no `?year=`), gate the resolved party here so a gated 2027 GPP event can
    // never leak to an out-of-scope viewer via a direct customUrl/inviteCode hit.
    // rigatoni-58919: same gate for unpublished "side" (conference side) events. Shared helper
    // (helpers/eventVisibility.ts) so hackathon public reads apply the identical rules.
    if (await isEventHiddenFrom(party, req.userEmail)) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // Enrich coHosts with user profile data (avatar, socials) then strip emails
    // mushroom-48468: User.email is canonical lowercase. Co-host emails come from
    // user-typed JSONB and may be mixed-case — lowercase before query + lookup.
    const rawCoHosts = (party.coHosts as any[] || []);
    const coHostEmailsLc = rawCoHosts.map((h: any) => h.email).filter(Boolean).map((e: string) => e.toLowerCase());

    // Independent reads run in parallel: sponsors (confirmed, with descriptions or logos),
    // one-sheet page-view stats (cached 60s), co-host user profiles, and the booth flag.
    // Booth: global rollout flag AND the host's per-party toggle (no row = on) AND not cancelled.
    // Looked up on its own (not in the party select) so a deploy before the party_booths migration
    // can only turn the booth off, never break event pages.
    const loadBooth = async (): Promise<boolean> => {
      if (party.cancelledAt || !(await isBoothGloballyOn())) return false;
      try {
        const row = await prisma.partyBooth.findUnique({ where: { partyId: party.id }, select: { enabled: true } });
        return row?.enabled !== false;
      } catch (err) {
        console.warn('[booth] party_booths lookup failed; booth off for this request.', err);
        return false;
      }
    };
    const [sponsors, pageViewStats, coHostUsers, boothEnabled] = await Promise.all([
      prisma.sponsor.findMany({
      where: {
        partyId: party.id,
        status: { in: ['yes', 'billed', 'paid'] },
        OR: [
          { brandDescription: { not: null } },
          { logoUrl: { not: null } },
        ],
      },
      select: {
        id: true,
        name: true,
        website: true,
        brandDescription: true,
        logoUrl: true,
        brandTwitter: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
      getPageViewStats(party.id),
      coHostEmailsLc.length > 0
        ? prisma.user.findMany({
            where: { email: { in: coHostEmailsLc } },
            select: { email: true, profilePictureUrl: true, twitter: true, website: true, instagram: true },
          })
        : Promise.resolve([] as { email: string; profilePictureUrl: string | null; twitter: string | null; website: string | null; instagram: string | null }[]),
      loadBooth(),
    ]);
    const profilesByEmail: Record<string, any> = Object.fromEntries(coHostUsers.map(u => [u.email, u]));
    const sanitizedCoHosts = rawCoHosts.map(({ email, ...rest }: any) => {
      const profile = email ? profilesByEmail[email.toLowerCase()] : null;
      if (profile) {
        return {
          ...rest,
          avatar_url: rest.avatar_url || profile.profilePictureUrl || null,
          twitter: rest.twitter || profile.twitter || null,
          website: rest.website || profile.website || null,
          instagram: rest.instagram || profile.instagram || null,
        };
      }
      return rest;
    });

    // Build host profile from user data (or PizzaDAO co-host for GPP events)
    let hostProfile;
    if (party.eventType === 'gpp') {
      const pizzaCoHost = sanitizedCoHosts.find((h: any) => h.name === 'PizzaDAO');
      hostProfile = {
        name: 'PizzaDAO',
        avatar_url: pizzaCoHost?.avatar_url || PIZZADAO_AVATAR_URL,
        website: pizzaCoHost?.website || 'https://pizzadao.org',
        twitter: pizzaCoHost?.twitter || 'pizza_dao',
        instagram: pizzaCoHost?.instagram || 'pizza_dao',
        youtube: null,
        tiktok: null,
        linkedin: null,
      };
    } else {
      hostProfile = party.user ? {
        name: party.user.name || null,
        avatar_url: party.user.profilePictureUrl || null,
        website: party.user.website || null,
        twitter: party.user.twitter || null,
        instagram: party.user.instagram || null,
        youtube: party.user.youtube || null,
        tiktok: party.user.tiktok || null,
        linkedin: party.user.linkedin || null,
      } : null;
    }

    // Anonymous responses are identical for every caller, so let the CDN cache them briefly.
    // Anything with an Authorization header (hosts, admins, pre-launch previews) is never
    // publicly cached. Error/404/redirect responses above never set this header.
    res.vary('Authorization');
    if (!req.headers.authorization) {
      res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    } else {
      res.set('Cache-Control', 'private, no-store');
    }
    res.json({
      event: {
        id: party.id,
        name: party.name,
        inviteCode: party.inviteCode,
        customUrl: party.customUrl,
        date: party.date,
        duration: party.duration,
        timezone: party.timezone,
        pizzaStyle: party.pizzaStyle,
        availableBeverages: party.availableBeverages,
        availableToppings: party.availableToppings,
        availableDietaryOptions: party.availableDietaryOptions,
        showToppingsOnRsvp: party.showToppingsOnRsvp,
        address: party.address,
        latitude: party.latitude,
        longitude: party.longitude,
        placeId: party.placeId,
        venueName: party.venueName,
        country: party.country,
        city: party.city,
        maxGuests: party.maxGuests,
        hideGuests: party.hideGuests,
        eventImageUrl: party.eventImageUrl,
        description: party.description,
        rsvpClosedAt: party.rsvpClosedAt,
        // porchetta-81402: include cancelled state in the public event payload.
        cancelledAt: party.cancelledAt,
        cancellationReason: party.cancellationReason,
        coHosts: sanitizedCoHosts,
        selectedPizzerias: party.selectedPizzerias,
        eventType: party.eventType,
        // White-label: lets a brand site redirect events that belong to another series.
        eventSeriesId: party.eventSeriesId ?? null,
        underbossStatus: party.underbossStatus,
        // calzone-50114: strip internal control tags from the public payload.
        eventTags: publicTags(party.eventTags),
        // blackolive-70521: host-chosen public tags (curated keys; public by construction)
        labels: party.labels ?? [],
        donationEnabled: party.donationEnabled,
        donationRecipient: party.donationRecipient,
        donationRecipientUrl: party.donationRecipientUrl,
        donationGoal: party.donationGoal ? Number(party.donationGoal) : null,
        donationMessage: party.donationMessage,
        suggestedAmounts: party.suggestedAmounts,
        donationEthAddress: party.donationEthAddress,
        shareToUnlock: party.shareToUnlock,
        shareTweetText: party.shareTweetText,
        photoModeration: party.photoModeration,
        nftEnabled: party.nftEnabled,
        nftChain: party.nftChain,
        quizEnabled: party.quizEnabled,
        photosEnabled: party.photosEnabled,
        boothEnabled,
        photosPublic: party.photosPublic,
        hiddenGppPhotos: party.hiddenGppPhotos || [],
        extraGppPhotos: party.extraGppPhotos || [],
        telegramGroup: party.telegramGroup || null,
        turtleRolesEnabled: party.turtleRolesEnabled || false,
        hasPassword: !!party.password,
        hostName: party.eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
        hostProfile,
        guestCount: party._count.guests,
        userId: party.userId,
        sponsors,
        pageViewStats,
        reimbursementCapUsd: party.reimbursementCapUsd != null ? Number(party.reimbursementCapUsd) : null,
        // focaccina-58550: host-customizable one-sheet config (read-only on public page).
        oneSheetConfig: party.oneSheetConfig ?? null,
        // Hackathon platform: the event page fetches GET /api/parties/:id/hackathon only when true.
        hasHackathon: !!(party.hackathon?.publishedAt && !party.hackathon.disabledAt),
        // arugula-38633 v2 follow-up: numeric-tag fallback when no
        // underboss-validated cap exists. See helpers/reimbursementCap.ts.
        effectiveReimbursementCapUsd: computeEffectiveCapUsd({
          reimbursementCapUsd: party.reimbursementCapUsd,
          eventTags: party.eventTags,
        }),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/:slug/check-host - Is the signed-in caller a host/co-host of this event?
// The caller is derived from the JWT (optionalAuth); a body email is ignored so the endpoint can't be
// used to probe whether arbitrary emails are hosts or admins. Unauthenticated -> not a host.
router.post('/:slug/check-host', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug.toLowerCase();
    const email = req.userEmail;
    res.set('Cache-Control', 'private, no-store');

    if (!email || typeof email !== 'string') {
      return res.json({ isHost: false, canEdit: false });
    }

    // Find party by invite code or custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: { coHosts: true, userId: true, eventType: true },
    });
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: { coHosts: true, userId: true, eventType: true },
      });
    }
    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: slug },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: { coHosts: true, userId: true, eventType: true },
        });
      }
    }
    if (!party) {
      return res.json({ isHost: false, canEdit: false });
    }

    const coHosts = (party.coHosts as any[]) || [];
    const matchedHost = coHosts.find(
      (h: any) => h.email?.toLowerCase() === email.toLowerCase()
    );

    // Check GPP global editor access
    let isHost = !!matchedHost;
    let canEdit = !!matchedHost?.canEdit;
    if (!canEdit && (party as any).eventType === 'gpp' && email) {
      const gppEditors = await getGppGlobalEditors();
      const isGppEditor = gppEditors.some(e => e.toLowerCase() === email.toLowerCase());
      if (isGppEditor) {
        isHost = true;
        canEdit = true;
      }
    }

    // Admin/superadmin bypass password on all events
    if (!isHost && await isAdmin(email)) {
      isHost = true;
      canEdit = true;
    }

    res.json({ isHost, canEdit });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/:slug/verify-tweet - Verify a tweet exists via oEmbed
router.post('/:slug/verify-tweet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug.toLowerCase();
    const { tweetUrl } = req.body;

    if (!tweetUrl || typeof tweetUrl !== 'string') {
      throw new AppError('Tweet URL is required', 400, 'MISSING_TWEET_URL');
    }

    // Validate URL format (must be twitter.com or x.com status URL)
    const tweetUrlPattern = /^https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/;
    if (!tweetUrlPattern.test(tweetUrl)) {
      throw new AppError('Invalid tweet URL format', 400, 'INVALID_TWEET_URL');
    }

    // Verify the event exists and has share-to-unlock enabled
    let party = await prisma.party.findUnique({ where: { inviteCode: slug }, select: { id: true, shareToUnlock: true } });
    if (!party) {
      party = await prisma.party.findUnique({ where: { customUrl: slug }, select: { id: true, shareToUnlock: true } });
    }
    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: slug },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: { id: true, shareToUnlock: true },
        });
      }
    }
    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }
    if (!party.shareToUnlock) {
      throw new AppError('Share to unlock is not enabled for this event', 400, 'SHARE_NOT_ENABLED');
    }

    // Normalize x.com URLs to twitter.com for oEmbed compatibility
    const normalizedUrl = tweetUrl.replace('https://x.com/', 'https://twitter.com/').replace('http://x.com/', 'https://twitter.com/');

    // Verify tweet via oEmbed API
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}`;
    const response = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSVPizza/1.0)' },
    });

    if (response.ok) {
      res.json({ verified: true });
    } else {
      res.json({ verified: false, error: 'Could not verify tweet. Please check the URL.' });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
