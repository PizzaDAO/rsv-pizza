import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (await isSuperAdmin(userEmail)) {
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

    // Calculate role breakdown — count ALL roles per guest (guests can have multiple)
    const roleBreakdown: Record<string, number> = {};
    party.guests.forEach(guest => {
      const guestRoles = guest.roles && guest.roles.length > 0 ? guest.roles : [guest.role || 'Other'];
      guestRoles.forEach(role => {
        roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
      });
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
        flyerArtistUrl: party.flyerArtistUrl,

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
        reportPassword: party.reportPassword || null,
        reportStatsConfig: party.reportStatsConfig || null,

        // Related data
        socialPosts: party.socialPosts,
        notableAttendees: party.notableAttendees,
        featuredPhotos: party.photos,

        // Wallet address list for CSV export
        walletAddressList: party.guests
          .filter(g => g.ethereumAddress)
          .map(g => g.ethereumAddress as string),

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
      flyerArtistUrl,
      xPostUrl,
      xPostViews,
      farcasterPostUrl,
      farcasterViews,
      lumaUrl,
      lumaViews,
      poapEventId,
      poapMints,
      poapMoments,
      reportStatsConfig,
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
        ...(flyerArtistUrl !== undefined && { flyerArtistUrl }),
        ...(xPostUrl !== undefined && { xPostUrl }),
        ...(xPostViews !== undefined && { xPostViews: toIntOrNull(xPostViews) }),
        ...(farcasterPostUrl !== undefined && { farcasterPostUrl }),
        ...(farcasterViews !== undefined && { farcasterViews: toIntOrNull(farcasterViews) }),
        ...(lumaUrl !== undefined && { lumaUrl }),
        ...(lumaViews !== undefined && { lumaViews: toIntOrNull(lumaViews) }),
        ...(poapEventId !== undefined && { poapEventId }),
        ...(poapMints !== undefined && { poapMints: toIntOrNull(poapMints) }),
        ...(poapMoments !== undefined && { poapMoments: toIntOrNull(poapMoments) }),
        ...(reportStatsConfig !== undefined && { reportStatsConfig }),
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

    // Accept optional password
    const { password } = req.body || {};

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
        reportPassword: password || null,
      },
    });

    res.json({
      success: true,
      reportPublicSlug: party.reportPublicSlug,
      publicUrl: `/report/${party.reportPublicSlug}`,
      hasPassword: !!party.reportPassword,
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

// GET /api/reports/:publicSlug/check - Check if report requires password (public)
router.get('/public/:publicSlug/check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { publicSlug } = req.params;
    const party = await prisma.party.findUnique({
      where: { reportPublicSlug: publicSlug },
      select: { reportPublished: true, reportPassword: true, name: true },
    });

    if (!party || !party.reportPublished) {
      throw new AppError('Report not found', 404, 'NOT_FOUND');
    }

    res.json({ requiresPassword: !!party.reportPassword, name: party.name });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/:publicSlug - View published report (public)
router.get('/public/:publicSlug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { publicSlug } = req.params;
    const password = req.query.password as string | undefined;

    // Quick password check before loading full data
    const check = await prisma.party.findUnique({
      where: { reportPublicSlug: publicSlug },
      select: { reportPassword: true, reportPublished: true },
    });

    if (check?.reportPassword && check.reportPassword !== password) {
      throw new AppError('Password required', 401, 'PASSWORD_REQUIRED');
    }

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

    // Calculate role breakdown — count ALL roles per guest (guests can have multiple)
    const roleBreakdown: Record<string, number> = {};
    party.guests.forEach(guest => {
      const guestRoles = guest.roles && guest.roles.length > 0 ? guest.roles : [guest.role || 'Other'];
      guestRoles.forEach(role => {
        roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
      });
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
        flyerArtistUrl: party.flyerArtistUrl,

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
        reportStatsConfig: party.reportStatsConfig || null,

        // Related data
        socialPosts: party.socialPosts,
        notableAttendees: party.notableAttendees,
        featuredPhotos: party.photos,

        // Wallet address list for CSV export
        walletAddressList: party.guests
          .filter(g => g.ethereumAddress)
          .map(g => g.ethereumAddress as string),

        // Calculated stats (some fields hidden for privacy)
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

// =====================
// Page View Stats
// =====================

// GET /api/parties/:partyId/report/views - Get page view stats (host only)
router.get('/:partyId/report/views', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Total views
    const totalViews = await prisma.pageView.count({
      where: { partyId },
    });

    // Unique views (distinct visitor_hash)
    const uniqueResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT visitor_hash) as count
      FROM page_views
      WHERE party_id = ${partyId}::uuid
        AND visitor_hash IS NOT NULL
    `;
    const uniqueViews = Number(uniqueResult[0]?.count || 0);

    // Daily views for last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyResult = await prisma.$queryRaw<{ date: string; total: bigint; unique: bigint }[]>`
      SELECT
        TO_CHAR(viewed_at::date, 'YYYY-MM-DD') as date,
        COUNT(*) as total,
        COUNT(DISTINCT visitor_hash) as unique
      FROM page_views
      WHERE party_id = ${partyId}::uuid
        AND viewed_at >= ${thirtyDaysAgo}
      GROUP BY viewed_at::date
      ORDER BY viewed_at::date ASC
    `;
    const dailyViews = dailyResult.map(row => ({
      date: row.date,
      total: Number(row.total),
      unique: Number(row.unique),
    }));

    // Top referrers (top 10, excluding null/empty)
    const referrerResult = await prisma.$queryRaw<{ referrer: string; count: bigint }[]>`
      SELECT referrer, COUNT(*) as count
      FROM page_views
      WHERE party_id = ${partyId}::uuid
        AND referrer IS NOT NULL
        AND referrer != ''
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 10
    `;
    const topReferrers = referrerResult.map(row => ({
      referrer: row.referrer,
      count: Number(row.count),
    }));

    res.json({
      totalViews,
      uniqueViews,
      dailyViews,
      topReferrers,
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

// POST /api/parties/:partyId/report/social-posts - Add social post
router.post('/:partyId/report/social-posts', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { platform, url, authorHandle, title, views } = req.body;

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

    const socialPost = await prisma.socialPost.create({
      data: {
        partyId,
        platform,
        url,
        authorHandle: authorHandle || null,
        title: title || null,
        views: views != null && views !== '' ? (typeof views === 'string' ? parseInt(views, 10) : views) : null,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    });

    res.status(201).json({ socialPost });
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
    const { name, link, guestId } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    if (!name) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // If guestId provided, check for duplicates
    if (guestId) {
      const existing = await prisma.notableAttendee.findFirst({
        where: { partyId, guestId },
      });
      if (existing) {
        return res.status(200).json({ notableAttendee: existing });
      }
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
        guestId: guestId || null,
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

// DELETE /api/parties/:partyId/report/notable-attendees/by-guest/:guestId - Remove notable attendee by guest ID
router.delete('/:partyId/report/notable-attendees/by-guest/:guestId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Find the notable attendee by guest ID
    const notableAttendee = await prisma.notableAttendee.findFirst({
      where: { partyId, guestId },
    });

    if (!notableAttendee) {
      throw new AppError('Notable attendee not found for this guest', 404, 'NOT_FOUND');
    }

    await prisma.notableAttendee.delete({
      where: { id: notableAttendee.id },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/report/notable-attendees/guest-ids - Get notable guest IDs
router.get('/:partyId/report/notable-attendees/guest-ids', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const notableAttendees = await prisma.notableAttendee.findMany({
      where: { partyId, guestId: { not: null } },
      select: { guestId: true },
    });

    const guestIds = notableAttendees
      .map(a => a.guestId)
      .filter((id): id is string => id !== null);

    res.json({ guestIds });
  } catch (error) {
    next(error);
  }
});

export default router;
