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
        nftEnabled: true,
        nftChain: true,
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
          nftEnabled: true,
          nftChain: true,
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

    // Build host profile from user data
    const hostProfile = party.user ? {
      name: party.user.name || null,
      avatar_url: party.user.profilePictureUrl || null,
      website: party.user.website || null,
      twitter: party.user.twitter || null,
      instagram: party.user.instagram || null,
      youtube: party.user.youtube || null,
      tiktok: party.user.tiktok || null,
      linkedin: party.user.linkedin || null,
    } : null;

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
        coHosts: party.coHosts,
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
        nftEnabled: party.nftEnabled,
        nftChain: party.nftChain,
        hasPassword: !!party.password,
        hostName: party.user?.name || null,
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
