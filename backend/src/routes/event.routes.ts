import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { isAdmin } from '../middleware/auth.js';
import { GPP_GLOBAL_EDITORS } from '../helpers/partyAccess.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';

const PIZZADAO_AVATAR_URL = 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/profile-pictures/cmkgpzby50002f8y1d8md1dzn/1768937020563.jpg';

const router = Router();

// GET /api/events/:slug - Get public event details with host profile (public)
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug.toLowerCase();

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: {
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
        maxGuests: true,
        hideGuests: true,
        eventImageUrl: true,
        description: true,
        rsvpClosedAt: true,
        coHosts: true,
        selectedPizzerias: true,
        eventType: true,
        eventTags: true,
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
      },
    });

    // If not found by invite code, try custom URL
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: {
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
          maxGuests: true,
          hideGuests: true,
          eventImageUrl: true,
          description: true,
          rsvpClosedAt: true,
          coHosts: true,
          selectedPizzerias: true,
          eventType: true,
          eventTags: true,
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
          password: true,
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
            select: { guests: true },
          },
        },
      });
    }

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

    // Fetch confirmed sponsors with descriptions or logos for public display
    const sponsors = await prisma.sponsor.findMany({
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
    });

    // Page view stats for one-sheet
    const [totalViews, uniqueVisitorsResult] = await Promise.all([
      prisma.pageView.count({ where: { partyId: party.id } }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT visitor_hash) as count
        FROM page_views
        WHERE party_id = ${party.id}::uuid AND visitor_hash IS NOT NULL
      `,
    ]);
    const pageViewStats = {
      totalViews,
      uniqueVisitors: Number(uniqueVisitorsResult[0]?.count ?? 0),
    };

    // Enrich coHosts with user profile data (avatar, socials) then strip emails
    // mushroom-48468: User.email is canonical lowercase. Co-host emails come from
    // user-typed JSONB and may be mixed-case — lowercase before query + lookup.
    const rawCoHosts = (party.coHosts as any[] || []);
    const coHostEmails = rawCoHosts.map((h: any) => h.email).filter(Boolean);
    const coHostEmailsLc = coHostEmails.map((e: string) => e.toLowerCase());
    let profilesByEmail: Record<string, any> = {};
    if (coHostEmailsLc.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: coHostEmailsLc } },
        select: { email: true, profilePictureUrl: true, twitter: true, website: true, instagram: true },
      });
      profilesByEmail = Object.fromEntries(users.map(u => [u.email, u]));
    }
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
        coHosts: sanitizedCoHosts,
        selectedPizzerias: party.selectedPizzerias,
        eventType: party.eventType,
        underbossStatus: party.underbossStatus,
        eventTags: party.eventTags,
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

// POST /api/events/:slug/check-host - Check if an email belongs to a co-host (public, no auth)
router.post('/:slug/check-host', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug.toLowerCase();
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.json({ isHost: false });
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
      return res.json({ isHost: false });
    }

    const coHosts = (party.coHosts as any[]) || [];
    const matchedHost = coHosts.find(
      (h: any) => h.email?.toLowerCase() === email.toLowerCase()
    );

    // Check GPP global editor access
    let isHost = !!matchedHost;
    let canEdit = !!matchedHost?.canEdit;
    if (!canEdit && (party as any).eventType === 'gpp' && email) {
      const isGppEditor = GPP_GLOBAL_EDITORS.some(e => e.toLowerCase() === email.toLowerCase());
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
