import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';
import { setDeleteContext } from '../helpers/auditContext.js';

const router = Router();

// GET /api/parties/:partyId/sponsors - List all sponsors for a party
router.get('/:partyId/sponsors', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { status, sortBy, sortDir = 'desc' } = req.query;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Build query filters
    const where: any = { partyId };

    if (status && typeof status === 'string') {
      where.status = status;
    }

    // Default order: sortOrder asc (for flyer logo row), then newest first as tiebreaker.
    // If caller passes an explicit sortBy, honor it with sortDir (asc/desc).
    const validSortFields = ['createdAt', 'name', 'amount', 'lastContactedAt', 'status'];
    const order = sortDir === 'asc' ? 'asc' : 'desc';

    let orderBy: any;
    if (sortBy && validSortFields.includes(sortBy as string)) {
      orderBy = { [sortBy as string]: order };
    } else {
      orderBy = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
    }

    const sponsors = await prisma.sponsor.findMany({
      where,
      orderBy,
    });

    // Strip contact info from underboss-added sponsors for non-privileged users
    const userIsPrivileged = await isSuperAdmin(req.userEmail) || await isUnderboss(req.userEmail);
    const sanitized = userIsPrivileged
      ? sponsors
      : sponsors.map(s => {
          if (s.addedByUnderboss) {
            return { ...s, contactEmail: null, contactPhone: null, contactName: null, contactTwitter: null };
          }
          return s;
        });

    res.json({ sponsors: sanitized });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/sponsors/unified - List unified partners (event + underboss)
router.get('/:partyId/sponsors/unified', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // 1. Fetch confirmed event sponsors with brand descriptions
    const eventSponsors = await prisma.sponsor.findMany({
      where: {
        partyId,
        brandDescription: { not: null },
        status: { in: ['yes', 'billed', 'paid'] },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // 2. Get the party's eventTags
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { eventTags: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // 3. Fetch tag-matched SponsorUsers with brand descriptions
    let underbossPartners: any[] = [];
    if (party.eventTags.length > 0) {
      underbossPartners = await prisma.sponsorUser.findMany({
        where: {
          tag: { in: party.eventTags },
          isActive: true,
          brandDescription: { not: null },
        },
        orderBy: [{ descriptionSortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    }

    // 4. Deduplicate: collect emails of event sponsors
    const eventSponsorEmails = new Set(
      eventSponsors
        .filter(s => s.contactEmail)
        .map(s => s.contactEmail!.toLowerCase())
    );

    // 5. Build unified list
    const partners: any[] = [];

    // Add event sponsors
    for (const s of eventSponsors) {
      partners.push({
        id: s.id,
        sponsorId: s.id,
        sponsorUserId: undefined,
        source: 'event',
        name: s.name,
        brandDescription: s.brandDescription,
        logoUrl: s.logoUrl,
        avatarUrl: null,
        website: s.website,
        sortOrder: s.sortOrder ?? 0,
      });
    }

    // Add underboss partners that don't have a matching Sponsor record
    for (const su of underbossPartners) {
      if (eventSponsorEmails.has(su.email.toLowerCase())) {
        // Already has a Sponsor record — mark the existing entry with the sponsorUserId
        const existing = partners.find(
          p => p.source === 'event' && eventSponsors.find(
            es => es.id === p.sponsorId && es.contactEmail?.toLowerCase() === su.email.toLowerCase()
          )
        );
        if (existing) {
          existing.sponsorUserId = su.id;
          existing.source = 'event'; // keep as event since it has a Sponsor record
          existing.avatarUrl = su.coHostAvatarUrl;
        }
        continue;
      }

      partners.push({
        id: `su-${su.id}`,
        sponsorId: undefined,
        sponsorUserId: su.id,
        source: 'underboss',
        name: su.coHostName || su.name || su.email,
        brandDescription: su.brandDescription,
        logoUrl: su.coHostLogoUrl,
        avatarUrl: su.coHostAvatarUrl,
        website: su.coHostWebsite,
        sortOrder: 9999 + su.descriptionSortOrder,
      });
    }

    // Sort by sortOrder, then by name as tiebreaker
    partners.sort((a, b) => a.sortOrder - b.sortOrder);

    res.json({ partners });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/sponsors/ensure-from-underboss - Create Sponsor records for underboss partners
router.post('/:partyId/sponsors/ensure-from-underboss', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { sponsorUserIds } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    if (!Array.isArray(sponsorUserIds) || sponsorUserIds.length === 0) {
      throw new AppError('sponsorUserIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    const createdSponsorIds: string[] = [];

    for (const suId of sponsorUserIds) {
      // Fetch the SponsorUser
      const sponsorUser = await prisma.sponsorUser.findUnique({
        where: { id: suId },
      });

      if (!sponsorUser) {
        continue; // Skip unknown IDs
      }

      // Check if a Sponsor record already exists for this party + email or name
      const sponsorName = sponsorUser.coHostName || sponsorUser.name || sponsorUser.email;
      const existingSponsor = await prisma.sponsor.findFirst({
        where: {
          partyId,
          OR: [
            { contactEmail: sponsorUser.email },
            { name: sponsorName, notes: `Auto-created from partner tag "${sponsorUser.tag}"` },
          ],
        },
      });

      if (existingSponsor) {
        createdSponsorIds.push(existingSponsor.id);
        continue;
      }

      // Create a Sponsor record, reusing partnerSync logic
      const created = await prisma.sponsor.create({
        data: {
          partyId,
          name: sponsorUser.coHostName || sponsorUser.name || sponsorUser.email,
          website: sponsorUser.coHostWebsite || null,
          brandTwitter: sponsorUser.coHostTwitter || null,
          brandInstagram: sponsorUser.coHostInstagram || null,
          brandDescription: sponsorUser.brandDescription || null,
          logoUrl: sponsorUser.coHostLogoUrl || null,
          category: sponsorUser.category || null,
          contactEmail: sponsorUser.email,
          status: 'yes',
          sortOrder: sponsorUser.descriptionSortOrder,
          notes: `Auto-created from partner tag "${sponsorUser.tag}"`,
          addedByUnderboss: true,
        },
      });

      createdSponsorIds.push(created.id);
    }

    res.json({ createdSponsorIds });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/sponsors/stats - Get pipeline statistics
router.get('/:partyId/sponsors/stats', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Get party with fundraising goal
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { fundraisingGoal: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Get sponsors for this party
    const sponsors = await prisma.sponsor.findMany({
      where: { partyId },
      select: {
        status: true,
        amount: true,
      },
    });

    // Count by status
    const statusCounts: Record<string, number> = {
      todo: 0,
      asked: 0,
      yes: 0,
      billed: 0,
      paid: 0,
      stuck: 0,
      alum: 0,
      skip: 0,
    };

    let totalConfirmed = 0;

    for (const sponsor of sponsors) {
      statusCounts[sponsor.status] = (statusCounts[sponsor.status] || 0) + 1;

      // Only count amounts for yes, billed, paid statuses
      if (['yes', 'billed', 'paid'].includes(sponsor.status) && sponsor.amount) {
        totalConfirmed += Number(sponsor.amount);
      }
    }

    res.json({
      fundraisingGoal: party.fundraisingGoal ? Number(party.fundraisingGoal) : null,
      totalConfirmed,
      totalSponsors: sponsors.length,
      statusCounts,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/sponsors - Create a new sponsor
router.post('/:partyId/sponsors', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name,
      website,
      brandTwitter,
      brandInstagram,
      brandDescription,
      pointPerson,
      contactName,
      contactEmail,
      contactPhone,
      contactTwitter,
      telegram,
      status,
      amount,
      sponsorshipType,
      productService,
      logoUrl,
      notes,
      lastContactedAt,
      sponsorMessage,
      category,
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Validate status if provided
    const validStatuses = ['todo', 'asked', 'yes', 'billed', 'paid', 'stuck', 'alum', 'skip'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate sponsorship type if provided
    const validTypes = ['cash', 'in-kind', 'venue', 'pizza', 'drinks', 'other'];
    if (sponsorshipType && !validTypes.includes(sponsorshipType)) {
      throw new AppError(`Invalid sponsorship type. Must be one of: ${validTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Append to the end of the sort order for this party
    const lastSponsor = await prisma.sponsor.findFirst({
      where: { partyId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = (lastSponsor?.sortOrder ?? -1) + 1;

    // Validate category if provided
    const validCategories = ['hardware_wallet', 'software_wallet', 'cex', 'blockchain', 'dex', 'community', 'custom'];
    if (category && !validCategories.includes(category)) {
      throw new AppError(`Invalid category. Must be one of: ${validCategories.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const sponsor = await prisma.sponsor.create({
      data: {
        partyId,
        name: name.trim(),
        website: website?.trim() || null,
        brandTwitter: brandTwitter?.trim() || null,
        brandInstagram: brandInstagram?.trim() || null,
        brandDescription: brandDescription?.trim() || null,
        pointPerson: pointPerson?.trim() || null,
        contactName: contactName?.trim() || null,
        contactEmail: contactEmail?.trim()?.toLowerCase() || null,
        contactPhone: contactPhone?.trim() || null,
        contactTwitter: contactTwitter?.trim() || null,
        telegram: telegram?.trim() || null,
        status: status || 'todo',
        amount: amount !== undefined && amount !== null && amount !== '' ? amount : null,
        sponsorshipType: sponsorshipType || null,
        productService: productService?.trim() || null,
        logoUrl: logoUrl?.trim() || null,
        notes: notes?.trim() || null,
        lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null,
        sponsorMessage: sponsorMessage?.trim() || null,
        sortOrder: nextSortOrder,
        category: category?.trim() || null,
      },
    });

    res.status(201).json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/sponsors/reorder - Reorder sponsors (host only)
router.patch('/:partyId/sponsors/reorder', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { sponsorIds } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'sponsors');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Validate sponsorIds
    if (!Array.isArray(sponsorIds) || sponsorIds.length === 0) {
      throw new AppError('sponsorIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    // Verify all sponsors belong to this party
    const sponsors = await prisma.sponsor.findMany({
      where: { partyId },
      select: { id: true },
    });

    const existingIds = new Set(sponsors.map(s => s.id));
    for (const id of sponsorIds) {
      if (!existingIds.has(id)) {
        throw new AppError(`Sponsor ${id} not found in this party`, 400, 'VALIDATION_ERROR');
      }
    }

    // Update sort orders
    await prisma.$transaction(
      sponsorIds.map((id: string, index: number) =>
        prisma.sponsor.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    // Return updated sponsors
    const updatedSponsors = await prisma.sponsor.findMany({
      where: { partyId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ sponsors: updatedSponsors });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/sponsors/:sponsorId - Get single sponsor details
router.get('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    // Strip contact info from underboss-added sponsors for non-privileged users
    const userIsPrivileged = await isSuperAdmin(req.userEmail) || await isUnderboss(req.userEmail);
    const sanitizedSponsor = (!userIsPrivileged && sponsor.addedByUnderboss)
      ? { ...sponsor, contactEmail: null, contactPhone: null, contactName: null, contactTwitter: null }
      : sponsor;

    res.json({ sponsor: sanitizedSponsor });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/sponsors/:sponsorId - Update a sponsor
router.patch('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;
    const {
      name,
      website,
      brandTwitter,
      brandInstagram,
      brandDescription,
      pointPerson,
      contactName,
      contactEmail,
      contactPhone,
      contactTwitter,
      telegram,
      status,
      amount,
      sponsorshipType,
      productService,
      logoUrl,
      notes,
      lastContactedAt,
      sponsorMessage,
      category,
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Check if sponsor exists
    const existingSponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!existingSponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    // Validate status if provided
    const validStatuses = ['todo', 'asked', 'yes', 'billed', 'paid', 'stuck', 'alum', 'skip'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate sponsorship type if provided
    const validTypes = ['cash', 'in-kind', 'venue', 'pizza', 'drinks', 'other'];
    if (sponsorshipType && !validTypes.includes(sponsorshipType)) {
      throw new AppError(`Invalid sponsorship type. Must be one of: ${validTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate category if provided
    const validCategories = ['hardware_wallet', 'software_wallet', 'cex', 'blockchain', 'dex', 'community', 'custom'];
    if (category && !validCategories.includes(category)) {
      throw new AppError(`Invalid category. Must be one of: ${validCategories.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Protect contact fields for underboss-added sponsors from non-privileged users
    const userIsPrivileged = await isSuperAdmin(req.userEmail) || await isUnderboss(req.userEmail);
    const stripContactFields = existingSponsor.addedByUnderboss && !userIsPrivileged;

    const sponsor = await prisma.sponsor.update({
      where: { id: sponsorId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(website !== undefined && { website: website?.trim() || null }),
        ...(brandTwitter !== undefined && { brandTwitter: brandTwitter?.trim() || null }),
        ...(brandInstagram !== undefined && { brandInstagram: brandInstagram?.trim() || null }),
        ...(brandDescription !== undefined && { brandDescription: brandDescription?.trim() || null }),
        ...(pointPerson !== undefined && { pointPerson: pointPerson?.trim() || null }),
        ...(!stripContactFields && contactName !== undefined && { contactName: contactName?.trim() || null }),
        ...(!stripContactFields && contactEmail !== undefined && { contactEmail: contactEmail?.trim()?.toLowerCase() || null }),
        ...(!stripContactFields && contactPhone !== undefined && { contactPhone: contactPhone?.trim() || null }),
        ...(!stripContactFields && contactTwitter !== undefined && { contactTwitter: contactTwitter?.trim() || null }),
        ...(telegram !== undefined && { telegram: telegram?.trim() || null }),
        ...(status !== undefined && { status }),
        ...(amount !== undefined && { amount: amount !== null && amount !== '' ? amount : null }),
        ...(sponsorshipType !== undefined && { sponsorshipType: sponsorshipType || null }),
        ...(productService !== undefined && { productService: productService?.trim() || null }),
        ...(logoUrl !== undefined && { logoUrl: logoUrl?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(lastContactedAt !== undefined && { lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null }),
        ...(sponsorMessage !== undefined && { sponsorMessage: sponsorMessage?.trim() || null }),
        ...(category !== undefined && { category: category?.trim() || null }),
      },
    });

    res.json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/sponsors/:sponsorId - Delete a sponsor
router.delete('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to sponsors tab
    const canAccessSponsors = await canUserAccessTab(partyId, req.userEmail, req.userId, 'partners');
    if (!canAccessSponsors) {
      throw new AppError('You do not have access to the sponsors tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Check if sponsor exists
    const existingSponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!existingSponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    await prisma.$transaction(async (tx) => {
      await setDeleteContext(tx, req.userEmail, 'host_dashboard');
      await tx.sponsor.delete({
        where: { id: sponsorId },
      });
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
