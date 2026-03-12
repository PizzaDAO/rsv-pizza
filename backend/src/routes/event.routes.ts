import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// GET /api/events/:slug - Get public event details with host profile (public)
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;

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
        address: true,
        venueName: true,
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
        photosEnabled: true,
        photosPublic: true,
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
          select: { guests: true },
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
          address: true,
          venueName: true,
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
          photosEnabled: true,
          photosPublic: true,
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

    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // Enrich coHosts with user profile data (avatar, socials) then strip emails
    const rawCoHosts = (party.coHosts as any[] || []);
    const coHostEmails = rawCoHosts.map((h: any) => h.email).filter(Boolean);
    let profilesByEmail: Record<string, any> = {};
    if (coHostEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: coHostEmails } },
        select: { email: true, profilePictureUrl: true, twitter: true, website: true, instagram: true },
      });
      profilesByEmail = Object.fromEntries(users.map(u => [u.email, u]));
    }
    const sanitizedCoHosts = rawCoHosts.map(({ email, ...rest }: any) => {
      const profile = email ? profilesByEmail[email] : null;
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
        avatar_url: pizzaCoHost?.avatar_url || null,
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
        address: party.address,
        venueName: party.venueName,
        maxGuests: party.maxGuests,
        hideGuests: party.hideGuests,
        eventImageUrl: party.eventImageUrl,
        description: party.description,
        rsvpClosedAt: party.rsvpClosedAt,
        coHosts: sanitizedCoHosts,
        selectedPizzerias: party.selectedPizzerias,
        eventType: party.eventType,
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
        photosEnabled: party.photosEnabled,
        photosPublic: party.photosPublic,
        hasPassword: !!party.password,
        hostName: party.eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
        hostProfile,
        guestCount: party._count.guests,
        userId: party.userId,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/:slug/verify-tweet - Verify a tweet exists via oEmbed
router.post('/:slug/verify-tweet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
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
