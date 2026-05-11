import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';
import { addPartnerToParty, removePartnerFromParty, getAutoCoHostPartners } from '../helpers/partnerSync.js';
import { setDeleteContext } from '../helpers/auditContext.js';

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
function computeProgress(party: any, underbossEmails: string[] = []) {
  const coHosts = Array.isArray(party.coHosts) ? party.coHosts : [];
  const sponsors = Array.isArray(party.sponsors) ? party.sponsors : [];
  const checkedInCount = party.guests?.filter((g: any) => g.checkedInAt).length || 0;
  const eventPassed = party.date ? new Date(party.date) < new Date() : false;

  // Filter out system co-hosts (PizzaDAO, the host, underbosses)
  const hostEmail = (party.user?.email || '').toLowerCase();
  const hostName = (party.user?.name || '').toLowerCase();

  const realCoHosts = coHosts.filter((h: any) => {
    const email = (h.email || '').toLowerCase();
    const name = (h.name || '').toLowerCase();

    // Exclude PizzaDAO
    if (name === 'pizzadao' || email === 'hello@rarepizzas.com') return false;

    // Exclude the host themselves
    if (hostEmail && email === hostEmail) return false;
    if (hostName && name === hostName && !email) return false;

    // Exclude underbosses
    if (email && underbossEmails.includes(email)) return false;

    return true;
  });

  return {
    hasCreatedEvent: true,
    hasPartyKit: !!party.partyKit,
    hasCoHosts: realCoHosts.length > 0,
    hasVenue: !!(party.venueName || party.address),
    hasBudget: !!(party.budgetEnabled && party.budgetTotal),
    hasSponsors: sponsors.length > 0,
    hasPrepared: false, // manual step — always false for now
    hasSocialPosts: !!(party.xPostUrl || party.farcasterPostUrl),
    hasThrown: eventPassed && checkedInCount > 0,
  };
}

// Helper: compute stats from events
function computeStats(events: any[], underbossEmails: string[] = []) {
  const totalEvents = events.length;
  let totalRsvps = 0;
  let totalApproved = 0;
  let eventsWithVenue = 0;
  let eventsWithBudget = 0;
  let eventsWithKit = 0;

  let totalInvited = 0;

  for (const event of events) {
    const invited = event.guests?.filter((g: any) => g.status === 'INVITED').length || 0;
    const guestCount = (event._count?.guests || 0) - invited;
    const approvedCount = event.guests?.filter((g: any) => g.approved !== false && g.status !== 'INVITED').length || 0;

    totalInvited += invited;
    totalRsvps += guestCount;
    totalApproved += approvedCount;

    const progress = computeProgress(event, underbossEmails);
    if (progress.hasVenue) eventsWithVenue++;
    if (progress.hasBudget) eventsWithBudget++;
    if (progress.hasPartyKit) eventsWithKit++;
  }

  return {
    totalEvents,
    totalRsvps,
    totalInvited,
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
function formatEvent(party: any, underbossEmails: string[] = [], latestSponsorMap?: Map<string, Date>) {
  const invitedCount = party.guests?.filter((g: any) => g.status === 'INVITED').length || 0;
  const guestCount = (party._count?.guests || 0) - invitedCount;
  const approvedCount = party.guests?.filter((g: any) => g.approved !== false && g.status !== 'INVITED').length || 0;
  const checkedInCount = party.guests?.filter((g: any) => g.checkedInAt).length || 0;
  const photoCount = party._count?.photos || 0;

  // Get total sponsored from sponsors relation
  const totalSponsored = party.sponsors?.reduce((sum: number, s: any) => {
    if (['yes', 'billed', 'paid'].includes(s.status) && s.amount) {
      return sum + Number(s.amount);
    }
    return sum;
  }, 0) || 0;

  // Flyer staleness detection
  const flyerGeneratedAt = party.flyerGeneratedAt ? new Date(party.flyerGeneratedAt).toISOString() : null;
  const latestSponsorAt = latestSponsorMap?.get(party.id) ?? null;
  const latestSponsorAtStr = latestSponsorAt ? new Date(latestSponsorAt).toISOString() : null;
  const flyerStale = latestSponsorAt !== null && (
    flyerGeneratedAt === null || new Date(latestSponsorAt) > new Date(flyerGeneratedAt)
  );

  return {
    id: party.id,
    name: party.name,
    customUrl: party.customUrl,
    date: party.date,
    address: party.address,
    venueName: party.venueName,
    region: party.region || null,
    country: party.country || null,
    eventImageUrl: party.eventImageUrl || null,
    timezone: party.timezone || null,
    duration: party.duration ? Number(party.duration) : null,
    host: {
      name: party.user?.name || null,
      email: party.user?.email || null,
    },
    coHosts: party.coHosts || [],
    progress: computeProgress(party, underbossEmails),
    guestCount,
    invitedCount,
    approvedCount,
    checkedInCount,
    photoCount,
    kitStatus: party.partyKit?.status || null,
    fundraisingGoal: party.fundraisingGoal ? Number(party.fundraisingGoal) : null,
    totalSponsored,
    hostStatus: party.hostStatus || null,
    underbossStatus: party.underbossStatus || 'pending',
    hostTags: party.hostTags || [],
    eventTags: party.eventTags || [],
    underbossNotes: party.underbossNotes || null,
    expectedGuests: party.expectedGuests || null,
    telegramGroup: party.telegramGroup || null,
    createdAt: party.createdAt,
    flyerGeneratedAt,
    flyerConfig: party.flyerConfig || null,
    latestSponsorAt: latestSponsorAtStr,
    flyerStale,
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

    // Check graphics admin status
    const graphicsAdmin = await prisma.graphicsAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    const isGraphicsAdmin = !!graphicsAdmin;

    // Check admin first
    const adminStatus = await isAdmin(email);
    if (adminStatus) {
      return res.json({
        isAdmin: true,
        isUnderboss: false,
        isGraphicsAdmin,
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
        isGraphicsAdmin,
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
      isGraphicsAdmin,
      region: null,
      regions: [],
      name: null,
      email,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// City status routes (underboss auth)
// NOTE: Must be registered BEFORE /:region catch-all
// ============================================

// GET /api/underboss/city-statuses - Returns all city statuses as a map
router.get('/city-statuses', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.cityStatus.findMany();
    const map: Record<string, { status: string; updatedBy: string | null; updatedAt: string }> = {};
    for (const row of rows) {
      map[row.cityKey] = {
        status: row.status,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    res.json(map);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/city-statuses - Upsert a city status (or delete if 'todo')
router.patch('/city-statuses', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { cityKey, status } = req.body;

    if (!cityKey || typeof cityKey !== 'string') {
      throw new AppError('cityKey is required', 400, 'VALIDATION_ERROR');
    }

    const validStatuses = ['created', 'skip', 'todo'];
    if (!validStatuses.includes(status)) {
      throw new AppError('status must be "created", "skip", or "todo"', 400, 'VALIDATION_ERROR');
    }

    const updatedBy = req.underboss?.email || null;

    if (status === 'todo') {
      // Default status doesn't need storage — delete the row
      await prisma.cityStatus.deleteMany({ where: { cityKey } });
      return res.json({ success: true, deleted: true });
    }

    // Upsert: create or update
    const result = await prisma.cityStatus.upsert({
      where: { cityKey },
      update: { status, updatedBy },
      create: { cityKey, status, updatedBy },
    });

    res.json({ success: true, cityStatus: result });
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
          select: { id: true, approved: true, checkedInAt: true, status: true },
        },
        partyKit: { select: { status: true } },
        sponsors: { select: { status: true, amount: true } },
        _count: { select: { guests: true, photos: true } },
      },
      orderBy: { date: 'asc' },
    });

    // Get all underboss emails for co-host filtering
    const allUnderbosses = await prisma.underboss.findMany({
      where: { isActive: true },
      select: { email: true },
    });
    const ubEmails = allUnderbosses.map(u => u.email.toLowerCase());

    // Get latest sponsor timestamp per party for flyer staleness detection
    const partyIds = events.map(e => e.id);
    const latestSponsorMap = new Map<string, Date>();
    if (partyIds.length > 0) {
      const sponsorTimestamps = await prisma.sponsor.groupBy({
        by: ['partyId'],
        where: {
          partyId: { in: partyIds },
          status: { in: ['yes', 'paid'] },
        },
        _max: { updatedAt: true },
      });
      for (const row of sponsorTimestamps) {
        if (row._max.updatedAt) {
          latestSponsorMap.set(row.partyId, row._max.updatedAt);
        }
      }
    }

    const stats = computeStats(events, ubEmails);
    const formattedEvents = events.map(e => formatEvent(e, ubEmails, latestSponsorMap));

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

    const [events, total, allUnderbosses] = await Promise.all([
      prisma.party.findMany({
        where: { region, eventType: 'gpp' },
        include: {
          user: { select: { name: true, email: true } },
          guests: {
            select: { id: true, approved: true, checkedInAt: true, status: true },
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
      prisma.underboss.findMany({
        where: { isActive: true },
        select: { email: true },
      }),
    ]);
    const ubEmails = allUnderbosses.map(u => u.email.toLowerCase());

    // Get latest sponsor timestamp per party for flyer staleness detection
    const partyIds = events.map(e => e.id);
    const latestSponsorMap = new Map<string, Date>();
    if (partyIds.length > 0) {
      const sponsorTimestamps = await prisma.sponsor.groupBy({
        by: ['partyId'],
        where: {
          partyId: { in: partyIds },
          status: { in: ['yes', 'paid'] },
        },
        _max: { updatedAt: true },
      });
      for (const row of sponsorTimestamps) {
        if (row._max.updatedAt) {
          latestSponsorMap.set(row.partyId, row._max.updatedAt);
        }
      }
    }

    res.json({
      events: events.map(e => formatEvent(e, ubEmails, latestSponsorMap)),
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

    // Get underboss emails for co-host filtering
    const allUnderbosses = await prisma.underboss.findMany({
      where: { isActive: true },
      select: { email: true },
    });
    const ubEmails = allUnderbosses.map(u => u.email.toLowerCase());

    res.json({
      event: {
        ...formatEvent(party, ubEmails),
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

    const [events, allUnderbosses] = await Promise.all([
      prisma.party.findMany({
        where: { region, eventType: 'gpp' },
        include: {
          user: { select: { name: true, email: true } },
          guests: {
            select: { id: true, approved: true, checkedInAt: true, status: true },
          },
          partyKit: { select: { status: true } },
          _count: { select: { guests: true, photos: true } },
        },
      }),
      prisma.underboss.findMany({
        where: { isActive: true },
        select: { email: true },
      }),
    ]);
    const ubEmails = allUnderbosses.map(u => u.email.toLowerCase());

    const stats = computeStats(events, ubEmails);

    res.json({ region, stats });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Bulk action routes (underboss auth)
// ============================================

// PATCH /api/underboss/events/bulk-status - Bulk update underboss status
router.patch('/events/bulk-status', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyIds, status } = req.body;

    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      throw new AppError('partyIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    const validStatuses = ['pending', 'approved', 'rejected', 'listed', 'hidden'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`status must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const result = await prisma.party.updateMany({
      where: { id: { in: partyIds } },
      data: { underbossStatus: status },
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

    const result = await prisma.$transaction(async (tx) => {
      await setDeleteContext(tx, req.userEmail, 'underboss_bulk');
      return tx.party.deleteMany({
        where: { id: { in: partyIds } },
      });
    });

    res.json({ deleted: result.count });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/events/bulk-event-tags - Bulk add/remove event tags
router.patch('/events/bulk-event-tags', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyIds, tags, action } = req.body;

    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      throw new AppError('partyIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (!Array.isArray(tags) || tags.length === 0) {
      throw new AppError('tags must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (!['add', 'remove', 'set'].includes(action)) {
      throw new AppError('action must be "add", "remove", or "set"', 400, 'VALIDATION_ERROR');
    }

    // Validate tags: strings, max 50 chars each, max 10 tags
    const cleanTags = tags
      .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
      .map((t: string) => t.trim().toLowerCase().slice(0, 50))
      .slice(0, 10);

    if (cleanTags.length === 0) {
      throw new AppError('No valid tags provided', 400, 'VALIDATION_ERROR');
    }

    // Fetch current events
    const parties = await prisma.party.findMany({
      where: { id: { in: partyIds } },
      select: { id: true, eventTags: true },
    });

    let updated = 0;
    for (const party of parties) {
      let newTags: string[];
      const existing = party.eventTags || [];

      if (action === 'add') {
        // Append tags, deduplicated
        const combined = [...existing, ...cleanTags];
        newTags = [...new Set(combined)];
      } else if (action === 'remove') {
        newTags = existing.filter((t: string) => !cleanTags.includes(t));
      } else {
        // 'set' — replace entirely
        newTags = cleanTags;
      }

      await prisma.party.update({
        where: { id: party.id },
        data: { eventTags: newTags },
      });
      updated++;

      // Sync partner co-hosts based on tag changes
      try {
        if (action === 'add') {
          // Find partners for the added tags and add them as co-hosts
          const partners = await getAutoCoHostPartners(cleanTags);
          const updatedParty = await prisma.party.findUnique({
            where: { id: party.id },
            select: { id: true, coHosts: true, eventTags: true },
          });
          if (updatedParty) {
            for (const partner of partners) {
              await addPartnerToParty(updatedParty, partner);
            }
          }
        } else if (action === 'remove') {
          // Remove partner co-hosts for the removed tags
          for (const tag of cleanTags) {
            await removePartnerFromParty(party.id, tag);
          }
        } else if (action === 'set') {
          // Diff: find tags removed and added
          const removedTags = existing.filter((t: string) => !cleanTags.includes(t));
          const addedTags = cleanTags.filter((t: string) => !existing.includes(t));

          for (const tag of removedTags) {
            await removePartnerFromParty(party.id, tag);
          }

          if (addedTags.length > 0) {
            const partners = await getAutoCoHostPartners(addedTags);
            const updatedParty = await prisma.party.findUnique({
              where: { id: party.id },
              select: { id: true, coHosts: true, eventTags: true },
            });
            if (updatedParty) {
              for (const partner of partners) {
                await addPartnerToParty(updatedParty, partner);
              }
            }
          }
        }
      } catch (syncError) {
        console.error(`Failed to sync partner co-hosts for party ${party.id}:`, syncError);
      }
    }

    res.json({ updated });
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

// PATCH /api/underboss/event/:partyId/status - Update underboss status
// Allows both underbosses (all statuses) and event owners (listed/hidden only from rejected/listed/hidden)
router.patch('/event/:partyId/status', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { status } = req.body;
    const email = req.userEmail;

    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const allValidStatuses = ['pending', 'approved', 'rejected', 'listed', 'hidden'];
    if (!allValidStatuses.includes(status)) {
      throw new AppError(`status must be one of: ${allValidStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Check if user is an underboss or admin
    const isAdminUser = await isAdmin(email);
    const underboss = isAdminUser ? { id: 'admin' } : await prisma.underboss.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: { id: true },
    });

    if (underboss) {
      // Underboss/admin: allow all statuses
      const party = await prisma.party.update({
        where: { id: partyId },
        data: { underbossStatus: status },
        select: { id: true, underbossStatus: true },
      });
      return res.json({ party });
    }

    // Not an underboss — check if user is the event owner
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, underbossStatus: true, user: { select: { email: true } } },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (party.user?.email?.toLowerCase() !== email.toLowerCase()) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    // Event owner: only allow listed/hidden transitions from rejected/listed/hidden
    const ownerAllowedStatuses = ['listed', 'hidden'];
    const ownerAllowedFromStatuses = ['rejected', 'listed', 'hidden'];

    if (!ownerAllowedStatuses.includes(status)) {
      throw new AppError('Event owners can only set status to listed or hidden', 403, 'FORBIDDEN');
    }

    if (!ownerAllowedFromStatuses.includes(party.underbossStatus || '')) {
      throw new AppError('Cannot change status from current state', 403, 'FORBIDDEN');
    }

    const updated = await prisma.party.update({
      where: { id: partyId },
      data: { underbossStatus: status },
      select: { id: true, underbossStatus: true },
    });

    res.json({ party: updated });
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

// PATCH /api/underboss/event/:partyId/expected-guests - Set expected guests
router.patch('/event/:partyId/expected-guests', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { expectedGuests } = req.body;

    if (expectedGuests !== null && expectedGuests !== undefined) {
      const num = Number(expectedGuests);
      if (!Number.isInteger(num) || num < 0) {
        throw new AppError('expectedGuests must be a non-negative integer or null', 400, 'VALIDATION_ERROR');
      }
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: { expectedGuests: expectedGuests != null ? Number(expectedGuests) : null },
      select: { id: true, expectedGuests: true },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/event/:partyId/notes - Set underboss notes
router.patch('/event/:partyId/notes', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { notes } = req.body;

    if (notes !== null && typeof notes !== 'string') {
      throw new AppError('notes must be a string or null', 400, 'VALIDATION_ERROR');
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: { underbossNotes: notes || null },
      select: { id: true, underbossNotes: true },
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

    // Add new underboss as co-host to all existing GPP events in their region(s)
    try {
      const gppEvents = await prisma.party.findMany({
        where: {
          eventType: 'gpp',
          region: { in: regions },
        },
        select: { id: true, coHosts: true },
      });

      const ubEmail = email.toLowerCase();
      for (const event of gppEvents) {
        const existingCoHosts = (event.coHosts as any[]) || [];
        // Skip if already a co-host
        if (existingCoHosts.some((h: any) => h.email?.toLowerCase() === ubEmail)) continue;

        const updatedCoHosts = [
          ...existingCoHosts,
          {
            id: crypto.randomUUID(),
            name,
            email: ubEmail,
            showOnEvent: false,
            canEdit: true,
            isUnderboss: true,
          },
        ];
        await prisma.party.update({
          where: { id: event.id },
          data: { coHosts: updatedCoHosts },
        });
      }
    } catch (syncError) {
      console.error('Failed to sync underboss co-hosts on create:', syncError);
    }

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

    // Fetch old state before update for co-host sync
    const oldUnderboss = await prisma.underboss.findUnique({
      where: { id },
      select: { name: true, email: true, regions: true, region: true, isActive: true },
    });

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

    // Sync co-host entries across GPP events
    if (oldUnderboss) {
      try {
        const oldEmail = oldUnderboss.email.toLowerCase();
        const newEmail = (email !== undefined ? email : oldUnderboss.email).toLowerCase();
        const newName = name !== undefined ? name : oldUnderboss.name;
        const oldRegions = oldUnderboss.regions.length > 0 ? oldUnderboss.regions : [oldUnderboss.region];
        const newRegions = Array.isArray(regions) ? regions : oldRegions;
        const nowActive = isActive !== undefined ? isActive : oldUnderboss.isActive;

        // If deactivated, remove from all events
        if (!nowActive && oldUnderboss.isActive) {
          const eventsWithUb = await prisma.party.findMany({
            where: { eventType: 'gpp' },
            select: { id: true, coHosts: true },
          });
          for (const event of eventsWithUb) {
            const coHosts = (event.coHosts as any[]) || [];
            const filtered = coHosts.filter((h: any) =>
              !(h.email?.toLowerCase() === oldEmail && h.isUnderboss === true)
            );
            if (filtered.length !== coHosts.length) {
              await prisma.party.update({
                where: { id: event.id },
                data: { coHosts: filtered },
              });
            }
          }
        } else if (nowActive) {
          // Determine added and removed regions
          const addedRegions = newRegions.filter((r: string) => !oldRegions.includes(r));
          const removedRegions = oldRegions.filter((r: string) => !newRegions.includes(r));

          // Remove from events in dropped regions
          if (removedRegions.length > 0) {
            const eventsToRemoveFrom = await prisma.party.findMany({
              where: { eventType: 'gpp', region: { in: removedRegions } },
              select: { id: true, coHosts: true },
            });
            for (const event of eventsToRemoveFrom) {
              const coHosts = (event.coHosts as any[]) || [];
              const filtered = coHosts.filter((h: any) =>
                !(h.email?.toLowerCase() === oldEmail && h.isUnderboss === true)
              );
              if (filtered.length !== coHosts.length) {
                await prisma.party.update({
                  where: { id: event.id },
                  data: { coHosts: filtered },
                });
              }
            }
          }

          // Add to events in new regions
          if (addedRegions.length > 0) {
            const eventsToAddTo = await prisma.party.findMany({
              where: { eventType: 'gpp', region: { in: addedRegions } },
              select: { id: true, coHosts: true },
            });
            for (const event of eventsToAddTo) {
              const coHosts = (event.coHosts as any[]) || [];
              if (coHosts.some((h: any) => h.email?.toLowerCase() === newEmail)) continue;
              const updatedCoHosts = [
                ...coHosts,
                {
                  id: crypto.randomUUID(),
                  name: newName,
                  email: newEmail,
                  showOnEvent: false,
                  canEdit: true,
                  isUnderboss: true,
                },
              ];
              await prisma.party.update({
                where: { id: event.id },
                data: { coHosts: updatedCoHosts },
              });
            }
          }

          // Update name/email on existing co-host entries in remaining regions
          const remainingRegions = newRegions.filter((r: string) => oldRegions.includes(r));
          if (remainingRegions.length > 0 && (name !== undefined || email !== undefined)) {
            const eventsToUpdate = await prisma.party.findMany({
              where: { eventType: 'gpp', region: { in: remainingRegions } },
              select: { id: true, coHosts: true },
            });
            for (const event of eventsToUpdate) {
              const coHosts = (event.coHosts as any[]) || [];
              let changed = false;
              const updatedCoHosts = coHosts.map((h: any) => {
                if (h.email?.toLowerCase() === oldEmail && h.isUnderboss === true) {
                  changed = true;
                  return { ...h, name: newName, email: newEmail };
                }
                return h;
              });
              if (changed) {
                await prisma.party.update({
                  where: { id: event.id },
                  data: { coHosts: updatedCoHosts },
                });
              }
            }
          }
        }
      } catch (syncError) {
        console.error('Failed to sync underboss co-hosts on update:', syncError);
      }
    }

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

    // Fetch underboss email before deactivating
    const underboss = await prisma.underboss.findUnique({
      where: { id },
      select: { email: true },
    });

    await prisma.underboss.update({
      where: { id },
      data: { isActive: false },
    });

    // Remove co-host entries from all GPP events
    if (underboss) {
      try {
        const ubEmail = underboss.email.toLowerCase();
        const eventsWithUb = await prisma.party.findMany({
          where: { eventType: 'gpp' },
          select: { id: true, coHosts: true },
        });
        for (const event of eventsWithUb) {
          const coHosts = (event.coHosts as any[]) || [];
          const filtered = coHosts.filter((h: any) =>
            !(h.email?.toLowerCase() === ubEmail && h.isUnderboss === true)
          );
          if (filtered.length !== coHosts.length) {
            await prisma.party.update({
              where: { id: event.id },
              data: { coHosts: filtered },
            });
          }
        }
      } catch (syncError) {
        console.error('Failed to remove underboss co-hosts on delete:', syncError);
      }
    }

    res.json({ success: true, message: 'Underboss deactivated' });
  } catch (error) {
    next(error);
  }
});

// POST /api/underboss/admin/backfill-cohosts - Idempotent backfill of underboss co-hosts
router.post('/admin/backfill-cohosts', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    // Get all active underbosses
    const activeUnderbosses = await prisma.underboss.findMany({
      where: { isActive: true },
      select: { name: true, email: true, region: true, regions: true },
    });

    // Get all GPP events with a region
    const gppEvents = await prisma.party.findMany({
      where: { eventType: 'gpp', region: { not: null } },
      select: { id: true, region: true, coHosts: true },
    });

    let eventsUpdated = 0;

    for (const event of gppEvents) {
      const eventRegion = event.region!;
      const existingCoHosts = (event.coHosts as any[]) || [];

      // Find underbosses for this event's region
      const regionUnderbosses = activeUnderbosses.filter(ub => {
        const ubRegions = ub.regions.length > 0 ? ub.regions : [ub.region];
        return ubRegions.includes(eventRegion);
      });

      let newCoHosts = [...existingCoHosts];
      let changed = false;

      for (const ub of regionUnderbosses) {
        const ubEmail = ub.email.toLowerCase();
        // Skip if already present
        if (newCoHosts.some((h: any) => h.email?.toLowerCase() === ubEmail)) continue;

        newCoHosts.push({
          id: crypto.randomUUID(),
          name: ub.name,
          email: ubEmail,
          showOnEvent: false,
          canEdit: true,
          isUnderboss: true,
        });
        changed = true;
      }

      if (changed) {
        await prisma.party.update({
          where: { id: event.id },
          data: { coHosts: newCoHosts },
        });
        eventsUpdated++;
      }
    }

    res.json({ eventsUpdated, totalEvents: gppEvents.length });
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

// GET /api/underboss/funnel-stats — RSVP funnel stats per event
router.get('/funnel-stats', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const underboss = req.underboss!;
    const regionsParam = req.query.regions as string | undefined;
    const regions = regionsParam ? regionsParam.split(',') : underboss.regions;

    // Build region filter
    const isAdminUser = underboss.regions.includes('__admin__');
    const regionFilter = isAdminUser && (!regionsParam || regions.includes('__admin__'))
      ? {}
      : { region: { in: regions } };

    // Get events with funnel data
    const events = await prisma.party.findMany({
      where: regionFilter,
      select: {
        id: true,
        name: true,
        city: true,
        _count: {
          select: {
            pageViews: true,
            guests: true,
          },
        },
        guests: {
          where: { status: { not: 'INVITED' } },
          select: { id: true },
        },
        rsvpFunnelEvents: {
          select: { step: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalViews = 0;
    let totalOpened = 0;
    let totalStep1 = 0;
    let totalSubmitted = 0;

    const eventStats = events.map((e) => {
      const views = e._count.pageViews;
      const opened = e.rsvpFunnelEvents.filter((f) => f.step === 'rsvp_opened').length;
      const step1Complete = e.rsvpFunnelEvents.filter((f) => f.step === 'rsvp_step1_complete').length;
      const submitted = e.guests.length;

      totalViews += views;
      totalOpened += opened;
      totalStep1 += step1Complete;
      totalSubmitted += submitted;

      return {
        eventId: e.id,
        eventName: e.name,
        city: e.city || '',
        views,
        opened,
        step1Complete,
        submitted,
      };
    });

    res.json({
      events: eventStats,
      totals: {
        views: totalViews,
        opened: totalOpened,
        step1Complete: totalStep1,
        submitted: totalSubmitted,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
