import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin, isAdmin, isUnderboss, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { sendApprovalEmail, sendPromotionEmail } from './rsvp.routes.js';
import { triggerWebhook } from '../services/webhook.service.js';
import { canUserEditParty, canUserAccessTab, VALID_TAB_IDS, GPP_GLOBAL_EDITORS } from '../helpers/partyAccess.js';
import { getUnderbossScope, partyMatchesScope } from '../helpers/underbossScope.js';
import { setDeleteContext } from '../helpers/auditContext.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import {
  capValuesDiffer,
  recordCapChange,
  resolveCapActorKind,
} from '../helpers/reimbursementCapAudit.js';
import { autoPopulatePizzerias } from '../lib/autoPopulatePizzerias.js';

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
      // porchetta-81402: surface cancellation state so HomePage can render
      // the "Cancelled" pill on cancelled events.
      cancelledAt: true,
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
      // porchetta-81402: HomePage renders a "Cancelled" pill from this field.
      cancelledAt: p.cancelledAt ? p.cancelledAt.toISOString() : null,
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
      name, date, endTime, duration, pizzaStyle, address, latitude, longitude, country, placeId, venueName, city, maxGuests,
      availableBeverages, availableToppings, availableDietaryOptions, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts,
      donationEnabled, donationGoal, donationMessage, suggestedAmounts, donationRecipient,
      donationRecipientUrl, donationEthAddress, showToppingsOnRsvp
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
        latitude: latitude !== null && latitude !== undefined ? Number(latitude) : null,
        longitude: longitude !== null && longitude !== undefined ? Number(longitude) : null,
        country: country || null,
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
        showToppingsOnRsvp: showToppingsOnRsvp || false,
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

    // prosciutto-58472: fire-and-forget auto-populate of selected_pizzerias.
    // Helper is idempotent + race-safe + never throws; we still wrap in .catch()
    // as a paranoid second line of defense so a rejected Promise can't crash the
    // process via unhandled rejection.
    void autoPopulatePizzerias({
      partyId: party.id,
      lat: party.latitude,
      lng: party.longitude,
      address: party.address,
    }).catch(err => console.warn('[autoPopulatePizzerias create]', err));

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
        // arugula-38633 v2 follow-up: numeric-tag fallback for the cap.
        effectiveReimbursementCapUsd: computeEffectiveCapUsd({
          reimbursementCapUsd: (party as any).reimbursementCapUsd,
          eventTags: (party as any).eventTags,
        }),
        // porchetta-81402: `findUnique` without `select` already returns the
        // 3 cancel columns, so we don't need to splice them in here — the
        // spread above carries them through. Listed for documentation.
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
      availableBeverages, availableToppings, availableDietaryOptions, showToppingsOnRsvp, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts, selectedPizzerias,
      expectedGuests,
      eventTags,
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
      // quattro-71244: gamified dashboard goals (JSONB) — per-KPI host targets.
      hostGoals,
      // porchetta-81402: host can edit the free-text cancellation reason
      // without re-cancelling. Cancel/reinstate themselves go through their
      // dedicated POST endpoints — NOT through this PATCH whitelist.
      cancellationReason,
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

    // arugula-38633: 'go' tag is the explicit "open Payments to this host"
    // signal. Adding or removing it is restricted to payment_admin / admin /
    // super_admin — hosts and underbosses cannot toggle it via PATCH.
    // isPaymentAdmin() returns true for all three of those roles.
    if (Array.isArray(eventTags)) {
      const existing = await prisma.party.findUnique({
        where: { id },
        select: { eventTags: true },
      });
      const currentTags = existing?.eventTags || [];
      const hadGo = currentTags.includes('go');
      const wantsGo = eventTags.includes('go');
      if (hadGo !== wantsGo) {
        const canToggleGo = await isPaymentAdmin(req.userEmail);
        if (!canToggleGo) {
          throw new AppError(
            "Only admins and payment admins can add or remove the 'go' tag.",
            403,
            'FORBIDDEN_TAG',
          );
        }
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

    // fennel-49102: snapshot the prior cap value so we can log only real
    // changes to reimbursement_cap_audit. Skipped when the request doesn't
    // touch the cap (either field omitted or caller wasn't authorized to
    // write it) so non-cap PATCHes pay no extra round trip.
    let priorCapUsd: any = undefined;
    if (reimbursementCapUsdToWrite !== undefined) {
      const prior = await prisma.party.findUnique({
        where: { id },
        select: { reimbursementCapUsd: true },
      });
      priorCapUsd = prior?.reimbursementCapUsd ?? null;
    }

    // quattro-71244: validate hostGoals — keep only known-numeric values, clamp
    // negatives to 0 and cap each at 1,000,000. Drop non-numeric / non-finite
    // entries silently. Persist `null` if the caller explicitly clears all goals.
    let hostGoalsToWrite: any | undefined = undefined;
    if (hostGoals !== undefined) {
      if (hostGoals === null) {
        hostGoalsToWrite = null;
      } else if (typeof hostGoals === 'object' && !Array.isArray(hostGoals)) {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(hostGoals)) {
          const n = typeof v === 'string' ? Number(v) : (v as any);
          if (typeof n === 'number' && Number.isFinite(n)) {
            const clamped = Math.min(1_000_000, Math.max(0, Math.floor(n)));
            cleaned[k] = clamped;
          }
        }
        hostGoalsToWrite = Object.keys(cleaned).length > 0 ? cleaned : null;
      } else {
        // Wrong type — treat as a clear (null) rather than 400, matches the
        // permissive handling other JSONB columns get on this endpoint.
        hostGoalsToWrite = null;
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
        ...(Array.isArray(eventTags) && { eventTags }),
        ...(hideGuests !== undefined && { hideGuests }),
        ...(requireApproval !== undefined && { requireApproval }),
        ...(availableBeverages !== undefined && { availableBeverages }),
        ...(availableToppings !== undefined && { availableToppings }),
        ...(availableDietaryOptions !== undefined && { availableDietaryOptions }),
        ...(showToppingsOnRsvp !== undefined && { showToppingsOnRsvp }),
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
        ...(hostGoalsToWrite !== undefined && { hostGoals: hostGoalsToWrite }),
        // porchetta-81402: allow editing the cancellation reason (truncated to
        // 500 chars to match the cancel-handler limit). Empty string clears it.
        ...(cancellationReason !== undefined && {
          cancellationReason:
            typeof cancellationReason === 'string' && cancellationReason.trim()
              ? cancellationReason.trim().slice(0, 500)
              : null,
        }),
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // fennel-49102: log cap changes to reimbursement_cap_audit so admins
    // can answer "who set this party's $X cap?". Idempotent edits (same
    // value as already on record) are skipped so we don't fill the table
    // with noise.
    if (
      reimbursementCapUsdToWrite !== undefined &&
      capValuesDiffer(priorCapUsd, reimbursementCapUsdToWrite)
    ) {
      const actorKind = await resolveCapActorKind(req.userEmail);
      await recordCapChange({
        partyId: id,
        oldCapUsd: priorCapUsd,
        newCapUsd: reimbursementCapUsdToWrite,
        actorEmail: req.userEmail || 'unknown',
        actorKind,
        note: 'PATCH /api/parties/:id',
      });
    }

    // Trigger webhook for party update
    await triggerWebhook('party.updated', party, req.userId!);

    // prosciutto-58472: fire-and-forget auto-populate of selected_pizzerias
    // when the host changed the address AND hasn't preselected pizzerias
    // AND isn't manually setting them in this PATCH. Helper is idempotent +
    // race-safe + never throws, but we still wrap in .catch() for unhandled
    // rejection safety.
    const currentSelected = (party as any).selectedPizzerias;
    const shouldAutoPopulate =
      address !== undefined &&
      address !== null &&
      (!currentSelected ||
        (Array.isArray(currentSelected) && currentSelected.length === 0)) &&
      req.body.selectedPizzerias === undefined;

    if (shouldAutoPopulate) {
      void autoPopulatePizzerias({
        partyId: party.id,
        lat: party.latitude,
        lng: party.longitude,
        address: party.address,
      }).catch(err => console.warn('[autoPopulatePizzerias update]', err));
    }

    // Return with hostName for backwards compatibility
    res.json({
      party: {
        ...party,
        hostName: (party as any).eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null),
        user: undefined,
        // arugula-38633 v2 follow-up: numeric-tag fallback for the cap.
        effectiveReimbursementCapUsd: computeEffectiveCapUsd({
          reimbursementCapUsd: (party as any).reimbursementCapUsd,
          eventTags: (party as any).eventTags,
        }),
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// porchetta-81402: Cancel / reinstate endpoints
// ============================================
// `DELETE /api/parties/:id` used to hard-delete the party row, which
// destroyed the public URL, every guest RSVP, sponsors, donations,
// photos, and so on. The new flow soft-cancels by writing
// `cancelled_at` / `cancelled_by` / `cancellation_reason` — the row
// and its children stay intact, the public URL stays live (showing a
// "this event has been cancelled" banner), and a host can reinstate
// with one click. The DELETE route is preserved as a back-compat
// alias that routes to the same soft-cancel handler.
//
// Audit: when the `party_status_audit` table exists in the DB we
// also record cancel/reinstate transitions. The table was introduced
// by pizzaiolo-97053 (2026-05-15); the existence check keeps the new
// handlers running in environments where that migration hasn't been
// applied yet.

async function softCancelParty(
  partyId: string,
  userEmail: string | undefined,
  reason: string | null,
) {
  return prisma.party.update({
    where: { id: partyId },
    data: {
      cancelledAt: new Date(),
      cancelledBy: userEmail || 'unknown',
      cancellationReason:
        reason && reason.trim() ? reason.trim().slice(0, 500) : null,
    },
  });
}

async function recordPartyStatusAuditIfTableExists(args: {
  partyId: string;
  action: 'cancel' | 'reinstate';
  oldStatus: string | null;
  newStatus: string;
  actorEmail: string;
  reason?: string | null;
}) {
  try {
    const result = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('party_status_audit') IS NOT NULL AS exists
    `;
    if (!result[0]?.exists) return;
    // Column shape mirrors the PartyStatusAudit Prisma model from
    // pizzaiolo-97053 (action / old_status / new_status / actor_email /
    // actor_kind / reason). We log actor_kind='host' because the cancel/
    // reinstate routes are auth-gated to host + cohost-with-canEdit only;
    // super_admins reach this path too but logging them as 'host' is the
    // same convention used by the other party.routes audit writes.
    await prisma.$executeRaw`
      INSERT INTO party_status_audit
        (party_id, action, old_status, new_status, actor_email, actor_kind, reason)
      VALUES
        (${args.partyId}::uuid, ${args.action}, ${args.oldStatus}, ${args.newStatus},
         ${args.actorEmail}, 'host', ${args.reason ?? null})
    `;
  } catch (err) {
    // Audit is best-effort — never let a logging failure roll back the
    // user-visible cancel/reinstate.
    console.warn('[porchetta-81402] party_status_audit insert failed:', err);
  }
}

// POST /api/parties/:id/cancel - Soft-cancel the event
router.post('/:id/cancel', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const reason: string | null = (req.body || {}).reason ?? null;
    const party = await softCancelParty(id, req.userEmail, reason);

    await recordPartyStatusAuditIfTableExists({
      partyId: id,
      action: 'cancel',
      oldStatus: 'active',
      newStatus: 'cancelled',
      actorEmail: req.userEmail || 'unknown',
      reason: party.cancellationReason,
    });

    // New event for new consumers + legacy `party.deleted` for back-compat.
    await triggerWebhook('party.cancelled', party, req.userId!);
    await triggerWebhook('party.deleted', { id }, req.userId!);

    res.json({ success: true, party });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/reinstate - Un-cancel the event
router.post('/:id/reinstate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // NOTE: reinstating intentionally does NOT touch rsvp_closed_at — if
    // the host had closed RSVPs separately, they stay closed.
    const party = await prisma.party.update({
      where: { id },
      data: {
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
      },
    });

    await recordPartyStatusAuditIfTableExists({
      partyId: id,
      action: 'reinstate',
      oldStatus: 'cancelled',
      newStatus: 'active',
      actorEmail: req.userEmail || 'unknown',
    });

    await triggerWebhook('party.reinstated', party, req.userId!);

    res.json({ success: true, party });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:id - LEGACY ALIAS that now soft-cancels instead of
// destroying the row. Old API clients (and the frontend `deletePartyApi`
// helper before this PR) hit this path; new code should use POST /cancel
// with an optional reason in the body. There is no reason here because
// DELETE bodies are not part of the existing API contract.
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await softCancelParty(id, req.userEmail, null);

    await recordPartyStatusAuditIfTableExists({
      partyId: id,
      action: 'cancel',
      oldStatus: 'active',
      newStatus: 'cancelled',
      actorEmail: req.userEmail || 'unknown',
    });

    await triggerWebhook('party.cancelled', party, req.userId!);
    await triggerWebhook('party.deleted', { id }, req.userId!);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/cohosts/full - Get unsanitized co_hosts JSONB
//
// gorgonzola-31204: Frontend Supabase reads strip `email` from co_hosts (PII).
// HostsManager needs the unsanitized array so its edit modal preloads each
// cohost's email and saves don't silently wipe the field — losing the email
// breaks `check-host` matching and hides the Host Dashboard button on the
// public EventPage for that cohost.
//
// Auth-gated by canUserEditParty (same gate as PATCH /api/parties/:id), so
// only users who can already edit the party can read cohost emails.
router.get('/:partyId/cohosts/full', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { coHosts: true },
    });

    if (!party) {
      return res.status(404).json({ error: 'party not found' });
    }

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      return res.status(403).json({ error: 'not authorized' });
    }

    return res.json({ coHosts: party.coHosts ?? [] });
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

    // porchetta-81402: a cancelled event must be reinstated before its RSVP
    // toggle can be reopened — otherwise the host could "open" RSVPs that
    // would then 410 on submit, which is confusing UX.
    const current = await prisma.party.findUnique({
      where: { id },
      select: { cancelledAt: true },
    });
    if (current?.cancelledAt) {
      throw new AppError(
        'This event has been cancelled. Reinstate it before reopening RSVPs.',
        410,
        'EVENT_CANCELLED',
      );
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

    // quattro-12847: also insert a row into the appeal-history table so
    // underbosses can mark each appeal reviewed and view past appeals.
    // The denormalized columns above are kept as a backwards-compat cache.
    if (req.userId) {
      await prisma.reimbursementCapAppeal.create({
        data: {
          partyId,
          hostUserId: req.userId,
          note: trimmed,
        },
      });
    }

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

// POST /api/parties/:partyId/reimbursement-cap/appeals/review (quattro-12847)
// Mark the latest unreviewed appeal as reviewed. Admin OR underboss-in-scope only.
router.post('/:partyId/reimbursement-cap/appeals/review', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { reviewedNote } = req.body ?? {};

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, region: true, name: true, city: true, eventType: true },
    });
    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Authz: admin OR underboss whose scope includes this party.
    let allowed = false;
    if (await isAdmin(req.userEmail)) {
      allowed = true;
    } else if (await isUnderboss(req.userEmail)) {
      const scope = await getUnderbossScope(req.userEmail);
      if (partyMatchesScope(party, scope)) {
        allowed = true;
      }
    }
    if (!allowed) {
      throw new AppError('Only an underboss or admin can review cap appeals', 403, 'FORBIDDEN');
    }

    const open = await prisma.reimbursementCapAppeal.findFirst({
      where: { partyId, reviewedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!open) {
      throw new AppError('No open appeal to review', 404, 'NO_OPEN_APPEAL');
    }
    const updated = await prisma.reimbursementCapAppeal.update({
      where: { id: open.id },
      data: {
        reviewedAt: new Date(),
        reviewedByUserId: req.userId ?? null,
        reviewedNote: typeof reviewedNote === 'string' && reviewedNote.trim() ? reviewedNote.trim() : null,
      },
    });
    res.json({
      id: updated.id,
      partyId: updated.partyId,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      reviewedByUserId: updated.reviewedByUserId,
      reviewedNote: updated.reviewedNote,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/reimbursement-cap/appeals (quattro-12847)
// Return the full appeal history (newest first). Admin OR underboss-in-scope
// OR the party host themselves may view.
router.get('/:partyId/reimbursement-cap/appeals', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, region: true, name: true, city: true, eventType: true, userId: true },
    });
    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    let allowed = false;
    if (party.userId && party.userId === req.userId) {
      allowed = true;
    } else if (await isAdmin(req.userEmail)) {
      allowed = true;
    } else if (await isUnderboss(req.userEmail)) {
      const scope = await getUnderbossScope(req.userEmail);
      if (partyMatchesScope(party, scope)) {
        allowed = true;
      }
    } else {
      // Co-host with edit permission can also view (delegated host).
      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (canEdit) allowed = true;
    }
    if (!allowed) {
      throw new AppError('Not authorized to view appeal history', 403, 'FORBIDDEN');
    }

    const appeals = await prisma.reimbursementCapAppeal.findMany({
      where: { partyId },
      orderBy: { createdAt: 'desc' },
      include: {
        host: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({
      appeals: appeals.map((a) => ({
        id: a.id,
        partyId: a.partyId,
        hostUserId: a.hostUserId,
        hostName: a.host?.name ?? null,
        hostEmail: a.host?.email ?? '',
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
        reviewedByUserId: a.reviewedByUserId,
        reviewedByName: a.reviewedBy?.name ?? null,
        reviewedByEmail: a.reviewedBy?.email ?? null,
        reviewedNote: a.reviewedNote,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/reimbursement-cap/audit (fennel-49102)
// Per-row history of cap changes — newest first, capped at 50 rows.
// Authz mirrors the /reimbursement-cap/appeals endpoint above:
// admin OR underboss-in-scope OR the party host (or an edit-permission
// co-host).
router.get('/:partyId/reimbursement-cap/audit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, region: true, name: true, city: true, eventType: true, userId: true },
    });
    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    let allowed = false;
    if (party.userId && party.userId === req.userId) {
      allowed = true;
    } else if (await isAdmin(req.userEmail)) {
      allowed = true;
    } else if (await isUnderboss(req.userEmail)) {
      const scope = await getUnderbossScope(req.userEmail);
      if (partyMatchesScope(party, scope)) {
        allowed = true;
      }
    } else {
      // Co-host with edit permission can also view (delegated host).
      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (canEdit) allowed = true;
    }
    if (!allowed) {
      throw new AppError('Not authorized to view cap audit history', 403, 'FORBIDDEN');
    }

    const rows = await prisma.reimbursementCapAudit.findMany({
      where: { partyId },
      orderBy: { setAt: 'desc' },
      take: 50,
    });

    res.json({
      audits: rows.map((r) => ({
        id: r.id,
        partyId: r.partyId,
        oldCapUsd: r.oldCapUsd != null ? Number(r.oldCapUsd) : null,
        newCapUsd: r.newCapUsd != null ? Number(r.newCapUsd) : null,
        actorEmail: r.actorEmail,
        actorKind: r.actorKind,
        setAt: r.setAt.toISOString(),
        note: r.note,
      })),
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

    // porchetta-81402: block host-side adds on cancelled events. Hosts must
    // reinstate first before they can keep adding guests.
    const partyState = await prisma.party.findUnique({
      where: { id },
      select: { cancelledAt: true },
    });
    if (partyState?.cancelledAt) {
      throw new AppError('This event has been cancelled', 410, 'EVENT_CANCELLED');
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

// POST /api/parties/:id/guests/import - Bulk-import guest lists exported from
// Luma / Meetup / Eventbrite / Generic CSV. See plans/calzone-83291-guest-list-import.md.
//
// submittedVia is set to `import-${sourcePlatform}` (e.g. 'import-luma') so
// fake-detection / partner scoring can distinguish imported rows from real
// RSVPs. Inserts run in chunks of 50 rows with a 100ms gap to bound the
// supabase_realtime fan-out burst.
const IMPORT_SOURCE_ALLOWLIST = ['luma', 'meetup', 'eventbrite', 'csv'] as const;
type ImportSource = typeof IMPORT_SOURCE_ALLOWLIST[number];
const IMPORT_HARD_CAP = 2000;
const IMPORT_CHUNK_SIZE = 50;
const IMPORT_CHUNK_GAP_MS = 100;
const IMPORT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/:id/guests/import', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to the guests tab
    const canAccessGuests = await canUserAccessTab(id, req.userEmail, req.userId, 'guests');
    if (!canAccessGuests) {
      throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
    }

    const { guests, sourcePlatform } = req.body as {
      guests?: Array<{
        name?: string;
        email?: string | null;
        status?: 'CONFIRMED' | 'INVITED' | 'WAITLISTED' | 'CHECKED_IN';
        approved?: boolean | null;
      }>;
      sourcePlatform?: string;
    };

    if (!sourcePlatform || !IMPORT_SOURCE_ALLOWLIST.includes(sourcePlatform as ImportSource)) {
      throw new AppError(
        `sourcePlatform must be one of: ${IMPORT_SOURCE_ALLOWLIST.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!Array.isArray(guests) || guests.length === 0) {
      throw new AppError('guests must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (guests.length > IMPORT_HARD_CAP) {
      throw new AppError(
        `Max ${IMPORT_HARD_CAP} guests per import; split the file into multiple uploads`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const submittedVia = `import-${sourcePlatform}`;

    // Prefetch existing emails on the party for dedup (case-insensitive)
    const existing = await prisma.guest.findMany({
      where: { partyId: id },
      select: { email: true },
    });
    const existingEmails = new Set(
      existing
        .map((g) => (g.email ? g.email.toLowerCase() : null))
        .filter((e): e is string => !!e)
    );

    const skipped: Array<{ email: string; reason: string }> = [];
    const errors: Array<{ index: number; reason: string }> = [];
    const toInsert: Array<{
      name: string;
      email: string | null;
      status: 'CONFIRMED' | 'INVITED' | 'WAITLISTED' | 'CHECKED_IN';
      approved: boolean | null;
      checkedInAt: Date | null;
      checkedInBy: string | null;
    }> = [];

    guests.forEach((row, idx) => {
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) {
        errors.push({ index: idx, reason: 'missing name' });
        return;
      }
      const rawEmail = typeof row.email === 'string' ? row.email.trim() : '';
      const normalizedEmail = rawEmail ? rawEmail.toLowerCase() : '';
      if (rawEmail && !IMPORT_EMAIL_REGEX.test(rawEmail)) {
        errors.push({ index: idx, reason: 'invalid email' });
        return;
      }
      if (normalizedEmail) {
        if (existingEmails.has(normalizedEmail)) {
          skipped.push({ email: rawEmail, reason: 'duplicate' });
          return;
        }
        existingEmails.add(normalizedEmail); // dedup within this batch too
      }

      const incomingStatus = row.status;
      const status: 'CONFIRMED' | 'INVITED' | 'WAITLISTED' | 'CHECKED_IN' =
        incomingStatus === 'WAITLISTED' ||
        incomingStatus === 'INVITED' ||
        incomingStatus === 'CHECKED_IN'
          ? incomingStatus
          : 'CONFIRMED';

      const approved =
        row.approved !== undefined
          ? row.approved
          : status === 'INVITED' || status === 'WAITLISTED'
            ? null
            : true;

      const isCheckedIn = status === 'CHECKED_IN';

      toInsert.push({
        name,
        email: normalizedEmail || null,
        status,
        approved,
        checkedInAt: isCheckedIn ? new Date() : null,
        checkedInBy: isCheckedIn ? (req.userEmail ?? null) : null,
      });
    });

    const createdGuestIds: string[] = [];

    // Insert in chunks of IMPORT_CHUNK_SIZE rows with a small gap between chunks
    // to bound the supabase_realtime WAL fan-out burst.
    for (let i = 0; i < toInsert.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + IMPORT_CHUNK_SIZE);
      const ops = chunk.map((g) =>
        prisma.guest.create({
          data: {
            name: g.name,
            email: g.email,
            dietaryRestrictions: [],
            likedToppings: [],
            dislikedToppings: [],
            likedBeverages: [],
            dislikedBeverages: [],
            submittedVia,
            partyId: id,
            status: g.status,
            approved: g.approved,
            checkedInAt: g.checkedInAt,
            checkedInBy: g.checkedInBy,
          },
        })
      );
      const created = await prisma.$transaction(ops);
      created.forEach((g) => createdGuestIds.push(g.id));
      if (i + IMPORT_CHUNK_SIZE < toInsert.length) {
        await new Promise((r) => setTimeout(r, IMPORT_CHUNK_GAP_MS));
      }
    }

    // Single webhook per import (not per row).
    await triggerWebhook(
      'guest.imported',
      { partyId: id, count: createdGuestIds.length, source: sourcePlatform },
      req.userId!
    );

    res.status(200).json({
      inserted: createdGuestIds.length,
      skipped,
      errors,
      createdGuestIds,
    });
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
            venueName: true,
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
            venueName: party.venueName,
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

// GET /api/parties/:partyId/broadcast-urls
// parmigiano-58729: approval-gated Day-Of broadcast URLs. Replaces the
// client-side ZOOM_URL / STREAMYARD_URL constants in lib/dayOfConfig.ts so
// the URLs never ship in the JS bundle for non-eligible viewers.
//
// Env vars (set on backend Vercel project):
//   BROADCAST_ZOOM_URL       - global GPP Zoom meeting link (set when known)
//   BROADCAST_STREAMYARD_URL - global GPP StreamYard studio link (set when known)
// While unset, returns null URLs and the card shows "Coming soon".
router.get('/:partyId/broadcast-urls', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, underbossStatus: true, eventType: true, userId: true },
    });
    if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) throw new AppError('Forbidden', 403, 'FORBIDDEN');

    if (party.eventType !== 'gpp' || party.underbossStatus !== 'approved') {
      return res.json({ zoomUrl: null, streamyardUrl: null, eligible: false });
    }

    return res.json({
      zoomUrl: process.env.BROADCAST_ZOOM_URL || null,
      streamyardUrl: process.env.BROADCAST_STREAMYARD_URL || null,
      eligible: true,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// bufala-83291: per-event payment opt-in
// ============================================
// User-level payout prefs (`users.preferred_payout_method`) describe HOW to
// pay a host across all of their events. The /payments prepay queue also
// requires WHETHER the host has explicitly opted in for a specific event,
// which is what these endpoints toggle.
//
// All three are gated by `canUserEditParty` (host or cohost), so each cohost
// can only opt themselves in / out, not other cohosts.

// GET /api/parties/:partyId/payment-opt-in — current user's opt-in state
router.get('/:partyId/payment-opt-in', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const row = await prisma.partyPaymentOptIn.findUnique({
      where: { partyId_userId: { partyId, userId } },
      select: { optedInAt: true },
    });

    res.json({
      optedIn: !!row,
      optedInAt: row?.optedInAt?.toISOString() ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/payment-opt-in — upsert opt-in for current user
router.post('/:partyId/payment-opt-in', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) throw new AppError('Party not found', 404, 'NOT_FOUND');

    // Upsert: refresh optedInAt on re-submit so the host's most recent
    // "Submit" click is reflected even if a row already existed.
    const row = await prisma.partyPaymentOptIn.upsert({
      where: { partyId_userId: { partyId, userId } },
      create: { partyId, userId },
      update: { optedInAt: new Date() },
      select: { optedInAt: true },
    });

    res.json({ optedIn: true, optedInAt: row.optedInAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/payment-opt-in — revoke for current user
router.delete('/:partyId/payment-opt-in', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const userId = req.userId;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) throw new AppError('Party not found', 404, 'NOT_FOUND');

    await prisma.partyPaymentOptIn.deleteMany({
      where: { partyId, userId },
    });

    res.json({ optedIn: false });
  } catch (error) {
    next(error);
  }
});

export default router;
