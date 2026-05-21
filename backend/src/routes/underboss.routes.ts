import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { requireUnderbossAuth, UnderbossAuthRequest } from '../middleware/underbossAuth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';
import { addPartnerToParty, removePartnerFromParty, getAutoCoHostPartners } from '../helpers/partnerSync.js';
import { setDeleteContext } from '../helpers/auditContext.js';
import { buildScopedWhereClause, partyMatchesScope, UnderbossScope } from '../helpers/underbossScope.js';
import { writeStatusAudit, ActorKind } from '../helpers/statusAudit.js';
import { scoreEvent, buildSybilWalletSet } from '../lib/fakeDetection.js';

// Re-export the request type under the local name used throughout this file
type UnderbossRequest = UnderbossAuthRequest;

/**
 * Build the UnderbossScope for the authenticated request.
 * Admins/graphics-admins (`regions: ['__admin__']`) get `isAdmin: true`.
 */
function scopeFromReq(req: UnderbossRequest): UnderbossScope {
  const ub = req.underboss!;
  if (ub.regions.includes('__admin__')) {
    return { isAdmin: true, regions: [], cities: [] };
  }
  return { isAdmin: false, regions: ub.regions, cities: ub.cities || [] };
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
    inviteCode: party.inviteCode,
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
    hostTelegram: party.user?.telegram || null,
    hostTelegramConnected: !!party.hostTelegramChatId,
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
    // Reimbursement cap (arugula-38633 v2) — exposed so the underboss
    // dashboard can render Validate/Override controls + appeal indicator.
    city: party.city || null,
    reimbursementCapUsd: party.reimbursementCapUsd != null ? Number(party.reimbursementCapUsd) : null,
    reimbursementCapAppealNote: party.reimbursementCapAppealNote || null,
    reimbursementCapAppealedAt: party.reimbursementCapAppealedAt
      ? new Date(party.reimbursementCapAppealedAt).toISOString()
      : null,
    // quattro-12847: derived from `_count.reimbursementCapAppeals` (where
    // reviewedAt IS NULL). The denormalized `reimbursementCapAppealedAt`
    // column is kept above for backwards compat, but new client code (badge,
    // filter, Mark-reviewed button) keys off this field.
    hasOpenAppeal:
      typeof party._count?.reimbursementCapAppeals === 'number'
        ? party._count.reimbursementCapAppeals > 0
        : false,
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
        cities: [],
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
        cities: underboss.cities || [],
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
      cities: [],
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
    const map: Record<string, { status: string; priority: boolean; updatedBy: string | null; updatedAt: string }> = {};
    for (const row of rows) {
      map[row.cityKey] = {
        status: row.status,
        priority: row.priority,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    res.json(map);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/city-statuses - Upsert a city status / priority
// Accepts optional `status` and/or `priority`. Row is only deleted when the
// effective state is { status: 'todo', priority: false } (the default).
router.patch('/city-statuses', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { cityKey, status, priority } = req.body;

    if (!cityKey || typeof cityKey !== 'string') {
      throw new AppError('cityKey is required', 400, 'VALIDATION_ERROR');
    }

    if (status !== undefined && !['created', 'skip', 'todo'].includes(status)) {
      throw new AppError('status must be "created", "skip", or "todo"', 400, 'VALIDATION_ERROR');
    }

    if (priority !== undefined && typeof priority !== 'boolean') {
      throw new AppError('priority must be a boolean', 400, 'VALIDATION_ERROR');
    }

    if (status === undefined && priority === undefined) {
      throw new AppError('nothing to update — provide status and/or priority', 400, 'VALIDATION_ERROR');
    }

    // Scope check: city-scoped UBs can update only their cities (mozzarella-25815).
    // Region-only UBs would need a city→region map (lives in the GPP cities sheet,
    // not in the backend today) — for v1 we let region-only UBs proceed without the
    // city check, matching pre-existing behavior. City-scoped UBs are restricted.
    const scope = scopeFromReq(req);
    if (!scope.isAdmin && scope.cities.length > 0 && scope.regions.length === 0) {
      const normalized = cityKey.toLowerCase().trim();
      const allowed = scope.cities.map((c) => c.toLowerCase().trim());
      if (!allowed.includes(normalized)) {
        throw new AppError('Not authorized for this city', 403, 'FORBIDDEN');
      }
    }

    const updatedBy = req.underboss?.email || null;

    const existing = await prisma.cityStatus.findUnique({ where: { cityKey } });
    const nextStatus = status ?? existing?.status ?? 'todo';
    const nextPriority = priority ?? existing?.priority ?? false;

    if (nextStatus === 'todo' && nextPriority === false) {
      // Default state — no need to store
      await prisma.cityStatus.deleteMany({ where: { cityKey } });
      return res.json({ success: true, deleted: true });
    }

    const result = await prisma.cityStatus.upsert({
      where: { cityKey },
      update: { status: nextStatus, priority: nextPriority, updatedBy },
      create: { cityKey, status: nextStatus, priority: nextPriority, updatedBy },
    });

    res.json({ success: true, cityStatus: result });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Fake-event detection review queue (blackolive-74932)
// NOTE: Must be registered BEFORE /:region catch-all
// ============================================

// GET /api/underboss/fake-detection - Composite risk score queue for GPP events
router.get('/fake-detection', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const isAdminUser = req.underboss!.regions.includes('__admin__');
    if (!isAdminUser) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    // Admin-only: see all GPP events.
    const whereClause: { eventType: 'gpp' } = { eventType: 'gpp' };

    // Cross-event wallet pre-pass — one raw query, then Set lookup per event.
    // A wallet is "sybil" when it appears on ≥4 distinct events under ≥2 distinct trimmed-lower names.
    const sybilRows = await prisma.$queryRaw<
      Array<{ ethereum_address: string; party_ids: string[]; names: string[] }>
    >`
      SELECT
        lower(ethereum_address) AS ethereum_address,
        array_agg(DISTINCT party_id::text) AS party_ids,
        array_agg(DISTINCT lower(trim(name))) AS names
      FROM guests
      WHERE ethereum_address IS NOT NULL
        AND submitted_via IN ('link','rsvp','api')
      GROUP BY lower(ethereum_address)
      HAVING COUNT(DISTINCT party_id) >= 4
    `;
    const sybilWallets = buildSybilWalletSet(
      sybilRows.map(r => ({
        ethereumAddress: r.ethereum_address,
        partyIds: r.party_ids,
        names: r.names,
      })),
    );

    const parties = await prisma.party.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        customUrl: true,
        country: true,
        region: true,
        timezone: true,
        maxGuests: true,
        createdAt: true,
        underbossStatus: true,
        coHosts: true,
        user: { select: { id: true, name: true, email: true } },
        guests: {
          select: {
            id: true,
            name: true,
            email: true,
            ethereumAddress: true,
            submittedAt: true,
            submittedVia: true,
            waitlistPosition: true,
            walletSource: true,
            likedToppings: true,
            dislikedToppings: true,
            likedBeverages: true,
            dislikedBeverages: true,
            dietaryRestrictions: true,
            roles: true,
            pizzeriaRankings: true,
            suggestedPizzerias: true,
            mailingListOptIn: true,
            visitorSessionId: true,
            emailStatus: true,
          },
        },
        linkClicks: {
          select: { clickedAt: true },
        },
        rsvpFunnelEvents: {
          select: { visitorHash: true, step: true, createdAt: true },
        },
      },
    });

    const rows: ReturnType<typeof scoreEvent>[] = parties.map(p =>
      scoreEvent(
        {
          id: p.id,
          name: p.name,
          customUrl: p.customUrl,
          country: p.country,
          region: p.region,
          timezone: p.timezone,
          maxGuests: p.maxGuests,
          createdAt: p.createdAt ?? new Date(0),
          underbossStatus: p.underbossStatus ?? null,
          user: p.user
            ? { id: p.user.id, name: p.user.name, email: p.user.email }
            : null,
          coHosts: p.coHosts,
        },
        p.guests.map(g => ({
          id: g.id,
          name: g.name,
          email: g.email,
          ethereumAddress: g.ethereumAddress,
          submittedAt: g.submittedAt,
          submittedVia: g.submittedVia,
          waitlistPosition: g.waitlistPosition,
          walletSource: g.walletSource,
          likedToppings: g.likedToppings,
          dislikedToppings: g.dislikedToppings,
          likedBeverages: g.likedBeverages,
          dislikedBeverages: g.dislikedBeverages,
          dietaryRestrictions: g.dietaryRestrictions,
          roles: g.roles,
          pizzeriaRankings: g.pizzeriaRankings,
          suggestedPizzerias: g.suggestedPizzerias,
          mailingListOptIn: g.mailingListOptIn,
          visitorSessionId: g.visitorSessionId,
          emailStatus: g.emailStatus,
        })),
        p.linkClicks.map(c => ({ clickedAt: c.clickedAt })),
        sybilWallets,
        p.maxGuests,
        p.rsvpFunnelEvents.map(e => ({
          visitorHash: e.visitorHash,
          step: e.step,
          createdAt: e.createdAt,
        })),
      ),
    );

    rows.sort((a, b) => b.score - a.score);

    res.json({
      rows,
      meta: {
        totalEvents: rows.length,
        sybilWalletCount: sybilWallets.size,
        scope: isAdminUser ? 'admin' : 'regions',
        regions: isAdminUser ? null : req.underboss!.regions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Outreach (marinara-67583)
// Admin/underboss tool for tracking outreach to candidate blockchain
// communities in uncovered cities. Per-route middleware ONLY — no
// `router.use('/outreach', ...)` (see memory: arugula-38633).
// NOTE: Must be registered BEFORE /:region catch-all.
// ============================================

const OUTREACH_CHANNELS = ['twitter_dm', 'email', 'telegram'] as const;
const OUTREACH_TEMPLATE_IDS = ['v1_twitter', 'v1_email', 'v1_telegram'] as const;
const OUTREACH_STATUSES = ['sent', 'replied', 'declined', 'converted', 'bounced'] as const;

function formatOutreachCommunity(community: any) {
  const attempts: any[] = Array.isArray(community.attempts) ? community.attempts : [];
  const last = attempts.length > 0 ? attempts[0] : null;
  return {
    id: community.id,
    city: community.city,
    country: community.country ?? null,
    name: community.communityName,
    source: community.source,
    contactHandle: community.contactHandle ?? null,
    contactUrl: community.contactUrl,
    contactEmail: community.contactEmail ?? null,
    twitterHandle:
      community.source && community.source.toLowerCase().includes('twitter')
        ? community.contactHandle ?? null
        : null,
    telegramHandle:
      community.source && community.source.toLowerCase().includes('telegram')
        ? community.contactHandle ?? null
        : null,
    email: community.contactEmail ?? null,
    followerCount: community.followerCount ?? null,
    priority: community.priority ?? null,
    notes: community.notes ?? null,
    lastAttempt: last
      ? {
          id: last.id,
          channel: last.channel,
          templateId: last.templateId,
          sentAt: last.sentAt instanceof Date ? last.sentAt.toISOString() : last.sentAt,
          sentBy: last.sentBy,
          status: last.status,
          convertedPartyId: last.convertedPartyId ?? null,
          notes: last.notes ?? null,
        }
      : null,
    attemptCount: community._count?.attempts ?? attempts.length,
    createdAt: community.createdAt instanceof Date ? community.createdAt.toISOString() : community.createdAt,
    updatedAt: community.updatedAt instanceof Date ? community.updatedAt.toISOString() : community.updatedAt,
  };
}

// GET /api/underboss/outreach/communities - List outreach candidates with latest attempt
router.get('/outreach/communities', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const cityFilter = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const priorityFilter = typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
    const sourceFilter = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const where: any = {};
    if (cityFilter) where.city = { contains: cityFilter, mode: 'insensitive' };
    if (priorityFilter) where.priority = priorityFilter;
    if (sourceFilter) where.source = sourceFilter;
    if (statusFilter === 'none') where.attempts = { none: {} };

    const rows = await prisma.outreachCommunity.findMany({
      where,
      include: {
        attempts: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
        _count: { select: { attempts: true } },
      },
      orderBy: [
        { priority: 'asc' },
        { followerCount: 'desc' },
        { city: 'asc' },
      ],
    });

    let formatted = rows.map(formatOutreachCommunity);

    // For status filters other than 'none' / '', post-filter on latest attempt status.
    if (statusFilter && statusFilter !== 'none') {
      if (!(OUTREACH_STATUSES as readonly string[]).includes(statusFilter)) {
        throw new AppError(
          `status must be one of: ${OUTREACH_STATUSES.join(', ')}, none`,
          400,
          'VALIDATION_ERROR'
        );
      }
      formatted = formatted.filter((c) => c.lastAttempt?.status === statusFilter);
    }

    res.json({ communities: formatted });
  } catch (error) {
    next(error);
  }
});

// POST /api/underboss/outreach/attempts - Log a new outreach attempt
router.post('/outreach/attempts', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { communityId, channel, templateId, notes } = req.body ?? {};

    if (!communityId || typeof communityId !== 'string') {
      throw new AppError('communityId is required', 400, 'VALIDATION_ERROR');
    }
    if (!channel || !(OUTREACH_CHANNELS as readonly string[]).includes(channel)) {
      throw new AppError(`channel must be one of: ${OUTREACH_CHANNELS.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    if (!templateId || !(OUTREACH_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
      throw new AppError(`templateId must be one of: ${OUTREACH_TEMPLATE_IDS.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      throw new AppError('notes must be a string', 400, 'VALIDATION_ERROR');
    }

    const community = await prisma.outreachCommunity.findUnique({
      where: { id: communityId },
      select: { id: true },
    });
    if (!community) {
      throw new AppError('community not found', 404, 'NOT_FOUND');
    }

    const sentBy = req.underboss?.email || req.userEmail || '';
    if (!sentBy) {
      throw new AppError('authenticated email missing', 401, 'UNAUTHORIZED');
    }

    const attempt = await prisma.outreachAttempt.create({
      data: {
        communityId,
        channel,
        templateId,
        sentBy,
        notes: notes ?? null,
        // status defaults to 'sent' per schema
      },
    });

    res.status(201).json({ attempt });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/underboss/outreach/attempts/:id - Update status / link converted party / notes
router.patch('/outreach/attempts/:id', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, convertedPartyId, notes } = req.body ?? {};

    if (status === undefined && convertedPartyId === undefined && notes === undefined) {
      throw new AppError('nothing to update', 400, 'VALIDATION_ERROR');
    }

    const updateData: any = {};

    if (status !== undefined) {
      if (!(OUTREACH_STATUSES as readonly string[]).includes(status)) {
        throw new AppError(
          `status must be one of: ${OUTREACH_STATUSES.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      updateData.status = status;
    }

    if (convertedPartyId !== undefined) {
      if (convertedPartyId === null) {
        updateData.convertedPartyId = null;
      } else if (typeof convertedPartyId === 'string') {
        const party = await prisma.party.findUnique({
          where: { id: convertedPartyId },
          select: { id: true },
        });
        if (!party) {
          throw new AppError('party not found', 404, 'NOT_FOUND');
        }
        updateData.convertedPartyId = convertedPartyId;
      } else {
        throw new AppError('convertedPartyId must be a string or null', 400, 'VALIDATION_ERROR');
      }
    }

    if (notes !== undefined) {
      if (notes !== null && typeof notes !== 'string') {
        throw new AppError('notes must be a string or null', 400, 'VALIDATION_ERROR');
      }
      updateData.notes = notes;
    }

    const existing = await prisma.outreachAttempt.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      throw new AppError('attempt not found', 404, 'NOT_FOUND');
    }

    const attempt = await prisma.outreachAttempt.update({
      where: { id },
      data: updateData,
    });

    res.json({ attempt });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/outreach/parties-search?q=<query> - Search parties for "Link to converted party"
router.get('/outreach/parties-search', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length < 2) {
      return res.json({ parties: [] });
    }

    const parties = await prisma.party.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { customUrl: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        customUrl: true,
        city: true,
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ parties });
  } catch (error) {
    next(error);
  }
});

// GET /api/underboss/:region - Main dashboard data
router.get('/:region', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { region } = req.params;
    const scope = scopeFromReq(req);
    // quattro-12847: optional filter / sort over the open cap-appeal queue.
    const appealsOnly = req.query.appealsOnly === 'true' || req.query.appealsOnly === '1';
    const sortMode = typeof req.query.sort === 'string' ? req.query.sort : null;

    // Handle "all" region — admins see everything, underbosses see scoped events
    if (region === 'all') {
      if (!scope.isAdmin && scope.regions.length === 0 && scope.cities.length === 0) {
        throw new AppError('Not authorized for any region', 403, 'FORBIDDEN');
      }
    } else {
      // For a specific region: must have region OR a city that's a GPP event in that region.
      // Cheap pre-check: region in scope (admin or region-scoped). City scope is
      // intersected by the whereClause below, so explicit "not in scope" only fires
      // when neither region nor any cities match.
      if (!scope.isAdmin && !scope.regions.includes(region) && scope.cities.length === 0) {
        throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
      }
    }

    let whereClause: any;
    if (region === 'all') {
      const scopedWhere = buildScopedWhereClause(scope);
      whereClause = scopedWhere
        ? { AND: [{ eventType: 'gpp' as const }, scopedWhere] }
        : { eventType: 'gpp' as const };
    } else {
      // Restrict to events whose region matches :region AND that match the UB's scope
      // (so a city-only UB sees only their cities even when browsing a specific region).
      const scopedWhere = buildScopedWhereClause(scope);
      const base = { region, eventType: 'gpp' as const };
      whereClause = scopedWhere ? { AND: [base, scopedWhere] } : base;
    }

    // quattro-12847: appeals-only narrows further to events with at least one
    // unreviewed appeal in history.
    if (appealsOnly) {
      whereClause = {
        AND: [whereClause, { reimbursementCapAppeals: { some: { reviewedAt: null } } }],
      };
    }

    const events = await prisma.party.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, email: true, telegram: true } },
        guests: {
          select: { id: true, approved: true, checkedInAt: true, status: true },
        },
        partyKit: { select: { status: true } },
        sponsors: { select: { status: true, amount: true } },
        _count: {
          select: {
            guests: true,
            photos: true,
            // quattro-12847: count of unreviewed appeals → `hasOpenAppeal`.
            reimbursementCapAppeals: { where: { reviewedAt: null } },
          },
        },
      },
      orderBy: sortMode === 'appealsFirst' ? undefined : { date: 'asc' },
    });

    if (sortMode === 'appealsFirst') {
      events.sort((a: any, b: any) => {
        const aOpen = (a._count?.reimbursementCapAppeals || 0) > 0 ? 1 : 0;
        const bOpen = (b._count?.reimbursementCapAppeals || 0) > 0 ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;
        const aDate = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
    }

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
    // quattro-12847: optional filter / sort over the open cap-appeal queue.
    const appealsOnly = req.query.appealsOnly === 'true' || req.query.appealsOnly === '1';
    const sortMode = typeof req.query.sort === 'string' ? req.query.sort : null;

    const scope = scopeFromReq(req);
    if (!scope.isAdmin && !scope.regions.includes(region) && scope.cities.length === 0) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const scopedWhere = buildScopedWhereClause(scope);
    const base: any = { region, eventType: 'gpp' as const };
    if (appealsOnly) {
      base.reimbursementCapAppeals = { some: { reviewedAt: null } };
    }
    const where: any = scopedWhere ? { AND: [base, scopedWhere] } : base;

    // Note: Prisma cannot order directly by a filtered `_count` of a relation,
    // so for `sort=appealsFirst` we fetch unsorted, then re-sort in JS below.
    const orderBy: any = sortMode === 'appealsFirst' ? undefined : { date: 'asc' };

    const [events, total, allUnderbosses] = await Promise.all([
      prisma.party.findMany({
        where,
        include: {
          user: { select: { name: true, email: true, telegram: true } },
          guests: {
            select: { id: true, approved: true, checkedInAt: true, status: true },
          },
          partyKit: { select: { status: true } },
          sponsors: { select: { status: true, amount: true } },
          _count: {
            select: {
              guests: true,
              photos: true,
              // quattro-12847: count of unreviewed appeals → `hasOpenAppeal`.
              reimbursementCapAppeals: { where: { reviewedAt: null } },
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.party.count({ where }),
      prisma.underboss.findMany({
        where: { isActive: true },
        select: { email: true },
      }),
    ]);

    if (sortMode === 'appealsFirst') {
      events.sort((a: any, b: any) => {
        const aOpen = (a._count?.reimbursementCapAppeals || 0) > 0 ? 1 : 0;
        const bOpen = (b._count?.reimbursementCapAppeals || 0) > 0 ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen; // open appeals first
        const aDate = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
    }
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
    const scope = scopeFromReq(req);

    if (!scope.isAdmin && !scope.regions.includes(region) && scope.cities.length === 0) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const party = await prisma.party.findFirst({
      where: { id: partyId, region, eventType: 'gpp' },
      include: {
        user: { select: { name: true, email: true, telegram: true } },
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
        _count: {
          select: {
            guests: true,
            photos: true,
            // quattro-12847: feed `hasOpenAppeal` on the detail view too.
            reimbursementCapAppeals: { where: { reviewedAt: null } },
          },
        },
      },
    });

    if (!party) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    // Scope enforcement: return 404 (not 403) when the party exists but is out of
    // scope, to avoid leaking the event's existence.
    if (!partyMatchesScope(party, scope)) {
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
    const scope = scopeFromReq(req);

    if (!scope.isAdmin && !scope.regions.includes(region) && scope.cities.length === 0) {
      throw new AppError('Not authorized for this region', 403, 'FORBIDDEN');
    }

    const scopedWhere = buildScopedWhereClause(scope);
    const base = { region, eventType: 'gpp' as const };
    const where: any = scopedWhere ? { AND: [base, scopedWhere] } : base;

    const [events, allUnderbosses] = await Promise.all([
      prisma.party.findMany({
        where,
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

    // Scope check (mozzarella-25815): reject if any partyId is outside the UB's region/city scope.
    const scope = scopeFromReq(req);
    if (!scope.isAdmin) {
      const affected = await prisma.party.findMany({
        where: { id: { in: partyIds } },
        select: { id: true, region: true, city: true, name: true, eventType: true },
      });
      const outOfScopeIds = affected.filter((p) => !partyMatchesScope(p, scope)).map((p) => p.id);
      if (outOfScopeIds.length > 0) {
        return res.status(403).json({ error: 'OUT_OF_SCOPE', outOfScopeIds });
      }
    }

    const email = req.userEmail!;
    const isAdminUser = await isAdmin(email);
    const actorKind: ActorKind = isAdminUser ? 'admin' : 'underboss';

    const updatedCount = await prisma.$transaction(async (tx) => {
      const before = await tx.party.findMany({
        where: { id: { in: partyIds } },
        select: { id: true, underbossStatus: true },
      });

      // Skip no-ops to avoid noisy audit rows.
      const changing = before.filter(p => p.underbossStatus !== status);

      await tx.party.updateMany({
        where: { id: { in: changing.map(p => p.id) } },
        data: { underbossStatus: status },
      });

      for (const p of changing) {
        await writeStatusAudit(tx, p.id, p.underbossStatus, status, email, actorKind);
      }
      return changing.length;
    });

    res.json({ updated: updatedCount });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/underboss/events/bulk-delete - Bulk delete events (admin-only, pineapple-26037)
router.delete('/events/bulk-delete', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { partyIds } = req.body;

    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      throw new AppError('partyIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    // Scope check (mozzarella-25815)
    const scope = scopeFromReq(req);
    if (!scope.isAdmin) {
      const affected = await prisma.party.findMany({
        where: { id: { in: partyIds } },
        select: { id: true, region: true, city: true, name: true, eventType: true },
      });
      const outOfScopeIds = affected.filter((p) => !partyMatchesScope(p, scope)).map((p) => p.id);
      if (outOfScopeIds.length > 0) {
        return res.status(403).json({ error: 'OUT_OF_SCOPE', outOfScopeIds });
      }
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

    // Scope check (mozzarella-25815)
    const scope = scopeFromReq(req);
    if (!scope.isAdmin) {
      const affected = await prisma.party.findMany({
        where: { id: { in: partyIds } },
        select: { id: true, region: true, city: true, name: true, eventType: true },
      });
      const outOfScopeIds = affected.filter((p) => !partyMatchesScope(p, scope)).map((p) => p.id);
      if (outOfScopeIds.length > 0) {
        return res.status(403).json({ error: 'OUT_OF_SCOPE', outOfScopeIds });
      }
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

/**
 * Helper: load a party and assert it's within the UB's scope. Returns 404
 * (not 403) on out-of-scope to avoid leaking existence (mozzarella-25815).
 */
async function assertPartyInScope(partyId: string, scope: UnderbossScope): Promise<void> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { id: true, region: true, city: true, name: true, eventType: true },
  });
  if (!party) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }
  if (!partyMatchesScope(party, scope)) {
    throw new AppError('Event not found', 404, 'NOT_FOUND');
  }
}

// PATCH /api/underboss/event/:partyId/host-status - Set host status (new/alum/pro)
router.patch('/event/:partyId/host-status', requireAuth, requireUnderbossAuth, async (req: UnderbossRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { hostStatus } = req.body;

    const validStatuses = ['new', 'alum', 'pro', null];
    if (!validStatuses.includes(hostStatus)) {
      throw new AppError('Invalid host status. Must be "new", "alum", "pro", or null', 400, 'VALIDATION_ERROR');
    }

    await assertPartyInScope(partyId, scopeFromReq(req));

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
      select: { id: true, region: true, regions: true, cities: true },
    });

    if (underboss) {
      // Scope check (mozzarella-25815): non-admin UBs may only mutate events in their scope.
      if (!isAdminUser) {
        const ubAny = underboss as any;
        const regions = ubAny.regions && ubAny.regions.length > 0 ? ubAny.regions : [ubAny.region];
        const scope: UnderbossScope = regions.includes('__admin__')
          ? { isAdmin: true, regions: [], cities: [] }
          : { isAdmin: false, regions, cities: ubAny.cities || [] };
        await assertPartyInScope(partyId, scope);
      }
      // Underboss/admin: allow all statuses
      const actorKind: ActorKind = isAdminUser ? 'admin' : 'underboss';
      const party = await prisma.$transaction(async (tx) => {
        const before = await tx.party.findUnique({
          where: { id: partyId },
          select: { underbossStatus: true },
        });
        if (!before) throw new AppError('Party not found', 404, 'NOT_FOUND');

        const updated = await tx.party.update({
          where: { id: partyId },
          data: { underbossStatus: status },
          select: { id: true, underbossStatus: true },
        });

        await writeStatusAudit(tx, partyId, before.underbossStatus, status, email, actorKind);
        return updated;
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

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.party.update({
        where: { id: partyId },
        data: { underbossStatus: status },
        select: { id: true, underbossStatus: true },
      });

      await writeStatusAudit(tx, partyId, party.underbossStatus, status, email, 'owner');
      return result;
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

    await assertPartyInScope(partyId, scopeFromReq(req));

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

    await assertPartyInScope(partyId, scopeFromReq(req));

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

    await assertPartyInScope(partyId, scopeFromReq(req));

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

    const { name, email, region, regions: regionsInput, cities: citiesInput, notes } = req.body;

    // Accept regions array or legacy single region
    let regions: string[] = [];
    if (Array.isArray(regionsInput) && regionsInput.length > 0) {
      regions = regionsInput;
    } else if (region) {
      regions = [region];
    }

    const cities: string[] = Array.isArray(citiesInput)
      ? citiesInput.filter((c: any) => typeof c === 'string' && c.trim().length > 0).map((c: string) => c.trim())
      : [];

    // mozzarella-25815: at least ONE of regions or cities required.
    if (!name || !email || (regions.length === 0 && cities.length === 0)) {
      throw new AppError('Name, email, and at least one region or city are required', 400, 'VALIDATION_ERROR');
    }

    // Generate a placeholder token for the DB column (required by schema) but it's no longer used for auth
    const placeholderToken = `unused_${crypto.randomBytes(32).toString('hex')}`;

    const underboss = await prisma.underboss.create({
      data: {
        name,
        email: email.toLowerCase(),
        region: regions[0] || '', // Deprecated field — set to first region or empty
        regions,
        cities,
        accessToken: placeholderToken,
        notes: notes || null,
      },
    });

    // Add new underboss as co-host to all GPP events matching their region(s) or city(ies)
    try {
      const scope: UnderbossScope = { isAdmin: false, regions, cities };
      const scopedWhere = buildScopedWhereClause(scope);
      const gppEvents = scopedWhere
        ? await prisma.party.findMany({
            where: { AND: [{ eventType: 'gpp' }, scopedWhere] },
            select: { id: true, coHosts: true, region: true, city: true, name: true, eventType: true },
          })
        : [];

      const ubEmail = email.toLowerCase();
      for (const event of gppEvents) {
        // Defensive: re-check scope (buildScopedWhereClause already filtered, but
        // double-check city extraction handles edge cases).
        if (!partyMatchesScope(event, scope)) continue;
        const existingCoHosts = (event.coHosts as any[]) || [];
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
        cities: underboss.cities,
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
        cities: true,
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
    const { name, email, region, regions, cities, notes, isActive } = req.body;

    // Fetch old state before update for co-host sync
    const oldUnderboss = await prisma.underboss.findUnique({
      where: { id },
      select: { name: true, email: true, regions: true, region: true, cities: true, isActive: true },
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

    // mozzarella-25815: handle cities array update
    if (Array.isArray(cities)) {
      updateData.cities = cities
        .filter((c: any) => typeof c === 'string' && c.trim().length > 0)
        .map((c: string) => c.trim());
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
        cities: true,
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

          // mozzarella-25815: mirror the region diff for cities.
          // Cities are additive to regions, so events that match an existing
          // region don't lose the co-host when a city is removed.
          const oldCities = oldUnderboss.cities || [];
          const newCities = Array.isArray(cities)
            ? cities.filter((c: any) => typeof c === 'string' && c.trim().length > 0).map((c: string) => c.trim())
            : oldCities;

          const addedCities = newCities.filter((c: string) => !oldCities.includes(c));
          const removedCities = oldCities.filter((c: string) => !newCities.includes(c));

          // Remove co-host from events in dropped cities — but ONLY if the event
          // doesn't also match a still-current region (additive scope).
          if (removedCities.length > 0) {
            const removeScope: UnderbossScope = { isAdmin: false, regions: [], cities: removedCities };
            const removeWhere = buildScopedWhereClause(removeScope);
            const stillScope: UnderbossScope = { isAdmin: false, regions: newRegions, cities: newCities };
            if (removeWhere) {
              const eventsToRemoveFrom = await prisma.party.findMany({
                where: { AND: [{ eventType: 'gpp' }, removeWhere] },
                select: { id: true, coHosts: true, region: true, city: true, name: true, eventType: true },
              });
              for (const event of eventsToRemoveFrom) {
                if (partyMatchesScope(event, stillScope)) continue; // still in scope via region or remaining city
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
          }

          // Add co-host to events matching newly-added cities
          if (addedCities.length > 0) {
            const addScope: UnderbossScope = { isAdmin: false, regions: [], cities: addedCities };
            const addWhere = buildScopedWhereClause(addScope);
            if (addWhere) {
              const eventsToAddTo = await prisma.party.findMany({
                where: { AND: [{ eventType: 'gpp' }, addWhere] },
                select: { id: true, coHosts: true, region: true, city: true, name: true, eventType: true },
              });
              for (const event of eventsToAddTo) {
                if (!partyMatchesScope(event, addScope)) continue;
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

    // Get all active underbosses (incl. cities for mozzarella-25815 city-scoped matches)
    const activeUnderbosses = await prisma.underboss.findMany({
      where: { isActive: true },
      select: { name: true, email: true, region: true, regions: true, cities: true },
    });

    // Get all GPP events (region may be null for city-only matches)
    const gppEvents = await prisma.party.findMany({
      where: { eventType: 'gpp' },
      select: { id: true, region: true, city: true, name: true, eventType: true, coHosts: true },
    });

    let eventsUpdated = 0;

    for (const event of gppEvents) {
      const existingCoHosts = (event.coHosts as any[]) || [];

      // Find underbosses whose scope matches this event (region OR city)
      const matchingUnderbosses = activeUnderbosses.filter((ub) => {
        const regions = ub.regions.length > 0 ? ub.regions : (ub.region ? [ub.region] : []);
        const scope: UnderbossScope = regions.includes('__admin__')
          ? { isAdmin: true, regions: [], cities: [] }
          : { isAdmin: false, regions, cities: ub.cities || [] };
        // Skip admin-scope UBs for backfill — they don't actually need a co-host entry
        if (scope.isAdmin) return false;
        return partyMatchesScope(event, scope);
      });

      let newCoHosts = [...existingCoHosts];
      let changed = false;

      for (const ub of matchingUnderbosses) {
        const ubEmail = ub.email.toLowerCase();
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

    // Build region+city scope filter (mozzarella-25815). Region filter from
    // query overrides the UB's regions for the region-branch but city scope
    // always comes from the UB's record.
    const isAdminUser = underboss.regions.includes('__admin__');
    let where: any;
    if (isAdminUser && (!regionsParam || regions.includes('__admin__'))) {
      where = {};
    } else {
      const scope: UnderbossScope = isAdminUser
        ? { isAdmin: true, regions: [], cities: [] }
        : { isAdmin: false, regions, cities: underboss.cities || [] };
      const scopedWhere = buildScopedWhereClause(scope);
      where = scopedWhere ?? {};
    }

    // Get events with funnel data — use separate count queries to avoid Prisma issues
    const events = await prisma.party.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalViews = 0;
    let totalOpened = 0;
    let totalStep1 = 0;
    let totalSubmitted = 0;

    const eventStats = await Promise.all(events.map(async (e) => {
      const [viewCount, guestCount, funnelEvents] = await Promise.all([
        prisma.pageView.count({ where: { partyId: e.id } }),
        prisma.guest.count({ where: { partyId: e.id, status: { not: 'INVITED' } } }),
        prisma.rsvpFunnelEvent.findMany({ where: { partyId: e.id }, select: { step: true } }),
      ]);

      const views = viewCount;
      const opened = funnelEvents.filter((f) => f.step === 'rsvp_opened').length;
      const step1Complete = funnelEvents.filter((f) => f.step === 'rsvp_step1_complete').length;
      const submitted = guestCount;

      totalViews += views;
      totalOpened += opened;
      totalStep1 += step1Complete;
      totalSubmitted += submitted;

      return {
        eventId: e.id,
        eventName: e.name,
        city: e.address || '',
        views,
        opened,
        step1Complete,
        submitted,
      };
    }));

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
