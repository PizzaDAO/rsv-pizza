import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin, isAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { sendApprovalEmail, sendPromotionEmail } from './rsvp.routes.js';
import { triggerWebhook } from '../services/webhook.service.js';
import { canUserEditParty, canUserAccessTab, VALID_TAB_IDS, GPP_GLOBAL_EDITORS } from '../helpers/partyAccess.js';
import { setDeleteContext } from '../helpers/auditContext.js';

// Helper function to get party with ownership check
async function getPartyWithOwnershipCheck(partyId: string, userId?: string, userEmail?: string) {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    include: {
      user: { select: { name: true } },
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

  // Check if user is a GPP global editor
  if (userEmail && (party as any).eventType === 'gpp') {
    if (GPP_GLOBAL_EDITORS.some(e => e.toLowerCase() === userEmail.toLowerCase())) {
      return party;
    }
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

    // 4. GPP global editor parties (if user is a GPP global editor)
    let gppEditorParties: typeof ownedParties = [];
    if (userEmail && GPP_GLOBAL_EDITORS.some(e => e.toLowerCase() === userEmail!.toLowerCase())) {
      gppEditorParties = await prisma.party.findMany({
        where: { eventType: 'gpp' },
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
    for (const p of gppEditorParties) {
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
      name, date, endTime, duration, pizzaStyle, address, placeId, venueName, city, maxGuests,
      availableBeverages, availableToppings, availableDietaryOptions, password, eventImageUrl, description,
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
        availableDietaryOptions: availableDietaryOptions || [],
        address: address || null,
        placeId: placeId || null,
        venueName: venueName || null,
        city: city || null,
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
    // mushroom-48468: User.email is canonical lowercase. Co-host emails come from
    // user-typed JSONB and may be mixed-case — lowercase before query + lookup.
    const rawCoHosts = (party.coHosts as any[] || []);
    const coHostEmails = rawCoHosts.map((h: any) => h.email).filter(Boolean);
    const coHostEmailsLc = coHostEmails.map((e: string) => e.toLowerCase());
    let enrichedCoHosts = rawCoHosts;
    if (coHostEmailsLc.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: coHostEmailsLc } },
        select: { email: true, profilePictureUrl: true, twitter: true, website: true, instagram: true },
      });
      const profilesByEmail = Object.fromEntries(users.map(u => [u.email, u]));
      enrichedCoHosts = rawCoHosts.map((h: any) => {
        const profile = h.email ? profilesByEmail[h.email.toLowerCase()] : null;
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
      name, date, endTime, duration, pizzaStyle, address, latitude, longitude, country, city, placeId, venueName, maxGuests,
      availableBeverages, availableToppings, availableDietaryOptions, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts, selectedPizzerias,
      expectedGuests,
      donationEnabled, donationGoal, donationMessage, suggestedAmounts, donationRecipient,
      donationRecipientUrl, donationEthAddress, shareToUnlock, shareTweetText, fundraisingGoal,
      musicEnabled, musicNotes, photoModeration,
      nftEnabled, nftChain,
      pinnedApps,
      region,
      venueReportTitle, venueReportNotes,
      flyerGeneratedAt, flyerConfig,
      posterImageUrl, posterGeneratedAt,
      rollupImageUrl, rollupGeneratedAt,
      hiddenGppPhotos, extraGppPhotos,
      lumaUrl, meetupUrl, eventbriteUrl, externalLinks,
      quizEnabled,
      telegramGroup,
      hostTelegramLinkToken,
      // NOTE: hostTelegramChatId is intentionally NOT destructured here —
      // the chat_id is webhook-only (set by /api/telegram/webhook when the host
      // sends /start <token> to the bot). Allowing PATCH writes would let a host
      // spoof another user's chat_id.
      turtleRolesEnabled,
      // Day-of logistics (pepperoni-58341)
      wifiInfo,
      parkingNotes,
      reimbursementCapUsd,
      // NOTE: reimbursementCapAppealNote + reimbursementCapAppealedAt are NOT
      // destructured here — appeals flow through the dedicated
      // POST /:partyId/reimbursement-cap/appeal endpoint so we can timestamp
      // the appeal and avoid leaking it through the generic PATCH whitelist.
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
    // Respects client-specified ordering so hosts can reorder protected entries
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
      // Build a map of protected entries by ID for O(1) lookups
      const protectedById = new Map(protectedEntries.map((h: any) => [h.id, h]));
      const usedProtectedIds = new Set<string>();

      const ordered: any[] = [];
      for (const clientEntry of coHosts as any[]) {
        if (protectedById.has(clientEntry.id)) {
          // Client referenced a protected entry — use DB version at this position
          // Protected entries keep all DB values (including showOnEvent)
          const dbEntry = protectedById.get(clientEntry.id)!;
          ordered.push(dbEntry);
          usedProtectedIds.add(clientEntry.id);
        } else {
          // Regular client entry — strip protected flags (anti-spoofing)
          const { isUnderboss: _ub, isPartner: _p, partnerTag: _pt, ...rest } = clientEntry;
          // Validate allowedTabs if present
          if (Array.isArray(rest.allowedTabs)) {
            rest.allowedTabs = rest.allowedTabs.filter(
              (tab: string) => VALID_TAB_IDS.includes(tab as any)
            );
          }
          ordered.push(rest);
        }
      }
      // Append any protected entries not referenced by the client (backward compat)
      for (const entry of protectedEntries) {
        if (!usedProtectedIds.has(entry.id)) {
          ordered.push(entry);
        }
      }
      mergedCoHosts = ordered;
    }

    // reimbursementCapUsd is settable by underbosses + admins only (arugula-38633 v2).
    // Hosts who try to set it via this generic PATCH get silently dropped from
    // the update (rather than 403'd) so the rest of their save still succeeds.
    let reimbursementCapUsdToWrite: number | null | undefined = undefined;
    if (reimbursementCapUsd !== undefined) {
      const allowed = (await isSuperAdmin(req.userEmail))
        || (await isAdmin(req.userEmail))
        || (await isUnderboss(req.userEmail));
      if (allowed) {
        if (reimbursementCapUsd === null || reimbursementCapUsd === '') {
          reimbursementCapUsdToWrite = null;
        } else {
          const n = Number(reimbursementCapUsd);
          if (!Number.isFinite(n) || n < 0 || n > 100000) {
            throw new AppError(
              'reimbursementCapUsd must be a non-negative number ≤ 100000',
              400,
              'VALIDATION_ERROR'
            );
          }
          reimbursementCapUsdToWrite = n;
        }
      }
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
        ...(address !== undefined && { address, addressIsCityDefault: false }),
        ...(latitude !== undefined && { latitude: latitude !== null ? Number(latitude) : null }),
        ...(longitude !== undefined && { longitude: longitude !== null ? Number(longitude) : null }),
        ...(country !== undefined && { country: country || null }),
        ...(city !== undefined && { city: city || null }),
        ...(placeId !== undefined && { placeId: placeId || null }),
        ...(venueName !== undefined && { venueName: venueName || null }),
        ...(maxGuests !== undefined && { maxGuests }),
        ...(expectedGuests !== undefined && { expectedGuests: expectedGuests !== null && expectedGuests !== '' ? Number(expectedGuests) : null }),
        ...(hideGuests !== undefined && { hideGuests }),
        ...(requireApproval !== undefined && { requireApproval }),
        ...(availableBeverages !== undefined && { availableBeverages }),
        ...(availableToppings !== undefined && { availableToppings }),
        ...(availableDietaryOptions !== undefined && { availableDietaryOptions }),
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
        ...(flyerGeneratedAt !== undefined && { flyerGeneratedAt: flyerGeneratedAt ? new Date(flyerGeneratedAt) : null }),
        ...(flyerConfig !== undefined && { flyerConfig }),
        ...(posterImageUrl !== undefined && { posterImageUrl: posterImageUrl || null }),
        ...(posterGeneratedAt !== undefined && { posterGeneratedAt: posterGeneratedAt ? new Date(posterGeneratedAt) : null }),
        ...(rollupImageUrl !== undefined && { rollupImageUrl: rollupImageUrl || null }),
        ...(rollupGeneratedAt !== undefined && { rollupGeneratedAt: rollupGeneratedAt ? new Date(rollupGeneratedAt) : null }),
        ...(hiddenGppPhotos !== undefined && { hiddenGppPhotos }),
        ...(extraGppPhotos !== undefined && { extraGppPhotos }),
        ...(lumaUrl !== undefined && { lumaUrl: lumaUrl || null }),
        ...(meetupUrl !== undefined && { meetupUrl: meetupUrl || null }),
        ...(eventbriteUrl !== undefined && { eventbriteUrl: eventbriteUrl || null }),
        ...(externalLinks !== undefined && { externalLinks }),
        ...(quizEnabled !== undefined && { quizEnabled }),
        ...(telegramGroup !== undefined && { telegramGroup: telegramGroup || null }),
        ...(hostTelegramLinkToken !== undefined && { hostTelegramLinkToken: hostTelegramLinkToken || null }),
        ...(turtleRolesEnabled !== undefined && { turtleRolesEnabled }),
        ...(wifiInfo !== undefined && { wifiInfo: wifiInfo || null }),
        ...(parkingNotes !== undefined && { parkingNotes: parkingNotes || null }),
        ...(reimbursementCapUsdToWrite !== undefined && { reimbursementCapUsd: reimbursementCapUsdToWrite }),
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

    await prisma.$transaction(async (tx) => {
      await setDeleteContext(tx, req.userEmail, 'host_dashboard');
      await tx.party.delete({ where: { id } });
    });

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

// POST /api/parties/:partyId/reimbursement-cap/appeal - Host appeal of the
// reimbursement cap (arugula-38633 v2).
//
// Intentionally lives in party.routes.ts (NOT payout.routes.ts) so the
// payouts soft-launch gate does not block hosts — even hosts who can't yet
// submit a payout may want to register that they think their cap is too low.
router.post('/:partyId/reimbursement-cap/appeal', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { note } = req.body || {};

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (typeof note !== 'string' || note.trim().length === 0) {
      throw new AppError('Appeal note is required', 400, 'VALIDATION_ERROR');
    }
    const trimmed = note.trim();
    if (trimmed.length > 2000) {
      throw new AppError('Appeal note must be 2000 characters or fewer', 400, 'VALIDATION_ERROR');
    }

    const now = new Date();
    const updated = await prisma.party.update({
      where: { id: partyId },
      data: {
        reimbursementCapAppealNote: trimmed,
        reimbursementCapAppealedAt: now,
      },
      select: {
        id: true,
        reimbursementCapUsd: true,
        reimbursementCapAppealNote: true,
        reimbursementCapAppealedAt: true,
      },
    });

    res.json({
      partyId: updated.id,
      reimbursementCapUsd: updated.reimbursementCapUsd != null ? Number(updated.reimbursementCapUsd) : null,
      reimbursementCapAppealNote: updated.reimbursementCapAppealNote,
      reimbursementCapAppealedAt: updated.reimbursementCapAppealedAt ? updated.reimbursementCapAppealedAt.toISOString() : null,
    });
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

    await prisma.$transaction(async (tx) => {
      await setDeleteContext(tx, req.userEmail, 'host_dashboard');
      await tx.guest.delete({
        where: { id: guestId, partyId },
      });
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

    if (approved !== null && typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean or null', 400, 'VALIDATION_ERROR');
    }

    // Only reconcile status when row is PENDING — avoid clobbering WAITLISTED.
    // When approved===null (restore-to-pending), leave status alone.
    const existing = await prisma.guest.findUnique({
      where: { id: guestId, partyId },
      select: { status: true },
    });
    const updateData: { approved: boolean | null; status?: 'CONFIRMED' | 'DECLINED' } = { approved };
    if (existing?.status === 'PENDING' && approved !== null) {
      updateData.status = approved ? 'CONFIRMED' : 'DECLINED';
    }

    const guest = await prisma.guest.update({
      where: { id: guestId, partyId },
      data: updateData,
    });

    // Trigger appropriate webhook. Skip when approved===null (restore-to-pending
    // is neither an approval nor a decline).
    if (approved !== null) {
      const event = approved ? 'guest.approved' : 'guest.declined';
      await triggerWebhook(event, { guest, partyId }, req.userId!);
    }

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
            eventImageUrl: true,
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
            partyImageUrl: party.eventImageUrl,
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
            timezone: true,
            address: true,
            inviteCode: true,
            customUrl: true,
            eventImageUrl: true,
          },
        });

        if (party) {
          await sendPromotionEmail({
            guestEmail: guest.email,
            guestName: guest.name,
            guestId: guest.id,
            partyName: party.name,
            partyDate: party.date,
            partyTimezone: party.timezone,
            partyAddress: party.address,
            partyImageUrl: party.eventImageUrl,
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

// =============================================================================
// pepperoni-58341: Day-of event app endpoints
// =============================================================================

// POST /api/parties/:partyId/guests/walk-in
// Day-of walk-in capture from the day-of dashboard. Creates a guest in
// confirmed+approved+checked-in state in a single round-trip.
router.post('/:partyId/guests/walk-in', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, email } = req.body;

    // Per-route auth — NEVER router.use(gate) at a path-less mount: it would
    // leak to sibling routers mounted at /api/parties (arugula-38633 v2 bug).
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const canAccessDayOf = await canUserAccessTab(partyId, req.userEmail, req.userId, 'day-of');
    if (!canAccessDayOf) {
      throw new AppError('You do not have access to the day-of tab', 403, 'TAB_ACCESS_DENIED');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email && typeof email === 'string' ? email.toLowerCase().trim() : null;

    // If a guest with this email already exists for this party, check them in
    // rather than creating a duplicate (host clicked walk-in for someone who
    // already RSVP'd online).
    if (normalizedEmail) {
      const existing = await prisma.guest.findFirst({
        where: { partyId, email: normalizedEmail },
      });
      if (existing) {
        const updated = await prisma.guest.update({
          where: { id: existing.id },
          data: {
            status: 'CONFIRMED',
            approved: true,
            checkedInAt: existing.checkedInAt || new Date(),
            checkedInBy: req.userId,
          },
        });
        return res.status(200).json({ guest: updated, alreadyExisted: true });
      }
    }

    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        submittedVia: 'host-checkin',
        status: 'CONFIRMED',
        approved: true,
        checkedInAt: new Date(),
        checkedInBy: req.userId,
        partyId,
      },
    });

    await triggerWebhook('guest.registered', { guest, partyId }, req.userId!);

    res.status(201).json({ guest });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/announce
// Day-of broadcast: sends a host-authored message via Telegram (to host's
// connected chat) and/or individual emails to confirmed guests. Persists an
// audit row to `announcements`.
router.post('/:partyId/announce', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { subject, body, channels } = req.body || {};

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const canAccessDayOf = await canUserAccessTab(partyId, req.userEmail, req.userId, 'day-of');
    if (!canAccessDayOf) {
      throw new AppError('You do not have access to the day-of tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Validate body
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      throw new AppError('body is required', 400, 'VALIDATION_ERROR');
    }
    if (body.length > 4096) {
      throw new AppError('body must be 4096 characters or less', 400, 'VALIDATION_ERROR');
    }

    // Validate channels
    if (!Array.isArray(channels) || channels.length === 0) {
      throw new AppError('channels must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    const VALID_CHANNELS = new Set(['telegram', 'email']);
    const filteredChannels = (channels as unknown[]).filter(
      (c): c is string => typeof c === 'string' && VALID_CHANNELS.has(c)
    );
    if (filteredChannels.length === 0) {
      throw new AppError('channels must include "telegram" or "email"', 400, 'VALIDATION_ERROR');
    }

    const emailRequested = filteredChannels.includes('email');
    const telegramRequested = filteredChannels.includes('telegram');

    // Subject required when emailing
    if (emailRequested && (!subject || typeof subject !== 'string' || subject.trim().length === 0)) {
      throw new AppError('subject is required when email channel is selected', 400, 'VALIDATION_ERROR');
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        id: true,
        name: true,
        inviteCode: true,
        customUrl: true,
        hostTelegramChatId: true,
      },
    });
    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // -----------------------------------------------------------------------
    // Telegram delivery — sends to host's connected chat (hostTelegramChatId).
    // The schema has no group chat_id for parties; `telegramGroup` is a URL
    // string only. If the host hasn't connected Telegram, skip silently.
    // -----------------------------------------------------------------------
    let telegramSent = false;
    if (telegramRequested && party.hostTelegramChatId) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        try {
          const message = subject ? `*${subject}*\n\n${body}` : body;
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: party.hostTelegramChatId.toString(),
              text: message,
              parse_mode: 'Markdown',
            }),
          });
          const tgJson = await tgRes.json();
          telegramSent = !!tgJson.ok;
        } catch (err) {
          console.error('[Day-of announce] Telegram send failed:', err);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Email delivery — individual sends (no BCC) to confirmed guests with an
    // email on file. We don't fail the request if a single send errors; the
    // recipient_count reflects successful sends.
    // -----------------------------------------------------------------------
    let emailSentCount = 0;
    let recipientCount = 0;
    if (emailRequested) {
      const recipients = await prisma.guest.findMany({
        where: {
          partyId,
          status: 'CONFIRMED',
          email: { not: null },
        },
        select: { id: true, name: true, email: true },
      });
      recipientCount = recipients.length;

      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.warn('[Day-of announce] RESEND_API_KEY not set, skipping email sends');
      } else {
        const baseUrl = 'https://rsv.pizza';
        const eventUrl = party.customUrl
          ? `${baseUrl}/${party.customUrl}`
          : `${baseUrl}/${party.inviteCode}`;

        // Build HTML once (per-recipient personalization only swaps the greeting)
        const escapedBody = body
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br />');

        for (const recipient of recipients) {
          if (!recipient.email) continue;
          const html = `
            <!DOCTYPE html>
            <html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px 20px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
                <h1 style="color: #ffffff; font-size: 24px; margin: 0;">${party.name.replace(/</g, '&lt;')}</h1>
                <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 8px 0 0 0;">A message from your host</p>
              </div>
              <div style="background: #f9f9f9; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #666;">Hi ${(recipient.name || 'there').replace(/</g, '&lt;')},</p>
                <div style="font-size: 16px;">${escapedBody}</div>
              </div>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600;">View Event Page</a>
              </div>
            </body></html>
          `;
          try {
            const r = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'RSV.Pizza <noreply@rsv.pizza>',
                to: [recipient.email],
                subject: subject || `Update from ${party.name}`,
                html,
              }),
            });
            if (r.ok) emailSentCount += 1;
          } catch (err) {
            console.error(`[Day-of announce] Resend send failed for guest ${recipient.id}:`, err);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Persist audit row
    // -----------------------------------------------------------------------
    const announcement = await prisma.announcement.create({
      data: {
        partyId,
        sentBy: req.userEmail || req.userId || 'unknown',
        channels: filteredChannels,
        subject: subject || null,
        body,
        recipientCount: emailRequested ? recipientCount : null,
      },
    });

    res.status(201).json({
      announcementId: announcement.id,
      recipientCount,
      channelsSent: {
        telegram: telegramSent,
        email: emailSentCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/announcements — last 10 sent announcements
router.get('/:partyId/announcements', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const canAccessDayOf = await canUserAccessTab(partyId, req.userEmail, req.userId, 'day-of');
    if (!canAccessDayOf) {
      throw new AppError('You do not have access to the day-of tab', 403, 'TAB_ACCESS_DENIED');
    }

    const rows = await prisma.announcement.findMany({
      where: { partyId },
      orderBy: { sentAt: 'desc' },
      take: 10,
    });

    res.json({ announcements: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
