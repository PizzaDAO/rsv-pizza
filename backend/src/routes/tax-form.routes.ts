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
import {
  generateW9PDF,
  generateW8BENPDF,
  generateW8BENEPDF,
  W9FormData,
  W8BENFormData,
  W8BENEFormData,
} from '../services/taxFormPdf.service.js';
import { uploadTaxFormPdf, TaxFormType } from '../services/taxFormStorage.service.js';

export const taxFormRouter = Router();
export const adminTaxFormRouter = Router();

const FORM_TYPES: ReadonlyArray<TaxFormType> = ['w9', 'w8ben', 'w8bene'] as const;
const STATUSES = ['draft', 'submitted', 'verified', 'rejected'] as const;
type TaxFormStatus = (typeof STATUSES)[number];

// ---------- helpers ----------

function isValidFormType(v: unknown): v is TaxFormType {
  return typeof v === 'string' && (FORM_TYPES as ReadonlyArray<string>).includes(v);
}

function serializeTaxForm(t: any, includeFormData: boolean) {
  return {
    id: t.id,
    userId: t.userId,
    formType: t.formType,
    status: t.status,
    pdfUrl: t.pdfUrl ?? null,
    pdfThumbUrl: t.pdfThumbUrl ?? null,
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

/**
 * Validate the minimal required fields per form type before generating a PDF.
 * Throws AppError(400, 'INVALID_FORM_DATA') with a human-readable message
 * naming the missing field.
 */
function assertSubmitValid(formType: TaxFormType, data: any): void {
  function requireField(field: string) {
    if (!data || typeof data[field] !== 'string' || !data[field].trim()) {
      throw new AppError(
        `Missing required field: ${field}`,
        400,
        'INVALID_FORM_DATA',
      );
    }
  }
  if (formType === 'w9') {
    requireField('name');
    requireField('taxClassification');
    requireField('address');
    requireField('cityStateZip');
    requireField('signature');
    requireField('date');
    // Exactly one of SSN / EIN must be present.
    const hasSsn = typeof data.ssn === 'string' && data.ssn.trim();
    const hasEin = typeof data.ein === 'string' && data.ein.trim();
    if (!hasSsn && !hasEin) {
      throw new AppError(
        'Either SSN or EIN is required on the W-9',
        400,
        'INVALID_FORM_DATA',
      );
    }
  } else if (formType === 'w8ben') {
    requireField('name');
    requireField('citizenship');
    requireField('permanentAddress');
    requireField('permanentCity');
    requireField('permanentCountry');
    requireField('dateOfBirth');
    requireField('signature');
    requireField('date');
  } else if (formType === 'w8bene') {
    requireField('entityName');
    requireField('countryOfIncorporation');
    requireField('entityType');
    requireField('chapter4Status');
    requireField('permanentAddress');
    requireField('permanentCity');
    requireField('permanentCountry');
    requireField('signature');
    requireField('date');
    if (data.chapter4Status === 'ffi') {
      // FFI requires the long-form FATCA classification we don't render.
      throw new AppError(
        'FFI entities require a paper W-8BEN-E — please contact an admin',
        400,
        'FFI_PAPER_FORM_REQUIRED',
      );
    }
  }
}

/**
 * Compute the IRS expiry for a W-8 form: signed_at + 3 years and the rest of
 * the calendar year. Simplified to "signed_at + 3 years 11 months" — phase 2
 * cron refines this if needed.
 *
 * W-9 has no expiry (returns null).
 */
function computeExpiry(formType: TaxFormType, signedAt: Date): Date | null {
  if (formType === 'w9') return null;
  const d = new Date(signedAt);
  d.setUTCMonth(d.getUTCMonth() + 47); // 3 years 11 months
  return d;
}

// ============================================================================
// Host endpoints
// ============================================================================

taxFormRouter.use(requireAuth);

// GET /api/tax-forms/me — list authed user's tax forms (latest first)
taxFormRouter.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('No user id on request', 500, 'NO_USER_ID');
    const forms = await prisma.taxForm.findMany({
      where: { userId: req.userId },
      orderBy: [{ updatedAt: 'desc' }],
    });
    res.json({ taxForms: forms.map((t) => serializeTaxForm(t, /* includeFormData */ true)) });
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

    // Look for an existing draft of this type for this user. If found, update
    // in place (so editing the form before submit doesn't pile up rows).
    const existingDraft = await prisma.taxForm.findFirst({
      where: { userId: req.userId, formType, status: 'draft' },
      orderBy: { updatedAt: 'desc' },
    });

    const data = formData as Prisma.InputJsonValue;

    let row;
    if (existingDraft) {
      row = await prisma.taxForm.update({
        where: { id: existingDraft.id },
        data: { formData: data },
      });
    } else {
      row = await prisma.taxForm.create({
        data: {
          userId: req.userId,
          formType,
          status: 'draft',
          formData: data,
        },
      });
    }

    res.status(existingDraft ? 200 : 201).json({ taxForm: serializeTaxForm(row, true) });
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

    // Locate the current draft for this type; either we're submitting one
    // the host already saved, or we'll create a fresh row.
    let draft = await prisma.taxForm.findFirst({
      where: { userId: req.userId, formType, status: 'draft' },
      orderBy: { updatedAt: 'desc' },
    });

    // Merge incoming formData over the saved draft (or use it standalone).
    const dataToValidate = formData && typeof formData === 'object'
      ? { ...(draft?.formData as any || {}), ...(formData as any) }
      : (draft?.formData as any || {});

    assertSubmitValid(formType, dataToValidate);

    // Render the PDF — use a stable shortish reference id for the PDF footer.
    // We use the draft id when available, otherwise a placeholder until insert.
    const refIdForPdf = draft?.id || `${formType}-${Date.now()}`;
    let pdf: Buffer;
    if (formType === 'w9') {
      pdf = await generateW9PDF(dataToValidate as W9FormData, refIdForPdf.slice(0, 8));
    } else if (formType === 'w8ben') {
      pdf = await generateW8BENPDF(dataToValidate as W8BENFormData, refIdForPdf.slice(0, 8));
    } else {
      pdf = await generateW8BENEPDF(dataToValidate as W8BENEFormData, refIdForPdf.slice(0, 8));
    }

    // Upload to storage.
    const { url, thumbUrl } = await uploadTaxFormPdf(pdf, req.userId, formType);

    // Persist as submitted.
    const now = new Date();
    const expiresAt = computeExpiry(formType, now);
    let row;
    if (draft) {
      row = await prisma.taxForm.update({
        where: { id: draft.id },
        data: {
          formData: dataToValidate as Prisma.InputJsonValue,
          status: 'submitted',
          pdfUrl: url,
          pdfThumbUrl: thumbUrl,
          signedAt: now,
          expiresAt,
          // Clear any prior rejection state if the host re-submits.
          rejectedReason: null,
        },
      });
    } else {
      row = await prisma.taxForm.create({
        data: {
          userId: req.userId,
          formType,
          status: 'submitted',
          formData: dataToValidate as Prisma.InputJsonValue,
          pdfUrl: url,
          pdfThumbUrl: thumbUrl,
          signedAt: now,
          expiresAt,
        },
      });
    }

    res.status(200).json({ taxForm: serializeTaxForm(row, true) });
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
    res.json({ taxForms: rows.map((t) => serializeTaxForm(t, /* includeFormData */ false)) });
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
    res.json({ taxForm: serializeTaxForm(row, /* includeFormData */ true) });
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
      res.json({ taxForm: serializeTaxForm(updated, true) });
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
      res.json({ taxForm: serializeTaxForm(updated, true) });
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
      status: { in: ['submitted', 'verified'] },
    },
    orderBy: [{ updatedAt: 'desc' }],
  });
}

// US YTD payout threshold — W-9 required at or above this.
export const US_W9_YTD_THRESHOLD_USD = 600;

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
