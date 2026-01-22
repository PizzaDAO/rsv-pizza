import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../config/database.js';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { generateApiKey, SCOPES, Scope } from '../../middleware/apiKey.js';

const router = Router();

// All routes use JWT auth (requireAuth), not API key auth

/**
 * @swagger
 * /api/v1/keys:
 *   get:
 *     summary: List user's API keys
 *     tags: [API Keys]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of API keys
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.userId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        expiresAt: true,
        revoked: true,
        revokedAt: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        lastUsedAt: true,
        createdAt: true,
        _count: { select: { webhooks: true, apiRequests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      data: keys.map(k => ({
        ...k,
        webhookCount: k._count.webhooks,
        requestCount: k._count.apiRequests,
        _count: undefined,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/keys:
 *   post:
 *     summary: Request a new API key
 *     description: Creates an API key request that requires admin approval
 *     tags: [API Keys]
 *     security:
 *       - BearerAuth: []
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
 *                 description: Friendly name for the API key
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [parties:read, parties:write, guests:read, guests:write, webhooks:read, webhooks:write]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration date
 *     responses:
 *       201:
 *         description: API key request created (pending approval)
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, scopes, expiresAt } = req.body;

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    if (name.length > 100) {
      throw new AppError('Name must be 100 characters or less', 400, 'VALIDATION_ERROR');
    }

    // Validate scopes
    const validScopes = Object.values(SCOPES);
    const requestedScopes: Scope[] = scopes || validScopes; // Default to all scopes

    if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
      throw new AppError('At least one scope is required', 400, 'VALIDATION_ERROR');
    }

    const invalidScopes = requestedScopes.filter(s => !validScopes.includes(s as Scope));
    if (invalidScopes.length > 0) {
      throw new AppError(`Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${validScopes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate expiration if provided
    let expiresAtDate: Date | null = null;
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        throw new AppError('Invalid expiration date', 400, 'VALIDATION_ERROR');
      }
      if (expiresAtDate <= new Date()) {
        throw new AppError('Expiration date must be in the future', 400, 'VALIDATION_ERROR');
      }
    }

    // Generate key (but don't store the actual key yet - we'll generate it on approval)
    // For now, store a placeholder hash
    const placeholderHash = `pending_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        key: placeholderHash, // Placeholder until approved
        keyPrefix: 'pending',
        scopes: requestedScopes,
        expiresAt: expiresAtDate,
        status: 'pending',
        userId: req.userId!,
      },
      select: {
        id: true,
        name: true,
        scopes: true,
        expiresAt: true,
        status: true,
        requestedAt: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      data: apiKey,
      message: 'API key request submitted. An admin will review your request.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/keys/{id}:
 *   get:
 *     summary: Get API key details
 *     tags: [API Keys]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key details
 */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const apiKey = await prisma.apiKey.findFirst({
      where: { id, userId: req.userId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        expiresAt: true,
        revoked: true,
        revokedAt: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { webhooks: true, apiRequests: true } },
      },
    });

    if (!apiKey) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    res.json({
      data: {
        ...apiKey,
        webhookCount: apiKey._count.webhooks,
        requestCount: apiKey._count.apiRequests,
        _count: undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/keys/{id}:
 *   patch:
 *     summary: Update an API key
 *     tags: [API Keys]
 *     security:
 *       - BearerAuth: []
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
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: API key updated
 */
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    // Only allow updating name (scopes/rateLimit require admin)
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new AppError('Name cannot be empty', 400, 'VALIDATION_ERROR');
      }
      if (name.length > 100) {
        throw new AppError('Name must be 100 characters or less', 400, 'VALIDATION_ERROR');
      }
    }

    const apiKey = await prisma.apiKey.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        expiresAt: true,
        status: true,
        revoked: true,
        updatedAt: true,
      },
    });

    res.json({ data: apiKey });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     tags: [API Keys]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key revoked
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    if (existing.revoked) {
      throw new AppError('API key is already revoked', 400, 'ALREADY_REVOKED');
    }

    await prisma.apiKey.update({
      where: { id },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/keys/{id}/usage:
 *   get:
 *     summary: Get API key usage statistics
 *     tags: [API Keys]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *         description: Number of days to include in statistics
 *     responses:
 *       200:
 *         description: Usage statistics
 */
router.get('/:id/usage', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get request counts grouped by day
    const requests = await prisma.apiRequest.findMany({
      where: {
        apiKeyId: id,
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
        statusCode: true,
        responseTime: true,
      },
    });

    // Aggregate stats
    const totalRequests = requests.length;
    const successfulRequests = requests.filter(r => r.statusCode >= 200 && r.statusCode < 400).length;
    const failedRequests = requests.filter(r => r.statusCode >= 400).length;
    const avgResponseTime = requests.length > 0
      ? Math.round(requests.reduce((sum, r) => sum + r.responseTime, 0) / requests.length)
      : 0;

    // Group by day
    const byDay: Record<string, number> = {};
    for (const req of requests) {
      const day = req.createdAt.toISOString().split('T')[0];
      byDay[day] = (byDay[day] || 0) + 1;
    }

    res.json({
      data: {
        period: { days, startDate, endDate: new Date() },
        summary: {
          totalRequests,
          successfulRequests,
          failedRequests,
          successRate: totalRequests > 0 ? Math.round((successfulRequests / totalRequests) * 100) : 0,
          avgResponseTime,
        },
        byDay: Object.entries(byDay)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
