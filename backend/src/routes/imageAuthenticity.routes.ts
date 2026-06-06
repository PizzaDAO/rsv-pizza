/**
 * marinara-61455: admin image-authenticity (AI-generated / doctored) check.
 *
 * POST /api/admin/image-authenticity
 *   Body: { imageUrl, sourceKind, partyId?, payoutDocumentId?, force? }
 *   - Admin-gated (requireAuth → isAdmin), matching admin.routes.ts.
 *   - Returns the cached row for `imageUrl` unless `force` is true; otherwise
 *     runs the scorer, persists a row to `image_authenticity_checks`, returns it.
 *
 * Advisory only — the verdict flags for human review; nothing auto-rejects.
 *
 * Mounted path-scoped at `/api/admin/image-authenticity` in index.ts (NOT a
 * path-less `router.use`, which would leak to sibling /api/admin routers).
 */

import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { scoreImageAuthenticity, SourceKind } from '../lib/imageAuthenticity.js';

const router = Router();

const VALID_SOURCE_KINDS: SourceKind[] = ['receipt', 'event_image'];

/** Shape the persisted row into the response the frontend consumes. */
function serializeCheck(row: {
  id: string;
  imageUrl: string;
  sourceKind: string;
  partyId: string | null;
  payoutDocumentId: string | null;
  verdict: string;
  score: number;
  reasons: unknown;
  provider: string;
  elaArtifactUrl: string | null;
  checkedAt: Date;
  checkedBy: string | null;
}) {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    sourceKind: row.sourceKind,
    partyId: row.partyId,
    payoutDocumentId: row.payoutDocumentId,
    verdict: row.verdict,
    score: row.score,
    reasons: row.reasons,
    provider: row.provider,
    elaArtifactUrl: row.elaArtifactUrl,
    checkedAt: row.checkedAt.toISOString(),
    checkedBy: row.checkedBy,
  };
}

// GET /api/admin/image-authenticity?imageUrl=... — return the most recent
// cached check for an image, or { check: null } when none exists.
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    const imageUrl = typeof req.query.imageUrl === 'string' ? req.query.imageUrl : '';
    if (!imageUrl) {
      throw new AppError('imageUrl is required', 400, 'VALIDATION_ERROR');
    }
    const cached = await prisma.imageAuthenticityCheck.findFirst({
      where: { imageUrl },
      orderBy: { checkedAt: 'desc' },
    });
    res.json({ check: cached ? serializeCheck(cached) : null });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/image-authenticity — run (or return cached) authenticity check.
router.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { imageUrl, sourceKind, partyId, payoutDocumentId, force } = req.body ?? {};

    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      throw new AppError('imageUrl is required', 400, 'VALIDATION_ERROR');
    }
    if (!VALID_SOURCE_KINDS.includes(sourceKind)) {
      throw new AppError(
        `sourceKind must be one of: ${VALID_SOURCE_KINDS.join(', ')}`,
        400,
        'VALIDATION_ERROR',
      );
    }

    // Return the cached row unless force=true.
    if (force !== true) {
      const cached = await prisma.imageAuthenticityCheck.findFirst({
        where: { imageUrl },
        orderBy: { checkedAt: 'desc' },
      });
      if (cached) {
        return res.json({ check: serializeCheck(cached), cached: true });
      }
    }

    // For receipts, pull OCR line items + amount so the receipt-math pass runs.
    let ocrLineItems: any = null;
    let ocrAmount: number | null = null;
    if (sourceKind === 'receipt' && typeof payoutDocumentId === 'string' && payoutDocumentId) {
      const doc = await prisma.payoutDocument.findUnique({
        where: { id: payoutDocumentId },
        select: { ocrLineItems: true, ocrAmount: true },
      });
      if (doc) {
        ocrLineItems = doc.ocrLineItems ?? null;
        ocrAmount = doc.ocrAmount != null ? Number(doc.ocrAmount) : null;
      }
    }

    const result = await scoreImageAuthenticity({
      imageUrl,
      sourceKind,
      ocrLineItems,
      ocrAmount,
    });

    const row = await prisma.imageAuthenticityCheck.create({
      data: {
        imageUrl,
        sourceKind,
        partyId: typeof partyId === 'string' && partyId ? partyId : null,
        payoutDocumentId:
          typeof payoutDocumentId === 'string' && payoutDocumentId ? payoutDocumentId : null,
        verdict: result.verdict,
        score: result.score,
        reasons: result.reasons as any,
        provider: result.provider,
        elaArtifactUrl: result.elaArtifactUrl,
        checkedBy: req.userEmail ?? null,
      },
    });

    res.json({ check: serializeCheck(row), cached: false });
  } catch (error) {
    next(error);
  }
});

export default router;
