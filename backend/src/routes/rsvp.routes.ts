import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { triggerWebhook } from '../services/webhook.service.js';
import { createEmbeddedWalletForGuest } from '../services/privy.service.js';
import { siteForParty } from '../lib/siteBrand.js';
import { verifySecret } from '../lib/secretHash.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import { signGuestToken, verifyGuestToken, guestTokenFromRequest } from '../lib/guestToken.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * bounce-rate-heuristic: parse Resend's email-send response and persist the
 * `id` onto `guests.email_resend_id` so the webhook handler can match
 * delivery/bounce/complaint events back to the originating guest by ID
 * (not by address — same address can be re-sent N times).
 *
 * Safe to call without a guestId (no-ops) since some sends happen before
 * the guest row is created. Never throws — email sending must not fail
 * because of a downstream DB write.
 *
 * Param `response` is a global-fetch Response; we don't type it as such
 * because Express's Response is already imported above under the same name.
 */
async function recordResendId(response: { json: () => Promise<unknown> }, guestId?: string | null): Promise<unknown> {
  const data = await response.json().catch(() => null) as { id?: string } | null;
  if (guestId && data && typeof data.id === 'string' && data.id.length > 0) {
    try {
      await prisma.guest.update({
        where: { id: guestId },
        data: { emailResendId: data.id },
      });
    } catch (err) {
      // Non-fatal — bounce-tracking is observability, not correctness.
      console.error('Failed to record Resend message ID on guest', guestId, err);
    }
  }
  return data;
}

// GET /api/rsvp/:inviteCode - Get party info for RSVP page (public)
router.get('/:inviteCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        eventType: true,
        availableBeverages: true,
        rsvpClosedAt: true,
        maxGuests: true,
        user: { select: { name: true } },
        guests: {
          select: { status: true, approved: true },
        },
      },
    });

    // If not found by invite code, try custom URL
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          date: true,
          eventType: true,
          availableBeverages: true,
          rsvpClosedAt: true,
          maxGuests: true,
          user: { select: { name: true } },
          guests: {
            select: { status: true, approved: true },
          },
        },
      });
    }

    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: inviteCode },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: {
            id: true,
            name: true,
            date: true,
            eventType: true,
            availableBeverages: true,
            rsvpClosedAt: true,
            maxGuests: true,
            user: { select: { name: true } },
            guests: {
              select: { status: true, approved: true },
            },
          },
        });
      }
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    const hostName = party.eventType === 'gpp' ? 'PizzaDAO' : (party.user?.name || null);

    // Count confirmed guests (CONFIRMED or PENDING status). Rejected guests
    // (approved === false, see mushroom-31723) do not count toward capacity.
    const confirmedCount = party.guests.filter(
      g => (g.status === 'CONFIRMED' || g.status === 'PENDING') && g.approved !== false
    ).length;

    // Count waitlisted guests (excluding rejected — mushroom-31723)
    const waitlistCount = party.guests.filter(
      g => g.status === 'WAITLISTED' && g.approved !== false
    ).length;

    // Check if at capacity
    const isAtCapacity = party.maxGuests ? confirmedCount >= party.maxGuests : false;

    // Check if RSVPs are closed
    if (party.rsvpClosedAt) {
      return res.json({
        party: {
          name: party.name,
          date: party.date,
          hostName,
        },
        rsvpClosed: true,
        message: 'RSVPs are no longer being accepted for this party',
      });
    }

    res.json({
      party: {
        name: party.name,
        date: party.date,
        hostName,
        availableBeverages: party.availableBeverages,
        guestCount: confirmedCount,
        waitlistCount,
        maxGuests: party.maxGuests,
        isAtCapacity,
      },
      rsvpClosed: false,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/rsvp/:inviteCode/verify-password - Verify event password (public)
router.post('/:inviteCode/verify-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: { id: true, password: true },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: { id: true, password: true },
      });
    }

    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: inviteCode },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: { id: true, password: true },
        });
      }
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    const valid = party.password ? await verifySecret(party.password, String(password)) : false;
    res.json({ valid });
  } catch (error) {
    next(error);
  }
});

// GET /api/rsvp/:inviteCode/guest/:email - Get the caller's own guest row (auth, self only)
// guest-oracles (guests-anon-exposure PR3): this used to be public, so anyone could test
// whether an email RSVP'd to an event and read its name, wallet, roles and preferences.
// Now the caller must be logged in as that email. Anything else gets the same 404 a
// missing guest gets, so old bundles (which treat 404 as "no RSVP") keep working quietly
// and the response never reveals whether someone else's email is on the list.
// The current frontend uses GET /api/parties/:id/my-guest instead.
router.get('/:inviteCode/guest/:email', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, email } = req.params;

    const callerEmail = req.userEmail?.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();
    if (!callerEmail || callerEmail !== normalizedEmail) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: { id: true },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: { id: true },
      });
    }

    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: inviteCode },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: { id: true },
        });
      }
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Find guest by party ID and email
    const guest = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: normalizedEmail,
      },
      select: {
        id: true,
        name: true,
        email: true,
        ethereumAddress: true,
        walletSource: true,
        roles: true,
        mailingListOptIn: true,
        optinAbVariant: true,
        dietaryRestrictions: true,
        likedToppings: true,
        dislikedToppings: true,
        likedBeverages: true,
        dislikedBeverages: true,
        pizzeriaRankings: true,
        status: true,
        checkedInAt: true,
        checkedInBy: true,
      },
    });

    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    res.json({ guest });
  } catch (error) {
    next(error);
  }
});

// POST /api/rsvp/:inviteCode/guest - Submit guest preferences (public)
// rsvp-overwrite-fix: an existing RSVP can only be changed by its owner (JWT email == RSVP
// email). Anyone else submitting a taken email gets a response identical to a new RSVP and
// nothing is written. Every success carries `guestToken`, the per-guest capability that
// guest-scoped endpoints (raffle, quiz, discount, NFT) now require instead of a bare id.
router.post('/:inviteCode/guest', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const {
      name,
      email,
      ethereumAddress,
      roles,
      mailingListOptIn,
      swcOptIn,
      swcCaOptIn,
      swcAuOptIn,
      swcEuOptIn,
      swcUkOptIn,
      swcBrOptIn,
      ethconfOptIn,
      optinAbVariant,
      dietaryRestrictions,
      likedToppings,
      dislikedToppings,
      likedBeverages,
      dislikedBeverages,
      pizzeriaRankings,
      suggestedPizzerias,
      visitorSessionId,
    } = req.body;

    // rsvp-overwrite-fix: a login that was sent but didn't verify (expired/forged) must not
    // silently fall back to anonymous: the owner would get the no-op decoy while their UI
    // still shows them logged in. This says nothing about the submitted email, only about
    // the caller's own token, so it isn't an oracle.
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ') && !req.userEmail) {
      throw new AppError('Your login has expired. Please log in again.', 401, 'INVALID_TOKEN');
    }

    const safeOptinAbVariant: 'control' | 'variant' | null =
      optinAbVariant === 'control' || optinAbVariant === 'variant' ? optinAbVariant : null;

    // romana-30802: accept only string-shaped UUID-ish values (loose hex+dash
    // check). Anything else (numbers, objects, tampered junk) → null.
    const safeVisitorSessionId: string | null =
      typeof visitorSessionId === 'string' && /^[a-f0-9-]{20,128}$/i.test(visitorSessionId)
        ? visitorSessionId
        : null;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // pancetta-58472: lowercase + trim the wallet/ENS at the boundary so every
    // downstream write (manual create, manual update, Privy auto-provision)
    // stores the same canonical form.
    const normalizedAddress = ethereumAddress ? ethereumAddress.trim().toLowerCase() : null;

    // Validate Ethereum address or ENS name format if provided
    if (normalizedAddress) {
      const ethAddressRegex = /^0x[a-f0-9]{40}$/;
      const ensRegex = /^[a-z0-9-]+\.(eth|xyz|com|org|io|co|app|dev|id)$/;
      if (!ethAddressRegex.test(normalizedAddress) && !ensRegex.test(normalizedAddress)) {
        throw new AppError('Invalid Ethereum address or ENS name format', 400, 'VALIDATION_ERROR');
      }
    }

    // Validate email format if provided
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        throw new AppError('Invalid email format', 400, 'VALIDATION_ERROR');
      }
    }

    // Find party by invite code OR custom URL (frontend supports both)
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        timezone: true,
        address: true,
        customUrl: true,
        eventImageUrl: true,
        eventSeriesId: true,
        rsvpClosedAt: true,
        // porchetta-81402: block RSVP submission on cancelled events.
        cancelledAt: true,
        maxGuests: true,
        requireApproval: true,
        userId: true,
        user: { select: { name: true } },
        _count: { select: { guests: true } },
      },
    });

    // If not found by invite code, try custom URL
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          date: true,
          timezone: true,
          address: true,
          customUrl: true,
          eventImageUrl: true,
          eventSeriesId: true,
          rsvpClosedAt: true,
          // porchetta-81402: block RSVP submission on cancelled events.
          cancelledAt: true,
          maxGuests: true,
          requireApproval: true,
          userId: true,
          user: { select: { name: true } },
          _count: { select: { guests: true } },
        },
      });
    }

    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: inviteCode },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: {
            id: true,
            name: true,
            date: true,
            timezone: true,
            address: true,
            customUrl: true,
            eventImageUrl: true,
            eventSeriesId: true,
            rsvpClosedAt: true,
            // porchetta-81402: block RSVP submission on cancelled events.
            cancelledAt: true,
            maxGuests: true,
            requireApproval: true,
            userId: true,
            user: { select: { name: true } },
            _count: { select: { guests: true } },
          },
        });
      }
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // porchetta-81402: 410 GONE when the host has cancelled the event.
    // Checked BEFORE the rsvp_closed_at check so the reason surfaced to the
    // submitter is "cancelled" (more accurate) rather than "closed".
    if ((party as any).cancelledAt) {
      throw new AppError('This event has been cancelled', 410, 'EVENT_CANCELLED');
    }

    // Check if RSVPs are closed
    if (party.rsvpClosedAt) {
      throw new AppError('RSVPs are closed for this party', 400, 'RSVP_CLOSED');
    }

    // Count confirmed guests to check capacity. Rejected guests
    // (approved === false, see mushroom-31723) do not count toward capacity.
    // anchovy-59118: use `OR: [{approved:true},{approved:null}]` instead of
    // `{ not: false }` — Prisma compiles `{ not: false }` to SQL `<>`, and
    // under Postgres three-valued logic `NULL <> false` is NULL (falsy in
    // WHERE), so unreviewed RSVPs (approved=null by default) were silently
    // excluded from the capacity gate.
    const confirmedGuestCount = await prisma.guest.count({
      where: {
        partyId: party.id,
        status: { in: ['CONFIRMED', 'PENDING'] },
        OR: [{ approved: true }, { approved: null }],
      },
    });

    // Determine if guest should be waitlisted
    const isAtCapacity = party.maxGuests ? confirmedGuestCount >= party.maxGuests : false;

    // rsvp-overwrite-fix: the walletShared heads-up (another guest's name for a shared
    // wallet) is gone. Even a boolean would tell an anonymous caller "wallet W is on event
    // E's guest list", so no wallet lookup happens here any more.

    // What a brand-new RSVP would get right now. Used for real creates, for completing a
    // host invite, and for the decoy response below, so all three look the same.
    let waitlistPosition: number | null = null;
    if (isAtCapacity) {
      // Next waitlist position (excluding rejected — mushroom-31723)
      const maxPosition = await prisma.guest.aggregate({
        where: {
          partyId: party.id,
          status: 'WAITLISTED',
          OR: [{ approved: true }, { approved: null }],
        },
        _max: { waitlistPosition: true },
      });
      waitlistPosition = (maxPosition._max.waitlistPosition || 0) + 1;
    }
    let guestStatus: 'CONFIRMED' | 'PENDING' | 'WAITLISTED' = 'CONFIRMED';
    if (isAtCapacity) {
      guestStatus = 'WAITLISTED';
    } else if (party.requireApproval) {
      guestStatus = 'PENDING';
    }
    let message = 'Your preferences have been saved!';
    if (isAtCapacity) {
      message = `You're #${waitlistPosition} on the waitlist! We'll notify you if a spot opens up.`;
    } else if (party.requireApproval) {
      message = 'Your RSVP has been submitted and is pending approval from the host.';
    }

    // The one response shape every public "new RSVP" gets (201). The duplicate-email decoy
    // and an invite completion use it too, so the caller can't tell them apart.
    const requireApproval = party.requireApproval;
    const newRsvpResponse = (guestId: string) => ({
      success: true,
      guest: {
        id: guestId,
        name: name.trim(),
        status: guestStatus,
        waitlistPosition,
      },
      guestToken: signGuestToken(guestId),
      requireApproval,
      waitlisted: isAtCapacity,
      waitlistPosition,
      message,
    });

    const updateData = (existing: { status: string; submittedVia: string }) => ({
      name: name.trim(),
      ethereumAddress: normalizedAddress || null,
      ...(normalizedAddress ? { walletSource: 'manual' } : {}),
      roles: roles || [],
      mailingListOptIn: mailingListOptIn || false,
      swcOptIn: swcOptIn || false,
      swcCaOptIn: swcCaOptIn || false,
      swcAuOptIn: swcAuOptIn || false,
      swcEuOptIn: swcEuOptIn || false,
      swcUkOptIn: swcUkOptIn || false,
      swcBrOptIn: swcBrOptIn || false,
      ethconfOptIn: ethconfOptIn || false,
      optinAbVariant: safeOptinAbVariant,
      dietaryRestrictions: dietaryRestrictions || [],
      likedToppings: likedToppings || [],
      dislikedToppings: dislikedToppings || [],
      likedBeverages: likedBeverages || [],
      dislikedBeverages: dislikedBeverages || [],
      pizzeriaRankings: pizzeriaRankings || [],
      suggestedPizzerias: suggestedPizzerias || [],
      // INVITED guests completing their RSVP get the status a new RSVP would get.
      ...(existing.status === 'INVITED'
        ? { status: guestStatus, ...(waitlistPosition !== null ? { waitlistPosition } : {}) }
        : {}),
      submittedVia: existing.status === 'INVITED' ? 'rsvp' : existing.submittedVia,
      // romana-30802: only overwrite session ID if the current request
      // carries one — otherwise preserve whatever's already on the row.
      ...(safeVisitorSessionId ? { visitorSessionId: safeVisitorSessionId } : {}),
    });

    // Check for duplicate email if email is provided
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalizedEmail) {
      const existingGuest = await prisma.guest.findFirst({
        where: {
          partyId: party.id,
          email: normalizedEmail,
        },
      });

      if (existingGuest) {
        // rsvp-overwrite-fix: only the owner of the email (verified JWT) may change an
        // existing RSVP. This used to be open to anyone who typed the address, and the
        // 200 `updated` reply plus the returned guest id made it an RSVP oracle and a
        // capability leak.
        const callerEmail = req.userEmail?.trim().toLowerCase();
        const isOwner = !!callerEmail && callerEmail === normalizedEmail;

        if (isOwner) {
          // mushroom-31723: if the host has rejected this guest (approved=false),
          // do NOT silently reactivate them. Return the generic "already RSVPd"
          // response without mutating the row.
          if (existingGuest.approved === false) {
            return res.status(200).json({
              success: true,
              updated: false,
              guest: {
                id: existingGuest.id,
                name: existingGuest.name,
              },
              guestToken: signGuestToken(existingGuest.id),
              message: 'Your RSVP has been updated!',
            });
          }

          const updatedGuest = await prisma.guest.update({
            where: { id: existingGuest.id },
            data: updateData(existingGuest),
          });

          // Trigger webhook for guest update (using party owner's webhooks)
          await triggerWebhook('guest.updated', { guest: updatedGuest, partyId: party.id }, party.userId!);

          return res.status(200).json({
            success: true,
            updated: true,
            guest: {
              id: updatedGuest.id,
              name: updatedGuest.name,
            },
            guestToken: signGuestToken(updatedGuest.id),
            message: 'Your RSVP has been updated!',
          });
        }

        // Not the owner. A host invite (status INVITED) holds no RSVP yet, only the
        // address the host typed, so completing it is the same as a brand-new RSVP with
        // that email (which anyone can always make). It keeps invite links working for
        // logged-out invitees, and it answers exactly like a new RSVP.
        if (existingGuest.status === 'INVITED' && existingGuest.approved !== false) {
          const completed = await prisma.guest.update({
            where: { id: existingGuest.id },
            data: updateData(existingGuest),
          });
          await triggerWebhook('guest.updated', { guest: completed, partyId: party.id }, party.userId!);
          return res.status(201).json(newRsvpResponse(completed.id));
        }

        // A real RSVP already exists for this email and the caller can't prove it's
        // theirs: change NOTHING and answer exactly like a new RSVP would. The guest id
        // is a fresh random UUID (its token is valid-looking but matches no guest, so it
        // grants nothing); no field of the existing guest is read into the response.
        // TODO(rsvp-overwrite-fix): optionally email the address a "manage your RSVP"
        // link here. Not enabled: that would be a new send and needs Snax's OK.
        return res.status(201).json(newRsvpResponse(randomUUID()));
      }
    }

    // Create guest
    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        email: email?.trim().toLowerCase() || null,
        ethereumAddress: normalizedAddress || null,
        walletSource: normalizedAddress ? 'manual' : null,
        roles: roles || [],
        mailingListOptIn: mailingListOptIn || false,
        swcOptIn: swcOptIn || false,
        swcCaOptIn: swcCaOptIn || false,
        swcAuOptIn: swcAuOptIn || false,
        swcEuOptIn: swcEuOptIn || false,
        swcUkOptIn: swcUkOptIn || false,
        swcBrOptIn: swcBrOptIn || false,
        ethconfOptIn: ethconfOptIn || false,
        optinAbVariant: safeOptinAbVariant,
        dietaryRestrictions: dietaryRestrictions || [],
        likedToppings: likedToppings || [],
        dislikedToppings: dislikedToppings || [],
        likedBeverages: likedBeverages || [],
        dislikedBeverages: dislikedBeverages || [],
        pizzeriaRankings: pizzeriaRankings || [],
        suggestedPizzerias: suggestedPizzerias || [],
        submittedVia: 'link',
        partyId: party.id,
        status: guestStatus,
        waitlistPosition: waitlistPosition,
        // romana-30802: cookie-based per-browser ID; null for legacy/blocked browsers
        visitorSessionId: safeVisitorSessionId,
      },
    });

    // Auto-provision Privy embedded wallet if no wallet address was provided and email exists
    if (!normalizedAddress && email?.trim()) {
      try {
        const walletResult = await createEmbeddedWalletForGuest(email.trim().toLowerCase(), name.trim());
        if (walletResult) {
          await prisma.guest.update({
            where: { id: guest.id },
            data: {
              ethereumAddress: walletResult.walletAddress.toLowerCase(),
              privyUserId: walletResult.privyUserId,
              walletSource: 'privy-embedded',
            },
          });
          console.log(`Privy embedded wallet provisioned for guest ${guest.id}: ${walletResult.walletAddress.toLowerCase()}`);
        }
      } catch (privyError) {
        // Non-fatal: RSVP succeeds even if Privy provisioning fails
        console.error('Privy wallet provisioning failed (non-fatal):', privyError);
      }
    }

    // Trigger webhook for guest registration or waitlist (using party owner's webhooks)
    if (isAtCapacity) {
      await triggerWebhook('guest.waitlisted', { guest, partyId: party.id, waitlistPosition }, party.userId!);
    } else {
      await triggerWebhook('guest.registered', { guest, partyId: party.id }, party.userId!);
    }

    // Send appropriate email if email provided
    if (email?.trim()) {
      try {
        if (isAtCapacity) {
          await sendWaitlistConfirmationEmail({
            guestEmail: email.trim(),
            guestName: name.trim(),
            guestId: guest.id,
            partyName: party.name,
            partyDate: party.date,
            partyTimezone: party.timezone,
            waitlistPosition: waitlistPosition!,
            inviteCode,
            customUrl: party.customUrl,
            eventSeriesId: party.eventSeriesId,
          });
        } else {
          await sendRSVPConfirmationEmail({
            guestEmail: email.trim(),
            guestName: name.trim(),
            guestId: guest.id,
            partyName: party.name,
            partyDate: party.date,
            partyTimezone: party.timezone,
            partyAddress: party.address,
            partyImageUrl: party.eventImageUrl,
            inviteCode,
            customUrl: party.customUrl,
            requireApproval: party.requireApproval,
            eventSeriesId: party.eventSeriesId,
          });
        }
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        // Don't fail the RSVP if email fails
      }
    }

    res.status(201).json(newRsvpResponse(guest.id));
  } catch (error) {
    next(error);
  }
});

// POST /api/rsvp/:inviteCode/send-confirmation - Re-send the confirmation email for an RSVP
// rsvp-overwrite-fix: this used to email ANY address/name supplied in the body and stamp the
// Resend id onto ANY guest id (an open relay plus bounce-tracking corruption). Now the
// caller must hold that guest's token (or be logged in as the guest), and the email goes
// only to the address stored on the guest row. No frontend caller today.
router.post('/:inviteCode/send-confirmation', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { guestId } = req.body ?? {};

    if (!guestId || typeof guestId !== 'string') {
      throw new AppError('guestId is required', 400, 'VALIDATION_ERROR');
    }
    const tokenOk = verifyGuestToken(guestId, guestTokenFromRequest(req));
    if (!tokenOk && !req.userEmail) {
      throw new AppError('Guest not found', 404, 'GUEST_NOT_FOUND');
    }

    // Get party details (try invite code first, then custom URL)
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        timezone: true,
        address: true,
        customUrl: true,
        eventImageUrl: true,
        eventSeriesId: true,
      },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          date: true,
          timezone: true,
          address: true,
          customUrl: true,
          eventImageUrl: true,
          eventSeriesId: true,
        },
      });
    }

    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: inviteCode },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: {
            id: true,
            name: true,
            date: true,
            timezone: true,
            address: true,
            customUrl: true,
            eventImageUrl: true,
            eventSeriesId: true,
          },
        });
      }
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // A valid token means we minted this id; otherwise refuse ids Postgres can't parse.
    const guestRow = tokenOk || UUID_RE.test(guestId)
      ? await prisma.guest.findFirst({
          where: { id: guestId, partyId: party.id },
          select: { id: true, name: true, email: true },
        })
      : null;
    const callerEmail = req.userEmail?.trim().toLowerCase();
    const allowed =
      !!guestRow?.email &&
      (tokenOk || (!!callerEmail && callerEmail === guestRow.email.trim().toLowerCase()));
    if (!guestRow || !guestRow.email || !allowed) {
      throw new AppError('Guest not found', 404, 'GUEST_NOT_FOUND');
    }

    // Send confirmation email (to the stored address only)
    await sendRSVPConfirmationEmail({
      guestEmail: guestRow.email,
      guestName: guestRow.name,
      guestId: guestRow.id,
      partyName: party.name,
      partyDate: party.date,
      partyTimezone: party.timezone,
      partyAddress: party.address,
      partyImageUrl: party.eventImageUrl,
      inviteCode,
      customUrl: party.customUrl,
      eventSeriesId: party.eventSeriesId,
    });

    res.json({ success: true, message: 'Confirmation email sent' });
  } catch (error) {
    next(error);
  }
});

// Helper function to send RSVP confirmation email
async function sendRSVPConfirmationEmail(params: {
  guestEmail: string;
  guestName: string;
  guestId?: string;
  partyName: string;
  partyDate: Date | null;
  partyTimezone: string | null;
  partyAddress: string | null;
  partyImageUrl?: string | null;
  inviteCode: string;
  customUrl: string | null;
  requireApproval?: boolean;
  eventSeriesId?: string | null;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const site = await siteForParty(params, 'https://rsv.pizza'); // brand-check-ignore-line
  const baseUrl = site.url;
  const eventUrl = params.customUrl
    ? `${baseUrl}/${params.customUrl}`
    : `${baseUrl}/${params.inviteCode}`;

  // Generate unique check-in URL with guest ID
  const checkInUrl = params.guestId
    ? `${baseUrl}/checkin/${params.inviteCode}/${params.guestId}`
    : eventUrl;

  // Generate QR code using a free QR code API (encoded check-in URL)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkInUrl)}&bgcolor=f9f9f9&color=1a1a2e`;

  const dateText = params.partyDate
    ? new Date(params.partyDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: params.partyTimezone || undefined,
      })
    : 'Date TBD';

  const addressText = params.partyAddress || 'Location TBD';

  // Different email content based on whether approval is required
  const isPendingApproval = params.requireApproval;

  const qrCodeSection = !isPendingApproval ? `
        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #1a1a2e; margin-top: 0; margin-bottom: 15px;">Your Check-In QR Code</h3>
          <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Show this at the event for quick check-in</p>
          <img src="${qrCodeUrl}" alt="Check-in QR Code" style="width: 200px; height: 200px; border-radius: 8px;" />
          <p style="color: #999; font-size: 12px; margin-top: 15px;">Guest: ${params.guestName}</p>
        </div>
  ` : `
        <div style="background: #fff3cd; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center; border: 1px solid #ffc107;">
          <h3 style="color: #856404; margin-top: 0; margin-bottom: 15px;">Pending Host Approval</h3>
          <p style="color: #856404; font-size: 14px; margin: 0;">Your RSVP is pending approval from the host. You'll receive another email with your check-in QR code once approved.</p>
        </div>
  `;

  const headerTitle = isPendingApproval ? '🍕 RSVP Submitted!' : '🍕 You\'re Going!';
  const headerSubtitle = isPendingApproval ? 'Awaiting host approval' : 'Your RSVP is confirmed';
  const footerText = isPendingApproval
    ? `We'll let you know once the host approves your RSVP, ${params.guestName}!`
    : `See you there, ${params.guestName}!`;
  const emailSubject = isPendingApproval
    ? `RSVP Submitted for ${params.partyName} - Pending Approval`
    : `You're going to ${params.partyName}! 🍕`;

  const flyerBlock = params.partyImageUrl
    ? `
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="${params.partyImageUrl}" alt="${params.partyName}" style="max-width: 100%; border-radius: 12px;" />
        </div>
  `
    : '';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isPendingApproval ? 'RSVP Pending' : 'RSVP Confirmed'}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${flyerBlock}
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">${headerTitle}</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 18px; margin: 0;">${headerSubtitle}</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">Event Details</h2>
          <p style="margin: 10px 0;"><strong>Event:</strong> ${params.partyName}</p>
          <p style="margin: 10px 0;"><strong>When:</strong> ${dateText}</p>
          <p style="margin: 10px 0;"><strong>Where:</strong> ${addressText}</p>
        </div>

        ${qrCodeSection}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>${footerText}</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: site.fromEmail,
      to: [params.guestEmail],
      subject: emailSubject,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return recordResendId(response, params.guestId);
}

// Helper function to send approval notification email with QR code
export async function sendApprovalEmail(params: {
  guestEmail: string;
  guestName: string;
  guestId: string;
  partyName: string;
  partyDate: Date | null;
  partyTimezone: string | null;
  partyAddress: string | null;
  partyImageUrl: string | null;
  venueName: string | null;
  inviteCode: string;
  customUrl: string | null;
  eventSeriesId?: string | null;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const site = await siteForParty(params, 'https://rsv.pizza'); // brand-check-ignore-line
  const baseUrl = site.url;
  const eventUrl = params.customUrl
    ? `${baseUrl}/${params.customUrl}`
    : `${baseUrl}/${params.inviteCode}`;

  // Generate unique check-in URL with guest ID
  const checkInUrl = `${baseUrl}/checkin/${params.inviteCode}/${params.guestId}`;

  // Generate QR code using a free QR code API (encoded check-in URL)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkInUrl)}&bgcolor=f9f9f9&color=1a1a2e`;

  const dateText = params.partyDate
    ? new Date(params.partyDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: params.partyTimezone || undefined,
      })
    : 'Date TBD';

  const addressText = params.partyAddress || 'Location TBD';

  const flyerImg = params.partyImageUrl
    ? `<img src="${params.partyImageUrl}" alt="${params.partyName}" style="width: 100%; max-width: 540px; height: auto; border-radius: 12px; display: block; margin: 0 auto 20px auto;" />`
    : '';

  const whereHtml = params.venueName
    ? `<p style="margin: 10px 0;"><strong>Where:</strong> ${params.venueName}<br><span style="color: #666; font-size: 14px;">${addressText}</span></p>`
    : `<p style="margin: 10px 0;"><strong>Where:</strong> ${addressText}</p>`;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RSVP Approved</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">🍕 You're Approved!</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 18px; margin: 0;">Your RSVP has been confirmed</p>
        </div>

        <div style="background: #d4edda; padding: 20px; border-radius: 12px; margin-bottom: 20px; text-align: center; border: 1px solid #28a745;">
          <p style="color: #155724; font-size: 16px; margin: 0; font-weight: 600;">Great news! The host has approved your RSVP.</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          ${flyerImg}
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">Event Details</h2>
          <p style="margin: 10px 0;"><strong>Event:</strong> ${params.partyName}</p>
          <p style="margin: 10px 0;"><strong>When:</strong> ${dateText}</p>
          ${whereHtml}
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #1a1a2e; margin-top: 0; margin-bottom: 15px;">Your Check-In QR Code</h3>
          <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Show this at the event for quick check-in</p>
          <img src="${qrCodeUrl}" alt="Check-in QR Code" style="width: 200px; height: 200px; border-radius: 8px;" />
          <p style="color: #999; font-size: 12px; margin-top: 15px;">Guest: ${params.guestName}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>See you there, ${params.guestName}!</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: site.fromEmail,
      to: [params.guestEmail],
      subject: `You're approved for ${params.partyName}! 🍕`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return recordResendId(response, params.guestId);
}

// Helper function to send waitlist confirmation email
async function sendWaitlistConfirmationEmail(params: {
  guestEmail: string;
  guestName: string;
  guestId?: string;
  partyName: string;
  partyDate: Date | null;
  partyTimezone: string | null;
  waitlistPosition: number;
  inviteCode: string;
  customUrl: string | null;
  eventSeriesId?: string | null;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const site = await siteForParty(params, 'https://rsv.pizza'); // brand-check-ignore-line
  const baseUrl = site.url;
  const eventUrl = params.customUrl
    ? `${baseUrl}/${params.customUrl}`
    : `${baseUrl}/${params.inviteCode}`;

  const dateText = params.partyDate
    ? new Date(params.partyDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: params.partyTimezone || undefined,
      })
    : 'Date TBD';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're on the Waitlist</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">You're on the Waitlist!</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 18px; margin: 0;">Position #${params.waitlistPosition}</p>
        </div>

        <div style="background: #fff3cd; padding: 20px; border-radius: 12px; margin-bottom: 20px; text-align: center; border: 1px solid #ffc107;">
          <p style="color: #856404; font-size: 16px; margin: 0;">
            ${params.partyName} is currently at capacity, but you're #${params.waitlistPosition} on the waitlist!
          </p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">Event Details</h2>
          <p style="margin: 10px 0;"><strong>Event:</strong> ${params.partyName}</p>
          <p style="margin: 10px 0;"><strong>When:</strong> ${dateText}</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #1a1a2e; margin-top: 0; margin-bottom: 15px;">What Happens Next?</h3>
          <p style="color: #666; font-size: 14px; margin: 0;">
            We'll send you an email with your check-in QR code if a spot opens up.
            Keep an eye on your inbox!
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>Fingers crossed, ${params.guestName}!</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: site.fromEmail,
      to: [params.guestEmail],
      subject: `You're #${params.waitlistPosition} on the waitlist for ${params.partyName}`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return recordResendId(response, params.guestId);
}

// Helper function to send promotion email (guest moved from waitlist to confirmed)
export async function sendPromotionEmail(params: {
  guestEmail: string;
  guestName: string;
  guestId: string;
  partyName: string;
  partyDate: Date | null;
  partyTimezone: string | null;
  partyAddress: string | null;
  partyImageUrl?: string | null;
  inviteCode: string;
  customUrl: string | null;
  eventSeriesId?: string | null;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email');
    return;
  }

  const site = await siteForParty(params, 'https://rsv.pizza'); // brand-check-ignore-line
  const baseUrl = site.url;
  const eventUrl = params.customUrl
    ? `${baseUrl}/${params.customUrl}`
    : `${baseUrl}/${params.inviteCode}`;

  // Generate unique check-in URL with guest ID
  const checkInUrl = `${baseUrl}/checkin/${params.inviteCode}/${params.guestId}`;

  // Generate QR code using a free QR code API
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkInUrl)}&bgcolor=f9f9f9&color=1a1a2e`;

  const dateText = params.partyDate
    ? new Date(params.partyDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: params.partyTimezone || undefined,
      })
    : 'Date TBD';

  const addressText = params.partyAddress || 'Location TBD';

  const flyerBlock = params.partyImageUrl
    ? `
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="${params.partyImageUrl}" alt="${params.partyName}" style="max-width: 100%; border-radius: 12px;" />
        </div>
  `
    : '';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're In!</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${flyerBlock}
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">You're In!</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 18px; margin: 0;">A spot opened up just for you</p>
        </div>

        <div style="background: #d4edda; padding: 20px; border-radius: 12px; margin-bottom: 20px; text-align: center; border: 1px solid #28a745;">
          <p style="color: #155724; font-size: 16px; margin: 0; font-weight: 600;">
            Great news! You've been moved from the waitlist to confirmed!
          </p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">Event Details</h2>
          <p style="margin: 10px 0;"><strong>Event:</strong> ${params.partyName}</p>
          <p style="margin: 10px 0;"><strong>When:</strong> ${dateText}</p>
          <p style="margin: 10px 0;"><strong>Where:</strong> ${addressText}</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #1a1a2e; margin-top: 0; margin-bottom: 15px;">Your Check-In QR Code</h3>
          <p style="color: #666; font-size: 14px; margin-bottom: 20px;">Show this at the event for quick check-in</p>
          <img src="${qrCodeUrl}" alt="Check-in QR Code" style="width: 200px; height: 200px; border-radius: 8px;" />
          <p style="color: #999; font-size: 12px; margin-top: 15px;">Guest: ${params.guestName}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
          <p>See you there, ${params.guestName}!</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: site.fromEmail,
      to: [params.guestEmail],
      subject: `You're in! A spot opened up at ${params.partyName}`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return recordResendId(response, params.guestId);
}

export default router;
