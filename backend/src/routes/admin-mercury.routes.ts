/**
 * stromboli-58524: Admin Mercury wire-reconciliation routes.
 * Mounted at /api/admin/mercury (see backend/src/index.ts).
 *
 * All endpoints require auth + payment-admin or higher.
 */

import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { reconcileWires, markInvoicePaidInternal } from '../services/mercury.service.js';

const router = Router();

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────

async function requireAnyAdminOrPaymentAdmin(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    if (!(await isPaymentAdmin(req.userEmail))) {
      throw new AppError('Payments admin access required', 403, 'FORBIDDEN');
    }
    next();
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────
// POST /api/admin/mercury/reconcile
// Run the reconciler — poll Mercury and auto-match invoices.
// ──────────────────────────────────────────────

router.post('/reconcile', requireAuth, requireAnyAdminOrPaymentAdmin, async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await reconcileWires();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────
// GET /api/admin/mercury/matches?status=needs_review
// List match rows for the admin review queue (joined with invoice info).
// ──────────────────────────────────────────────

router.get('/matches', requireAuth, requireAnyAdminOrPaymentAdmin, async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status } = req.query;

    const where: Record<string, any> = {};
    if (status && typeof status === 'string') {
      // Support comma-separated list, e.g. ?status=needs_review,unmatched
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else if (statuses.length > 1) {
        where.status = { in: statuses };
      }
    }

    const matches = await prisma.mercuryWireMatch.findMany({
      where,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            billToCompany: true,
            total: true,
            status: true,
            sponsor: { select: { name: true } },
            party: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    res.json({ matches });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────
// POST /api/admin/mercury/matches/:id/resolve
// Manually link a needs_review/unmatched txn to an invoice and mark it paid.
// Body: { invoiceId: string }
// ──────────────────────────────────────────────

router.post('/matches/:id/resolve', requireAuth, requireAnyAdminOrPaymentAdmin, async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { invoiceId } = req.body;

    if (!invoiceId) {
      throw new AppError('invoiceId is required', 400, 'VALIDATION_ERROR');
    }

    const match = await prisma.mercuryWireMatch.findUnique({ where: { id } });
    if (!match) {
      throw new AppError('Match not found', 404, 'NOT_FOUND');
    }

    if (match.status === 'auto_paid') {
      throw new AppError('This match is already auto-paid', 400, 'ALREADY_RESOLVED');
    }

    // Verify invoice exists and is payable
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    }
    if (!['issued', 'viewed'].includes(invoice.status)) {
      throw new AppError(
        `Invoice status is "${invoice.status}" — only issued or viewed invoices can be marked paid`,
        400,
        'INVALID_STATUS'
      );
    }

    await markInvoicePaidInternal(invoiceId, {
      paymentMethod: 'wire',
      paymentRef: `Mercury wire ${match.mercuryTxnId} / ${match.counterparty ?? 'unknown'} (manual resolve)`,
      paidAmount: match.amount,
    });

    const updated = await prisma.mercuryWireMatch.update({
      where: { id },
      data: {
        invoiceId,
        status: 'auto_paid',
        updatedAt: new Date(),
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            billToCompany: true,
            total: true,
            status: true,
            sponsor: { select: { name: true } },
            party: { select: { name: true } },
          },
        },
      },
    });

    res.json({ match: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
