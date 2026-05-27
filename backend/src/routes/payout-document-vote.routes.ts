/**
 * napoletana-58210: thumbs-up voting on payout-sourced pizza photos.
 *
 * The /photos feed and event-page galleries now union the photos table and
 * payout_documents (kind='pizza'). Voting on payout-sourced items uses its
 * own table (`payout_document_votes`) parallel to `photo_votes`, so this
 * router exposes the toggle endpoint:
 *
 *   POST /api/payouts/:payoutId/documents/:docId/vote
 *
 * Mirrors the photo vote endpoint:
 *   - requires auth
 *   - verifies the doc exists, is kind='pizza', and belongs to the payout
 *   - toggles (insert / delete) the (docId, userId) row
 *   - maintains the denormalized vote_count column transactionally
 *   - returns { voted, voteCount }
 */

import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

router.post(
  '/:payoutId/documents/:docId/vote',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { payoutId, docId } = req.params;
      const userId = req.userId;
      if (!userId) {
        throw new AppError('Auth required', 401, 'UNAUTHORIZED');
      }

      // Verify the doc exists, is kind='pizza', and belongs to that payout.
      // Anything else (receipts, mismatched payout) → 404.
      const doc = await prisma.payoutDocument.findFirst({
        where: { id: docId, payoutId, kind: 'pizza' },
        select: { id: true },
      });
      if (!doc) {
        throw new AppError('Payout pizza photo not found', 404, 'NOT_FOUND');
      }

      const existing = await prisma.payoutDocumentVote.findUnique({
        where: { payoutDocumentId_userId: { payoutDocumentId: docId, userId } },
        select: { id: true },
      });

      if (existing) {
        // Toggle off.
        const [, updated] = await prisma.$transaction([
          prisma.payoutDocumentVote.delete({
            where: { payoutDocumentId_userId: { payoutDocumentId: docId, userId } },
          }),
          prisma.payoutDocument.update({
            where: { id: docId },
            data: { voteCount: { decrement: 1 } },
            select: { voteCount: true },
          }),
        ]);
        const voteCount = Math.max(0, updated.voteCount);
        return res.json({ voted: false, voteCount });
      }

      // Toggle on.
      const [, updated] = await prisma.$transaction([
        prisma.payoutDocumentVote.create({
          data: { payoutDocumentId: docId, userId },
        }),
        prisma.payoutDocument.update({
          where: { id: docId },
          data: { voteCount: { increment: 1 } },
          select: { voteCount: true },
        }),
      ]);
      return res.json({ voted: true, voteCount: updated.voteCount });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
