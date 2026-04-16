import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin } from '../middleware/auth.js';
import { requireSponsorAuth, SponsorRequest } from '../middleware/sponsorAuth.js';
import { AppError } from '../middleware/error.js';
import { syncPartnerToAllEvents, removePartnerFromAllEvents, removeAutoSponsorsFromAllEvents } from '../helpers/partnerSync.js';

// ============================================
// Admin management routes (mounted at /api/sponsor-users)
// ============================================

export const sponsorUserAdminRouter = Router();

// GET /api/sponsor-users/list - List all sponsor users (admin only)
sponsorUserAdminRouter.get('/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const sponsorUsers = await prisma.sponsorUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        coHostName: true,
        coHostWebsite: true,
        coHostTwitter: true,
        coHostInstagram: true,
        coHostAvatarUrl: true,
        coHostLogoUrl: true,
        autoCoHost: true,
        autoSponsor: true,
        coHostShowOnEvent: true,
        coHostCanEdit: true,
        coHostAllowedTabs: true,
      },
    });

    // Count events per tag for admin UI
    const tagCounts: Record<string, number> = {};
    const uniqueTags = [...new Set(sponsorUsers.map(su => su.tag))];
    if (uniqueTags.length > 0) {
      for (const tag of uniqueTags) {
        const count = await prisma.party.count({
          where: { eventTags: { has: tag } },
        });
        tagCounts[tag] = count;
      }
    }

    res.json({ sponsorUsers, tagCounts });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor-users - Create a sponsor user (super admin only)
sponsorUserAdminRouter.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const {
      email, tag, name, notes,
      coHostName, coHostWebsite, coHostTwitter, coHostInstagram,
      coHostAvatarUrl, coHostLogoUrl, autoCoHost, autoSponsor,
      coHostShowOnEvent, coHostCanEdit, coHostAllowedTabs,
    } = req.body;

    if (!email || !tag) {
      throw new AppError('Email and tag are required', 400, 'VALIDATION_ERROR');
    }

    // Check for existing sponsor with same email
    const existing = await prisma.sponsorUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      throw new AppError('A sponsor user with this email already exists', 409, 'CONFLICT');
    }

    const sponsorUser = await prisma.sponsorUser.create({
      data: {
        email: email.toLowerCase(),
        tag: tag.trim().toLowerCase(),
        name: name?.trim() || null,
        notes: notes?.trim() || null,
        createdBy: req.userEmail || null,
        coHostName: coHostName?.trim() || null,
        coHostWebsite: coHostWebsite?.trim() || null,
        coHostTwitter: coHostTwitter?.trim() || null,
        coHostInstagram: coHostInstagram?.trim() || null,
        coHostAvatarUrl: coHostAvatarUrl?.trim() || null,
        coHostLogoUrl: coHostLogoUrl?.trim() || null,
        autoCoHost: autoCoHost || false,
        autoSponsor: autoSponsor || false,
        coHostShowOnEvent: coHostShowOnEvent !== undefined ? !!coHostShowOnEvent : true,
        coHostCanEdit: !!coHostCanEdit,
        coHostAllowedTabs: Array.isArray(coHostAllowedTabs) ? coHostAllowedTabs : Prisma.JsonNull,
      },
    });

    // If autoCoHost is enabled, sync partner to all existing events with this tag
    let syncedCount = 0;
    if (sponsorUser.autoCoHost) {
      try {
        syncedCount = await syncPartnerToAllEvents(sponsorUser);
      } catch (syncError) {
        console.error('Failed to sync partner to events on create:', syncError);
      }
    }

    res.status(201).json({ sponsorUser, syncedCount });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/sponsor-users/:id - Update a sponsor user (super admin only)
sponsorUserAdminRouter.patch('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const {
      email, name, tag, notes, isActive,
      coHostName, coHostWebsite, coHostTwitter, coHostInstagram,
      coHostAvatarUrl, coHostLogoUrl, autoCoHost, autoSponsor,
      coHostShowOnEvent, coHostCanEdit, coHostAllowedTabs,
    } = req.body;

    // Fetch old state for sync reconciliation
    const oldSponsorUser = await prisma.sponsorUser.findUnique({
      where: { id },
    });
    if (!oldSponsorUser) {
      throw new AppError('Sponsor user not found', 404, 'NOT_FOUND');
    }

    const updateData: any = {};
    if (email !== undefined) updateData.email = email.toLowerCase();
    if (name !== undefined) updateData.name = name?.trim() || null;
    if (tag !== undefined) updateData.tag = tag.trim().toLowerCase();
    if (notes !== undefined) updateData.notes = notes?.trim() || null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (coHostName !== undefined) updateData.coHostName = coHostName?.trim() || null;
    if (coHostWebsite !== undefined) updateData.coHostWebsite = coHostWebsite?.trim() || null;
    if (coHostTwitter !== undefined) updateData.coHostTwitter = coHostTwitter?.trim() || null;
    if (coHostInstagram !== undefined) updateData.coHostInstagram = coHostInstagram?.trim() || null;
    if (coHostAvatarUrl !== undefined) updateData.coHostAvatarUrl = coHostAvatarUrl?.trim() || null;
    if (coHostLogoUrl !== undefined) updateData.coHostLogoUrl = coHostLogoUrl?.trim() || null;
    if (autoCoHost !== undefined) updateData.autoCoHost = autoCoHost;
    if (autoSponsor !== undefined) updateData.autoSponsor = autoSponsor;
    if (coHostShowOnEvent !== undefined) updateData.coHostShowOnEvent = !!coHostShowOnEvent;
    if (coHostCanEdit !== undefined) updateData.coHostCanEdit = !!coHostCanEdit;
    if (coHostAllowedTabs !== undefined) {
      updateData.coHostAllowedTabs = Array.isArray(coHostAllowedTabs) ? coHostAllowedTabs : Prisma.JsonNull;
    }

    const sponsorUser = await prisma.sponsorUser.update({
      where: { id },
      data: updateData,
    });

    // Sync partner co-hosts based on changes
    let syncedCount = 0;
    try {
      const oldTag = oldSponsorUser.tag;
      const newTag = sponsorUser.tag;
      const wasAutoCoHost = oldSponsorUser.autoCoHost;
      const isAutoCoHost = sponsorUser.autoCoHost;
      const wasActive = oldSponsorUser.isActive;
      const isActive_ = sponsorUser.isActive;

      // Case 1: Deactivated or autoCoHost turned off — remove from all events
      if ((!isActive_ && wasActive) || (!isAutoCoHost && wasAutoCoHost)) {
        await removePartnerFromAllEvents(oldTag);
        if (oldSponsorUser.autoSponsor) {
          await removeAutoSponsorsFromAllEvents(oldTag, oldSponsorUser.email);
        }
      }
      // Case 1b: autoSponsor turned off but partner still active — clean up auto sponsors
      else if (!sponsorUser.autoSponsor && oldSponsorUser.autoSponsor && isActive_) {
        await removeAutoSponsorsFromAllEvents(oldTag, oldSponsorUser.email);
        // Still sync co-host if autoCoHost remains on (profile might have changed)
        if (isAutoCoHost) {
          syncedCount = await syncPartnerToAllEvents(sponsorUser);
        }
      }
      // Case 2: Tag changed — remove from old, add to new
      else if (oldTag !== newTag && isAutoCoHost && isActive_) {
        await removePartnerFromAllEvents(oldTag);
        if (oldSponsorUser.autoSponsor) {
          await removeAutoSponsorsFromAllEvents(oldTag, oldSponsorUser.email);
        }
        syncedCount = await syncPartnerToAllEvents(sponsorUser);
      }
      // Case 3: autoCoHost just turned on — sync to all events
      else if (isAutoCoHost && !wasAutoCoHost && isActive_) {
        syncedCount = await syncPartnerToAllEvents(sponsorUser);
      }
      // Case 4: Profile fields updated but still autoCoHost — upsert co-host entries in place
      else if (isAutoCoHost && isActive_ && wasAutoCoHost) {
        syncedCount = await syncPartnerToAllEvents(sponsorUser);
      }
    } catch (syncError) {
      console.error('Failed to sync partner on update:', syncError);
    }

    res.json({ sponsorUser, syncedCount });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/sponsor-users/:id - Deactivate a sponsor user (super admin only)
sponsorUserAdminRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    // Fetch sponsor user to get tag before deactivating
    const sponsorUser = await prisma.sponsorUser.findUnique({
      where: { id },
    });

    await prisma.sponsorUser.update({
      where: { id },
      data: { isActive: false },
    });

    // Remove partner co-hosts from all events
    if (sponsorUser?.autoCoHost) {
      try {
        await removePartnerFromAllEvents(sponsorUser.tag);
      } catch (syncError) {
        console.error('Failed to remove partner co-hosts on deactivate:', syncError);
      }
    }
    // Remove auto-created sponsor rows from all events
    if (sponsorUser?.autoSponsor) {
      try {
        await removeAutoSponsorsFromAllEvents(sponsorUser.tag, sponsorUser.email);
      } catch (syncError) {
        console.error('Failed to remove auto sponsors on deactivate:', syncError);
      }
    }

    res.json({ success: true, message: 'Sponsor user deactivated' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Sponsor Dashboard routes (mounted at /api/sponsor)
// ============================================

export const sponsorDashboardRouter = Router();

// GET /api/sponsor/me - Check if logged-in user is a sponsor or admin
sponsorDashboardRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const adminUser = await isAdmin(email);

    const sponsorUser = await prisma.sponsorUser.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
      },
    });

    if (sponsorUser) {
      return res.json({
        isSponsor: true,
        isAdmin: adminUser,
        sponsor: {
          id: sponsorUser.id,
          email: sponsorUser.email,
          name: sponsorUser.name,
          tag: sponsorUser.tag,
        },
      });
    }

    // Admins can view all sponsor dashboards even without a sponsor_users entry
    if (adminUser) {
      return res.json({
        isSponsor: true,
        isAdmin: true,
        sponsor: null,
      });
    }

    return res.json({
      isSponsor: false,
      isAdmin: false,
      sponsor: null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/sponsor/events - Get all events matching sponsor's tag (or ?tag= for admins)
sponsorDashboardRouter.get('/events', requireAuth, requireSponsorAuth, async (req: SponsorRequest, res: Response, next: NextFunction) => {
  try {
    // Admins can pass ?tag= to filter, or see all tagged events
    const queryTag = req.query.tag as string | undefined;
    const tag = queryTag?.trim().toLowerCase() || req.sponsorUser?.tag;
    const sponsorUserId = req.sponsorUser?.id;
    const sponsorEmail = req.sponsorUser?.email?.toLowerCase() || null;

    // Build where clause — admins without a tag filter see all events that have any eventTags
    const where: any = {};
    if (tag) {
      where.eventTags = { has: tag };
    } else if (req.isAdminViewing) {
      // Admin with no tag filter — show events that have at least one eventTag
      where.NOT = { eventTags: { equals: [] } };
    }

    // Find events
    const events = await prisma.party.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, profilePictureUrl: true, website: true, twitter: true, instagram: true } },
        guests: {
          select: { id: true, approved: true, checkedInAt: true },
        },
        budgetItems: {
          select: { id: true, cost: true, status: true },
        },
        sponsors: {
          select: { id: true, status: true },
        },
        partyKit: { select: { id: true } },
        sponsorChecklistItems: {
          ...(sponsorUserId ? { where: { sponsorUserId } } : {}),
          select: {
            id: true,
            name: true,
            completed: true,
            completedAt: true,
            dueDate: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { guests: true } },
      },
      orderBy: { date: 'asc' },
    });

    // Batch-fetch this partner's expectedGuests per event (matched by contactEmail)
    let expectedGuestsByPartyId: Record<string, number | null> = {};
    if (sponsorEmail && events.length > 0) {
      const sponsorRows = await prisma.sponsor.findMany({
        where: {
          partyId: { in: events.map(e => e.id) },
          contactEmail: sponsorEmail,
        },
        select: { partyId: true, expectedGuests: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      // If multiple rows exist for the same party + email, the first (oldest) wins
      for (const row of sponsorRows) {
        if (!(row.partyId in expectedGuestsByPartyId)) {
          expectedGuestsByPartyId[row.partyId] = row.expectedGuests;
        }
      }
    }

    // Batch-fetch all co-host profile data upfront (avoid await inside .map)
    const allCoHostEmails = new Set<string>();
    for (const event of events) {
      const rawCoHosts = Array.isArray(event.coHosts) ? (event.coHosts as any[]) : [];
      for (const h of rawCoHosts) {
        if (h.email) allCoHostEmails.add(h.email);
      }
    }
    let allProfilesByEmail: Record<string, any> = {};
    if (allCoHostEmails.size > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: Array.from(allCoHostEmails) } },
        select: { email: true, profilePictureUrl: true, twitter: true, website: true, instagram: true },
      });
      allProfilesByEmail = Object.fromEntries(users.map(u => [u.email, u]));
    }

    const formattedEvents = events.map(event => {
      const guestCount = event._count.guests;
      const approvedCount = event.guests.filter(g => g.approved !== false).length;

      // Budget summary
      let budget = null;
      if (event.budgetEnabled && event.budgetItems.length > 0) {
        const totalBudget = event.budgetTotal ? Number(event.budgetTotal) : 0;
        const totalSpent = event.budgetItems.reduce((sum, item) => sum + Number(item.cost), 0);
        const totalPaid = event.budgetItems
          .filter(item => item.status === 'paid')
          .reduce((sum, item) => sum + Number(item.cost), 0);
        const totalPending = totalSpent - totalPaid;

        budget = {
          total: totalBudget,
          spent: totalSpent,
          paid: totalPaid,
          pending: totalPending,
          remaining: totalBudget > 0 ? totalBudget - totalSpent : null,
        };
      }

      // Co-hosts — enrich with user profile data (avatar, socials)
      const rawCoHosts = Array.isArray(event.coHosts) ? (event.coHosts as any[]) : [];
      const coHosts = rawCoHosts.map(({ email, ...rest }: any) => {
        const profile = email ? allProfilesByEmail[email] : null;
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

      // Sponsor statuses for this event
      const sponsorStatuses = event.sponsors.map(s => s.status);
      const sponsorCount = event.sponsors.length;

      // Compute progress (same logic as underboss)
      const hostEmail = (event.user?.email || '').toLowerCase();
      const hostName = (event.user?.name || '').toLowerCase();
      const realCoHosts = rawCoHosts.filter((h: any) => {
        const hEmail = (h.email || '').toLowerCase();
        const hName = (h.name || '').toLowerCase();
        if (hName === 'pizzadao' || hEmail === 'hello@rarepizzas.com') return false;
        if (hostEmail && hEmail === hostEmail) return false;
        if (hostName && hName === hostName && !hEmail) return false;
        return true;
      });
      const checkedInCount = event.guests?.filter((g: any) => g.checkedInAt).length || 0;
      const eventPassed = event.date ? new Date(event.date) < new Date() : false;

      const progress = {
        hasPartyKit: !!event.partyKit,
        hasCoHosts: realCoHosts.length > 0,
        hasVenue: !!(event.venueName || event.address),
        hasBudget: !!(event.budgetEnabled && event.budgetTotal),
        hasSponsors: event.sponsors.length > 0,
        hasSocialPosts: !!(event.xPostUrl || event.farcasterPostUrl),
        hasThrown: eventPassed && checkedInCount > 0,
      };

      return {
        id: event.id,
        name: event.name,
        slug: event.customUrl || event.inviteCode,
        reportPublicSlug: event.reportPublished ? (event.reportPublicSlug || null) : null,
        date: event.date,
        timezone: event.timezone,
        address: event.address,
        venueName: event.venueName,
        region: event.region || null,
        eventImageUrl: event.eventImageUrl,
        hostName: event.user?.name || null,
        hostProfile: event.user ? {
          name: event.user.name,
          avatar_url: event.user.profilePictureUrl,
          website: event.user.website,
          twitter: event.user.twitter,
          instagram: event.user.instagram,
        } : null,
        coHosts,
        rsvpCount: guestCount,
        approvedCount,
        maxGuests: event.maxGuests,
        expectedGuests: sponsorEmail ? (expectedGuestsByPartyId[event.id] ?? null) : null,
        budget,
        progress,
        sponsorStatuses,
        sponsorCount,
        checklist: event.sponsorChecklistItems.map(item => ({
          id: item.id,
          name: item.name,
          completed: item.completed,
          completedAt: item.completedAt,
          dueDate: item.dueDate,
          sortOrder: item.sortOrder,
        })),
      };
    });

    res.json({
      sponsor: req.sponsorUser ? {
        name: req.sponsorUser.name,
        email: req.sponsorUser.email,
        tag: req.sponsorUser.tag,
      } : null,
      isAdmin: req.isAdminViewing || false,
      tag: tag || null,
      events: formattedEvents,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor/checklist/:itemId/toggle - Toggle a checklist item
sponsorDashboardRouter.post('/checklist/:itemId/toggle', requireAuth, requireSponsorAuth, async (req: SponsorRequest, res: Response, next: NextFunction) => {
  try {
    const { itemId } = req.params;
    const sponsorUserId = req.sponsorUser?.id;

    // Verify the checklist item belongs to this sponsor (admins can toggle any)
    const whereClause: any = { id: itemId };
    if (!req.isAdminViewing && sponsorUserId) {
      whereClause.sponsorUserId = sponsorUserId;
    }
    const item = await prisma.sponsorChecklistItem.findFirst({
      where: whereClause,
    });

    if (!item) {
      throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
    }

    const updated = await prisma.sponsorChecklistItem.update({
      where: { id: itemId },
      data: {
        completed: !item.completed,
        completedAt: !item.completed ? new Date() : null,
      },
      select: {
        id: true,
        name: true,
        completed: true,
        completedAt: true,
        dueDate: true,
        sortOrder: true,
      },
    });

    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/sponsor/me/events/:partyId/expected-guests - Set this partner's expected guest count for an event
sponsorDashboardRouter.patch('/me/events/:partyId/expected-guests', requireAuth, requireSponsorAuth, async (req: SponsorRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const sponsorUser = req.sponsorUser;

    if (!sponsorUser) {
      throw new AppError('Sponsor account required', 403, 'FORBIDDEN');
    }

    const sponsorEmail = sponsorUser.email?.toLowerCase();
    if (!sponsorEmail) {
      throw new AppError('Sponsor account missing email', 400, 'VALIDATION_ERROR');
    }

    // Validate body
    const { expectedGuests } = req.body ?? {};
    let normalized: number | null;
    if (expectedGuests === null || expectedGuests === undefined || expectedGuests === '') {
      normalized = null;
    } else if (
      typeof expectedGuests !== 'number' ||
      !Number.isFinite(expectedGuests) ||
      !Number.isInteger(expectedGuests) ||
      expectedGuests < 0 ||
      expectedGuests > 10000
    ) {
      throw new AppError('expectedGuests must be null or a non-negative integer <= 10000', 400, 'VALIDATION_ERROR');
    } else {
      normalized = expectedGuests;
    }

    // Find party and verify partner has access via tag
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, eventTags: true },
    });
    if (!party) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }
    if (!party.eventTags?.includes(sponsorUser.tag)) {
      throw new AppError('You do not have access to this event', 403, 'FORBIDDEN');
    }

    // Find existing Sponsor row matching this partner (by contactEmail) for this event
    const existing = await prisma.sponsor.findFirst({
      where: { partyId, contactEmail: sponsorEmail },
      orderBy: { createdAt: 'asc' },
    });

    let updated;
    if (existing) {
      updated = await prisma.sponsor.update({
        where: { id: existing.id },
        data: { expectedGuests: normalized },
      });
    } else {
      // Look up the full SponsorUser record to get coHostName for the display name
      const fullSponsorUser = await prisma.sponsorUser.findUnique({
        where: { id: sponsorUser.id },
        select: { coHostName: true, name: true, email: true },
      });
      const displayName =
        fullSponsorUser?.coHostName?.trim() ||
        fullSponsorUser?.name?.trim() ||
        sponsorUser.name?.trim() ||
        sponsorEmail;
      updated = await prisma.sponsor.create({
        data: {
          partyId,
          name: displayName,
          contactEmail: sponsorEmail,
          status: 'yes',
          notes: 'Auto-created from partner dashboard expected guests entry',
          expectedGuests: normalized,
        },
      });
    }

    res.json({
      sponsor: {
        id: updated.id,
        partyId: updated.partyId,
        contactEmail: updated.contactEmail,
        expectedGuests: updated.expectedGuests,
      },
    });
  } catch (error) {
    next(error);
  }
});
