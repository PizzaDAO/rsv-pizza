import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (isSuperAdmin(userEmail)) {
    return true;
  }

  // Otherwise, must be the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

// Generate a unique slug for public reports
function generateSlug(): string {
  return crypto.randomBytes(8).toString('hex');
}

const router = Router();

// GET /api/parties/:partyId/report - Get full report data (host only)
router.get('/:partyId/report', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      include: {
        socialPosts: { orderBy: { sortOrder: 'asc' } },
        notableAttendees: { orderBy: { sortOrder: 'asc' } },
        guests: {
          select: {
            id: true,
            name: true,
            email: true,
            ethereumAddress: true,
            roles: true,
            role: true,
            mailingListOptIn: true,
            approved: true,
          },
        },
        photos: {
          where: { starred: true },
          orderBy: { starredAt: 'desc' },
          take: 10,
        },
        user: {
          select: {
            name: true,
            profilePictureUrl: true,
          },
        },
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Calculate stats
    const totalRsvps = party.guests.length;
    const approvedGuests = party.guests.filter(g => g.approved !== false).length;
    const mailingListSignups = party.guests.filter(g => g.mailingListOptIn).length;
    const walletAddresses = party.guests.filter(g => g.ethereumAddress).length;

    // Calculate role breakdown
    const roleBreakdown: Record<string, number> = {};
    party.guests.forEach(guest => {
      // Use single role field if available, otherwise use first role from roles array
      const role = guest.role || (guest.roles && guest.roles.length > 0 ? guest.roles[0] : 'Other');
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    });

    res.json({
      report: {
        // Event details
        id: party.id,
        name: party.name,
        date: party.date,
        timezone: party.timezone,
        venueName: party.venueName,
        address: party.address,
        eventImageUrl: party.eventImageUrl,
        description: party.description,
        coHosts: party.coHosts,
        host: party.user,

        // Report-specific fields
        reportRecap: party.reportRecap,
        reportVideoUrl: party.reportVideoUrl,
        reportPhotosUrl: party.reportPhotosUrl,
        flyerArtist: party.flyerArtist,

        // KPIs
        xPostUrl: party.xPostUrl,
        xPostViews: party.xPostViews,
        farcasterPostUrl: party.farcasterPostUrl,
        farcasterViews: party.farcasterViews,
        lumaUrl: party.lumaUrl,
        lumaViews: party.lumaViews,
        poapEventId: party.poapEventId,
        poapMints: party.poapMints,
        poapMoments: party.poapMoments,

        // Report settings
        reportPublished: party.reportPublished,
        reportPublicSlug: party.reportPublicSlug,

        // Related data
        socialPosts: party.socialPosts,
        notableAttendees: party.notableAttendees,
        featuredPhotos: party.photos,

        // Calculated stats
        stats: {
          totalRsvps,
          approvedGuests,
          mailingListSignups,
          walletAddresses,
          roleBreakdown,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/report - Update report fields (host only)
router.patch('/:partyId/report', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      reportRecap,
      reportVideoUrl,
      reportPhotosUrl,
      flyerArtist,
      xPostUrl,
      xPostViews,
      farcasterPostUrl,
      farcasterViews,
      lumaUrl,
      lumaViews,
      poapEventId,
      poapMints,
      poapMoments,
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Helper: convert value to integer or null (handles string, number, null)
    const toIntOrNull = (val: any): number | null => {
      if (val === null || val === undefined || val === '') return null;
      const num = typeof val === 'string' ? parseInt(val, 10) : val;
      return isNaN(num) ? null : num;
    };

    const party = await prisma.party.update({
      where: { id: partyId },
      data: {
        ...(reportRecap !== undefined && { reportRecap }),
        ...(reportVideoUrl !== undefined && { reportVideoUrl }),
        ...(reportPhotosUrl !== undefined && { reportPhotosUrl }),
        ...(flyerArtist !== undefined && { flyerArtist }),
        ...(xPostUrl !== undefined && { xPostUrl }),
        ...(xPostViews !== undefined && { xPostViews: toIntOrNull(xPostViews) }),
        ...(farcasterPostUrl !== undefined && { farcasterPostUrl }),
        ...(farcasterViews !== undefined && { farcasterViews: toIntOrNull(farcasterViews) }),
        ...(lumaUrl !== undefined && { lumaUrl }),
        ...(lumaViews !== undefined && { lumaViews: toIntOrNull(lumaViews) }),
        ...(poapEventId !== undefined && { poapEventId }),
        ...(poapMints !== undefined && { poapMints: toIntOrNull(poapMints) }),
        ...(poapMoments !== undefined && { poapMoments: toIntOrNull(poapMoments) }),
      },
    });

    res.json({ success: true, party });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/report/publish - Publish report with public slug
router.post('/:partyId/report/publish', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if already published
    const existingParty = await prisma.party.findUnique({
      where: { id: partyId },
      select: { reportPublished: true, reportPublicSlug: true },
    });

    if (!existingParty) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Generate slug if not already set
    let slug = existingParty.reportPublicSlug;
    if (!slug) {
      slug = generateSlug();
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: {
        reportPublished: true,
        reportPublicSlug: slug,
      },
    });

    res.json({
      success: true,
      reportPublicSlug: party.reportPublicSlug,
      publicUrl: `/report/${party.reportPublicSlug}`,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/report/publish - Unpublish report
router.delete('/:partyId/report/publish', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    await prisma.party.update({
      where: { id: partyId },
      data: {
        reportPublished: false,
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/:publicSlug - View published report (public)
router.get('/public/:publicSlug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { publicSlug } = req.params;

    const party = await prisma.party.findUnique({
      where: { reportPublicSlug: publicSlug },
      include: {
        socialPosts: { orderBy: { sortOrder: 'asc' } },
        notableAttendees: { orderBy: { sortOrder: 'asc' } },
        guests: {
          select: {
            id: true,
            roles: true,
            role: true,
            mailingListOptIn: true,
            ethereumAddress: true,
            approved: true,
          },
        },
        photos: {
          where: { starred: true },
          orderBy: { starredAt: 'desc' },
          take: 10,
        },
        user: {
          select: {
            name: true,
            profilePictureUrl: true,
          },
        },
      },
    });

    if (!party) {
      throw new AppError('Report not found', 404, 'NOT_FOUND');
    }

    if (!party.reportPublished) {
      throw new AppError('Report is not published', 404, 'NOT_PUBLISHED');
    }

    // Calculate stats
    const totalRsvps = party.guests.length;
    const approvedGuests = party.guests.filter(g => g.approved !== false).length;
    const mailingListSignups = party.guests.filter(g => g.mailingListOptIn).length;
    const walletAddresses = party.guests.filter(g => g.ethereumAddress).length;

    // Calculate role breakdown
    const roleBreakdown: Record<string, number> = {};
    party.guests.forEach(guest => {
      const role = guest.role || (guest.roles && guest.roles.length > 0 ? guest.roles[0] : 'Other');
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    });

    res.json({
      report: {
        // Event details (public)
        id: party.id,
        name: party.name,
        date: party.date,
        timezone: party.timezone,
        venueName: party.venueName,
        address: party.address,
        eventImageUrl: party.eventImageUrl,
        description: party.description,
        coHosts: party.coHosts,
        host: party.user,

        // Report-specific fields
        reportRecap: party.reportRecap,
        reportVideoUrl: party.reportVideoUrl,
        reportPhotosUrl: party.reportPhotosUrl,
        flyerArtist: party.flyerArtist,

        // KPIs
        xPostUrl: party.xPostUrl,
        xPostViews: party.xPostViews,
        farcasterPostUrl: party.farcasterPostUrl,
        farcasterViews: party.farcasterViews,
        lumaUrl: party.lumaUrl,
        lumaViews: party.lumaViews,
        poapEventId: party.poapEventId,
        poapMints: party.poapMints,
        poapMoments: party.poapMoments,

        // Related data
        socialPosts: party.socialPosts,
        notableAttendees: party.notableAttendees,
        featuredPhotos: party.photos,

        // Calculated stats (some fields hidden for privacy)
        stats: {
          totalRsvps,
          approvedGuests,
          mailingListSignups, // Might want to hide this
          walletAddresses,
          roleBreakdown,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// =====================
// Social Posts CRUD
// =====================

// GET /api/parties/:partyId/report/social-posts - List social posts
router.get('/:partyId/report/social-posts', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const socialPosts = await prisma.socialPost.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ socialPosts });
  } catch (error) {
    next(error);
  }
});

// Helper: fetch Twitter oEmbed data for a URL
async function fetchTwitterOembed(tweetUrl: string): Promise<{ html: string; authorName: string } | null> {
  try {
    // Normalize x.com to twitter.com for oEmbed API
    const normalizedUrl = tweetUrl.replace('https://x.com/', 'https://twitter.com/');
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&theme=dark&dnt=true`;
    const response = await fetch(oembedUrl);
    if (!response.ok) return null;
    const data = await response.json();
    return { html: data.html || null, authorName: data.author_name || '' };
  } catch {
    return null;
  }
}

// Helper: detect platform from URL
function detectPlatformFromUrl(url: string): string {
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('warpcast.com') || url.includes('farcaster')) return 'farcaster';
  if (url.includes('instagram.com')) return 'instagram';
  return 'twitter'; // default
}

// POST /api/parties/:partyId/report/social-posts - Add social post
router.post('/:partyId/report/social-posts', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { platform, url, authorHandle } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    if (!platform || !url) {
      throw new AppError('Platform and URL are required', 400, 'VALIDATION_ERROR');
    }

    // Get max sort order
    const maxOrder = await prisma.socialPost.aggregate({
      where: { partyId },
      _max: { sortOrder: true },
    });

    // Fetch oEmbed data for Twitter posts
    let embedHtml: string | null = null;
    let resolvedAuthorHandle = authorHandle || null;

    if (platform === 'twitter') {
      const oembedData = await fetchTwitterOembed(url);
      if (oembedData) {
        embedHtml = oembedData.html;
        if (!resolvedAuthorHandle && oembedData.authorName) {
          resolvedAuthorHandle = oembedData.authorName;
        }
      }
    }

    const socialPost = await prisma.socialPost.create({
      data: {
        partyId,
        platform,
        url,
        authorHandle: resolvedAuthorHandle,
        embedHtml,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    });

    res.status(201).json({ socialPost });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/report/social-posts/bulk - Bulk add social posts
router.post('/:partyId/report/social-posts/bulk', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { urls } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      throw new AppError('URLs array is required', 400, 'VALIDATION_ERROR');
    }

    // Limit to 50 URLs at a time
    const urlList = urls.slice(0, 50).map((u: string) => u.trim()).filter(Boolean);

    // Get max sort order
    const maxOrder = await prisma.socialPost.aggregate({
      where: { partyId },
      _max: { sortOrder: true },
    });
    let nextOrder = (maxOrder._max.sortOrder || 0) + 1;

    const createdPosts = [];

    for (const url of urlList) {
      const platform = detectPlatformFromUrl(url);

      let embedHtml: string | null = null;
      let authorHandle: string | null = null;

      if (platform === 'twitter') {
        const oembedData = await fetchTwitterOembed(url);
        if (oembedData) {
          embedHtml = oembedData.html;
          authorHandle = oembedData.authorName || null;
        }
      }

      const socialPost = await prisma.socialPost.create({
        data: {
          partyId,
          platform,
          url,
          authorHandle,
          embedHtml,
          sortOrder: nextOrder++,
        },
      });
      createdPosts.push(socialPost);
    }

    res.status(201).json({ socialPosts: createdPosts, count: createdPosts.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/report/social-posts/:id/refresh-embed - Refresh oEmbed for a post
router.post('/:partyId/report/social-posts/:id/refresh-embed', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Find the post
    const existingPost = await prisma.socialPost.findFirst({
      where: { id, partyId },
    });

    if (!existingPost) {
      throw new AppError('Social post not found', 404, 'NOT_FOUND');
    }

    if (existingPost.platform !== 'twitter') {
      throw new AppError('oEmbed refresh is only supported for Twitter posts', 400, 'UNSUPPORTED_PLATFORM');
    }

    const oembedData = await fetchTwitterOembed(existingPost.url);

    const socialPost = await prisma.socialPost.update({
      where: { id },
      data: {
        embedHtml: oembedData?.html || null,
        ...(oembedData?.authorName && !existingPost.authorHandle ? { authorHandle: oembedData.authorName } : {}),
      },
    });

    res.json({ socialPost });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/report/social-posts/:id - Delete social post
router.delete('/:partyId/report/social-posts/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify the social post belongs to this party
    const socialPost = await prisma.socialPost.findFirst({
      where: { id, partyId },
    });

    if (!socialPost) {
      throw new AppError('Social post not found', 404, 'NOT_FOUND');
    }

    await prisma.socialPost.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// =====================
// Notable Attendees CRUD
// =====================

// GET /api/parties/:partyId/report/notable-attendees - List notable attendees
router.get('/:partyId/report/notable-attendees', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const notableAttendees = await prisma.notableAttendee.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ notableAttendees });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/report/notable-attendees - Add notable attendee
router.post('/:partyId/report/notable-attendees', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, link } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    if (!name) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Get max sort order
    const maxOrder = await prisma.notableAttendee.aggregate({
      where: { partyId },
      _max: { sortOrder: true },
    });

    const notableAttendee = await prisma.notableAttendee.create({
      data: {
        partyId,
        name,
        link: link || null,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    });

    res.status(201).json({ notableAttendee });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/report/notable-attendees/:id - Delete notable attendee
router.delete('/:partyId/report/notable-attendees/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify the notable attendee belongs to this party
    const notableAttendee = await prisma.notableAttendee.findFirst({
      where: { id, partyId },
    });

    if (!notableAttendee) {
      throw new AppError('Notable attendee not found', 404, 'NOT_FOUND');
    }

    await prisma.notableAttendee.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
