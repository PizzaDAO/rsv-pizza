import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';

// Extend Request to include underboss
interface UnderbossRequest extends AuthRequest {
  underboss?: {
    id: string;
    name: string;
    email: string;
    region: string;
    isActive: boolean;
  };
}

// Token validation middleware
async function requireUnderbossToken(
  req: UnderbossRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const token = (req.query.token as string) || req.headers['x-underboss-token'] as string;
    if (!token) {
      throw new AppError('Access token required', 401, 'UNAUTHORIZED');
    }

    const underboss = await prisma.underboss.findUnique({
      where: { accessToken: token },
    });

    if (!underboss || !underboss.isActive) {
      throw new AppError('Invalid or inactive token', 403, 'FORBIDDEN');
    }

    req.underboss = {
      id: underboss.id,
      name: underboss.name,
      email: underboss.email,
      region: underboss.region,
      isActive: underboss.isActive,
    };

    next();
  } catch (error) {
    next(error);
  }
}

// Helper: compute progress for an event
function computeProgress(party: any) {
  return {
    hasVenue: !!(party.venueName || party.address),
    hasBudget: !!(party.budgetEnabled && party.budgetTotal),
    hasPartyKit: !!party.partyKit,
    hasEventImage: !!party.eventImageUrl,
    hasDate: !!party.date,
    hasAddress: !!party.address,
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
    createdAt: party.createdAt,
  };
}

const router = Router();

// ============================================
// Dashboard routes (token-based auth)
// ============================================

// GET /api/underboss/:region - Main dashboard data
router.get('/:region', requireUnderbossToken, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;

    // Verify the underboss is assigned to this region
    if (req.underboss!.region !== region) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const events = await prisma.party.findMany({
      where: {
        region,
        eventType: 'gpp',
      },
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
router.get('/:region/events', requireUnderbossToken, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    if (req.underboss!.region !== region) {
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
router.get('/:region/events/:partyId', requireUnderbossToken, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region, partyId } = req.params;

    if (req.underboss!.region !== region) {
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
router.get('/:region/stats', requireUnderbossToken, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;

    if (req.underboss!.region !== region) {
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
// Admin routes (JWT auth + super admin check)
// ============================================

// POST /api/underboss/admin/create - Create underboss + generate token
router.post('/admin/create', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req.userEmail)) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { name, email, region, notes } = req.body;

    if (!name || !email || !region) {
      throw new AppError('Name, email, and region are required', 400, 'VALIDATION_ERROR');
    }

    // Generate a secure random token
    const accessToken = `ub_${crypto.randomBytes(32).toString('hex')}`;

    const underboss = await prisma.underboss.create({
      data: {
        name,
        email,
        region,
        accessToken,
        notes: notes || null,
      },
    });

    res.status(201).json({
      underboss: {
        id: underboss.id,
        name: underboss.name,
        email: underboss.email,
        region: underboss.region,
        isActive: underboss.isActive,
        notes: underboss.notes,
        createdAt: underboss.createdAt,
      },
      accessToken, // Only returned on creation
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/admin/list - List all underbosses
router.get('/admin/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req.userEmail)) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const underbosses = await prisma.underboss.findMany({
      orderBy: { region: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
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
    if (!isSuperAdmin(req.userEmail)) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { name, email, region, notes, isActive } = req.body;

    const underboss = await prisma.underboss.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(region !== undefined && { region }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(isActive !== undefined && { isActive }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
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

// POST /api/underboss/admin/:id/rotate-token - Rotate access token
router.post('/admin/:id/rotate-token', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req.userEmail)) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const newToken = `ub_${crypto.randomBytes(32).toString('hex')}`;

    await prisma.underboss.update({
      where: { id },
      data: { accessToken: newToken },
    });

    res.json({ accessToken: newToken });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/underboss/admin/:id - Deactivate underboss
router.delete('/admin/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isSuperAdmin(req.userEmail)) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
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
    if (!isSuperAdmin(req.userEmail)) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { partyId } = req.params;
    const { region } = req.body;

    const validRegions = ['latam', 'europe', 'india', 'usa-canada', 'africa', 'apac'];
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
