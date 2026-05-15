import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../config/database.js';
import { requireApiKey, ApiKeyRequest, SCOPES } from '../../middleware/apiKey.js';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { triggerWebhook } from '../../services/webhook.service.js';
import { setDeleteContext } from '../../helpers/auditContext.js';
import { canUserAccessTab } from '../../helpers/partyAccess.js';

const router = Router({ mergeParams: true }); // mergeParams to access :partyId

// Helper to verify party ownership
async function verifyPartyOwnership(partyId: string, userId: string) {
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });
  if (!party) {
    throw new AppError('Party not found', 404, 'NOT_FOUND');
  }
  return party;
}

// Build the invite email subject + HTML for a given party + guest. Optionally
// inject a custom host message above the CTA button. Shared by the single
// `/send-invite` and bulk `/bulk-invite` endpoints.
export function buildInviteEmail(
  party: {
    name: string;
    date: Date | null;
    address: string | null;
    inviteCode: string;
    customUrl: string | null;
    timezone: string | null;
    eventImageUrl?: string | null;
  },
  guest: { name: string; email: string },
  customMessage?: string
): { subject: string; html: string } {
  const baseUrl = 'https://rsv.pizza';
  const eventUrl = party.customUrl
    ? `${baseUrl}/${party.customUrl}`
    : `${baseUrl}/${party.inviteCode}`;

  const dateText = party.date
    ? new Date(party.date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: party.timezone || undefined,
      })
    : 'Date TBD';

  // Escape user-provided content to avoid HTML injection
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const customMessageBlock = customMessage && customMessage.trim().length > 0
    ? `
          <div style="background: #fff; border-left: 4px solid #ff393a; padding: 16px 20px; border-radius: 6px; margin: 20px 0; white-space: pre-wrap;">
            <p style="margin: 0; color: #333; font-size: 15px;">${escape(customMessage.trim()).replace(/\n/g, '<br>')}</p>
          </div>`
    : '';

  const flyerBlock = party.eventImageUrl
    ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="${party.eventImageUrl}" alt="${escape(party.name)}" style="max-width: 100%; border-radius: 12px;" />
          </div>`
    : '';

  const subject = `You're invited to ${party.name}!`;

  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>You're invited!</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${flyerBlock}
          <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
            <h2 style="color: #1a1a2e; margin-top: 0;">${escape(party.name)}</h2>
            <p><strong>When:</strong> ${escape(dateText)}</p>
            <p><strong>Where:</strong> ${escape(party.address || 'Location TBD')}</p>
          </div>
          ${customMessageBlock}
          <div style="text-align: center; margin: 30px 0;">
            <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">RSVP Now</a>
          </div>
        </body>
      </html>
    `;

  return { subject, html };
}

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests:
 *   get:
 *     summary: List all guests for a party
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: approved
 *         schema:
 *           type: boolean
 *         description: Filter by approval status
 *     responses:
 *       200:
 *         description: List of guests
 */
router.get('/', requireApiKey(SCOPES.GUESTS_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const approvedFilter = req.query.approved;

    await verifyPartyOwnership(partyId, req.apiKey!.userId);

    const whereClause: any = { partyId };
    if (approvedFilter !== undefined) {
      whereClause.approved = approvedFilter === 'true' ? true : approvedFilter === 'false' ? false : null;
    }

    const [guests, total] = await Promise.all([
      prisma.guest.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          email: true,
          ethereumAddress: true,
          roles: true,
          mailingListOptIn: true,
          dietaryRestrictions: true,
          likedToppings: true,
          dislikedToppings: true,
          likedBeverages: true,
          dislikedBeverages: true,
          pizzeriaRankings: true,
          submittedAt: true,
          submittedVia: true,
          approved: true,
          nftTokenId: true,
          nftTransactionHash: true,
          nftMintedAt: true,
        },
        orderBy: { submittedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.guest.count({ where: whereClause }),
    ]);

    res.json({
      data: guests,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + guests.length < total,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests:
 *   post:
 *     summary: Add a guest to a party
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               dietaryRestrictions:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Guest added successfully
 */
router.post('/', requireApiKey(SCOPES.GUESTS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name, email, ethereumAddress, roles, mailingListOptIn,
      dietaryRestrictions, likedToppings, dislikedToppings,
      likedBeverages, dislikedBeverages, pizzeriaRankings
    } = req.body;

    const party = await verifyPartyOwnership(partyId, req.apiKey!.userId);

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Check if guest with this email already exists
    if (email) {
      const existingGuest = await prisma.guest.findFirst({
        where: { partyId, email: email.toLowerCase() },
      });
      if (existingGuest) {
        return res.status(200).json({ data: existingGuest, alreadyExists: true });
      }
    }

    // Check max guests
    if (party.maxGuests) {
      const guestCount = await prisma.guest.count({ where: { partyId, status: { not: 'INVITED' } } });
      if (guestCount >= party.maxGuests) {
        throw new AppError('Party has reached maximum guests', 400, 'MAX_GUESTS_REACHED');
      }
    }

    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        email: email ? email.toLowerCase() : null,
        ethereumAddress: ethereumAddress || null,
        roles: roles || [],
        mailingListOptIn: mailingListOptIn || false,
        dietaryRestrictions: dietaryRestrictions || [],
        likedToppings: likedToppings || [],
        dislikedToppings: dislikedToppings || [],
        likedBeverages: likedBeverages || [],
        dislikedBeverages: dislikedBeverages || [],
        pizzeriaRankings: pizzeriaRankings || [],
        submittedVia: 'api',
        approved: party.requireApproval ? null : true,
        partyId,
      },
    });

    // Trigger webhook
    await triggerWebhook('guest.registered', { guest, partyId }, req.apiKey!.userId);

    res.status(201).json({ data: guest });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests/{guestId}:
 *   get:
 *     summary: Get a guest by ID
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: guestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Guest details
 */
router.get('/:guestId', requireApiKey(SCOPES.GUESTS_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    await verifyPartyOwnership(partyId, req.apiKey!.userId);

    const guest = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'NOT_FOUND');
    }

    res.json({ data: guest });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests/{guestId}:
 *   patch:
 *     summary: Update a guest
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: guestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Guest updated successfully
 */
router.patch('/:guestId', requireApiKey(SCOPES.GUESTS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;
    const {
      name, email, ethereumAddress, roles, mailingListOptIn,
      dietaryRestrictions, likedToppings, dislikedToppings,
      likedBeverages, dislikedBeverages, pizzeriaRankings
    } = req.body;

    await verifyPartyOwnership(partyId, req.apiKey!.userId);

    const existing = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!existing) {
      throw new AppError('Guest not found', 404, 'NOT_FOUND');
    }

    const guest = await prisma.guest.update({
      where: { id: guestId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(email !== undefined && { email: email ? email.toLowerCase() : null }),
        ...(ethereumAddress !== undefined && { ethereumAddress }),
        ...(roles !== undefined && { roles }),
        ...(mailingListOptIn !== undefined && { mailingListOptIn }),
        ...(dietaryRestrictions !== undefined && { dietaryRestrictions }),
        ...(likedToppings !== undefined && { likedToppings }),
        ...(dislikedToppings !== undefined && { dislikedToppings }),
        ...(likedBeverages !== undefined && { likedBeverages }),
        ...(dislikedBeverages !== undefined && { dislikedBeverages }),
        ...(pizzeriaRankings !== undefined && { pizzeriaRankings }),
      },
    });

    // Trigger webhook
    await triggerWebhook('guest.updated', { guest, partyId }, req.apiKey!.userId);

    res.json({ data: guest });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests/{guestId}:
 *   delete:
 *     summary: Remove a guest
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: guestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Guest removed successfully
 */
router.delete('/:guestId', requireApiKey(SCOPES.GUESTS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    await verifyPartyOwnership(partyId, req.apiKey!.userId);

    const existing = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!existing) {
      throw new AppError('Guest not found', 404, 'NOT_FOUND');
    }

    await prisma.$transaction(async (tx) => {
      await setDeleteContext(tx, `api_key:${req.apiKey!.userId}`, 'api_v1');
      await tx.guest.delete({ where: { id: guestId } });
    });

    // Trigger webhook
    await triggerWebhook('guest.removed', { guestId, partyId }, req.apiKey!.userId);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests/{guestId}/approve:
 *   patch:
 *     summary: Approve or decline a guest
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: guestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - approved
 *             properties:
 *               approved:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Guest approval status updated
 */
router.patch('/:guestId/approve', requireApiKey(SCOPES.GUESTS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;
    const { approved } = req.body;

    await verifyPartyOwnership(partyId, req.apiKey!.userId);

    if (typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const existing = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!existing) {
      throw new AppError('Guest not found', 404, 'NOT_FOUND');
    }

    const guest = await prisma.guest.update({
      where: { id: guestId },
      data: { approved },
    });

    // Trigger appropriate webhook
    const event = approved ? 'guest.approved' : 'guest.declined';
    await triggerWebhook(event, { guest, partyId }, req.apiKey!.userId);

    res.json({ data: guest });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{partyId}/guests/{guestId}/send-invite:
 *   post:
 *     summary: Send email invite to a guest
 *     tags: [Guests]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: guestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invite sent successfully
 */
router.post('/:guestId/send-invite', requireApiKey(SCOPES.GUESTS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    const party = await verifyPartyOwnership(partyId, req.apiKey!.userId);

    const guest = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'NOT_FOUND');
    }

    if (!guest.email) {
      throw new AppError('Guest does not have an email address', 400, 'VALIDATION_ERROR');
    }

    // Send invite email using Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new AppError('Email service not configured', 500, 'CONFIG_ERROR');
    }

    const { subject, html } = buildInviteEmail(
      {
        name: party.name,
        date: party.date,
        address: party.address,
        inviteCode: party.inviteCode,
        customUrl: party.customUrl,
        timezone: party.timezone,
        eventImageUrl: party.eventImageUrl,
      },
      { name: guest.name, email: guest.email }
    );

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RSV.Pizza <noreply@rsv.pizza>',
        to: [guest.email],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new AppError(`Failed to send email: ${error}`, 500, 'EMAIL_ERROR');
    }

    res.json({ success: true, message: 'Invite sent' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/parties/:partyId/guests/bulk-invite
 *
 * User-authenticated (Bearer token) bulk invite endpoint used by the Promo
 * app in the host dashboard. Creates a `Guest` row per entry with status
 * PENDING / submittedVia 'invite' and sends an invite email via Resend.
 *
 * Body: { guests: Array<{name, email}>, customMessage?: string }
 * Response: { sent, failed, skipped, createdGuestIds }
 */
router.post('/bulk-invite', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const userId = req.userId;
    if (!userId) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    // Verify the user can access the promo tab (owner, co-host, or super admin)
    const canAccess = await canUserAccessTab(partyId, req.userEmail, userId, 'promo');
    if (!canAccess) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const party = await prisma.party.findUnique({ where: { id: partyId } });
    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const { guests, customMessage, testOnly } = req.body as {
      guests?: Array<{ name?: string; email?: string }>;
      customMessage?: string;
      testOnly?: boolean;
    };

    if (!Array.isArray(guests) || guests.length === 0) {
      throw new AppError('guests must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    if (guests.length > 500) {
      throw new AppError('Max 500 guests per request', 400, 'VALIDATION_ERROR');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const results = {
      sent: [] as string[],
      failed: [] as Array<{ email: string; reason: string }>,
      skipped: [] as Array<{ email: string; reason: string }>,
      createdGuestIds: [] as string[],
    };

    // Prefetch existing guest emails for this party (case-insensitive compare)
    const existing = await prisma.guest.findMany({
      where: { partyId },
      select: { email: true },
    });
    const existingEmails = new Set(
      existing
        .map((g) => (g.email ? g.email.toLowerCase() : null))
        .filter((e): e is string => !!e)
    );

    const resendApiKey = process.env.RESEND_API_KEY;

    // Process in batches of 10 with a 500ms delay between batches.
    const BATCH_SIZE = 10;
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (g) => {
          const rawEmail = (g.email || '').trim();
          const normalizedEmail = rawEmail.toLowerCase();
          const displayEmail = rawEmail || '(no email)';

          if (!rawEmail || !emailRegex.test(rawEmail)) {
            results.failed.push({ email: displayEmail, reason: 'invalid email' });
            return;
          }

          const name = (g.name || '').trim() || normalizedEmail.split('@')[0];

          if (!testOnly) {
            if (existingEmails.has(normalizedEmail)) {
              results.skipped.push({ email: displayEmail, reason: 'already invited' });
              return;
            }
            // Reserve this email so duplicates within the same batch are also skipped
            existingEmails.add(normalizedEmail);

            try {
              const newGuest = await prisma.guest.create({
                data: {
                  partyId,
                  name,
                  email: normalizedEmail,
                  status: 'INVITED',
                  submittedVia: 'invite',
                  approved: null,
                  roles: [],
                },
              });
              results.createdGuestIds.push(newGuest.id);
            } catch (err: any) {
              results.failed.push({
                email: displayEmail,
                reason: err?.message || 'failed to create guest',
              });
              return;
            }
          }

          // Send invite email (if Resend configured). If email fails, keep the
          // guest row but report the failure so the host knows to retry.
          if (resendApiKey) {
            try {
              const { subject, html } = buildInviteEmail(
                {
                  name: party.name,
                  date: party.date,
                  address: party.address,
                  inviteCode: party.inviteCode,
                  customUrl: party.customUrl,
                  timezone: party.timezone,
                  eventImageUrl: party.eventImageUrl,
                },
                { name, email: normalizedEmail },
                customMessage
              );

              const resp = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${resendApiKey}`,
                },
                body: JSON.stringify({
                  from: 'RSV.Pizza <noreply@rsv.pizza>',
                  to: [normalizedEmail],
                  subject,
                  html,
                }),
              });

              if (!resp.ok) {
                const body = await resp.text().catch(() => '');
                results.failed.push({
                  email: displayEmail,
                  reason: `resend ${resp.status}${body ? ': ' + body.slice(0, 120) : ''}`,
                });
                return;
              }
            } catch (err: any) {
              results.failed.push({
                email: displayEmail,
                reason: err?.message || 'email send error',
              });
              return;
            }
          }

          results.sent.push(displayEmail);
        })
      );

      if (i + BATCH_SIZE < guests.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    res.json(results);
  } catch (error) {
    next(error);
  }
});

export default router;
