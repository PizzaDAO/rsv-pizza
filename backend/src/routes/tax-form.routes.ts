/**
 * salame-92110: host-facing + admin endpoints for tax forms (W-9 / W-8BEN /
 * W-8BEN-E).
 *
 * Host endpoints (authed):
 *   GET    /api/tax-forms/me                   List my tax forms (latest first)
 *   POST   /api/tax-forms/draft                Upsert my draft for a form type
 *   POST   /api/tax-forms/submit               Finalize current draft → generate PDF → status='submitted'
 *
 * Admin endpoints (admin / payment_admin / super_admin):
 *   GET    /api/admin/tax-forms                List with filters (status, form_type, user_id, expiring)
 *   GET    /api/admin/tax-forms/:id            Detail (includes form_data jsonb)
 *   POST   /api/admin/tax-forms/:id/verify     Stamp verified_at + verified_by
 *   POST   /api/admin/tax-forms/:id/reject     Set status='rejected' + rejected_reason
 *
 * Phase 1 scope: no expiry cron, no 1099-NEC year-end generator. Those land
 * in phase 2.
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { getSignedTaxFormUrl, TaxFormType } from '../services/taxFormStorage.service.js';
import {
  isValidFormType,
  saveTaxFormDraftCore,
  submitTaxFormCore,
} from '../services/taxFormCore.service.js';

export const taxFormRouter = Router();
export const adminTaxFormRouter = Router();

// Verify/reject mirror onto tax_form_requests (calzone-70821).
import { mirrorRequestStatus } from '../services/taxFormCore.service.js';

const STATUSES = ['draft', 'submitted', 'verified', 'rejected'] as const;
type TaxFormStatus = (typeof STATUSES)[number];

// ---------- helpers ----------


// NOTE: `t.pdfUrl` / `t.pdfThumbUrl` in the DB are private-bucket object PATHS
// (salame-92110 security fix), never public URLs. Callers must resolve them to
// short-lived signed URLs via `serializeTaxForm` (async), which mints them on
// each read. The path is never returned to clients.
async function serializeTaxForm(t: any, includeFormData: boolean) {
  const [pdfUrl, pdfThumbUrl] = await Promise.all([
    getSignedTaxFormUrl(t.pdfUrl),
    getSignedTaxFormUrl(t.pdfThumbUrl),
  ]);
  return {
    id: t.id,
    userId: t.userId,
    formType: t.formType,
    status: t.status,
    pdfUrl,
    pdfThumbUrl,
    signedAt: t.signedAt ? t.signedAt.toISOString() : null,
    expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
    verifiedAt: t.verifiedAt ? t.verifiedAt.toISOString() : null,
    verifiedBy: t.verifiedBy ?? null,
    rejectedReason: t.rejectedReason ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ...(includeFormData ? { formData: t.formData ?? {} } : {}),
    ...(t.user ? { user: { id: t.user.id, name: t.user.name ?? null, email: t.user.email ?? null } } : {}),
  };
}

// ============================================================================
// Host endpoints
// ============================================================================

taxFormRouter.use(requireAuth);

// GET /api/tax-forms/me — list authed user's tax forms (latest first)
taxFormRouter.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('No user id on request', 500, 'NO_USER_ID');
    // calzone-70821: request-owned (token-link) forms are never listed here,
    // even if a user_id were somehow set on one.
    const forms = await prisma.taxForm.findMany({
      where: { userId: req.userId, requestId: null },
      orderBy: [{ updatedAt: 'desc' }],
    });
    res.json({ taxForms: await Promise.all(forms.map((t) => serializeTaxForm(t, /* includeFormData */ true))) });
  } catch (error) {
    next(error);
  }
});

// POST /api/tax-forms/draft — create/update draft for a form type
// Body: { formType: 'w9'|'w8ben'|'w8bene', formData: {...} }
// Idempotent per (user, form_type) — upserts the user's existing draft if
// one exists, otherwise creates a new row. Replacing a submitted form
// requires posting a new draft of the same type (which appears alongside).
taxFormRouter.post('/draft', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('No user id on request', 500, 'NO_USER_ID');
    const { formType, formData } = (req.body || {}) as {
      formType?: unknown;
      formData?: unknown;
    };
    if (!isValidFormType(formType)) {
      throw new AppError('formType must be w9|w8ben|w8bene', 400, 'INVALID_FORM_TYPE');
    }
    if (formData == null || typeof formData !== 'object') {
      throw new AppError('formData must be an object', 400, 'INVALID_FORM_DATA');
    }

    const { row, created } = await saveTaxFormDraftCore({ userId: req.userId }, formType, formData);

    res.status(created ? 201 : 200).json({ taxForm: await serializeTaxForm(row, true) });
  } catch (error) {
    next(error);
  }
});

// POST /api/tax-forms/submit — finalize draft (or submit new) → PDF → store
// Body: { formType: 'w9'|'w8ben'|'w8bene', formData?: {...} }
//   - If formData is provided, the draft is updated to that data first.
//   - Validates required fields, generates the PDF, uploads it, then writes:
//       status='submitted', signed_at=now(), expires_at, pdf_url.
taxFormRouter.post('/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('No user id on request', 500, 'NO_USER_ID');
    const { formType, formData } = (req.body || {}) as {
      formType?: unknown;
      formData?: unknown;
    };
    if (!isValidFormType(formType)) {
      throw new AppError('formType must be w9|w8ben|w8bene', 400, 'INVALID_FORM_TYPE');
    }

    const row = await submitTaxFormCore({ userId: req.userId }, formType, formData);

    res.status(200).json({ taxForm: await serializeTaxForm(row, true) });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Admin endpoints
// ============================================================================

adminTaxFormRouter.use(requireAuth);

async function requireAnyAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isPaymentAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    next();
  } catch (e) {
    next(e);
  }
}
adminTaxFormRouter.use(requireAnyAdmin);

// GET /api/admin/tax-forms?status=&formType=&userId=&expiringWithinDays=
adminTaxFormRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, formType, userId, expiringWithinDays } = req.query;
    const where: Prisma.TaxFormWhereInput = {};
    if (typeof status === 'string' && (STATUSES as ReadonlyArray<string>).includes(status)) {
      where.status = status;
    }
    if (isValidFormType(formType)) {
      where.formType = formType;
    }
    if (typeof userId === 'string' && userId.trim()) {
      where.userId = userId.trim();
    }
    if (typeof expiringWithinDays === 'string') {
      const n = Number(expiringWithinDays);
      if (Number.isFinite(n) && n > 0) {
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() + n);
        where.expiresAt = { not: null, lte: cutoff };
      }
    }

    const rows = await prisma.taxForm.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: { user: { select: { id: true, name: true, email: true } } },
      take: 500,
    });

    // Tight payload — omit form_data on the list (it's only fetched on detail).
    res.json({ taxForms: await Promise.all(rows.map((t) => serializeTaxForm(t, /* includeFormData */ false))) });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/tax-forms/:id — full detail incl. form_data jsonb
adminTaxFormRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.taxForm.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!row) throw new AppError('Tax form not found', 404, 'NOT_FOUND');
    res.json({ taxForm: await serializeTaxForm(row, /* includeFormData */ true) });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/tax-forms/:id/verify
adminTaxFormRouter.post(
  '/:id/verify',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const row = await prisma.taxForm.findUnique({ where: { id: req.params.id } });
      if (!row) throw new AppError('Tax form not found', 404, 'NOT_FOUND');
      if (row.status !== 'submitted') {
        throw new AppError(
          'Only submitted forms can be verified',
          400,
          'INVALID_STATUS_TRANSITION',
        );
      }
      const updated = await prisma.taxForm.update({
        where: { id: row.id },
        data: {
          status: 'verified',
          verifiedAt: new Date(),
          verifiedBy: req.userEmail || null,
          rejectedReason: null,
        },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await mirrorRequestStatus(updated.id, 'verified');
      res.json({ taxForm: await serializeTaxForm(updated, true) });
    } catch (error) {
      next(error);
    }
  },
);

// POST /api/admin/tax-forms/:id/reject  Body: { reason: string }
adminTaxFormRouter.post(
  '/:id/reject',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reason } = (req.body || {}) as { reason?: unknown };
      if (typeof reason !== 'string' || !reason.trim()) {
        throw new AppError('reason is required', 400, 'REASON_REQUIRED');
      }
      const row = await prisma.taxForm.findUnique({ where: { id: req.params.id } });
      if (!row) throw new AppError('Tax form not found', 404, 'NOT_FOUND');
      if (row.status !== 'submitted' && row.status !== 'verified') {
        throw new AppError('Only submitted or verified forms can be rejected', 400, 'INVALID_STATUS_TRANSITION');
      }
      const updated = await prisma.taxForm.update({
        where: { id: row.id },
        data: {
          status: 'rejected',
          rejectedReason: reason.trim(),
          verifiedAt: null,
          verifiedBy: null,
        },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await mirrorRequestStatus(updated.id, 'rejected');
      res.json({ taxForm: await serializeTaxForm(updated, true) });
    } catch (error) {
      next(error);
    }
  },
);

// Convenience helper exported for use in the payout-submission gate.
export async function getLatestSubmittedTaxFormForUser(userId: string) {
  return prisma.taxForm.findFirst({
    where: {
      userId,
      requestId: null, // calzone-70821: token-link forms never satisfy the payout gate
      status: { in: ['submitted', 'verified'] },
    },
    orderBy: [{ updatedAt: 'desc' }],
  });
}

// marinara-71630 P2: the US YTD W-9 threshold (W-9 required at or above this)
// moved to app_config — read it via `getPayoutCaps().w9ThresholdUsd` (see
// backend/src/lib/privateConfig.ts) so the real value stays out of committed
// source. Consumers resolve the caps at their async entry point.

/**
 * Sum paid + approved + queued payouts for a user in the current calendar
 * year. Used by the payout-submission gate to decide whether the W-9 floor
 * has been crossed.
 */
export async function getYtdPayoutTotalUsd(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCMonth(0, 1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.payout.findMany({
    where: {
      hostUserId: userId,
      status: { in: ['paid', 'approved', 'queued', 'completed'] },
      createdAt: { gte: start },
    },
    select: { finalAmountUsd: true },
  });
  return rows.reduce((s, r) => s + Number(r.finalAmountUsd), 0);
}
