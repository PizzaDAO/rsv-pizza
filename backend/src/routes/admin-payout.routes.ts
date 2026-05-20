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
import { Prisma } from '@prisma/client';
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
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';

const router = Router();

const ALLOWED_PAYOUT_STATUSES = ['pending', 'approved', 'rejected', 'paid', 'failed'] as const;
const ALLOWED_PAYOUT_METHODS = ['mercury_card', 'wire', 'usdc_base'] as const;

/**
 * Shared Prisma `select` for the embedded `party` on payout responses.
 *
 * `expectedGuests` is the host's planning number; `_count.guests` is a
 * filtered count of confirmed direct RSVPs (status='CONFIRMED' AND
 * submittedVia IN ('link','rsvp','api')) — bulk-invited rows are excluded
 * per the project convention (see feedback_invite_vs_link_rsvps memory).
 * `serializePayout` flattens this to `party.rsvpCount` on the wire.
 */
const PAYOUT_PARTY_SELECT: Prisma.PartySelect = {
  id: true,
  name: true,
  inviteCode: true,
  customUrl: true,
  expectedGuests: true,
  // arugula-38633 v2 follow-up: surface the effective reimbursement cap on
  // the /payments admin dashboard. Raw `reimbursementCapUsd` + `eventTags`
  // are selected here so `serializePayout` can resolve them via the shared
  // `computeEffectiveCapUsd` helper (validated cap OR max numeric tag).
  reimbursementCapUsd: true,
  eventTags: true,
  _count: {
    select: {
      guests: {
        where: {
          status: 'CONFIRMED',
          submittedVia: { in: ['link', 'rsvp', 'api'] },
        },
      },
    },
  },
};

type AdminActorKind = 'admin' | 'super_admin' | 'payment_admin';

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
    admin.role === 'super_admin' ? 'super_admin' :
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
    externalProofUrl: row.externalProofUrl,
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
          // arugula-38633 v2 follow-up: admin dashboard shows planning vs
          // actuals. `expectedGuests` is the host's planning number;
          // `rsvpCount` is the filtered _count of confirmed direct RSVPs
          // (excludes 'host' / 'host-checkin' / 'invite' rows).
          expectedGuests: row.party.expectedGuests ?? null,
          rsvpCount: row.party._count?.guests ?? 0,
          // arugula-38633 (cap-everywhere): resolved cap (validated value OR
          // max numeric event_tag). null = no cap set.
          effectiveReimbursementCapUsd: computeEffectiveCapUsd({
            reimbursementCapUsd: row.party.reimbursementCapUsd,
            eventTags: row.party.eventTags,
          }),
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
// GET /api/admin/payouts/parties/search?q=<query>
//   - Autocomplete for the "Record External Payment" modal (arugula-38633 v2).
//   - Filters parties.underbossStatus === 'approved'.
//   - Matches name / customUrl / inviteCode (case-insensitive contains).
//   - For each match, returns the main host + cohosts whose email maps to a
//     User record so the modal can show a host picker dropdown.
//   - Must be declared BEFORE GET /:id so the literal path wins.
//   - Empty / <2 char query returns []  — we don't dump the full party list.
// ============================================
router.get(
  '/parties/search',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (rawQ.length < 2) {
        res.json({ parties: [] });
        return;
      }

      // Pull approved parties matching name / customUrl / inviteCode. Cap at 20.
      // Sorted createdAt DESC so the most recent approved events show first —
      // matches how admins typically remember "the event that was just approved".
      const parties = await prisma.party.findMany({
        where: {
          underbossStatus: 'approved',
          OR: [
            { name: { contains: rawQ, mode: 'insensitive' } },
            { customUrl: { contains: rawQ, mode: 'insensitive' } },
            { inviteCode: { contains: rawQ, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          inviteCode: true,
          userId: true,
          coHosts: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      // Collect every cohost email so we can resolve them all in a single
      // User.findMany() instead of N round-trips per party.
      const allCohostEmails = new Set<string>();
      for (const p of parties) {
        const list = Array.isArray(p.coHosts) ? (p.coHosts as any[]) : [];
        for (const ch of list) {
          if (ch && typeof ch === 'object' && typeof ch.email === 'string' && ch.email.trim()) {
            allCohostEmails.add(ch.email.trim().toLowerCase());
          }
        }
      }

      const cohostUsers = allCohostEmails.size
        ? await prisma.user.findMany({
            where: { email: { in: Array.from(allCohostEmails) } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const cohostUserByEmail = new Map<string, { id: string; name: string | null; email: string }>();
      for (const u of cohostUsers) {
        cohostUserByEmail.set(u.email.toLowerCase(), u);
      }

      const results = parties
        // Skip parties with no linked main host — Payout.hostUserId is FK NOT NULL
        // and the modal needs a default selection. (Vanishingly rare in practice.)
        .filter((p) => !!p.user)
        .map((p) => {
          const hostCandidates: Array<{
            userId: string;
            name: string | null;
            email: string | null;
            role: 'host' | 'cohost';
          }> = [];

          // Main host always first.
          hostCandidates.push({
            userId: p.user!.id,
            name: p.user!.name,
            email: p.user!.email,
            role: 'host',
          });

          const cohostList = Array.isArray(p.coHosts) ? (p.coHosts as any[]) : [];
          const seenUserIds = new Set<string>([p.user!.id]);
          for (const ch of cohostList) {
            if (!ch || typeof ch !== 'object') continue;
            const email = typeof ch.email === 'string' ? ch.email.trim().toLowerCase() : '';
            if (!email) continue;
            const u = cohostUserByEmail.get(email);
            // Cohosts without a matching User record (or no email at all) are
            // silently excluded — the modal can only set Payout.hostUserId to
            // a real User.id.
            if (!u) continue;
            // Dedupe: if a cohost row happens to also be the main host (host
            // listed themselves as cohost), skip the duplicate.
            if (seenUserIds.has(u.id)) continue;
            seenUserIds.add(u.id);
            hostCandidates.push({
              userId: u.id,
              name: u.name,
              email: u.email,
              role: 'cohost',
            });
          }

          return {
            id: p.id,
            name: p.name,
            inviteCode: p.inviteCode,
            hostUserId: p.user!.id,
            hostCandidates,
          };
        });

      res.json({ parties: results });
    } catch (error) {
      next(error);
    }
  },
);

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
          party: { select: PAYOUT_PARTY_SELECT },
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
          escapeCSV(r.payoutMethod ?? ''),
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
// POST /api/admin/payouts/external — record an OUT-OF-BAND payment
//   - For payments that happened OUTSIDE the rsv.pizza flow (Venmo, manual
//     bank transfer, etc.). Creates a payout row in `paid` status immediately
//     so the host's "paid so far" reflects it and there's an audit trail.
//   - Literal `/external` MUST be declared before `/:id` so the literal path wins.
//   - Auth: admin / super_admin / payment_admin all allowed.
//   - payment_admin actors are blocked from recording payouts to themselves.
//   - The plan allows 'other' as a method intent but the DB CHECK only allows
//     the 3 — we map 'other' → 'wire' and rely on admin_notes for the real
//     method (e.g. "Other: Venmo").
// ============================================
router.post(
  '/external',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const body = req.body || {};

      const partyId = typeof body.partyId === 'string' ? body.partyId.trim() : '';
      const hostUserId = typeof body.hostUserId === 'string' ? body.hostUserId.trim() : '';
      const finalAmountUsd = Number(body.finalAmountUsd);
      const rawMethod = typeof body.payoutMethod === 'string' ? body.payoutMethod : '';
      const adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() : '';

      if (!partyId) {
        throw new AppError('partyId is required', 400, 'VALIDATION_ERROR');
      }
      if (!hostUserId) {
        throw new AppError('hostUserId is required', 400, 'VALIDATION_ERROR');
      }
      if (!Number.isFinite(finalAmountUsd) || finalAmountUsd <= 0) {
        throw new AppError('finalAmountUsd must be > 0', 400, 'VALIDATION_ERROR');
      }
      // 'other' is accepted at the API boundary, but the DB CHECK only allows
      // the 3 hard rails. We map 'other' → 'wire' and the admin clarifies the
      // real method in admin_notes (e.g. "Other: Venmo").
      const ALLOWED_INTENT_METHODS = ['mercury_card', 'wire', 'usdc_base', 'other'] as const;
      if (!ALLOWED_INTENT_METHODS.includes(rawMethod as any)) {
        throw new AppError(
          `payoutMethod must be one of: ${ALLOWED_INTENT_METHODS.join(', ')}`,
          400,
          'VALIDATION_ERROR',
        );
      }
      const storedMethod = rawMethod === 'other' ? 'wire' : rawMethod;
      if (!adminNotes) {
        throw new AppError(
          'adminNotes is required — please explain why this is being recorded',
          400,
          'VALIDATION_ERROR',
        );
      }

      // Block payment_admin from paying themselves (full admins exempt).
      assertNotSelfPayout(actor, hostUserId);

      // Verify referenced party + host exist (avoids opaque FK errors).
      const party = await prisma.party.findUnique({ where: { id: partyId }, select: { id: true } });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }
      const host = await prisma.user.findUnique({ where: { id: hostUserId }, select: { id: true } });
      if (!host) {
        throw new AppError('Host user not found', 404, 'HOST_NOT_FOUND');
      }

      const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
      if (Number.isNaN(paidAt.getTime())) {
        throw new AppError('paidAt must be a valid ISO date', 400, 'VALIDATION_ERROR');
      }

      const txHash = typeof body.transactionHash === 'string' && body.transactionHash.trim()
        ? body.transactionHash.trim()
        : null;
      const wireRef = typeof body.wireReference === 'string' && body.wireReference.trim()
        ? body.wireReference.trim()
        : null;
      const cardLast4 = typeof body.mercuryCardLast4 === 'string' && body.mercuryCardLast4.trim()
        ? body.mercuryCardLast4.trim()
        : null;
      const extProof = typeof body.externalProofUrl === 'string' && body.externalProofUrl.trim()
        ? body.externalProofUrl.trim()
        : null;

      const composedNote = `External payment recorded. ${adminNotes}`;

      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.create({
          data: {
            partyId,
            hostUserId,
            // Required non-null fields — for external payments we know the
            // amount already; original currency/rate/extracted all collapse to USD/1.
            originalAmount: finalAmountUsd as any,
            originalCurrency: 'USD',
            exchangeRate: 1.0 as any,
            extractedAmountUsd: finalAmountUsd as any,
            finalAmountUsd: finalAmountUsd as any,
            status: 'paid',
            payoutMethod: storedMethod,
            paidAt,
            transactionHash: txHash,
            wireReference: wireRef,
            mercuryCardLast4: cardLast4,
            externalProofUrl: extProof,
            adminNotes: composedNote,
            reviewedBy: actor.email,
            reviewedAt: paidAt,
          },
          include: {
            party: { select: PAYOUT_PARTY_SELECT },
            host: { select: { id: true, name: true, email: true } },
            documents: { orderBy: { sortOrder: 'asc' } },
            audits: { orderBy: { createdAt: 'desc' } },
          },
        });

        // loadActor() now returns 'super_admin' (matches DB CHECK on
        // payout_audit.actor_kind) — no normalization needed.
        const auditActorKind = actor.actorKind;

        await tx.payoutAudit.create({
          data: {
            payoutId: row.id,
            action: 'create',
            newStatus: 'paid',
            newAmount: finalAmountUsd as any,
            actorEmail: actor.email,
            actorKind: auditActorKind,
            note: composedNote,
          },
        });

        return row;
      });

      // Refetch with audits included (the create() above already has them empty).
      const full = await prisma.payout.findUnique({
        where: { id: created.id },
        include: {
          party: { select: PAYOUT_PARTY_SELECT },
          host: { select: { id: true, name: true, email: true } },
          documents: { orderBy: { sortOrder: 'asc' } },
          audits: { orderBy: { createdAt: 'desc' } },
        },
      });

      res.status(201).json({ payout: serializePayout(full || created) });
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
          party: { select: PAYOUT_PARTY_SELECT },
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
        // arugula-38633 v3 follow-up: bucket null methods under 'unset' so the
        // dashboard pills don't drop them from the count.
        const methodKey = r.payoutMethod ?? 'unset';
        byMethod[methodKey] = (byMethod[methodKey] || 0) + 1;
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
          party: { select: PAYOUT_PARTY_SELECT },
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
            party: { select: PAYOUT_PARTY_SELECT },
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
            party: { select: PAYOUT_PARTY_SELECT },
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
                party: { select: PAYOUT_PARTY_SELECT },
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
            party: { select: PAYOUT_PARTY_SELECT },
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
            party: { select: PAYOUT_PARTY_SELECT },
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
 * For `usdc_base` the onchain send happens BEFORE the DB transaction
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

  // arugula-38633 v3 follow-up: payout_method can be null when the host
  // submitted before setting their payment details. Block execute with a
  // clear message — admin should ask the host to set their details (or
  // patch via PATCH /api/admin/payouts/:id).
  if (existing.payoutMethod == null) {
    throw new AppError(
      'This payout has no payment method set. Ask the host to set their payment details, ' +
        'or patch the payout method directly via PATCH /api/admin/payouts/:id.',
      400,
      'MISSING_PAYOUT_METHOD',
    );
  }

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
            party: { select: PAYOUT_PARTY_SELECT },
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
          party: { select: PAYOUT_PARTY_SELECT },
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
          party: { select: PAYOUT_PARTY_SELECT },
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
