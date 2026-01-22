import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../config/database.js';
import { requireApiKey, ApiKeyRequest, SCOPES } from '../../middleware/apiKey.js';
import { AppError } from '../../middleware/error.js';
import { triggerWebhook } from '../../services/webhook.service.js';
import guestsRouter from './guests.js';

const router = Router();

// Mount guests router under /parties/:partyId/guests
router.use('/:partyId/guests', guestsRouter);

/**
 * @swagger
 * /api/v1/parties:
 *   get:
 *     summary: List all parties
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of parties to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of parties to skip
 *     responses:
 *       200:
 *         description: List of parties
 */
router.get('/', requireApiKey(SCOPES.PARTIES_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        where: { userId: req.apiKey!.userId },
        select: {
          id: true,
          name: true,
          inviteCode: true,
          customUrl: true,
          date: true,
          endTime: true,
          timezone: true,
          pizzaStyle: true,
          address: true,
          venueName: true,
          maxGuests: true,
          hideGuests: true,
          requireApproval: true,
          eventImageUrl: true,
          description: true,
          rsvpClosedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { guests: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.party.count({ where: { userId: req.apiKey!.userId } }),
    ]);

    res.json({
      data: parties.map(p => ({
        ...p,
        guestCount: p._count.guests,
        _count: undefined,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + parties.length < total,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties:
 *   post:
 *     summary: Create a new party
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
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
 *               date:
 *                 type: string
 *                 format: date-time
 *               address:
 *                 type: string
 *     responses:
 *       201:
 *         description: Party created successfully
 */
router.post('/', requireApiKey(SCOPES.PARTIES_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name, date, endTime, duration, pizzaStyle, address, venueName, maxGuests,
      availableBeverages, availableToppings, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate custom URL if provided
    if (customUrl) {
      if (!/^[a-z0-9-]+$/.test(customUrl)) {
        throw new AppError('Custom URL can only contain lowercase letters, numbers, and hyphens', 400, 'VALIDATION_ERROR');
      }
      if (customUrl.length < 3 || customUrl.length > 50) {
        throw new AppError('Custom URL must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
      }
    }

    const party = await prisma.party.create({
      data: {
        name: name.trim(),
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
        coHosts: [],
        userId: req.apiKey!.userId,
      },
    });

    // Trigger webhook
    await triggerWebhook('party.created', party, req.apiKey!.userId);

    res.status(201).json({ data: party });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{id}:
 *   get:
 *     summary: Get a party by ID
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Party details
 *       404:
 *         description: Party not found
 */
router.get('/:id', requireApiKey(SCOPES.PARTIES_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const party = await prisma.party.findFirst({
      where: { id, userId: req.apiKey!.userId },
      include: {
        _count: { select: { guests: true } },
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    res.json({
      data: {
        ...party,
        guestCount: party._count.guests,
        _count: undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{id}:
 *   patch:
 *     summary: Update a party
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *         description: Party updated successfully
 *       404:
 *         description: Party not found
 */
router.patch('/:id', requireApiKey(SCOPES.PARTIES_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      name, date, endTime, duration, pizzaStyle, address, venueName, maxGuests,
      availableBeverages, availableToppings, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, selectedPizzerias
    } = req.body;

    // Verify ownership
    const existing = await prisma.party.findFirst({
      where: { id, userId: req.apiKey!.userId },
    });

    if (!existing) {
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
        ...(venueName !== undefined && { venueName: venueName || null }),
        ...(maxGuests !== undefined && { maxGuests }),
        ...(hideGuests !== undefined && { hideGuests }),
        ...(requireApproval !== undefined && { requireApproval }),
        ...(availableBeverages !== undefined && { availableBeverages }),
        ...(availableToppings !== undefined && { availableToppings }),
        ...(password !== undefined && { password: password || null }),
        ...(eventImageUrl !== undefined && { eventImageUrl: eventImageUrl || null }),
        ...(description !== undefined && { description: description || null }),
        ...(customUrl !== undefined && { customUrl: customUrl || null }),
        ...(selectedPizzerias !== undefined && { selectedPizzerias }),
      },
    });

    // Trigger webhook
    await triggerWebhook('party.updated', party, req.apiKey!.userId);

    res.json({ data: party });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{id}:
 *   delete:
 *     summary: Delete a party
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Party deleted successfully
 *       404:
 *         description: Party not found
 */
router.delete('/:id', requireApiKey(SCOPES.PARTIES_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.party.findFirst({
      where: { id, userId: req.apiKey!.userId },
    });

    if (!existing) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.party.delete({ where: { id } });

    // Trigger webhook
    await triggerWebhook('party.deleted', { id }, req.apiKey!.userId);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{id}/close-rsvp:
 *   post:
 *     summary: Close RSVPs for a party
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: RSVPs closed successfully
 */
router.post('/:id/close-rsvp', requireApiKey(SCOPES.PARTIES_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.party.findFirst({
      where: { id, userId: req.apiKey!.userId },
    });

    if (!existing) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await prisma.party.update({
      where: { id },
      data: { rsvpClosedAt: new Date() },
    });

    // Trigger webhook
    await triggerWebhook('party.rsvp_closed', party, req.apiKey!.userId);

    res.json({ success: true, message: 'RSVPs closed' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/parties/{id}/open-rsvp:
 *   post:
 *     summary: Reopen RSVPs for a party
 *     tags: [Parties]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: RSVPs reopened successfully
 */
router.post('/:id/open-rsvp', requireApiKey(SCOPES.PARTIES_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.party.findFirst({
      where: { id, userId: req.apiKey!.userId },
    });

    if (!existing) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await prisma.party.update({
      where: { id },
      data: { rsvpClosedAt: null },
    });

    // Trigger webhook
    await triggerWebhook('party.rsvp_opened', party, req.apiKey!.userId);

    res.json({ success: true, message: 'RSVPs reopened' });
  } catch (error) {
    next(error);
  }
});

export default router;
