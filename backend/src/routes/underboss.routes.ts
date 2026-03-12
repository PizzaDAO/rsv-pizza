import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';

// Extend Request to include underboss
interface UnderbossRequest extends AuthRequest {
  underboss?: {
    id: string;
    name: string;
    email: string;
    region: string;
    regions: string[];
    isActive: boolean;
  };
}

function isAuthorizedForRegion(underboss: { regions: string[] }, region: string): boolean {
  if (underboss.regions.includes('__admin__')) return true;
  return underboss.regions.includes(region);
}

// Login-based underboss middleware — requires JWT auth, then looks up underboss by email
async function requireUnderbossAuth(
  req: UnderbossRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Check if user is an admin first
    if (await isAdmin(email)) {
      req.underboss = {
        id: 'admin',
        name: 'Admin',
        email,
        region: '__admin__', // Special marker — admin can view any region
        regions: ['__admin__'],
        isActive: true,
      };
      return next();
    }

    // Look up underboss by email
    const underboss = await prisma.underboss.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
        regions: true,
        isActive: true,
      },
    });

    if (underboss) {
      // Fall back to [region] if regions array is empty (legacy data)
      const regions = underboss.regions.length > 0 ? underboss.regions : [underboss.region];
      req.underboss = {
        id: underboss.id,
        name: underboss.name,
        email: underboss.email,
        region: underboss.region,
        regions,
        isActive: underboss.isActive,
      };
      return next();
    }

    // Neither underboss nor admin
    throw new AppError('Not authorized as underboss', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}

// Helper: compute progress for an event (9 items matching GPP host dashboard)
function computeProgress(party: any) {
  const coHosts = Array.isArray(party.coHosts) ? party.coHosts : [];
  const sponsors = Array.isArray(party.sponsors) ? party.sponsors : [];
  const checkedInCount = party.guests?.filter((g: any) => g.checkedInAt).length || 0;
  const eventPassed = party.date ? new Date(party.date) < new Date() : false;

  return {
    hasCreatedEvent: true,
    hasPartyKit: !!party.partyKit,
    hasCoHosts: coHosts.length > 0,
    hasVenue: !!(party.venueName || party.address),
    hasBudget: !!(party.budgetEnabled && party.budgetTotal),
    hasSponsors: sponsors.length > 0,
    hasPrepared: false, // manual step — always false for now
    hasSocialPosts: !!(party.xPostUrl || party.farcasterPostUrl),
    hasThrown: eventPassed && checkedInCount > 0,
  };
}

// Helper: compute stats from events
function computeStats(events: any[]) {
  const totalEvents = events.length;
  let totalRsvps = 0;
  let totalApproved = 0;
  let eventsWithVenue = 0;
  let eventsWithBudget = 0;
  let eventsWithKit = 0;

  for (const event of events) {
    const guestCount = event._count?.guests || 0;
    const approvedCount = event.guests?.filter((g: any) => g.approved !== false).length || 0;

    totalRsvps += guestCount;
    totalApproved += approvedCount;

    const progress = computeProgress(event);
    if (progress.hasVenue) eventsWithVenue++;
    if (progress.hasBudget) eventsWithBudget++;
    if (progress.hasPartyKit) eventsWithKit++;
  }

  return {
    totalEvents,
    totalRsvps,
    totalApproved,
    eventsWithVenue,
    eventsWithBudget,
    eventsWithKit,
    completionRate: {
      venue: totalEvents > 0 ? Math.round((eventsWithVenue / totalEvents) * 100) : 0,
      budget: totalEvents > 0 ? Math.round((eventsWithBudget / totalEvents) * 100) : 0,
      partyKit: totalEvents > 0 ? Math.round((eventsWithKit / totalEvents) * 100) : 0,
    },
    avgRsvpsPerEvent: totalEvents > 0 ? Math.round(totalRsvps / totalEvents) : 0,
  };
}

// Helper: format event for response
function formatEvent(party: any) {
  const guestCount = party._count?.guests || 0;
  const approvedCount = party.guests?.filter((g: any) => g.approved !== false).length || 0;
  const checkedInCount = party.guests?.filter((g: any) => g.checkedInAt).length || 0;
  const photoCount = party._count?.photos || 0;

  // Get total sponsored from sponsors relation
  const totalSponsored = party.sponsors?.reduce((sum: number, s: any) => {
    if (['yes', 'billed', 'paid'].includes(s.status) && s.amount) {
      return sum + Number(s.amount);
    }
    return sum;
  }, 0) || 0;

  return {
    id: party.id,
    name: party.name,
    customUrl: party.customUrl,
    date: party.date,
    address: party.address,
    venueName: party.venueName,
    region: party.region || null,
    host: {
      name: party.user?.name || null,
      email: party.user?.email || null,
    },
    coHosts: party.coHosts || [],
    progress: computeProgress(party),
    guestCount,
    approvedCount,
    checkedInCount,
    photoCount,
    kitStatus: party.partyKit?.status || null,
    fundraisingGoal: party.fundraisingGoal ? Number(party.fundraisingGoal) : null,
    totalSponsored,
    hostStatus: party.hostStatus || null,
    underbossApproved: party.underbossApproved || false,
    hostTags: party.hostTags || [],
    createdAt: party.createdAt,
  };
}

const router = Router();

// ============================================
// Dashboard routes (login-based auth)
// ============================================

// GET /api/underboss/me - Returns the current user's underboss record or admin status
router.get('/me', requireAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Check admin first
    const adminStatus = await isAdmin(email);
    if (adminStatus) {
      return res.json({
        isAdmin: true,
        isUnderboss: false,
        region: null,
        regions: ['__admin__'],
        name: 'Admin',
        email,
      });
    }

    // Look up underboss by email
    const underboss = await prisma.underboss.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
    });

    if (underboss) {
      // Fall back to [region] if regions array is empty (legacy data)
      const regions = underboss.regions.length > 0 ? underboss.regions : [underboss.region];
      return res.json({
        isAdmin: false,
        isUnderboss: true,
        region: underboss.region,
        regions,
        name: underboss.name,
        email: underboss.email,
      });
    }

    // Neither
    return res.json({
      isAdmin: false,
      isUnderboss: false,
      region: null,
      regions: [],
      name: null,
      email,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/:region - Main dashboard data
router.get('/:region', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;

    // Handle "all" region — admins see everything, underbosses see their assigned regions
    if (region === 'all') {
      const isAdminUser = req.underboss!.regions.includes('__admin__');
      if (!isAdminUser && req.underboss!.regions.length === 0) {
        throw new AppError('Not authorized for any region', 403, 'FORBIDDEN');
      }
    } else {
      // Verify the underboss is assigned to this region (admins can view any region)
      if (!isAuthorizedForRegion(req.underboss!, region)) {
        throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
      }
    }

    let whereClause;
    if (region === 'all') {
      const isAdminUser = req.underboss!.regions.includes('__admin__');
      whereClause = isAdminUser
        ? { eventType: 'gpp' as const }
        : { eventType: 'gpp' as const, region: { in: req.underboss!.regions } };
    } else {
      whereClause = { region, eventType: 'gpp' as const };
    }

    const events = await prisma.party.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, email: true } },
        guests: {
          select: { id: true, approved: true, checkedInAt: true },
        },
        partyKit: { select: { status: true } },
        sponsors: { select: { status: true, amount: true } },
        _count: { select: { guests: true, photos: true } },
      },
      orderBy: { date: 'asc' },
    });

    const stats = computeStats(events);
    const formattedEvents = events.map(formatEvent);

    res.json({
      region,
      underboss: { name: req.underboss!.name, email: req.underboss!.email },
      stats,
      events: formattedEvents,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/:region/events - Paginated event list
router.get('/:region/events', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    if (!isAuthorizedForRegion(req.underboss!, region)) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const [events, total] = await Promise.all([
      prisma.party.findMany({
        where: { region, eventType: 'gpp' },
        include: {
          user: { select: { name: true, email: true } },
          guests: {
            select: { id: true, approved: true, checkedInAt: true },
          },
          partyKit: { select: { status: true } },
          sponsors: { select: { status: true, amount: true } },
          _count: { select: { guests: true, photos: true } },
        },
        orderBy: { date: 'asc' },
        skip,
        take: limit,
      }),
      prisma.party.count({ where: { region, eventType: 'gpp' } }),
    ]);

    res.json({
      events: events.map(formatEvent),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/:region/events/:partyId - Single event detail
router.get('/:region/events/:partyId', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region, partyId } = req.params;

    if (!isAuthorizedForRegion(req.underboss!, region)) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const party = await prisma.party.findFirst({
      where: { id: partyId, region, eventType: 'gpp' },
      include: {
        user: { select: { name: true, email: true } },
        guests: {
          select: { id: true, name: true, email: true, approved: true, checkedInAt: true, submittedAt: true },
          orderBy: { submittedAt: 'desc' },
        },
        partyKit: true,
        sponsors: {
          select: { id: true, name: true, status: true, amount: true, sponsorshipType: true },
          orderBy: { createdAt: 'desc' },
        },
        budgetItems: {
          select: { id: true, name: true, category: true, cost: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { guests: true, photos: true } },
      },
    });

    if (!party) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    res.json({
      event: {
        ...formatEvent(party),
        guests: party.guests,
        partyKit: party.partyKit,
        sponsors: party.sponsors,
        budgetItems: party.budgetItems,
        description: party.description,
        eventImageUrl: party.eventImageUrl,
        budgetTotal: party.budgetTotal ? Number(party.budgetTotal) : null,
        budgetEnabled: party.budgetEnabled,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/:region/stats - Aggregate stats
router.get('/:region/stats', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;

    if (!isAuthorizedForRegion(req.underboss!, region)) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const events = await prisma.party.findMany({
      where: { region, eventType: 'gpp' },
      include: {
        guests: {
          select: { id: true, approved: true, checkedInAt: true },
        },
        partyKit: { select: { status: true } },
        _count: { select: { guests: true, photos: true } },
      },
    });

    const stats = computeStats(events);

    res.json({ region, stats });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Bulk action routes (underboss auth)
// ============================================

// PATCH /api/underboss/events/bulk-approve - Bulk approve/unapprove events
router.patch('/events/bulk-approve', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyIds, approved } = req.body;

    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      throw new AppError('partyIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const result = await prisma.party.updateMany({
      where: { id: { in: partyIds } },
      data: { underbossApproved: approved },
    });

    res.json({ updated: result.count });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/underboss/events/bulk-delete - Bulk delete events
router.delete('/events/bulk-delete', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyIds } = req.body;

    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      throw new AppError('partyIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    const result = await prisma.party.deleteMany({
      where: { id: { in: partyIds } },
    });

    res.json({ deleted: result.count });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Event PATCH routes (underboss auth)
// ============================================

// PATCH /api/underboss/event/:partyId/host-status - Set host status (new/alum/pro)
router.patch('/event/:partyId/host-status', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { hostStatus } = req.body;

    const validStatuses = ['new', 'alum', 'pro', null];
    if (!validStatuses.includes(hostStatus)) {
      throw new AppError('Invalid host status. Must be "new", "alum", "pro", or null', 400, 'VALIDATION_ERROR');
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: { hostStatus: hostStatus || null },
      select: { id: true, hostStatus: true },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/event/:partyId/approve - Toggle underboss approval
router.patch('/event/:partyId/approve', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { approved } = req.body;

    if (typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: { underbossApproved: approved },
      select: { id: true, underbossApproved: true },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/event/:partyId/tags - Set host tags
router.patch('/event/:partyId/tags', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      throw new AppError('tags must be an array of strings', 400, 'VALIDATION_ERROR');
    }

    // Validate: tags must be strings, max 50 chars each, max 10 tags
    const cleanTags = tags
      .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
      .map((t: string) => t.trim().toLowerCase().slice(0, 50))
      .slice(0, 10);

    const party = await prisma.party.update({
      where: { id: partyId },
      data: { hostTags: cleanTags },
      select: { id: true, hostTags: true },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Admin routes (JWT auth + super admin check)
// ============================================

// POST /api/underboss/admin/create - Create underboss
router.post('/admin/create', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { name, email, region, regions: regionsInput, notes } = req.body;

    // Accept regions array or legacy single region
    let regions: string[] = [];
    if (Array.isArray(regionsInput) && regionsInput.length > 0) {
      regions = regionsInput;
    } else if (region) {
      regions = [region];
    }

    if (!name || !email || regions.length === 0) {
      throw new AppError('Name, email, and at least one region are required', 400, 'VALIDATION_ERROR');
    }

    // Generate a placeholder token for the DB column (required by schema) but it's no longer used for auth
    const placeholderToken = `unused_${crypto.randomBytes(32).toString('hex')}`;

    const underboss = await prisma.underboss.create({
      data: {
        name,
        email: email.toLowerCase(),
        region: regions[0], // Deprecated field — set to first region
        regions,
        accessToken: placeholderToken,
        notes: notes || null,
      },
    });

    res.status(201).json({
      underboss: {
        id: underboss.id,
        name: underboss.name,
        email: underboss.email,
        region: underboss.region,
        regions: underboss.regions,
        isActive: underboss.isActive,
        notes: underboss.notes,
        createdAt: underboss.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/admin/list - List all underbosses
router.get('/admin/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const underbosses = await prisma.underboss.findMany({
      orderBy: { region: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
        regions: true,
        isActive: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ underbosses });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/admin/:id - Update underboss
router.patch('/admin/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { name, email, region, regions, notes, isActive } = req.body;

    const updateData: any = {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(region !== undefined && { region }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(isActive !== undefined && { isActive }),
    };

    // Handle regions array update
    if (Array.isArray(regions)) {
      updateData.regions = regions;
      // Also update deprecated region field to first region
      if (regions.length > 0) {
        updateData.region = regions[0];
      }
    }

    const underboss = await prisma.underboss.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
        regions: true,
        isActive: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ underboss });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/underboss/admin/:id - Deactivate underboss
router.delete('/admin/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    await prisma.underboss.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Underboss deactivated' });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/admin/assign-region/:partyId - Set region on a GPP event
router.patch('/admin/assign-region/:partyId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { partyId } = req.params;
    const { region } = req.body;

    const validRegions = ['usa', 'canada', 'central-america', 'south-america', 'western-europe', 'eastern-europe', 'west-africa', 'east-africa', 'south-africa', 'india', 'china', 'middle-east', 'asia', 'oceania'];
    if (region && !validRegions.includes(region)) {
      throw new AppError(`Invalid region. Must be one of: ${validRegions.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: { region: region || null },
      select: { id: true, name: true, region: true },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

export default router;
