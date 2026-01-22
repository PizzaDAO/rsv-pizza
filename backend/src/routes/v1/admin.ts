import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin, SUPER_ADMIN_EMAIL } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { generateApiKey, SCOPES, Scope } from '../../middleware/apiKey.js';

const router = Router();

// Middleware to require super admin access
const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isSuperAdmin(req.userEmail)) {
    throw new AppError(`Admin access required (${SUPER_ADMIN_EMAIL})`, 403, 'FORBIDDEN');
  }
  next();
};

/**
 * @swagger
 * /api/v1/admin/keys:
 *   get:
 *     summary: List all API key requests (admin only)
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of API key requests
 *       403:
 *         description: Admin access required
 */
router.get('/keys', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    const whereClause: any = {};
    if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
      whereClause.status = statusFilter;
    }

    const keys = await prisma.apiKey.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimit: true,
        expiresAt: true,
        revoked: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        approvedBy: true,
        lastUsedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            username: true,
          },
        },
        _count: { select: { apiRequests: true } },
      },
      orderBy: [
        { status: 'asc' }, // pending first
        { requestedAt: 'desc' },
      ],
    });

    res.json({
      data: keys.map(k => ({
        ...k,
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
 * /api/v1/admin/keys/{id}:
 *   get:
 *     summary: Get API key request details (admin only)
 *     tags: [Admin]
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
router.get('/keys/:id', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            createdAt: true,
          },
        },
        _count: { select: { webhooks: true, apiRequests: true } },
      },
    });

    if (!apiKey) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    res.json({
      data: {
        ...apiKey,
        key: undefined, // Don't expose the hash
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
 * /api/v1/admin/keys/{id}/approve:
 *   post:
 *     summary: Approve an API key request (admin only)
 *     tags: [Admin]
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
 *               rateLimit:
 *                 type: integer
 *                 description: Custom rate limit (default 500)
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Override requested scopes
 *     responses:
 *       200:
 *         description: API key approved and generated
 */
router.post('/keys/:id/approve', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { rateLimit, scopes } = req.body;

    const existing = await prisma.apiKey.findUnique({
      where: { id },
      include: {
        user: { select: { email: true } },
      },
    });

    if (!existing) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'pending') {
      throw new AppError(`API key is already ${existing.status}`, 400, 'INVALID_STATUS');
    }

    // Validate custom rate limit if provided
    let finalRateLimit = 500;
    if (rateLimit !== undefined) {
      if (typeof rateLimit !== 'number' || rateLimit < 1 || rateLimit > 10000) {
        throw new AppError('Rate limit must be between 1 and 10000', 400, 'VALIDATION_ERROR');
      }
      finalRateLimit = rateLimit;
    }

    // Validate custom scopes if provided
    let finalScopes = existing.scopes;
    if (scopes !== undefined) {
      const validScopes = Object.values(SCOPES);
      if (!Array.isArray(scopes) || scopes.length === 0) {
        throw new AppError('At least one scope is required', 400, 'VALIDATION_ERROR');
      }
      const invalidScopes = scopes.filter((s: string) => !validScopes.includes(s as Scope));
      if (invalidScopes.length > 0) {
        throw new AppError(`Invalid scopes: ${invalidScopes.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
      finalScopes = scopes;
    }

    // Generate the actual API key
    const { key, hash, prefix } = generateApiKey();

    // Update the API key record
    await prisma.apiKey.update({
      where: { id },
      data: {
        key: hash,
        keyPrefix: prefix,
        scopes: finalScopes,
        rateLimit: finalRateLimit,
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: req.userId,
      },
    });

    res.json({
      success: true,
      message: 'API key approved',
      data: {
        id: existing.id,
        name: existing.name,
        key, // Return the actual key (only time it's shown)
        keyPrefix: prefix,
        scopes: finalScopes,
        rateLimit: finalRateLimit,
        userEmail: existing.user.email,
      },
      warning: 'Save this API key now. It will not be shown again.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/admin/keys/{id}/reject:
 *   post:
 *     summary: Reject an API key request (admin only)
 *     tags: [Admin]
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
 *               reason:
 *                 type: string
 *                 description: Optional rejection reason
 *     responses:
 *       200:
 *         description: API key request rejected
 */
router.post('/keys/:id/reject', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError('API key not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'pending') {
      throw new AppError(`API key is already ${existing.status}`, 400, 'INVALID_STATUS');
    }

    await prisma.apiKey.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedBy: req.userId, // Records who rejected it
      },
    });

    res.json({
      success: true,
      message: 'API key request rejected',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/admin/keys/{id}/revoke:
 *   post:
 *     summary: Revoke an API key (admin only)
 *     tags: [Admin]
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
router.post('/keys/:id/revoke', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.apiKey.findUnique({
      where: { id },
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

    res.json({
      success: true,
      message: 'API key revoked',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/admin/stats:
 *   get:
 *     summary: Get API usage statistics (admin only)
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: API usage statistics
 */
router.get('/stats', requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [
      totalKeys,
      pendingKeys,
      approvedKeys,
      revokedKeys,
      totalWebhooks,
      activeWebhooks,
      totalRequests,
      recentRequests,
    ] = await Promise.all([
      prisma.apiKey.count(),
      prisma.apiKey.count({ where: { status: 'pending' } }),
      prisma.apiKey.count({ where: { status: 'approved', revoked: false } }),
      prisma.apiKey.count({ where: { revoked: true } }),
      prisma.webhook.count(),
      prisma.webhook.count({ where: { active: true } }),
      prisma.apiRequest.count(),
      prisma.apiRequest.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    res.json({
      data: {
        apiKeys: {
          total: totalKeys,
          pending: pendingKeys,
          approved: approvedKeys,
          revoked: revokedKeys,
        },
        webhooks: {
          total: totalWebhooks,
          active: activeWebhooks,
        },
        requests: {
          total: totalRequests,
          last24Hours: recentRequests,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
