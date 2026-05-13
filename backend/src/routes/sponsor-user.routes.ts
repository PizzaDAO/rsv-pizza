import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isUnderboss } from '../middleware/auth.js';
import { requireSponsorAuth, SponsorRequest } from '../middleware/sponsorAuth.js';
import { AppError } from '../middleware/error.js';
import { syncPartnerToAllEvents, syncAutoSponsorsToAllEvents, removePartnerFromAllEvents, removeAutoSponsorsFromAllEvents } from '../helpers/partnerSync.js';

// Admin management routes (mounted at /api/sponsor-users)

export const sponsorUserAdminRouter = Router();

// GET /api/sponsor-users/list - List sponsor users (admin: all, underboss: own)
sponsorUserAdminRouter.get('/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminUser = await isAdmin(req.userEmail);
    const underbossUser = !adminUser ? await isUnderboss(req.userEmail) : false;
    if (!adminUser && !underbossUser) {
      throw new AppError('Admin or underboss access required', 403, 'FORBIDDEN');
    }

    const whereClause: any = {};
    if (!adminUser) {
      // Underboss: only see partners they created
      whereClause.createdBy = req.userEmail;
    }

    const sponsorUsers = await prisma.sponsorUser.findMany({
      where: whereClause,
      orderBy: [{ descriptionSortOrder: 'asc' }, { createdAt: 'desc' }],
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
        category: true,
        coHostShowOnEvent: true,
        coHostCanEdit: true,
        coHostAllowedTabs: true,
        brandDescription: true,
        descriptionSortOrder: true,
      },
    });

    // Count events per tag for admin UI
    const tagCounts: Record<string, number> = {};
    const uniqueTags = [...new Set(sponsorUsers.map(su => su.tag))];
    if (uniqueTags.length > 0) {
      for (const tag of uniqueTags) {
        const count = await prisma.party.count({
          where: tag === 'pizzadao' ? {} : { eventTags: { has: tag } },
        });
        tagCounts[tag] = count;
      }
    }

    res.json({ sponsorUsers, tagCounts });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor-users - Create a sponsor user (admin or underboss)
sponsorUserAdminRouter.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminUser = await isAdmin(req.userEmail);
    const underbossUser = !adminUser ? await isUnderboss(req.userEmail) : false;
    if (!adminUser && !underbossUser) {
      throw new AppError('Admin or underboss access required', 403, 'FORBIDDEN');
    }

    const {
      email, tag, name, notes,
      coHostName, coHostWebsite, coHostTwitter, coHostInstagram,
      coHostAvatarUrl, coHostLogoUrl, autoCoHost, autoSponsor,
      coHostShowOnEvent, coHostCanEdit, coHostAllowedTabs,
      category,
      brandDescription,
      descriptionSortOrder,
    } = req.body;

    if (!email || !tag) {
      throw new AppError('Email and tag are required', 400, 'VALIDATION_ERROR');
    }

    // Check for existing sponsor with same email+tag combo
    const existing = await prisma.sponsorUser.findFirst({
      where: { email: email.toLowerCase(), tag: tag.trim().toLowerCase() },
    });

    if (existing) {
      throw new AppError('This email is already registered for this tag', 409, 'CONFLICT');
    }

    // Underboss: always set createdBy to their email (prevent spoofing)
    const createdBy = underbossUser ? req.userEmail : (req.userEmail || null);

    const sponsorUser = await prisma.sponsorUser.create({
      data: {
        email: email.toLowerCase(),
        tag: tag.trim().toLowerCase(),
        name: name?.trim() || null,
        notes: notes?.trim() || null,
        createdBy,
        coHostName: coHostName?.trim() || null,
        coHostWebsite: coHostWebsite?.trim() || null,
        coHostTwitter: coHostTwitter?.trim() || null,
        coHostInstagram: coHostInstagram?.trim() || null,
        coHostAvatarUrl: coHostAvatarUrl?.trim() || null,
        coHostLogoUrl: coHostLogoUrl?.trim() || null,
        autoCoHost: autoCoHost || false,
        autoSponsor: autoSponsor || false,
        brandDescription: brandDescription?.trim() || null,
        descriptionSortOrder: typeof descriptionSortOrder === 'number' ? descriptionSortOrder : 0,
        coHostShowOnEvent: coHostShowOnEvent !== undefined ? !!coHostShowOnEvent : true,
        coHostCanEdit: !!coHostCanEdit,
        coHostAllowedTabs: Array.isArray(coHostAllowedTabs) ? coHostAllowedTabs : Prisma.JsonNull,
        category: category?.trim() || null,
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

// PATCH /api/sponsor-users/reorder - Reorder sponsor users by descriptionSortOrder (admin or underboss)
// NOTE: Must be registered before /:id to avoid Express matching 'reorder' as an id
sponsorUserAdminRouter.patch('/reorder', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminUser = await isAdmin(req.userEmail);
    const underbossUser = !adminUser ? await isUnderboss(req.userEmail) : false;
    if (!adminUser && !underbossUser) {
      throw new AppError('Admin or underboss access required', 403, 'FORBIDDEN');
    }

    const { sponsorUserIds } = req.body;

    if (!Array.isArray(sponsorUserIds) || sponsorUserIds.length === 0) {
      throw new AppError('sponsorUserIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    // Underboss: verify all IDs belong to them
    if (!adminUser) {
      const ownedCount = await prisma.sponsorUser.count({
        where: { id: { in: sponsorUserIds }, createdBy: req.userEmail },
      });
      if (ownedCount !== sponsorUserIds.length) {
        throw new AppError('You can only reorder your own partners', 403, 'FORBIDDEN');
      }
    }

    // Capture old global order BEFORE updating
    const oldSponsorUsers = await prisma.sponsorUser.findMany({
      where: { id: { in: sponsorUserIds }, autoSponsor: true, isActive: true },
      select: { id: true, email: true, descriptionSortOrder: true, tag: true },
      orderBy: { descriptionSortOrder: 'asc' },
    });

    // Apply the new order
    await prisma.$transaction(
      sponsorUserIds.map((id: string, index: number) =>
        prisma.sponsorUser.update({
          where: { id },
          data: { descriptionSortOrder: index },
        })
      )
    );

    // Smart sync: propagate new order to events that haven't been host-customized
    try {
      // Build old order: email -> old descriptionSortOrder
      const oldOrderByEmail = new Map(oldSponsorUsers.map(su => [su.email, su.descriptionSortOrder]));

      // Build new order: email -> new descriptionSortOrder (index)
      const newSponsorUsers = await prisma.sponsorUser.findMany({
        where: { id: { in: sponsorUserIds }, autoSponsor: true, isActive: true },
        select: { id: true, email: true, descriptionSortOrder: true, tag: true },
      });
      const newOrderByEmail = new Map(newSponsorUsers.map(su => [su.email, su.descriptionSortOrder]));

      // Find all auto-created sponsors across all events
      const autoSponsors = await prisma.sponsor.findMany({
        where: {
          contactEmail: { in: Array.from(oldOrderByEmail.keys()) },
          notes: { startsWith: 'Auto-created from partner tag' },
        },
        select: { id: true, partyId: true, contactEmail: true, sortOrder: true },
      });

      if (autoSponsors.length > 0) {
        // Group by event
        const byEvent = new Map<string, typeof autoSponsors>();
        for (const sp of autoSponsors) {
          const list = byEvent.get(sp.partyId) || [];
          list.push(sp);
          byEvent.set(sp.partyId, list);
        }

        const updates: { id: string; sortOrder: number }[] = [];

        for (const [, eventSponsors] of byEvent) {
          // Current event order (by sortOrder)
          const currentOrder = [...eventSponsors]
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map(s => s.contactEmail);

          // Old global order for the same emails
          const oldGlobalOrder = [...eventSponsors]
            .sort((a, b) => (oldOrderByEmail.get(a.contactEmail!) ?? 0) - (oldOrderByEmail.get(b.contactEmail!) ?? 0))
            .map(s => s.contactEmail);

          // Compare sequences — if they match, event hasn't been host-customized
          const isCustomized = currentOrder.length !== oldGlobalOrder.length ||
            currentOrder.some((email, i) => email !== oldGlobalOrder[i]);

          if (!isCustomized) {
            // Safe to sync — update each sponsor's sortOrder to new global value
            for (const sp of eventSponsors) {
              const newOrder = newOrderByEmail.get(sp.contactEmail!);
              if (newOrder !== undefined) {
                updates.push({ id: sp.id, sortOrder: newOrder });
              }
            }
          }
        }

        // Batch update
        if (updates.length > 0) {
          await prisma.$transaction(
            updates.map(u =>
              prisma.sponsor.update({
                where: { id: u.id },
                data: { sortOrder: u.sortOrder },
              })
            )
          );
        }
      }
    } catch (syncError) {
      console.error('Failed to sync sponsor sort order to events:', syncError);
      // Non-fatal: the global reorder succeeded, event sync is best-effort
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/sponsor-users/:id - Update a sponsor user (admin or underboss)
sponsorUserAdminRouter.patch('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminUser = await isAdmin(req.userEmail);
    const underbossUser = !adminUser ? await isUnderboss(req.userEmail) : false;
    if (!adminUser && !underbossUser) {
      throw new AppError('Admin or underboss access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const {
      email, name, tag, notes, isActive,
      coHostName, coHostWebsite, coHostTwitter, coHostInstagram,
      coHostAvatarUrl, coHostLogoUrl, autoCoHost, autoSponsor,
      coHostShowOnEvent, coHostCanEdit, coHostAllowedTabs,
      category,
      brandDescription,
      descriptionSortOrder,
    } = req.body;

    // Fetch old state for sync reconciliation
    const oldSponsorUser = await prisma.sponsorUser.findUnique({
      where: { id },
    });
    if (!oldSponsorUser) {
      throw new AppError('Sponsor user not found', 404, 'NOT_FOUND');
    }

    // Underboss: verify ownership
    if (!adminUser && oldSponsorUser.createdBy !== req.userEmail) {
      throw new AppError('You can only edit your own partners', 403, 'FORBIDDEN');
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
    if (brandDescription !== undefined) updateData.brandDescription = brandDescription?.trim() || null;
    if (descriptionSortOrder !== undefined) updateData.descriptionSortOrder = typeof descriptionSortOrder === 'number' ? descriptionSortOrder : 0;
    if (autoCoHost !== undefined) updateData.autoCoHost = autoCoHost;
    if (autoSponsor !== undefined) updateData.autoSponsor = autoSponsor;
    if (category !== undefined) updateData.category = category?.trim() || null;
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

      // Case 1: Deactivated — remove everything
      if (!isActive_ && wasActive) {
        await removePartnerFromAllEvents(oldTag);
        if (oldSponsorUser.autoSponsor) {
          await removeAutoSponsorsFromAllEvents(oldTag, oldSponsorUser.email);
        }
      }
      // Case 1a: autoCoHost turned off (but still active)
      else if (!isAutoCoHost && wasAutoCoHost && isActive_) {
        await removePartnerFromAllEvents(oldTag);
        // Only remove sponsors if autoSponsor is also off
        if (!sponsorUser.autoSponsor && oldSponsorUser.autoSponsor) {
          await removeAutoSponsorsFromAllEvents(oldTag, oldSponsorUser.email);
        }
        // If autoSponsor is still on, sync sponsor rows (without co-host)
        if (sponsorUser.autoSponsor) {
          syncedCount = await syncAutoSponsorsToAllEvents(sponsorUser);
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
      // Case 3b: autoSponsor just turned on (without autoCoHost) — sync sponsor rows only
      else if (sponsorUser.autoSponsor && !oldSponsorUser.autoSponsor && !isAutoCoHost && isActive_) {
        syncedCount = await syncAutoSponsorsToAllEvents(sponsorUser);
      }
      // Case 4: Profile fields updated but still autoCoHost — upsert co-host entries in place
      else if (isAutoCoHost && isActive_ && wasAutoCoHost) {
        syncedCount = await syncPartnerToAllEvents(sponsorUser);
      }
      // Case 4b: Profile fields updated, autoSponsor on but autoCoHost off — update sponsor rows
      else if (!isAutoCoHost && sponsorUser.autoSponsor && oldSponsorUser.autoSponsor && isActive_) {
        syncedCount = await syncAutoSponsorsToAllEvents(sponsorUser);
      }
    } catch (syncError) {
      console.error('Failed to sync partner on update:', syncError);
    }

    res.json({ sponsorUser, syncedCount });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/sponsor-users/:id - Deactivate a sponsor user (admin or underboss)
sponsorUserAdminRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminUser = await isAdmin(req.userEmail);
    const underbossUser = !adminUser ? await isUnderboss(req.userEmail) : false;
    if (!adminUser && !underbossUser) {
      throw new AppError('Admin or underboss access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    // Fetch sponsor user to get tag before deactivating
    const sponsorUser = await prisma.sponsorUser.findUnique({
      where: { id },
    });

    // Underboss: verify ownership
    if (!adminUser && sponsorUser?.createdBy !== req.userEmail) {
      throw new AppError('You can only deactivate your own partners', 403, 'FORBIDDEN');
    }

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

// Sponsor Dashboard routes (mounted at /api/sponsor)

export const sponsorDashboardRouter = Router();

// GET /api/sponsor/me - Check if logged-in user is a sponsor or admin
sponsorDashboardRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const adminUser = await isAdmin(email);

    const sponsorUsers = await prisma.sponsorUser.findMany({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        tag: true,
        isActive: true,
      },
    });

    if (sponsorUsers.length > 0) {
      return res.json({
        isSponsor: true,
        isAdmin: adminUser,
        sponsor: {
          id: sponsorUsers[0].id,
          email: sponsorUsers[0].email,
          name: sponsorUsers[0].name,
          tag: sponsorUsers[0].tag,
        },
        sponsors: sponsorUsers.map(s => ({
          id: s.id,
          email: s.email,
          name: s.name,
          tag: s.tag,
        })),
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
    const tag = req.isAdminViewing
      ? (queryTag?.trim().toLowerCase() || undefined)
      : (queryTag?.trim().toLowerCase() || req.sponsorUser?.tag);
    const sponsorUserId = req.sponsorUser?.id;

    // Build where clause — admins without a tag filter see all events that have any eventTags
    const where: any = {};
    if (tag && tag !== 'pizzadao') {
      where.eventTags = { has: tag };
    } else if (tag === 'pizzadao') {
      // PizzaDAO: show all GPP events (created via /gpp flow)
      where.eventType = 'gpp';
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
          select: { id: true, approved: true, checkedInAt: true, status: true },
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
        partnerEventNotes: {
          ...(sponsorUserId ? { where: { sponsorUserId } } : {}),
          select: { notes: true },
          take: 1,
        },
        _count: { select: { guests: true, photos: true } },
      },
      orderBy: { date: 'asc' },
    });

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

    // Get link click stats per party — filtered to the relevant partner's links
    const eventIds = events.map(e => e.id);

    // Determine which partner name(s) to filter clicks by:
    // - Non-admin partner: filter to their own name
    // - Admin viewing a specific tag: filter to ALL partner names for that tag
    // - Admin with no tag filter: show all clicks (no filter)
    let partnerNames: string[] = [];

    if (!req.isAdminViewing && req.sponsorUser) {
      // Regular partner: filter to their own name
      const partnerRecord = await prisma.sponsorUser.findUnique({
        where: { id: req.sponsorUser.id },
        select: { coHostName: true, name: true, email: true },
      });
      const displayName = partnerRecord?.coHostName || partnerRecord?.name || partnerRecord?.email || '';
      if (displayName) partnerNames = [displayName];
    } else if (req.isAdminViewing) {
      // Admin: filter to partners for the specific tag, or ALL partners for "all tags"
      const tagPartners = await prisma.sponsorUser.findMany({
        where: { ...(tag ? { tag } : {}), isActive: true },
        select: { coHostName: true, name: true, email: true },
      });
      partnerNames = tagPartners
        .map(p => p.coHostName || p.name || p.email)
        .filter(Boolean) as string[];
    }

    // Build parameterized label filter: exact match OR prefix match (for "Name_twitter" etc.)
    let labelFilter = Prisma.empty;
    if (partnerNames.length === 1) {
      labelFilter = Prisma.sql`AND (link_label = ${partnerNames[0]} OR link_label LIKE ${partnerNames[0] + '_%'})`;
    } else if (partnerNames.length > 1) {
      // Build OR chain: (link_label = 'A' OR link_label LIKE 'A_%' OR link_label = 'B' OR link_label LIKE 'B_%')
      const conditions = partnerNames.map(n =>
        Prisma.sql`link_label = ${n} OR link_label LIKE ${n + '_%'}`
      );
      labelFilter = Prisma.sql`AND (${Prisma.join(conditions, ' OR ')})`;
    }

    const clicksByLink = eventIds.length > 0
      ? await prisma.$queryRaw<{ party_id: string; url: string; link_type: string; link_label: string | null; total_clicks: bigint; unique_clicks: bigint }[]>`
        SELECT
          party_id::text,
          url,
          link_type,
          MAX(link_label) as link_label,
          COUNT(*) as total_clicks,
          COUNT(DISTINCT visitor_hash) as unique_clicks
        FROM link_clicks
        WHERE party_id::text IN (${Prisma.join(eventIds)})
        AND link_type IN ('sponsor', 'host_social')
        ${labelFilter}
        GROUP BY party_id, url, link_type
        ORDER BY total_clicks DESC
      `
      : [];

    // Build map: partyId -> [{ url, linkType, linkLabel, clicks, uniqueClickers }]
    const byLinkMap = new Map<string, { url: string; linkType: string; linkLabel: string | null; clicks: number; uniqueClickers: number }[]>();
    const clickCountMap = new Map<string, number>();
    const uniqueClickMap = new Map<string, number>();
    for (const row of clicksByLink) {
      const list = byLinkMap.get(row.party_id) || [];
      list.push({
        url: row.url,
        linkType: row.link_type,
        linkLabel: row.link_label,
        clicks: Number(row.total_clicks),
        uniqueClickers: Number(row.unique_clicks),
      });
      byLinkMap.set(row.party_id, list);
      clickCountMap.set(row.party_id, (clickCountMap.get(row.party_id) || 0) + Number(row.total_clicks));
      uniqueClickMap.set(row.party_id, (uniqueClickMap.get(row.party_id) || 0) + Number(row.unique_clicks));
    }

    // Get page view (impression) counts per party
    const viewStats = await prisma.pageView.groupBy({
      by: ['partyId'],
      where: { partyId: { in: eventIds } },
      _count: true,
    });
    const viewCountMap = new Map(viewStats.map(r => [r.partyId, r._count]));

    const uniqueViewStats = eventIds.length > 0
      ? await prisma.$queryRaw<{ party_id: string; unique_count: bigint }[]>`
        SELECT party_id::text, COUNT(DISTINCT visitor_hash) as unique_count
        FROM page_views
        WHERE party_id::text IN (${Prisma.join(eventIds)})
        GROUP BY party_id
      `
      : [];
    const uniqueViewMap = new Map(uniqueViewStats.map(r => [r.party_id, Number(r.unique_count)]));

    const formattedEvents = events.map(event => {
      const guestCount = event.guests.filter(g => g.status !== 'INVITED').length;
      const approvedCount = event.guests.filter(g => g.approved !== false && g.status !== 'INVITED').length;

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
        reportPublicSlug: event.reportPublished ? (event.reportPublicSlug || event.customUrl || event.inviteCode) : null,
        date: event.date,
        timezone: event.timezone,
        address: event.address,
        latitude: event.latitude || null,
        longitude: event.longitude || null,
        venueName: event.venueName,
        region: event.region || null,
        telegramGroup: event.telegramGroup || null,
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
        invitedCount: event.guests.filter(g => g.status === 'INVITED').length,
        approvedCount,
        maxGuests: event.maxGuests,
        expectedGuests: event.expectedGuests || null,
        budget,
        progress,
        clickStats: {
          totalClicks: clickCountMap.get(event.id) || 0,
          uniqueClickers: uniqueClickMap.get(event.id) || 0,
          byLink: byLinkMap.get(event.id) || [],
        },
        impressions: {
          totalViews: viewCountMap.get(event.id) || 0,
          uniqueVisitors: uniqueViewMap.get(event.id) || 0,
        },
        sponsorStatuses,
        sponsorCount,
        partnerNotes: event.partnerEventNotes.length > 0 ? event.partnerEventNotes[0].notes : null,
        photoCount: event._count.photos,
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

// PUT /api/sponsor/notes - Upsert per-event notes for the logged-in partner
sponsorDashboardRouter.put('/notes', requireAuth, requireSponsorAuth, async (req: SponsorRequest, res: Response, next: NextFunction) => {
  try {
    const sponsorUserId = req.sponsorUser?.id;
    if (!sponsorUserId) {
      throw new AppError('Sponsor user required (admins without a sponsor profile cannot save notes)', 400, 'VALIDATION_ERROR');
    }

    const { partyId, notes } = req.body;
    if (!partyId || typeof notes !== 'string') {
      throw new AppError('partyId and notes are required', 400, 'VALIDATION_ERROR');
    }

    const trimmedNotes = notes.trim();

    if (!trimmedNotes) {
      // Delete the row if notes are empty (cleanup)
      await prisma.partnerEventNote.deleteMany({
        where: { sponsorUserId, partyId },
      });
      return res.json({ success: true, notes: '' });
    }

    // Upsert on the composite key
    await prisma.partnerEventNote.upsert({
      where: {
        sponsorUserId_partyId: { sponsorUserId, partyId },
      },
      create: {
        sponsorUserId,
        partyId,
        notes: trimmedNotes,
      },
      update: {
        notes: trimmedNotes,
      },
    });

    res.json({ success: true, notes: trimmedNotes });
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
