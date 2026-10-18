/**
 * calzone-70821: standalone tax-form requests.
 *
 * Public, token-authed (the link token is the credential):
 *   GET  /api/tax-form-requests/:token          Request info + current draft (TINs stripped)
 *   POST /api/tax-form-requests/:token/draft    Save draft
 *   POST /api/tax-form-requests/:token/submit   Submit -> PDF -> private bucket; locks the token
 *
 * Admin (/api/admin/tax-form-requests, requireAnyAdmin):
 *   POST /                    Create one ({label,...}) or many ({requests:[...]}); returns tokens
 *   GET  /                    List (metadata only, no form contents)
 *   POST /:id/revoke
 *   POST /:id/regenerate-token
 *
 * Verify/reject go through /api/admin/tax-forms/:id/verify|reject, which
 * mirror status onto the request. NEVER log formData or return TINs here.
 */
import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { requireAuth, optionalAuth, AuthRequest, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import {
  isValidFormType,
  saveTaxFormDraftCore,
  submitTaxFormCore,
} from '../services/taxFormCore.service.js';

export const publicTaxFormRequestRouter = Router();
export const adminTaxFormRequestRouter = Router();

const REQUESTERS = ['rare_pizzas', 'pizzadao'] as const;
const REQUESTER_LABEL: Record<string, string> = { rare_pizzas: 'Rare Pizzas', pizzadao: 'PizzaDAO' };
const STATUSES = ['sent', 'opened', 'draft', 'submitted', 'verified', 'rejected'] as const;
const MAX_BULK = 500;

// Fields that hold tax identifiers; never returned by the public API.
const TIN_KEYS = new Set(['ssn', 'ein', 'tin', 'itin', 'usTin', 'foreignTin', 'giin']);

function stripTins(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!TIN_KEYS.has(k)) out[k] = v;
    }
  }
  return out;
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url'); // 256-bit
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const NOT_FOUND = () => new AppError('This link is invalid or no longer active.', 404, 'INVALID_TOKEN');

// ---------- rate limiting (per IP, and per IP+token) ----------
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Too many requests, please try again later.' },
});
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => `${req.ip}:${String(req.params.token || '').slice(0, 64)}`,
  message: { error: 'Too many requests, please try again later.' },
});
publicTaxFormRequestRouter.use(ipLimiter);

/** Resolve a live (non-revoked) request by token; constant-time re-check. */
async function loadRequest(token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) throw NOT_FOUND();
  const row = await prisma.taxFormRequest.findUnique({ where: { token } });
  if (!row || row.revokedAt || !safeEqual(row.token, token)) throw NOT_FOUND();
  return row;
}

async function payload(row: Awaited<ReturnType<typeof loadRequest>>) {
  let currentDraft: { formType: string; formData: Record<string, unknown> } | null = null;
  let rejectedReason: string | null = null;
  let formType: string | null = null;
  if (row.taxFormId) {
    const f = await prisma.taxForm.findUnique({ where: { id: row.taxFormId } });
    if (f) {
      formType = f.formType;
      if (f.status === 'rejected') rejectedReason = f.rejectedReason ?? null;
    }
  }
  if (row.status === 'draft' || row.status === 'rejected' || row.status === 'opened' || row.status === 'sent') {
    const d = await prisma.taxForm.findFirst({
      where: { requestId: row.id, status: 'draft' },
      orderBy: { updatedAt: 'desc' },
    });
    if (d) currentDraft = { formType: d.formType, formData: stripTins(d.formData) };
  }
  return {
    payeeLabel: row.payeeLabel,
    requester: REQUESTER_LABEL[row.requester] ?? row.requester,
    suggestedFormType: row.suggestedFormType,
    taxYearNote: row.taxYearNote,
    status: row.status,
    // Locked once submitted/verified; only an admin rejection reopens it.
    locked: row.status === 'submitted' || row.status === 'verified',
    submittedFormType: row.status === 'submitted' || row.status === 'verified' ? formType : null,
    rejectedReason,
    currentDraft,
  };
}

publicTaxFormRequestRouter.get('/:token', tokenLimiter, async (req, res: Response, next: NextFunction) => {
  try {
    let row = await loadRequest(req.params.token);
    if (!row.openedAt) {
      row = await prisma.taxFormRequest.update({
        where: { id: row.id },
        data: { openedAt: new Date(), ...(row.status === 'sent' ? { status: 'opened' } : {}) },
      });
    }
    res.json(await payload(row));
  } catch (e) {
    next(e);
  }
});

function assertEditable(row: { status: string }) {
  if (row.status === 'submitted' || row.status === 'verified') {
    throw new AppError('This form has already been submitted.', 409, 'TOKEN_LOCKED');
  }
}

publicTaxFormRequestRouter.post(
  '/:token/draft',
  tokenLimiter,
  optionalAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const row = await loadRequest(req.params.token);
      assertEditable(row);
      const { formType, formData } = (req.body || {}) as { formType?: unknown; formData?: unknown };
      if (!isValidFormType(formType)) {
        throw new AppError('formType must be w9|w8ben|w8bene', 400, 'INVALID_FORM_TYPE');
      }
      const { row: form } = await saveTaxFormDraftCore(
        { requestId: row.id, userId: req.userId ?? null },
        formType,
        formData,
      );
      await prisma.taxFormRequest.update({
        where: { id: row.id },
        data: {
          status: 'draft',
          taxFormId: form.id,
          ...(req.userId && !row.userId ? { userId: req.userId } : {}),
        },
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

publicTaxFormRequestRouter.post(
  '/:token/submit',
  tokenLimiter,
  optionalAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const row = await loadRequest(req.params.token);
      assertEditable(row);
      const { formType, formData } = (req.body || {}) as { formType?: unknown; formData?: unknown };
      if (!isValidFormType(formType)) {
        throw new AppError('formType must be w9|w8ben|w8bene', 400, 'INVALID_FORM_TYPE');
      }
      const form = await submitTaxFormCore(
        {
          requestId: row.id,
          userId: req.userId ?? null,
          signerIp: req.ip ?? null,
          signerUserAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        },
        formType,
        formData,
      );
      const now = new Date();
      // Conditional update guards against a double-submit race: only flips
      // rows that are not already locked.
      const upd = await prisma.taxFormRequest.updateMany({
        where: { id: row.id, status: { notIn: ['submitted', 'verified'] } },
        data: {
          status: 'submitted',
          taxFormId: form.id,
          submittedAt: now,
          ...(req.userId && !row.userId ? { userId: req.userId } : {}),
        },
      });
      if (upd.count === 0) throw new AppError('This form has already been submitted.', 409, 'TOKEN_LOCKED');
      // Deliberately no PDF url / form data / TIN echo.
      res.json({ ok: true, status: 'submitted' });
    } catch (e) {
      next(e);
    }
  },
);

// ============================================================================
// Admin
// ============================================================================
adminTaxFormRequestRouter.use(requireAuth);
adminTaxFormRequestRouter.use(async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    if (!(await isPaymentAdmin(req.userEmail))) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    next();
  } catch (e) {
    next(e);
  }
});

function str(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

function serializeRequest(r: any) {
  return {
    id: r.id,
    token: r.token,
    requester: r.requester,
    payeeLabel: r.payeeLabel,
    payeeEmail: r.payeeEmail,
    payeeWallet: r.payeeWallet,
    payeeHandle: r.payeeHandle,
    suggestedFormType: r.suggestedFormType,
    taxYearNote: r.taxYearNote,
    userId: r.userId,
    taxFormId: r.taxFormId,
    formType: r.taxForm?.formType ?? null,
    status: r.status,
    openedAt: r.openedAt?.toISOString() ?? null,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

adminTaxFormRequestRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body || {}) as any;
    const requester = body.requester ?? 'rare_pizzas';
    if (!(REQUESTERS as ReadonlyArray<string>).includes(requester)) {
      throw new AppError('Invalid requester', 400, 'INVALID_REQUESTER');
    }
    const items: any[] = Array.isArray(body.requests) ? body.requests : [body];
    if (items.length === 0 || items.length > MAX_BULK) {
      throw new AppError(`Provide 1-${MAX_BULK} requests`, 400, 'INVALID_BATCH');
    }
    const data = items.map((it, i) => {
      const label = str(it.label ?? it.payeeLabel);
      if (!label) throw new AppError(`Row ${i + 1}: label is required`, 400, 'LABEL_REQUIRED');
      const sft = str(it.suggestedFormType, 10)?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? null;
      return {
        token: newToken(),
        requester,
        payeeLabel: label,
        payeeEmail: str(it.email ?? it.payeeEmail),
        payeeWallet: str(it.wallet ?? it.payeeWallet)?.toLowerCase() ?? null,
        payeeHandle: str(it.handle ?? it.payeeHandle),
        suggestedFormType: sft && isValidFormType(sft) ? sft : null,
        taxYearNote: str(it.taxYearNote),
      };
    });
    const created = await prisma.$transaction(data.map((d) => prisma.taxFormRequest.create({ data: d })));
    res.status(201).json({ requests: created.map(serializeRequest) });
  } catch (e) {
    next(e);
  }
});

adminTaxFormRequestRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { requester, status } = req.query;
    const where: any = {};
    if (typeof requester === 'string' && requester) where.requester = requester;
    if (typeof status === 'string' && (STATUSES as ReadonlyArray<string>).includes(status)) where.status = status;
    const rows = await prisma.taxFormRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: { taxForm: { select: { formType: true } } },
    });
    res.json({ requests: rows.map(serializeRequest) });
  } catch (e) {
    next(e);
  }
});

adminTaxFormRequestRouter.post('/:id/revoke', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.taxFormRequest.findUnique({ where: { id: req.params.id } });
    if (!row) throw new AppError('Request not found', 404, 'NOT_FOUND');
    const upd = await prisma.taxFormRequest.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
      include: { taxForm: { select: { formType: true } } },
    });
    res.json({ request: serializeRequest(upd) });
  } catch (e) {
    next(e);
  }
});

adminTaxFormRequestRouter.post('/:id/regenerate-token', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.taxFormRequest.findUnique({ where: { id: req.params.id } });
    if (!row) throw new AppError('Request not found', 404, 'NOT_FOUND');
    // New token invalidates the old link and un-revokes the request.
    const upd = await prisma.taxFormRequest.update({
      where: { id: row.id },
      data: { token: newToken(), revokedAt: null },
      include: { taxForm: { select: { formType: true } } },
    });
    res.json({ request: serializeRequest(upd) });
  } catch (e) {
    next(e);
  }
});
