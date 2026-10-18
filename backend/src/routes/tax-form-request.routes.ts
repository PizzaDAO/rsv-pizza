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
 *
 * Token routes take NO user auth: a Bearer header is ignored and user_id is
 * never set on tax_forms / tax_form_requests from this flow.
 */
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import {
  isValidFormType,
  saveTaxFormDraftCore,
  submitTaxFormCore,
  redactForPublic,
  storedSecretFieldNames,
} from '../services/taxFormCore.service.js';

export const publicTaxFormRequestRouter = Router();
export const adminTaxFormRequestRouter = Router();

const REQUESTERS = ['rare_pizzas', 'pizzadao'] as const;
const REQUESTER_LABEL: Record<string, string> = { rare_pizzas: 'Rare Pizzas', pizzadao: 'PizzaDAO' };
const STATUSES = ['sent', 'opened', 'draft', 'submitting', 'submitted', 'verified', 'rejected'] as const;
const MAX_BULK = 500;

/**
 * Statuses in which the token can no longer write. 'submitting' is the
 * transient lock held while a submit generates/uploads the PDF.
 */
const LOCKED_STATUSES = ['submitting', 'submitted', 'verified'];
/** A 'submitting' lock older than this is treated as abandoned (crashed submit). */
const STALE_SUBMIT_LOCK_MS = 5 * 60 * 1000;

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url'); // 256-bit
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const NOT_FOUND = () => new AppError('This link is invalid or no longer active.', 404, 'INVALID_TOKEN');
const LOCKED = () => new AppError('This form has already been submitted.', 409, 'TOKEN_LOCKED');

// ---------- rate limiting (per IP, and per IP+token) ----------
// ipKeyGenerator collapses IPv6 addresses to their /56 so one client can't
// dodge the limit by rotating addresses inside its own prefix.
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Too many requests, please try again later.' },
});
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.params.token || '').slice(0, 64)}`,
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

type RequestRow = Awaited<ReturnType<typeof loadRequest>>;

/**
 * Atomically move a live, unlocked request to `status`. Returns false when the
 * request is locked (submitting/submitted/verified) or revoked. A 'submitting'
 * lock that is older than STALE_SUBMIT_LOCK_MS counts as unlocked.
 */
async function claimRequest(id: string, status: 'draft' | 'submitting'): Promise<boolean> {
  const res = await prisma.taxFormRequest.updateMany({
    where: {
      id,
      revokedAt: null,
      OR: [
        { status: { notIn: LOCKED_STATUSES } },
        { status: 'submitting', updatedAt: { lt: new Date(Date.now() - STALE_SUBMIT_LOCK_MS) } },
      ],
    },
    data: { status },
  });
  return res.count > 0;
}

/**
 * Public payload. NEVER includes: TINs or any other SECRET_KEYS value, the
 * signature, a PDF path/url, form ids, or form data of a submitted form.
 */
async function payload(row: RequestRow) {
  const locked = LOCKED_STATUSES.includes(row.status);
  let currentDraft: { formType: string; formData: Record<string, unknown> } | null = null;
  let storedSecretFields: string[] = [];
  let rejectedReason: string | null = null;
  let submittedFormType: string | null = null;

  if (locked) {
    if (row.taxFormId && row.status !== 'submitting') {
      const f = await prisma.taxForm.findUnique({ where: { id: row.taxFormId }, select: { formType: true } });
      submittedFormType = f?.formType ?? null;
    }
  } else {
    const d = await prisma.taxForm.findFirst({
      where: { requestId: row.id, status: 'draft' },
      orderBy: { updatedAt: 'desc' },
    });
    if (d) {
      currentDraft = { formType: d.formType, formData: redactForPublic(d.formData) };
      storedSecretFields = storedSecretFieldNames(d.formData);
    }
    // The rejection reason survives a new draft: show the latest rejected form's.
    const rej = await prisma.taxForm.findFirst({
      where: { requestId: row.id, status: 'rejected' },
      orderBy: { updatedAt: 'desc' },
      select: { rejectedReason: true },
    });
    if (rej) rejectedReason = rej.rejectedReason ?? '';
  }

  return {
    payeeLabel: row.payeeLabel,
    requester: REQUESTER_LABEL[row.requester] ?? row.requester,
    suggestedFormType: row.suggestedFormType,
    taxYearNote: row.taxYearNote,
    status: row.status,
    // Locked once submitted/verified (or mid-submit); only an admin rejection reopens it.
    locked,
    submittedFormType,
    rejectedReason,
    currentDraft,
    storedSecretFields,
  };
}

publicTaxFormRequestRouter.get('/:token', tokenLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await loadRequest(req.params.token);
    if (!row.openedAt) {
      const now = new Date();
      // Conditional writes: never clobber a status another request just set.
      await prisma.taxFormRequest.updateMany({ where: { id: row.id, openedAt: null }, data: { openedAt: now } });
      const flipped = await prisma.taxFormRequest.updateMany({
        where: { id: row.id, status: 'sent' },
        data: { status: 'opened' },
      });
      row.openedAt = now;
      if (flipped.count > 0) row.status = 'opened';
    }
    res.json(await payload(row));
  } catch (e) {
    next(e);
  }
});

function parseBody(req: Request) {
  const { formType, formData } = (req.body || {}) as { formType?: unknown; formData?: unknown };
  if (!isValidFormType(formType)) {
    throw new AppError('formType must be w9|w8ben|w8bene', 400, 'INVALID_FORM_TYPE');
  }
  if (formData == null || typeof formData !== 'object' || Array.isArray(formData)) {
    throw new AppError('formData must be an object', 400, 'INVALID_FORM_DATA');
  }
  return { formType, formData };
}

// NOTE: no optionalAuth on the token routes. The link token is the only
// credential, and token writes never set user_id on tax_forms or
// tax_form_requests (a Bearer header, if sent, is ignored).
publicTaxFormRequestRouter.post('/:token/draft', tokenLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await loadRequest(req.params.token);
    const { formType, formData } = parseBody(req);
    // Claim BEFORE writing: a locked or in-flight request never gets a new
    // draft and is never flipped back to an editable status.
    if (!(await claimRequest(row.id, 'draft'))) throw LOCKED();
    const { row: form } = await saveTaxFormDraftCore({ requestId: row.id }, formType, formData);
    // Only point at the draft while still in draft (never over a submitted form).
    await prisma.taxFormRequest.updateMany({
      where: { id: row.id, status: 'draft' },
      data: { taxFormId: form.id },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

publicTaxFormRequestRouter.post('/:token/submit', tokenLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await loadRequest(req.params.token);
    const { formType, formData } = parseBody(req);
    const previousStatus = LOCKED_STATUSES.includes(row.status) ? 'draft' : row.status;
    // Take the 'submitting' lock BEFORE PDF generation/upload so a concurrent
    // (double-click / replayed) submit gets 409 and uploads nothing.
    if (!(await claimRequest(row.id, 'submitting'))) throw LOCKED();
    try {
      const form = await submitTaxFormCore(
        {
          requestId: row.id,
          signerIp: req.ip ?? null,
          signerUserAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        },
        formType,
        formData,
      );
      await prisma.taxFormRequest.update({
        where: { id: row.id },
        data: { status: 'submitted', taxFormId: form.id, submittedAt: new Date() },
      });
    } catch (err) {
      // Release the lock: restore the pre-submit status so the payee can retry.
      await prisma.taxFormRequest
        .updateMany({ where: { id: row.id, status: 'submitting' }, data: { status: previousStatus } })
        .catch(() => undefined);
      throw err;
    }
    // Deliberately no PDF url / form data / TIN echo.
    res.json({ ok: true, status: 'submitted' });
  } catch (e) {
    next(e);
  }
});

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

    // Dedupe on (payee_label, lower(payee_email)) against live (non-revoked)
    // requests for this requester and within the batch itself.
    const dedupeKey = (label: string, email: string | null) => `${label}\u0000${(email ?? '').toLowerCase()}`;
    const existing = await prisma.taxFormRequest.findMany({
      where: { requester, revokedAt: null, payeeLabel: { in: [...new Set(data.map((d) => d.payeeLabel))] } },
      select: { payeeLabel: true, payeeEmail: true },
    });
    const existingKeys = new Set(existing.map((e) => dedupeKey(e.payeeLabel, e.payeeEmail)));
    const seen = new Set<string>();
    const toCreate: typeof data = [];
    const skipped: Array<{ label: string; email: string | null; reason: 'exists' | 'duplicate_in_batch' }> = [];
    for (const d of data) {
      const k = dedupeKey(d.payeeLabel, d.payeeEmail);
      if (existingKeys.has(k)) skipped.push({ label: d.payeeLabel, email: d.payeeEmail, reason: 'exists' });
      else if (seen.has(k)) skipped.push({ label: d.payeeLabel, email: d.payeeEmail, reason: 'duplicate_in_batch' });
      else {
        seen.add(k);
        toCreate.push(d);
      }
    }

    const created = toCreate.length
      ? await prisma.$transaction(toCreate.map((d) => prisma.taxFormRequest.create({ data: d })))
      : [];
    res.status(created.length ? 201 : 200).json({ requests: created.map(serializeRequest), skipped });
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
