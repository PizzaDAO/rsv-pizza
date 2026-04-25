import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { sendApprovalEmail, sendPromotionEmail } from './rsvp.routes.js';
import { triggerWebhook } from '../services/webhook.service.js';
import { canUserEditParty, canUserAccessTab, VALID_TAB_IDS } from '../helpers/partyAccess.js';

// Helper function to get party with ownership check
async function getPartyWithOwnershipCheck(partyId: string, userId?: string, userEmail?: string) {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    include: {
      user: { select: { name: true } },
      guests: {
        orderBy: { submittedAt: 'desc' },
      },
    },
  });

  if (!party) {
    return null;
  }

  // Super admin can access any party
  if (await isSuperAdmin(userEmail)) {
    return party;
  }

  // Check if user is the owner
  if (party.userId === userId) {
    return party;
  }

  // Check if user is a co-host with edit permissions
  if (userEmail) {
    const coHosts = party.coHosts as Array<{ email?: string; canEdit?: boolean }> | null;
    if (coHosts) {
      const isEditor = coHosts.some(
        (h) => h.email?.toLowerCase() === userEmail.toLowerCase() && h.canEdit === true
      );
      if (isEditor) {
        return party;
      }
    }
  }

  return null;
}

const router = Router();

// All party routes require authentication
router.use(requireAuth);

// GET /api/parties/my-events - Get all events for the authenticated user (owned, guest, cohost) in a single call
// Must be registered BEFORE /:id catch-all route
router.get('/my-events', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    const userEmail = req.userEmail?.toLowerCase();

    if (!userId || !userEmail) {
      return res.json({ parties: [] });
    }

    // Slim select for homepage cards
    const slimSelect = {
      id: true,
      name: true,
      inviteCode: true,
      date: true,
      address: true,
      eventImageUrl: true,
      coHosts: true,
      _count: { select: { guests: true } },
    };

    // 1. Owned parties
    const ownedParties = await prisma.party.findMany({
      where: { userId },
      select: slimSelect,
      orderBy: { date: 'asc' },
    });

    // 2. Parties where user is a guest (via email)
    const guestEntries = await prisma.guest.findMany({
      where: { email: userEmail },
      select: { partyId: true },
    });
    const guestPartyIds = guestEntries.map(g => g.partyId);

    let guestParties: typeof ownedParties = [];
    if (guestPartyIds.length > 0) {
      guestParties = await prisma.party.findMany({
        where: { id: { in: guestPartyIds } },
        select: slimSelect,
        orderBy: { date: 'asc' },
      });
    }

    // 3. Co-host parties via raw SQL with JSONB operator
    const cohostRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM parties
      WHERE co_hosts::jsonb @> ${JSON.stringify([{ email: userEmail }])}::jsonb
    `;
    const cohostPartyIds = cohostRows.map(r => r.id);

    let cohostParties: typeof ownedParties = [];
    if (cohostPartyIds.length > 0) {
      cohostParties = await prisma.party.findMany({
        where: { id: { in: cohostPartyIds } },
        select: slimSelect,
        orderBy: { date: 'asc' },
      });
    }

    // Deduplicate by party ID, assign roles (host > cohost > guest)
    const partyMap = new Map<string, any>();

    for (const p of ownedParties) {
      partyMap.set(p.id, { ...p, role: 'host' as const });
    }
    for (const p of cohostParties) {
      if (!partyMap.has(p.id)) {
        partyMap.set(p.id, { ...p, role: 'cohost' as const });
      }
    }
    for (const p of guestParties) {
      if (!partyMap.has(p.id)) {
        partyMap.set(p.id, { ...p, role: 'guest' as const });
      }
    }

    // Format response
    const parties = Array.from(partyMap.values()).map(p => ({
      id: p.id,
      name: p.name,
      inviteCode: p.inviteCode,
      date: p.date ? p.date.toISOString() : null,
      address: p.address,
      eventImageUrl: p.eventImageUrl,
      guestCount: p._count?.guests ?? 0,
      role: p.role,
    }));

    // Sort by date ascending (nulls last)
    parties.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    res.json({ parties });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/by-cohost?email=xxx - Get party IDs where user is a co-host
// Must be registered BEFORE /:id catch-all route
router.get('/by-cohost', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = (req.query.email as string)?.toLowerCase();
    if (!email) {
      return res.json({ partyIds: [] });
    }

    // Use JSONB operator for efficient co-host lookup instead of loading all parties
    const matchingParties = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM parties
      WHERE co_hosts::jsonb @> ${JSON.stringify([{ email }])}::jsonb
    `;

    const matchingIds = matchingParties.map(p => p.id);

    res.json({ partyIds: matchingIds });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties - List user's parties
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parties = await prisma.party.findMany({
      where: { userId: req.userId },
      include: {
        user: { select: { name: true } },
        _count: { select: { guests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Map to include hostName from user for backwards compatibility
    const partiesWithHost = parties.map(party => ({
      ...party,
      hostName: (party as any).eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
      user: undefined, // Remove user object from response
    }));

    res.json({ parties: partiesWithHost });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties - Create new party
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name, date, endTime, duration, pizzaStyle, address, venueName, maxGuests,
      availableBeverages, availableToppings, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts,
      donationEnabled, donationGoal, donationMessage, suggestedAmounts, donationRecipient,
      donationRecipientUrl, donationEthAddress
    } = req.body;

    // Generate default party name if not provided
    let partyName = name?.trim();
    if (!partyName) {
      const count = await prisma.party.count();
      partyName = `Pizza Party ${count + 1}`;
    }

    // Validate custom URL if provided
    if (customUrl) {
      // Only allow lowercase letters, numbers, and hyphens
      if (!/^[a-z0-9-]+$/.test(customUrl)) {
        throw new AppError('Custom URL can only contain lowercase letters, numbers, and hyphens', 400, 'VALIDATION_ERROR');
      }
      if (customUrl.length < 3 || customUrl.length > 50) {
        throw new AppError('Custom URL must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
      }
    }

    // Get user's name for co-hosts default
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });

    // Build coHosts array with host email if provided
    const hostCoHosts = req.userEmail
      ? [{ id: crypto.randomUUID(), name: user?.name || '', email: req.userEmail, showOnEvent: false }]
      : [];
    const finalCoHosts = coHosts || hostCoHosts;

    const party = await prisma.party.create({
      data: {
        name: partyName,
        date: date ? new Date(date) : null,
        endTime: endTime ? new Date(endTime) : null,
        duration: duration || null,
        timezone: timezone || null,
        pizzaStyle: pizzaStyle || 'new-york',
        availableBeverages: availableBeverages || [],
        availableToppings: availableToppings || [],
        address: address || null,
        venueName: venueName || null,
        maxGuests: maxGuests || null,
        hideGuests: hideGuests || false,
        requireApproval: requireApproval || false,
        password: password || null,
        eventImageUrl: eventImageUrl || null,
        description: description || null,
        customUrl: customUrl || null,
        coHosts: finalCoHosts,
        userId: req.userId!,
        donationEnabled: donationEnabled || false,
        donationGoal: donationGoal || null,
        donationMessage: donationMessage || null,
        suggestedAmounts: suggestedAmounts || [500, 1000, 2500, 5000],
        donationRecipient: donationRecipient || null,
        donationRecipientUrl: donationRecipientUrl || null,
        donationEthAddress: donationEthAddress || null,
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // Add the host as a guest so they can bypass password protection
    if (req.userEmail) {
      await prisma.guest.create({
        data: {
          name: user?.name || 'Host',
          email: req.userEmail.toLowerCase(),
          dietaryRestrictions: [],
          likedToppings: [],
          dislikedToppings: [],
          likedBeverages: [],
          dislikedBeverages: [],
          submittedVia: 'host',
          partyId: party.id,
        },
      });
    }

    // Trigger webhook for party creation
    await triggerWebhook('party.created', party, req.userId!);

    // Return with hostName for backwards compatibility
    res.status(201).json({
      party: {
        ...party,
        hostName: (party as any).eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
        user: undefined,
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id - Get party details
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const party = await getPartyWithOwnershipCheck(id, req.userId, req.userEmail);

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Enrich coHosts with user profile data (avatar, socials)
    const rawCoHosts = (party.coHosts as any[] || []);
    const coHostEmails = rawCoHosts.map((h: any) => h.email).filter(Boolean);
    let enrichedCoHosts = rawCoHosts;
    if (coHostEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: coHostEmails } },
        select: { email: true, profilePictureUrl: true, twitter: true, website: true, instagram: true },
      });
      const profilesByEmail = Object.fromEntries(users.map(u => [u.email, u]));
      enrichedCoHosts = rawCoHosts.map((h: any) => {
        const profile = h.email ? profilesByEmail[h.email] : null;
        if (profile) {
          return {
            ...h,
            avatar_url: h.avatar_url || profile.profilePictureUrl || null,
            twitter: h.twitter || profile.twitter || null,
            website: h.website || profile.website || null,
            instagram: h.instagram || profile.instagram || null,
          };
        }
        return h;
      });
    }

    // Resolve the requesting user's co-host tab permissions
    let allowedTabs: string[] | undefined;
    const isOwner = party.userId === req.userId;
    const isSuper = await isSuperAdmin(req.userEmail);
    if (!isOwner && !isSuper && req.userEmail) {
      const myCoHostEntry = rawCoHosts.find(
        (h: any) => h.email?.toLowerCase() === req.userEmail!.toLowerCase() && h.canEdit === true
      );
      if (myCoHostEntry && Array.isArray(myCoHostEntry.allowedTabs)) {
        allowedTabs = myCoHostEntry.allowedTabs;
      }
    }

    // Return with hostName, userId for ownership checks, canEdit flag, and allowedTabs
    res.json({
      party: {
        ...party,
        coHosts: enrichedCoHosts,
        hostName: (party as any).eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
        user: undefined,
        canEdit: true, // If we reached here, getPartyWithOwnershipCheck verified edit permissions
        allowedTabs, // undefined for owner/admin (all tabs), string[] for restricted co-hosts
      }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:id - Update party
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      name, date, endTime, duration, pizzaStyle, address, latitude, longitude, venueName, maxGuests,
      availableBeverages, availableToppings, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts, selectedPizzerias,
      expectedGuests,
      donationEnabled, donationGoal, donationMessage, suggestedAmounts, donationRecipient,
      donationRecipientUrl, donationEthAddress, shareToUnlock, shareTweetText, fundraisingGoal,
      musicEnabled, musicNotes, photoModeration,
      nftEnabled, nftChain,
      pinnedApps,
      region,
      venueReportTitle, venueReportNotes,
      hiddenGppPhotos, extraGppPhotos,
      lumaUrl, meetupUrl, eventbriteUrl, externalLinks
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Validate custom URL if provided
    if (customUrl !== undefined && customUrl !== null && customUrl !== '') {
      if (!/^[a-z0-9-]+$/.test(customUrl)) {
        throw new AppError('Custom URL can only contain lowercase letters, numbers, and hyphens', 400, 'VALIDATION_ERROR');
      }
      if (customUrl.length < 3 || customUrl.length > 50) {
        throw new AppError('Custom URL must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
      }
    }

    // Validate externalLinks if provided
    if (externalLinks !== undefined && externalLinks !== null) {
      if (!Array.isArray(externalLinks)) {
        throw new AppError('externalLinks must be an array', 400, 'VALIDATION_ERROR');
      }
      if (externalLinks.length > 10) {
        throw new AppError('Maximum 10 external links allowed', 400, 'VALIDATION_ERROR');
      }
      for (const link of externalLinks) {
        if (typeof link.label !== 'string' || typeof link.url !== 'string') {
          throw new AppError('Each external link must have a label and url string', 400, 'VALIDATION_ERROR');
        }
      }
    }

    // Protect underboss and partner co-host entries: preserve them on co-hosts update
    let mergedCoHosts = coHosts;
    if (coHosts !== undefined) {
      const existingParty = await prisma.party.findUnique({
        where: { id },
        select: { coHosts: true },
      });
      const existingCoHosts = (existingParty?.coHosts as any[]) || [];
      // Extract protected entries (underboss + partner) from existing data
      const protectedEntries = existingCoHosts.filter(
        (h: any) => h.isUnderboss === true || h.isPartner === true
      );
      const protectedIds = new Set(protectedEntries.map((h: any) => h.id));
      // Strip isUnderboss and isPartner from client-submitted entries (prevent spoofing)
      // and remove any client entries that duplicate a protected entry (to prevent duplicates)
      // Also validate allowedTabs: strip invalid tab IDs
      const clientCoHosts = (coHosts as any[])
        .map((h: any) => {
          const { isUnderboss: _ub, isPartner: _p, partnerTag: _pt, ...rest } = h;
          // Validate allowedTabs if present
          if (Array.isArray(rest.allowedTabs)) {
            rest.allowedTabs = rest.allowedTabs.filter(
              (tab: string) => VALID_TAB_IDS.includes(tab as any)
            );
          }
          return rest;
        })
        .filter((h: any) => !protectedIds.has(h.id));
      // Merge: client entries + preserved protected entries
      mergedCoHosts = [...clientCoHosts, ...protectedEntries];
    }

    const party = await prisma.party.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(date !== undefined && { date: date ? new Date(date) : null }),
        ...(endTime !== undefined && { endTime: endTime ? new Date(endTime) : null }),
        ...(duration !== undefined && { duration }),
        ...(timezone !== undefined && { timezone }),
        ...(pizzaStyle && { pizzaStyle }),
        ...(address !== undefined && { address }),
        ...(latitude !== undefined && { latitude: latitude !== null ? Number(latitude) : null }),
        ...(longitude !== undefined && { longitude: longitude !== null ? Number(longitude) : null }),
        ...(venueName !== undefined && { venueName: venueName || null }),
        ...(maxGuests !== undefined && { maxGuests }),
        ...(expectedGuests !== undefined && { expectedGuests: expectedGuests !== null && expectedGuests !== '' ? Number(expectedGuests) : null }),
        ...(hideGuests !== undefined && { hideGuests }),
        ...(requireApproval !== undefined && { requireApproval }),
        ...(availableBeverages !== undefined && { availableBeverages }),
        ...(availableToppings !== undefined && { availableToppings }),
        ...(password !== undefined && { password: password || null }),
        ...(eventImageUrl !== undefined && { eventImageUrl: eventImageUrl || null }),
        ...(description !== undefined && { description: description || null }),
        ...(customUrl !== undefined && { customUrl: customUrl || null }),
        ...(mergedCoHosts !== undefined && { coHosts: mergedCoHosts }),
        ...(selectedPizzerias !== undefined && { selectedPizzerias }),
        ...(donationEnabled !== undefined && { donationEnabled }),
        ...(donationGoal !== undefined && { donationGoal: donationGoal || null }),
        ...(donationMessage !== undefined && { donationMessage: donationMessage || null }),
        ...(suggestedAmounts !== undefined && { suggestedAmounts }),
        ...(donationRecipient !== undefined && { donationRecipient: donationRecipient || null }),
        ...(donationRecipientUrl !== undefined && { donationRecipientUrl: donationRecipientUrl || null }),
        ...(donationEthAddress !== undefined && { donationEthAddress: donationEthAddress || null }),
        ...(shareToUnlock !== undefined && { shareToUnlock }),
        ...(shareTweetText !== undefined && { shareTweetText: shareTweetText || null }),
        ...(fundraisingGoal !== undefined && { fundraisingGoal: fundraisingGoal !== null && fundraisingGoal !== '' ? fundraisingGoal : null }),
        ...(musicEnabled !== undefined && { musicEnabled }),
        ...(musicNotes !== undefined && { musicNotes: musicNotes || null }),
        ...(photoModeration !== undefined && { photoModeration }),
        ...(nftEnabled !== undefined && { nftEnabled }),
        ...(nftChain !== undefined && { nftChain: nftChain || null }),
        ...(pinnedApps !== undefined && { pinnedApps }),
        ...(region !== undefined && { region: region || null }),
        ...(venueReportTitle !== undefined && { venueReportTitle: venueReportTitle || null }),
        ...(venueReportNotes !== undefined && { venueReportNotes: venueReportNotes || null }),
        ...(hiddenGppPhotos !== undefined && { hiddenGppPhotos }),
        ...(extraGppPhotos !== undefined && { extraGppPhotos }),
        ...(lumaUrl !== undefined && { lumaUrl: lumaUrl || null }),
        ...(meetupUrl !== undefined && { meetupUrl: meetupUrl || null }),
        ...(eventbriteUrl !== undefined && { eventbriteUrl: eventbriteUrl || null }),
        ...(externalLinks !== undefined && { externalLinks }),
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // Trigger webhook for party update
    await triggerWebhook('party.updated', party, req.userId!);

    // Return with hostName for backwards compatibility
    res.json({
      party: {
        ...party,
        hostName: (party as any).eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
        user: undefined,
      }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:id - Delete party
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.party.delete({ where: { id } });

    // Trigger webhook for party deletion
    await triggerWebhook('party.deleted', { id }, req.userId!);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id/invite-link - Get invite link
router.get('/:id/invite-link', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await prisma.party.findUnique({
      where: { id },
      select: { inviteCode: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5176';
    const inviteLink = `${baseUrl}/rsvp/${party.inviteCode}`;

    res.json({ inviteCode: party.inviteCode, inviteLink });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/close-rsvp - Close RSVPs
router.post('/:id/close-rsvp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await prisma.party.update({
      where: { id },
      data: { rsvpClosedAt: new Date() },
    });

    // Trigger webhook for RSVP closed
    await triggerWebhook('party.rsvp_closed', party, req.userId!);

    res.json({ success: true, message: 'RSVPs closed' });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/open-rsvp - Reopen RSVPs
router.post('/:id/open-rsvp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await prisma.party.update({
      where: { id },
      data: { rsvpClosedAt: null },
    });

    // Trigger webhook for RSVP reopened
    await triggerWebhook('party.rsvp_opened', party, req.userId!);

    res.json({ success: true, message: 'RSVPs reopened' });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/guests - Add guest manually (by host)
router.post('/:id/guests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, email, dietaryRestrictions, likedToppings, dislikedToppings, likedBeverages, dislikedBeverages } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to guests tab
    const canAccessGuests = await canUserAccessTab(id, req.userEmail, req.userId, 'guests');
    if (!canAccessGuests) {
      throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Check if guest with this email already exists for this party
    if (email) {
      const existingGuest = await prisma.guest.findFirst({
        where: { partyId: id, email: email.toLowerCase() },
      });
      if (existingGuest) {
        // Guest already exists, return success without creating duplicate
        res.status(200).json({ guest: existingGuest, alreadyExists: true });
        return;
      }
    }

    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        email: email ? email.toLowerCase() : null,
        dietaryRestrictions: dietaryRestrictions || [],
        likedToppings: likedToppings || [],
        dislikedToppings: dislikedToppings || [],
        likedBeverages: likedBeverages || [],
        dislikedBeverages: dislikedBeverages || [],
        submittedVia: 'host',
        partyId: id,
      },
    });

    // Trigger webhook for guest registration
    await triggerWebhook('guest.registered', { guest, partyId: id }, req.userId!);

    res.status(201).json({ guest });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/guests/:guestId - Remove guest
router.delete('/:partyId/guests/:guestId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to guests tab
    const canAccessGuests = await canUserAccessTab(partyId, req.userEmail, req.userId, 'guests');
    if (!canAccessGuests) {
      throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
    }

    await prisma.guest.delete({
      where: { id: guestId, partyId },
    });

    // Trigger webhook for guest removal
    await triggerWebhook('guest.removed', { guestId, partyId }, req.userId!);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/guests/:guestId/approve - Approve or decline guest
router.patch('/:partyId/guests/:guestId/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;
    const { approved } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to guests tab
    const canAccessGuests = await canUserAccessTab(partyId, req.userEmail, req.userId, 'guests');
    if (!canAccessGuests) {
      throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
    }

    if (typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const guest = await prisma.guest.update({
      where: { id: guestId, partyId },
      data: { approved },
    });

    // Trigger appropriate webhook
    const event = approved ? 'guest.approved' : 'guest.declined';
    await triggerWebhook(event, { guest, partyId }, req.userId!);

    // Send approval email with QR code if guest is approved and has an email
    if (approved && guest.email) {
      try {
        // Get party details for the email
        const party = await prisma.party.findUnique({
          where: { id: partyId },
          select: {
            name: true,
            date: true,
            timezone: true,
            address: true,
            inviteCode: true,
            customUrl: true,
          },
        });

        if (party) {
          await sendApprovalEmail({
            guestEmail: guest.email,
            guestName: guest.name,
            guestId: guest.id,
            partyName: party.name,
            partyDate: party.date,
            partyTimezone: party.timezone,
            partyAddress: party.address,
            inviteCode: party.inviteCode,
            customUrl: party.customUrl,
          });
        }
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
        // Don't fail the approval if email fails
      }
    }

    res.json({ guest });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id/waitlist - Get waitlist for party
router.get('/:id/waitlist', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to guests tab
    const canAccessGuests = await canUserAccessTab(id, req.userEmail, req.userId, 'guests');
    if (!canAccessGuests) {
      throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
    }

    const waitlistedGuests = await prisma.guest.findMany({
      where: {
        partyId: id,
        status: 'WAITLISTED',
      },
      orderBy: { waitlistPosition: 'asc' },
    });

    res.json({ guests: waitlistedGuests });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/guests/:guestId/promote - Promote guest from waitlist
router.post('/:partyId/guests/:guestId/promote', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to guests tab
    const canAccessGuests = await canUserAccessTab(partyId, req.userEmail, req.userId, 'guests');
    if (!canAccessGuests) {
      throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Get the guest
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'NOT_FOUND');
    }

    if (guest.status !== 'WAITLISTED') {
      throw new AppError('Guest is not on the waitlist', 400, 'NOT_WAITLISTED');
    }

    const currentPosition = guest.waitlistPosition;

    // Update guest to CONFIRMED status
    const updatedGuest = await prisma.guest.update({
      where: { id: guestId },
      data: {
        status: 'CONFIRMED',
        waitlistPosition: null,
        promotedAt: new Date(),
      },
    });

    // Reorder remaining waitlist positions
    if (currentPosition !== null) {
      await prisma.guest.updateMany({
        where: {
          partyId,
          status: 'WAITLISTED',
          waitlistPosition: { gt: currentPosition },
        },
        data: {
          waitlistPosition: { decrement: 1 },
        },
      });
    }

    // Trigger webhook for guest promotion
    await triggerWebhook('guest.promoted', { guest: updatedGuest, partyId }, req.userId!);

    // Send promotion email if guest has email
    if (guest.email) {
      try {
        // Get party details for the email
        const party = await prisma.party.findUnique({
          where: { id: partyId },
          select: {
            name: true,
            date: true,
            address: true,
            inviteCode: true,
            customUrl: true,
          },
        });

        if (party) {
          await sendPromotionEmail({
            guestEmail: guest.email,
            guestName: guest.name,
            guestId: guest.id,
            partyName: party.name,
            partyDate: party.date,
            partyAddress: party.address,
            inviteCode: party.inviteCode,
            customUrl: party.customUrl,
          });
        }
      } catch (emailError) {
        console.error('Failed to send promotion email:', emailError);
        // Don't fail the promotion if email fails
      }
    }

    res.json({ guest: updatedGuest });
  } catch (error) {
    next(error);
  }
});

export default router;
