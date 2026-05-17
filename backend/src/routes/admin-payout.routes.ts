/**
 * Admin host-payouts dashboard routes.
 *
 * Mounted at `/api/admin/payouts` (see backend/src/index.ts).
 *
 * Auth model:
 *  - All endpoints require `requireAuth` + `requireAnyAdminOrPaymentAdmin`
 *    (admin / super_admin / payment_admin).
 *  - For mutating endpoints (PATCH, approve, reject, mark-paid, execute), a
 *    `payment_admin` actor CANNOT operate on a payout whose `hostUserId`
 *    matches their own user id — see `assertNotSelfPayout()`. Full admins
 *    (admin / super_admin) are exempt from this restriction.
 *
 * Execute Payout (POST /:id/execute) is intentionally a 501 stub here — PR 5
 * wires in the actual Mercury / wire / USDC-via-Privy execution paths.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import {
  requireAuth,
  AuthRequest,
  isPaymentAdmin,
  isFullAdmin,
} from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import {
  sendUsdcPayment,
  getUsdcDailyCapStatus,
} from '../services/usdc-base.service.js';

const router = Router();

const ALLOWED_PAYOUT_STATUSES = ['pending', 'approved', 'rejected', 'paid', 'failed'] as const;
const ALLOWED_PAYOUT_METHODS = ['mercury_card', 'wire', 'usdc_base'] as const;

type AdminActorKind = 'admin' | 'superadmin' | 'payment_admin';

/**
 * Loads the admin row + the currently-authenticated user's id (used for
 * self-payout restriction). Returns `null` for either if the lookup fails.
 */
async function loadActor(req: AuthRequest): Promise<{
  email: string;
  adminRole: string;
  actorKind: AdminActorKind;
  userId: string | null;
  isFull: boolean;
}> {
  const email = req.userEmail?.toLowerCase();
  if (!email) {
    throw new AppError('Missing actor email', 401, 'UNAUTHORIZED');
  }

  const admin = await prisma.admin.findUnique({
    where: { email },
    select: { role: true },
  });
  if (!admin) {
    // Shouldn't happen because requireAnyAdminOrPaymentAdmin guards earlier,
    // but defensive.
    throw new AppError('Admin record not found', 403, 'FORBIDDEN');
  }

  const actorKind: AdminActorKind =
    admin.role === 'super_admin' ? 'superadmin' :
    admin.role === 'payment_admin' ? 'payment_admin' :
    'admin';

  // Self-payout restriction needs the user id linked to this email so we can
  // compare to payout.hostUserId. Best-effort lookup — many admins are not
  // also hosts, in which case there's nothing to compare.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  return {
    email,
    adminRole: admin.role,
    actorKind,
    userId: user?.id ?? null,
    isFull: actorKind !== 'payment_admin',
  };
}

/**
 * Middleware: allow admin / super_admin / payment_admin only.
 * Composed inline as we need access to req.userEmail set by requireAuth.
 */
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

/**
 * payment_admin cannot approve / edit / execute their own payouts. Full admins
 * (admin / super_admin) bypass this check.
 */
function assertNotSelfPayout(
  actor: { actorKind: AdminActorKind; userId: string | null; isFull: boolean },
  payoutHostUserId: string,
) {
  if (actor.isFull) return;
  if (actor.userId && actor.userId === payoutHostUserId) {
    throw new AppError(
      'payment_admin cannot operate on a payout they would receive',
      403,
      'SELF_PAYOUT_FORBIDDEN',
    );
  }
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build a Prisma `where` clause from query-string filters. */
function buildPayoutWhere(query: Request['query']): any {
  const where: any = {};

  const status = query.status;
  if (typeof status === 'string' && status !== 'all' && ALLOWED_PAYOUT_STATUSES.includes(status as any)) {
    where.status = status;
  }

  const method = query.payoutMethod;
  if (typeof method === 'string' && method !== 'all' && ALLOWED_PAYOUT_METHODS.includes(method as any)) {
    where.payoutMethod = method;
  }

  const partyId = query.partyId;
  if (typeof partyId === 'string' && partyId.trim().length > 0) {
    where.partyId = partyId.trim();
  }

  const hostEmail = query.hostEmail;
  if (typeof hostEmail === 'string' && hostEmail.trim().length > 0) {
    where.host = {
      email: { contains: hostEmail.trim().toLowerCase(), mode: 'insensitive' as const },
    };
  }

  const currency = query.currency;
  if (typeof currency === 'string' && currency !== 'all' && currency.trim().length > 0) {
    where.originalCurrency = currency.trim().toUpperCase();
  }

  const dateFrom = query.dateFrom;
  const dateTo = query.dateTo;
  if (typeof dateFrom === 'string' || typeof dateTo === 'string') {
    where.createdAt = {} as any;
    if (typeof dateFrom === 'string' && dateFrom) {
      where.createdAt.gte = new Date(dateFrom);
    }
    if (typeof dateTo === 'string' && dateTo) {
      where.createdAt.lte = new Date(dateTo);
    }
  }

  return where;
}

/** Shape a Prisma payout row for the API response. */
function serializePayout(row: any): any {
  return {
    id: row.id,
    partyId: row.partyId,
    hostUserId: row.hostUserId,
    originalAmount: Number(row.originalAmount),
    originalCurrency: row.originalCurrency,
    exchangeRate: Number(row.exchangeRate),
    extractedAmountUsd: Number(row.extractedAmountUsd),
    finalAmountUsd: Number(row.finalAmountUsd),
    status: row.status,
    payoutMethod: row.payoutMethod,
    payoutWalletAddress: row.payoutWalletAddress,
    payoutBankDetails: row.payoutBankDetails,
    mercuryCardId: row.mercuryCardId,
    mercuryCardLast4: row.mercuryCardLast4,
    hostNotes: row.hostNotes,
    adminNotes: row.adminNotes,
    rejectionReason: row.rejectionReason,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    transactionHash: row.transactionHash,
    wireReference: row.wireReference,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    documents: (row.documents || []).map((d: any) => ({
      id: d.id,
      kind: d.kind,
      url: d.url,
      fileName: d.fileName,
      fileSize: d.fileSize,
      mimeType: d.mimeType,
      ocrAmount: d.ocrAmount == null ? null : Number(d.ocrAmount),
      ocrCurrency: d.ocrCurrency,
      ocrConfidence: d.ocrConfidence == null ? null : Number(d.ocrConfidence),
      ocrError: d.ocrError,
      sortOrder: d.sortOrder,
    })),
    party: row.party
      ? {
          id: row.party.id,
          name: row.party.name,
          inviteCode: row.party.inviteCode,
          customUrl: row.party.customUrl,
        }
      : undefined,
    host: row.host
      ? {
          id: row.host.id,
          name: row.host.name,
          email: row.host.email,
        }
      : undefined,
    audits: row.audits
      ? row.audits.map((a: any) => ({
          id: a.id,
          action: a.action,
          oldStatus: a.oldStatus,
          newStatus: a.newStatus,
          oldAmount: a.oldAmount == null ? null : Number(a.oldAmount),
          newAmount: a.newAmount == null ? null : Number(a.newAmount),
          actorEmail: a.actorEmail,
          actorKind: a.actorKind,
          note: a.note,
          createdAt: a.createdAt.toISOString(),
        }))
      : undefined,
  };
}

// ============================================
// GET /api/admin/payouts/export.csv
//   - Must be declared BEFORE GET /:id so the literal path wins.
// ============================================
router.get(
  '/export.csv',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const where = buildPayoutWhere(req.query);
      const rows = await prisma.payout.findMany({
        where,
        include: {
          party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
          host: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const headers = [
        'Payout ID',
        'Created At',
        'Status',
        'Method',
        'Host Name',
        'Host Email',
        'Party Name',
        'Party Invite Code',
        'Original Amount',
        'Original Currency',
        'Exchange Rate',
        'Extracted USD',
        'Final USD',
        'Reviewed By',
        'Reviewed At',
        'Paid At',
        'Wire Reference',
        'Transaction Hash',
        'Mercury Card Last4',
        'Admin Notes',
        'Rejection Reason',
      ];
      const csvRows = [headers.join(',')];

      for (const r of rows) {
        const row = [
          escapeCSV(r.id),
          escapeCSV(r.createdAt.toISOString()),
          escapeCSV(r.status),
          escapeCSV(r.payoutMethod),
          escapeCSV(r.host?.name || ''),
          escapeCSV(r.host?.email || ''),
          escapeCSV(r.party?.name || ''),
          escapeCSV(r.party?.inviteCode || ''),
          escapeCSV(String(Number(r.originalAmount))),
          escapeCSV(r.originalCurrency || ''),
          escapeCSV(String(Number(r.exchangeRate))),
          escapeCSV(String(Number(r.extractedAmountUsd))),
          escapeCSV(String(Number(r.finalAmountUsd))),
          escapeCSV(r.reviewedBy || ''),
          escapeCSV(r.reviewedAt ? r.reviewedAt.toISOString() : ''),
          escapeCSV(r.paidAt ? r.paidAt.toISOString() : ''),
          escapeCSV(r.wireReference || ''),
          escapeCSV(r.transactionHash || ''),
          escapeCSV(r.mercuryCardLast4 || ''),
          escapeCSV(r.adminNotes || ''),
          escapeCSV(r.rejectionReason || ''),
        ];
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=host-payouts-export.csv');
      res.send(csvRows.join('\n'));
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// GET /api/admin/payouts — list with filters + totals + cursor pagination
// ============================================
router.get(
  '/',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const where = buildPayoutWhere(req.query);

      const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1),
        100,
      );

      const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length > 0
        ? req.query.cursor
        : undefined;

      const findArgs: any = {
        where,
        include: {
          party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
          host: { select: { id: true, name: true, email: true } },
          documents: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      };
      if (cursor) {
        findArgs.cursor = { id: cursor };
        findArgs.skip = 1;
      }

      const rows = await prisma.payout.findMany(findArgs);

      let nextCursor: string | null = null;
      const page = rows.slice(0, limit);
      if (rows.length > limit) {
        nextCursor = page[page.length - 1]?.id ?? null;
      }

      // Totals — computed over the filtered set (NOT just the current page),
      // so the dashboard pills reflect the user's current filters.
      const allFiltered = await prisma.payout.findMany({
        where,
        select: {
          status: true,
          payoutMethod: true,
          finalAmountUsd: true,
          createdAt: true,
          paidAt: true,
        },
      });

      const byStatus: Record<string, number> = {};
      const byMethod: Record<string, number> = {};
      let totalUsdPending = 0;
      let totalUsdPaid = 0;
      let totalUsdThisMonth = 0;
      let sumUsd = 0;
      let awaitingReview = 0;

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      for (const r of allFiltered) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        byMethod[r.payoutMethod] = (byMethod[r.payoutMethod] || 0) + 1;
        const usd = Number(r.finalAmountUsd);
        sumUsd += usd;
        if (r.status === 'pending') {
          totalUsdPending += usd;
          awaitingReview += 1;
        } else if (r.status === 'paid') {
          totalUsdPaid += usd;
          if (r.paidAt && r.paidAt >= startOfMonth) {
            totalUsdThisMonth += usd;
          }
        }
      }

      const avgUsd = allFiltered.length > 0 ? sumUsd / allFiltered.length : 0;

      res.json({
        payouts: page.map(serializePayout),
        nextCursor,
        totals: {
          byStatus,
          byMethod,
          totalUsdPending,
          totalUsdPaid,
          totalUsdThisMonth,
          avgUsd,
          awaitingReview,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// GET /api/admin/payouts/:id — full detail incl. audit history
// ============================================
router.get(
  '/:id',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const row = await prisma.payout.findUnique({
        where: { id: req.params.id },
        include: {
          party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
          host: { select: { id: true, name: true, email: true } },
          documents: { orderBy: { sortOrder: 'asc' } },
          audits: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (!row) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }

      res.json({ payout: serializePayout(row) });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// PATCH /api/admin/payouts/:id — edit amount / notes / method / target
// ============================================
router.patch(
  '/:id',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          status: true,
          hostUserId: true,
          finalAmountUsd: true,
        },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status === 'paid') {
        throw new AppError('Cannot edit a payout that is already paid', 400, 'ALREADY_PAID');
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      const data: any = {};
      const {
        finalAmountUsd,
        adminNotes,
        payoutMethod,
        payoutWalletAddress,
        payoutBankDetails,
      } = req.body || {};

      let amountChanged = false;
      let oldAmount: number | null = null;
      let newAmount: number | null = null;

      if (finalAmountUsd !== undefined) {
        const parsed = Number(finalAmountUsd);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new AppError('finalAmountUsd must be a non-negative number', 400, 'VALIDATION_ERROR');
        }
        oldAmount = Number(existing.finalAmountUsd);
        newAmount = parsed;
        if (oldAmount !== newAmount) {
          amountChanged = true;
          data.finalAmountUsd = parsed;
        }
      }

      if (adminNotes !== undefined) {
        data.adminNotes = adminNotes === null ? null : String(adminNotes);
      }

      if (payoutMethod !== undefined) {
        if (!ALLOWED_PAYOUT_METHODS.includes(payoutMethod)) {
          throw new AppError('Invalid payoutMethod', 400, 'VALIDATION_ERROR');
        }
        data.payoutMethod = payoutMethod;
      }

      if (payoutWalletAddress !== undefined) {
        data.payoutWalletAddress = payoutWalletAddress === null
          ? null
          : String(payoutWalletAddress).trim();
      }

      if (payoutBankDetails !== undefined) {
        data.payoutBankDetails = payoutBankDetails;
      }

      if (Object.keys(data).length === 0) {
        throw new AppError('No editable fields supplied', 400, 'VALIDATION_ERROR');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data,
          include: {
            party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
            host: { select: { id: true, name: true, email: true } },
            documents: { orderBy: { sortOrder: 'asc' } },
            audits: { orderBy: { createdAt: 'desc' } },
          },
        });

        if (amountChanged) {
          await tx.payoutAudit.create({
            data: {
              payoutId: existing.id,
              action: 'edit_amount',
              oldAmount: oldAmount as any,
              newAmount: newAmount as any,
              actorEmail: actor.email,
              actorKind: actor.actorKind,
              note: typeof req.body?.note === 'string' ? req.body.note : null,
            },
          });
        }

        return row;
      });

      res.json({ payout: serializePayout(updated) });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// POST /api/admin/payouts/:id/approve
// ============================================
router.post(
  '/:id/approve',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status !== 'pending') {
        throw new AppError(
          `Can only approve a pending payout (current status: ${existing.status})`,
          400,
          'INVALID_STATE',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      const { note, autoExecute } = req.body || {};

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'approved',
            reviewedBy: actor.email,
            reviewedAt: new Date(),
          },
          include: {
            party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
            host: { select: { id: true, name: true, email: true } },
            documents: { orderBy: { sortOrder: 'asc' } },
            audits: { orderBy: { createdAt: 'desc' } },
          },
        });

        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'approve',
            oldStatus: 'pending',
            newStatus: 'approved',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note: typeof note === 'string' ? note : null,
          },
        });

        return row;
      });

      // autoExecute (PR 5): synchronously execute after approval — only for
      // usdc_base, since wire + mercury_card require body refs (wireReference,
      // mercuryCardLast4) which the approve call doesn't carry. For those two,
      // we log + no-op (the admin will hit execute separately with refs).
      let autoExecuted = false;
      let autoExecuteSkippedReason: string | null = null;
      let result = updated;

      if (autoExecute) {
        if (updated.payoutMethod === 'usdc_base') {
          try {
            result = await executePayout({
              payoutId: existing.id,
              actor: { email: actor.email, actorKind: actor.actorKind },
              body: {},
            });
            autoExecuted = true;
          } catch (err: any) {
            // Execution failed but approval already happened — surface the
            // error to the client. executePayout already wrote audit + flipped
            // status to failed for usdc_base.
            console.error(
              `[admin-payout] autoExecute after approve failed for ${existing.id}: ` +
                (err?.message || err),
            );
            // Re-fetch so client sees the failed state.
            const refreshed = await prisma.payout.findUnique({
              where: { id: existing.id },
              include: {
                party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
                host: { select: { id: true, name: true, email: true } },
                documents: { orderBy: { sortOrder: 'asc' } },
                audits: { orderBy: { createdAt: 'desc' } },
              },
            });
            if (refreshed) result = refreshed;
            autoExecuteSkippedReason = err?.message || 'execution failed';
          }
        } else {
          autoExecuteSkippedReason =
            `autoExecute not supported for ${updated.payoutMethod} — ` +
            `requires admin-supplied refs at execute time`;
          console.log(
            `[admin-payout] approve+autoExecute for payout=${existing.id} ` +
              `method=${updated.payoutMethod}: ${autoExecuteSkippedReason}`,
          );
        }
      }

      res.json({
        payout: serializePayout(result),
        autoExecuteDeferred: !!autoExecute && !autoExecuted,
        autoExecuted,
        autoExecuteSkippedReason,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// POST /api/admin/payouts/:id/reject
// ============================================
router.post(
  '/:id/reject',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status === 'paid') {
        throw new AppError('Cannot reject a paid payout', 400, 'INVALID_STATE');
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      const reason = typeof req.body?.rejectionReason === 'string'
        ? req.body.rejectionReason.trim()
        : '';
      if (!reason) {
        throw new AppError('rejectionReason is required', 400, 'VALIDATION_ERROR');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'rejected',
            rejectionReason: reason,
            reviewedBy: actor.email,
            reviewedAt: new Date(),
          },
          include: {
            party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
            host: { select: { id: true, name: true, email: true } },
            documents: { orderBy: { sortOrder: 'asc' } },
            audits: { orderBy: { createdAt: 'desc' } },
          },
        });

        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'reject',
            oldStatus: existing.status,
            newStatus: 'rejected',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note: reason,
          },
        });

        return row;
      });

      res.json({ payout: serializePayout(updated) });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// POST /api/admin/payouts/:id/mark-paid — manual override (out-of-band)
// ============================================
router.post(
  '/:id/mark-paid',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status === 'paid') {
        throw new AppError('Payout is already paid', 400, 'INVALID_STATE');
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      const {
        wireReference,
        transactionHash,
        mercuryCardLast4,
        mercuryCardId,
        note,
      } = req.body || {};

      const data: any = {
        status: 'paid',
        paidAt: new Date(),
      };
      if (wireReference !== undefined) {
        data.wireReference = wireReference == null ? null : String(wireReference).trim();
      }
      if (transactionHash !== undefined) {
        data.transactionHash = transactionHash == null ? null : String(transactionHash).trim();
      }
      if (mercuryCardLast4 !== undefined) {
        data.mercuryCardLast4 = mercuryCardLast4 == null ? null : String(mercuryCardLast4).trim();
      }
      if (mercuryCardId !== undefined) {
        data.mercuryCardId = mercuryCardId == null ? null : String(mercuryCardId).trim();
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data,
          include: {
            party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
            host: { select: { id: true, name: true, email: true } },
            documents: { orderBy: { sortOrder: 'asc' } },
            audits: { orderBy: { createdAt: 'desc' } },
          },
        });

        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'mark_paid',
            oldStatus: existing.status,
            newStatus: 'paid',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note: typeof note === 'string' ? note : null,
          },
        });

        return row;
      });

      res.json({ payout: serializePayout(updated) });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// GET /api/admin/payouts/usdc-daily-cap-remaining
//   - Used by the UI to show "Daily cap remaining: $Y" before USDC execute.
//   - Must be declared BEFORE POST /:id/execute (literal path) but it's a GET
//     so route order doesn't actually collide; declaring it here keeps the
//     "USDC execution" section coherent.
// ============================================
router.get(
  '/usdc-daily-cap-remaining',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const status = await getUsdcDailyCapStatus();
      res.json(status);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Shared executor used by both the explicit POST /:id/execute route and the
 * `autoExecute: true` branch of POST /:id/approve. Branches on payoutMethod
 * and writes the success/failure status + audit row in a single Prisma
 * transaction (so we can't leave status updated without an audit trail or
 * vice versa).
 *
 * For `usdc_base` the on-chain send happens BEFORE the DB transaction
 * (because waiting for a Base receipt can take 10-30s and we don't want to
 * hold a Postgres tx open that long). On send-failure we still open a tiny
 * tx to flip status -> failed + write the audit row, so the operator sees
 * the failure in the UI.
 *
 * Wire + Mercury are pure DB writes (admin has already executed the payment
 * out-of-band via bank portal / Mercury dashboard).
 */
async function executePayout(params: {
  payoutId: string;
  actor: {
    email: string;
    actorKind: AdminActorKind;
  };
  body: any;
}) {
  const { payoutId, actor, body } = params;

  const existing = await prisma.payout.findUnique({
    where: { id: payoutId },
    select: {
      id: true,
      status: true,
      hostUserId: true,
      payoutMethod: true,
      finalAmountUsd: true,
      payoutWalletAddress: true,
    },
  });
  if (!existing) {
    throw new AppError('Payout not found', 404, 'NOT_FOUND');
  }
  if (existing.status !== 'approved') {
    throw new AppError(
      `Can only execute an approved payout (current status: ${existing.status})`,
      400,
      'INVALID_STATE',
    );
  }

  const finalAmountUsd = Number(existing.finalAmountUsd);

  if (existing.payoutMethod === 'usdc_base') {
    if (!existing.payoutWalletAddress) {
      throw new AppError(
        'USDC payout has no recipient wallet address set',
        400,
        'MISSING_WALLET_ADDRESS',
      );
    }

    try {
      const result = await sendUsdcPayment(existing.payoutWalletAddress, finalAmountUsd);

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'paid',
            paidAt: new Date(),
            transactionHash: result.txHash,
          },
          include: {
            party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
            host: { select: { id: true, name: true, email: true } },
            documents: { orderBy: { sortOrder: 'asc' } },
            audits: { orderBy: { createdAt: 'desc' } },
          },
        });
        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'mark_paid',
            oldStatus: 'approved',
            newStatus: 'paid',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note: `USDC on Base sent: tx ${result.txHash}, ` +
              `from ${result.fromAddress} to ${result.toAddress}, ` +
              `$${result.amountUsd.toFixed(2)}`,
          },
        });
        return row;
      });
      return updated;
    } catch (err: any) {
      // Flip to failed + record the error so the admin UI shows what happened.
      const errMsg = err?.message || String(err);
      console.error(`[admin-payout] USDC execute failed for ${existing.id}: ${errMsg}`);
      await prisma.$transaction(async (tx) => {
        await tx.payout.update({
          where: { id: existing.id },
          data: { status: 'failed' },
        });
        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'mark_failed',
            oldStatus: 'approved',
            newStatus: 'failed',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note: `USDC send failed: ${errMsg.slice(0, 500)}`,
          },
        });
      });
      throw new AppError(`USDC payout failed: ${errMsg}`, 502, 'USDC_SEND_FAILED');
    }
  }

  if (existing.payoutMethod === 'wire') {
    const wireRef = typeof body?.wireReference === 'string' ? body.wireReference.trim() : '';
    if (!wireRef) {
      throw new AppError('wireReference is required for wire payouts', 400, 'MISSING_WIRE_REFERENCE');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payout.update({
        where: { id: existing.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          wireReference: wireRef,
        },
        include: {
          party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
          host: { select: { id: true, name: true, email: true } },
          documents: { orderBy: { sortOrder: 'asc' } },
          audits: { orderBy: { createdAt: 'desc' } },
        },
      });
      await tx.payoutAudit.create({
        data: {
          payoutId: existing.id,
          action: 'mark_paid',
          oldStatus: 'approved',
          newStatus: 'paid',
          actorEmail: actor.email,
          actorKind: actor.actorKind,
          note: `Wire executed out-of-band, reference: ${wireRef}` +
            (typeof body?.note === 'string' && body.note ? ` — ${body.note}` : ''),
        },
      });
      return row;
    });
    return updated;
  }

  if (existing.payoutMethod === 'mercury_card') {
    const last4Raw = typeof body?.mercuryCardLast4 === 'string' ? body.mercuryCardLast4.trim() : '';
    if (!/^\d{4}$/.test(last4Raw)) {
      throw new AppError(
        'mercuryCardLast4 must be exactly 4 digits',
        400,
        'INVALID_MERCURY_LAST4',
      );
    }
    const cardId = typeof body?.mercuryCardId === 'string' && body.mercuryCardId.trim()
      ? body.mercuryCardId.trim()
      : null;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payout.update({
        where: { id: existing.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          mercuryCardLast4: last4Raw,
          mercuryCardId: cardId,
        },
        include: {
          party: { select: { id: true, name: true, inviteCode: true, customUrl: true } },
          host: { select: { id: true, name: true, email: true } },
          documents: { orderBy: { sortOrder: 'asc' } },
          audits: { orderBy: { createdAt: 'desc' } },
        },
      });
      await tx.payoutAudit.create({
        data: {
          payoutId: existing.id,
          action: 'mark_paid',
          oldStatus: 'approved',
          newStatus: 'paid',
          actorEmail: actor.email,
          actorKind: actor.actorKind,
          note: `Mercury card issued via dashboard, last4=${last4Raw}` +
            (cardId ? `, id=${cardId}` : '') +
            (typeof body?.note === 'string' && body.note ? ` — ${body.note}` : ''),
        },
      });
      return row;
    });
    return updated;
  }

  throw new AppError(
    `Unknown payout method: ${existing.payoutMethod}`,
    400,
    'INVALID_PAYOUT_METHOD',
  );
}

// ============================================
// POST /api/admin/payouts/:id/execute — REAL execution (PR 5)
//
// Idempotent: rejects unless status === 'approved' (already-paid payouts get
// 400, not a double-send). Branches on payoutMethod:
//   - usdc_base    → sendUsdcPayment via Privy server-wallet
//   - wire         → body.wireReference REQUIRED, status -> paid
//   - mercury_card → body.mercuryCardLast4 REQUIRED (4 digits), status -> paid
// All paths write a payout_audit row atomically with the status update.
// ============================================
router.post(
  '/:id/execute',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true },
      });
      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status !== 'approved') {
        throw new AppError(
          `Can only execute an approved payout (current status: ${existing.status})`,
          400,
          'INVALID_STATE',
        );
      }
      assertNotSelfPayout(actor, existing.hostUserId);

      const updated = await executePayout({
        payoutId: existing.id,
        actor: { email: actor.email, actorKind: actor.actorKind },
        body: req.body || {},
      });

      res.json({ payout: serializePayout(updated) });
    } catch (error) {
      next(error);
    }
  },
);

// Re-export the helper so other backend code (e.g. PR 5 execute route) can
// reuse the composed guard without re-deriving it.
export { requireAnyAdminOrPaymentAdmin, isFullAdmin };

export default router;
