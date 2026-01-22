import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../config/database.js';
import { requireApiKey, ApiKeyRequest, SCOPES, generateWebhookSecret } from '../../middleware/apiKey.js';
import { AppError } from '../../middleware/error.js';
import { WEBHOOK_EVENTS, sendTestWebhook } from '../../services/webhook.service.js';

const router = Router();

/**
 * @swagger
 * /api/v1/webhooks:
 *   get:
 *     summary: List all webhooks
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of webhooks
 */
router.get('/', requireApiKey(SCOPES.WEBHOOKS_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { apiKeyId: req.apiKey!.id },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        failCount: true,
        createdAt: true,
        updatedAt: true,
        // Don't expose secret
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: webhooks });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/webhooks:
 *   post:
 *     summary: Create a new webhook
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - events
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [party.created, party.updated, party.deleted, party.rsvp_closed, party.rsvp_opened, guest.registered, guest.updated, guest.approved, guest.declined, guest.removed]
 *     responses:
 *       201:
 *         description: Webhook created successfully
 */
router.post('/', requireApiKey(SCOPES.WEBHOOKS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { url, events } = req.body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      throw new AppError('URL is required', 400, 'VALIDATION_ERROR');
    }

    try {
      new URL(url);
    } catch {
      throw new AppError('Invalid URL format', 400, 'VALIDATION_ERROR');
    }

    // Validate events
    if (!events || !Array.isArray(events) || events.length === 0) {
      throw new AppError('At least one event is required', 400, 'VALIDATION_ERROR');
    }

    const invalidEvents = events.filter((e: string) => !WEBHOOK_EVENTS.includes(e as any));
    if (invalidEvents.length > 0) {
      throw new AppError(`Invalid events: ${invalidEvents.join(', ')}. Valid events: ${WEBHOOK_EVENTS.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Generate secret
    const secret = generateWebhookSecret();

    const webhook = await prisma.webhook.create({
      data: {
        url,
        secret,
        events,
        apiKeyId: req.apiKey!.id,
      },
    });

    // Return webhook with secret (only shown once)
    res.status(201).json({
      data: {
        id: webhook.id,
        url: webhook.url,
        secret: webhook.secret, // Only shown on creation
        events: webhook.events,
        active: webhook.active,
        createdAt: webhook.createdAt,
      },
      message: 'Webhook created. Save the secret - it will not be shown again.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}:
 *   get:
 *     summary: Get a webhook by ID
 *     tags: [Webhooks]
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
 *         description: Webhook details
 */
router.get('/:id', requireApiKey(SCOPES.WEBHOOKS_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const webhook = await prisma.webhook.findFirst({
      where: { id, apiKeyId: req.apiKey!.id },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        failCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404, 'NOT_FOUND');
    }

    res.json({ data: webhook });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}:
 *   patch:
 *     summary: Update a webhook
 *     tags: [Webhooks]
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
 *             properties:
 *               url:
 *                 type: string
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Webhook updated successfully
 */
router.patch('/:id', requireApiKey(SCOPES.WEBHOOKS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { url, events, active } = req.body;

    const existing = await prisma.webhook.findFirst({
      where: { id, apiKeyId: req.apiKey!.id },
    });

    if (!existing) {
      throw new AppError('Webhook not found', 404, 'NOT_FOUND');
    }

    // Validate URL if provided
    if (url !== undefined) {
      if (typeof url !== 'string') {
        throw new AppError('URL must be a string', 400, 'VALIDATION_ERROR');
      }
      try {
        new URL(url);
      } catch {
        throw new AppError('Invalid URL format', 400, 'VALIDATION_ERROR');
      }
    }

    // Validate events if provided
    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        throw new AppError('At least one event is required', 400, 'VALIDATION_ERROR');
      }
      const invalidEvents = events.filter((e: string) => !WEBHOOK_EVENTS.includes(e as any));
      if (invalidEvents.length > 0) {
        throw new AppError(`Invalid events: ${invalidEvents.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: {
        ...(url !== undefined && { url }),
        ...(events !== undefined && { events }),
        ...(active !== undefined && { active, failCount: active ? 0 : existing.failCount }), // Reset fail count when re-enabling
      },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        failCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ data: webhook });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook
 *     tags: [Webhooks]
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
 *         description: Webhook deleted successfully
 */
router.delete('/:id', requireApiKey(SCOPES.WEBHOOKS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.webhook.findFirst({
      where: { id, apiKeyId: req.apiKey!.id },
    });

    if (!existing) {
      throw new AppError('Webhook not found', 404, 'NOT_FOUND');
    }

    await prisma.webhook.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}/deliveries:
 *   get:
 *     summary: List webhook deliveries
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of deliveries
 */
router.get('/:id/deliveries', requireApiKey(SCOPES.WEBHOOKS_READ), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const existing = await prisma.webhook.findFirst({
      where: { id, apiKeyId: req.apiKey!.id },
    });

    if (!existing) {
      throw new AppError('Webhook not found', 404, 'NOT_FOUND');
    }

    const [deliveries, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where: { webhookId: id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.webhookDelivery.count({ where: { webhookId: id } }),
    ]);

    res.json({
      data: deliveries,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + deliveries.length < total,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}/test:
 *   post:
 *     summary: Send a test webhook event
 *     tags: [Webhooks]
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
 *         description: Test webhook sent
 */
router.post('/:id/test', requireApiKey(SCOPES.WEBHOOKS_WRITE), async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.webhook.findFirst({
      where: { id, apiKeyId: req.apiKey!.id },
    });

    if (!existing) {
      throw new AppError('Webhook not found', 404, 'NOT_FOUND');
    }

    const result = await sendTestWebhook(id);

    if (result.success) {
      res.json({ success: true, message: 'Test webhook delivered successfully' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
