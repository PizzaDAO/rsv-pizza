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
  getPayoutWalletAddress,
  getPayoutWalletBalanceUsd,
} from '../services/usdc-base.service.js';
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import { resolveWalletInput } from '../services/ens.service.js';
import { isMercuryBlocked } from '../lib/mercuryBlockedCountries.js';
import { notifyHostOfPaymentExecution } from '../services/payoutTelegramNotify.js';
import { emailHostOfPaymentExecution } from '../services/payoutEmailNotify.js';

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

  // tartufo-58291: hide payouts from unapproved parties from the admin queue
  // + CSV export. Existing rows from before the bresaola-49185 backend gate
  // shouldn't surface in routine review. Stats/totals reuse this same `where`
  // so they stay consistent.
  where.party = { underbossStatus: 'approved' };

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
      // pancetta-37195: per-doc uploader attribution. Live name from the
      // join; cached email is the fallback if the User is later deleted.
      uploadedByUserId: d.uploadedByUserId ?? null,
      uploadedByName: d.uploadedBy?.name ?? null,
      uploadedByEmail: d.uploadedByEmail ?? d.uploadedBy?.email ?? null,
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
// GET /api/admin/payouts/prepay-queue — bismarck-92103
//
// Surfaces parties flagged for prepayment (`'prepay' ∈ event_tags`) where at
// least one host (primary host OR cohost matched by email) has saved a
// `preferredPayoutMethod` on their User record. Drops parties that already
// have an in-flight payout (pending/approved/paid) to any candidate — those
// prepayments are already moving and don't need to be nagged about.
//
// Literal `/prepay-queue` MUST be declared before `/:id` so the literal path
// wins on route matching.
// ============================================
router.get(
  '/prepay-queue',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // salame-58921: PizzaDAO (the platform admin user) and underbosses were
      // showing up as candidate "hosts" because they're set as primary host
      // (`parties.userId`) or appear in `parties.coHosts` on parties they
      // administer. They have a User-level `preferredPayoutMethod` set for
      // other reasons (e.g. PizzaDAO collects a refund USDC address), so the
      // existing filter let them through. Only actual event hosts should be
      // paid. Pre-fetch the staff email sets ONCE per request and filter the
      // per-party candidate list against them below.
      const [adminEmails, underbossEmails] = await Promise.all([
        prisma.admin.findMany({ select: { email: true } }).then(rows => new Set(rows.map(r => r.email.toLowerCase()))),
        prisma.underboss.findMany({ where: { isActive: true }, select: { email: true } }).then(rows => new Set(rows.map(r => r.email.toLowerCase()))),
      ]);
      const staffEmails = new Set<string>([...adminEmails, ...underbossEmails]);

      // 1. All approved parties flagged for prepayment, with their primary host.
      const parties = await prisma.party.findMany({
        where: {
          eventTags: { has: 'prepay' },
          underbossStatus: 'approved',
        },
        select: {
          id: true,
          name: true,
          customUrl: true,
          country: true,
          eventTags: true,
          reimbursementCapUsd: true,
          coHosts: true,
          userId: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              preferredPayoutMethod: true,
              payoutWalletAddress: true,
              payoutBankDetails: true,
            },
          },
        },
      });

      // Filter out parties with no effective cap — nothing to prepay against.
      const partiesWithCap = parties
        .map(p => ({
          p,
          cap: computeEffectiveCapUsd({
            reimbursementCapUsd: p.reimbursementCapUsd,
            eventTags: p.eventTags,
          }),
        }))
        .filter(({ cap }) => cap != null && cap > 0);

      if (partiesWithCap.length === 0) {
        res.json({ rows: [] });
        return;
      }

      // 2. Collect all cohost emails across the surviving parties.
      const cohostEmails = new Set<string>();
      for (const { p } of partiesWithCap) {
        const list = Array.isArray(p.coHosts) ? (p.coHosts as any[]) : [];
        for (const ch of list) {
          if (ch && typeof ch === 'object' && typeof ch.email === 'string' && ch.email.trim()) {
            cohostEmails.add(ch.email.trim().toLowerCase());
          }
        }
      }

      // 3. Resolve cohost emails → User rows (one batched query).
      const cohostUsers = cohostEmails.size
        ? await prisma.user.findMany({
            where: { email: { in: Array.from(cohostEmails) } },
            select: {
              id: true,
              name: true,
              email: true,
              preferredPayoutMethod: true,
              payoutWalletAddress: true,
              payoutBankDetails: true,
            },
          })
        : [];
      const cohostUserByEmail = new Map<string, typeof cohostUsers[number]>();
      for (const u of cohostUsers) {
        cohostUserByEmail.set(u.email.toLowerCase(), u);
      }

      // 4. For each party, build the candidate list. Primary host first (if
      //    they have a method), then cohost users with methods.
      type CandidateInternal = {
        userId: string;
        name: string | null;
        email: string;
        method: 'mercury_card' | 'wire' | 'usdc_base';
        walletAddress: string | null;
        bankEmail: string | null;
        isPrimaryHost: boolean;
      };

      function buildCandidate(
        u: {
          id: string;
          name: string | null;
          email: string;
          preferredPayoutMethod: string | null;
          payoutWalletAddress: string | null;
          payoutBankDetails: any;
        },
        isPrimaryHost: boolean,
      ): CandidateInternal | null {
        const method = u.preferredPayoutMethod;
        if (method !== 'mercury_card' && method !== 'wire' && method !== 'usdc_base') {
          return null;
        }
        // For wire, dig bankEmail out of payoutBankDetails JSONB. Null is fine
        // — PaymentDetailsCard will fill it in at payout-create time.
        let bankEmail: string | null = null;
        if (method === 'wire' && u.payoutBankDetails && typeof u.payoutBankDetails === 'object') {
          const raw = (u.payoutBankDetails as any).email;
          if (typeof raw === 'string' && raw.trim()) {
            bankEmail = raw.trim();
          }
        }
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          method,
          walletAddress: method === 'usdc_base' ? u.payoutWalletAddress : null,
          bankEmail,
          isPrimaryHost,
        };
      }

      type AssembledRow = {
        partyMeta: {
          id: string;
          name: string;
          customUrl: string | null;
          country: string | null;
          effectiveReimbursementCapUsd: number | null;
          eventTags: string[];
        };
        candidates: CandidateInternal[];
      };

      const assembled: AssembledRow[] = [];

      for (const { p, cap } of partiesWithCap) {
        const candidates: CandidateInternal[] = [];
        const seenUserIds = new Set<string>();

        // Primary host first.
        // salame-58921: skip if this User's email is a platform admin or
        // active underboss — they shouldn't be paid as event hosts even when
        // they're listed as `parties.userId` on events they administer.
        if (p.user && !staffEmails.has(p.user.email.toLowerCase())) {
          const c = buildCandidate(p.user, true);
          if (c) {
            candidates.push(c);
            seenUserIds.add(c.userId);
          }
        }

        // Cohosts (dedupe against the primary host id).
        const cohostList = Array.isArray(p.coHosts) ? (p.coHosts as any[]) : [];
        for (const ch of cohostList) {
          if (!ch || typeof ch !== 'object') continue;
          const email = typeof ch.email === 'string' ? ch.email.trim().toLowerCase() : '';
          if (!email) continue;
          // salame-58921: skip staff emails before the User lookup so admins
          // / underbosses listed as cohosts never become candidates.
          if (staffEmails.has(email)) continue;
          const u = cohostUserByEmail.get(email);
          if (!u) continue;
          if (seenUserIds.has(u.id)) continue;
          const c = buildCandidate(u, false);
          if (!c) continue;
          candidates.push(c);
          seenUserIds.add(c.userId);
        }

        // After staff-filtering: drop the party entirely if no real hosts have
        // a payment method set. `hasMultipleCandidates` (below) is derived from
        // this filtered list, so it's automatically post-filter.
        if (candidates.length === 0) continue;

        assembled.push({
          partyMeta: {
            id: p.id,
            name: p.name,
            customUrl: p.customUrl,
            country: p.country,
            effectiveReimbursementCapUsd: cap,
            eventTags: p.eventTags,
          },
          candidates,
        });
      }

      if (assembled.length === 0) {
        res.json({ rows: [] });
        return;
      }

      // 5. bufala-83291: filter each party's candidates to users who have
      //    EXPLICITLY opted in via the Submit button on PaymentDetailsCard.
      //    A user-level `preferredPayoutMethod` is the source of HOW to pay
      //    them; the opt-in row in `party_payment_opt_ins` is the source of
      //    WHETHER to consider them for a given event. This stops a cohost
      //    who set payment details on event X from auto-appearing as a
      //    candidate on every other event they're a cohost on.
      //
      //    Backfill at migration time inserted one opt-in row per existing
      //    payout, so hosts who already submitted a payout remain candidates
      //    without re-clicking Submit.
      const partyIds = assembled.map(r => r.partyMeta.id);
      const allCandidateUserIds = new Set<string>();
      for (const r of assembled) {
        for (const c of r.candidates) {
          allCandidateUserIds.add(c.userId);
        }
      }

      const optIns = allCandidateUserIds.size
        ? await prisma.partyPaymentOptIn.findMany({
            where: {
              partyId: { in: partyIds },
              userId: { in: Array.from(allCandidateUserIds) },
            },
            select: { partyId: true, userId: true },
          })
        : [];
      const optInByParty = new Map<string, Set<string>>();
      for (const row of optIns) {
        let set = optInByParty.get(row.partyId);
        if (!set) {
          set = new Set<string>();
          optInByParty.set(row.partyId, set);
        }
        set.add(row.userId);
      }

      // Apply opt-in filter in place; drop parties where no candidate remains.
      const optedInAssembled: AssembledRow[] = [];
      for (const r of assembled) {
        const optInSet = optInByParty.get(r.partyMeta.id);
        if (!optInSet || optInSet.size === 0) continue;
        const filtered = r.candidates.filter(c => optInSet.has(c.userId));
        if (filtered.length === 0) continue;
        optedInAssembled.push({ partyMeta: r.partyMeta, candidates: filtered });
      }

      if (optedInAssembled.length === 0) {
        res.json({ rows: [] });
        return;
      }

      // Recompute candidate-id set after opt-in filtering so the in-flight
      // query below only fetches payouts we still care about.
      const filteredCandidateUserIds = new Set<string>();
      for (const r of optedInAssembled) {
        for (const c of r.candidates) {
          filteredCandidateUserIds.add(c.userId);
        }
      }

      // 6. For each assembled row, drop it if ANY candidate already has an
      //    in-flight payout for that party. "In-flight" = pending/approved/paid
      //    (failed/rejected don't count — that prepayment never went through).
      //    Run as a single grouped query: pull all matching payouts and bucket
      //    by partyId in memory.
      const inFlight = filteredCandidateUserIds.size
        ? await prisma.payout.findMany({
            where: {
              partyId: { in: optedInAssembled.map(r => r.partyMeta.id) },
              hostUserId: { in: Array.from(filteredCandidateUserIds) },
              status: { in: ['pending', 'approved', 'paid'] },
            },
            select: { partyId: true, hostUserId: true },
          })
        : [];

      const inFlightByParty = new Map<string, Set<string>>();
      for (const row of inFlight) {
        let set = inFlightByParty.get(row.partyId);
        if (!set) {
          set = new Set<string>();
          inFlightByParty.set(row.partyId, set);
        }
        set.add(row.hostUserId);
      }

      const finalRows = optedInAssembled
        .filter(r => {
          const inFlightSet = inFlightByParty.get(r.partyMeta.id);
          if (!inFlightSet || inFlightSet.size === 0) return true;
          // If ANY candidate has an in-flight payout, drop the row entirely.
          return !r.candidates.some(c => inFlightSet.has(c.userId));
        })
        .map(r => ({
          party: r.partyMeta,
          candidates: r.candidates,
          hasMultipleCandidates: r.candidates.length > 1,
        }));

      res.json({ rows: finalRows });
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
            documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
          // pepperoni-47301: partyId is needed to look up `party.country` for
          // the Mercury sanctioned-country gate below.
          partyId: true,
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
        // pepperoni-47301: admins are also blocked from forcing `mercury_card`
        // on a party whose country is on Mercury's restricted list — the
        // compliance restriction is on the host's location, not the actor.
        if (payoutMethod === 'mercury_card') {
          const party = await prisma.party.findUnique({
            where: { id: existing.partyId },
            select: { country: true },
          });
          if (isMercuryBlocked(party?.country)) {
            throw new AppError(
              `Mercury virtual cards are unavailable in ${party?.country ?? 'this country'} due to compliance restrictions. Please pick another payout method.`,
              400,
              'MERCURY_COUNTRY_BLOCKED',
            );
          }
        }
        data.payoutMethod = payoutMethod;
      }

      if (payoutWalletAddress !== undefined) {
        // taleggio-30219: admin override also accepts ENS names; resolve to
        // 0x before persisting so the execution path (which already expects
        // 0x) stays untouched.
        if (payoutWalletAddress === null) {
          data.payoutWalletAddress = null;
        } else {
          try {
            data.payoutWalletAddress = await resolveWalletInput(String(payoutWalletAddress));
          } catch (err: any) {
            throw new AppError(
              err?.message || 'Could not resolve wallet address',
              400,
              'INVALID_WALLET_ADDRESS'
            );
          }
        }
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
            documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
            documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
                documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
            documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
            documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
  if (existing.status !== 'approved' && existing.status !== 'failed') {
    throw new AppError(
      `Can only execute an approved or previously-failed payout (current status: ${existing.status})`,
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
            documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
      // boscaiola-49102: fire-and-forget Telegram DM to the linked host.
      // NOT awaited — payout success must not depend on Telegram reachability.
      // Skips silently when host hasn't linked Telegram (no chat_id).
      void notifyHostOfPaymentExecution(existing.id, 'paid', {
        txHash: result.txHash,
      });
      // cipolla-49102: fire-and-forget email to the host's User.email.
      // Runs alongside Telegram (which is USDC-only) — same contract.
      void emailHostOfPaymentExecution(existing.id, 'paid', {
        txHash: result.txHash,
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
      // boscaiola-49102: fire-and-forget Telegram DM on failure too.
      // Same fire-and-forget contract — never blocks or throws.
      void notifyHostOfPaymentExecution(existing.id, 'failed', {
        error: errMsg,
      });
      // cipolla-49102: fire-and-forget email on failure too.
      void emailHostOfPaymentExecution(existing.id, 'failed', {
        error: errMsg,
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
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
    // cipolla-49102: fire-and-forget email to the host's User.email.
    // No txHash for wire — helper omits the link.
    void emailHostOfPaymentExecution(existing.id, 'paid');
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
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
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
    // cipolla-49102: fire-and-forget email to the host's User.email.
    // No txHash for mercury_card — helper omits the link.
    void emailHostOfPaymentExecution(existing.id, 'paid');
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
      if (existing.status !== 'approved' && existing.status !== 'failed') {
        throw new AppError(
          `Can only execute an approved or previously-failed payout (current status: ${existing.status})`,
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

// ============================================
// salsiccia-49102: POST /api/admin/payouts/bulk-execute
//
// Sequentially executes `sendUsdcPayment` for each eligible (USDC, approved,
// valid 0x wallet) payout in the request body. Sequential — NOT Promise.all —
// because the hot wallet has a single signer and viem's WalletClient manages
// nonces per process; concurrent sends would race the nonce calculation.
//
// Pre-flight: fetches hot-wallet USDC balance once before the loop. If
// balance < SUM(amounts), returns 400 INSUFFICIENT_BALANCE with the shortfall
// so the admin doesn't watch payouts fail one-by-one mid-batch. (The per-tx
// pre-flight inside sendUsdcPayment will still catch issues that arise after
// the first sends drain the balance.)
//
// Each per-payout call delegates to the shared `executePayout` helper, which
// already (a) sends the onchain tx, (b) flips status -> paid + writes a
// mark_paid audit on success, (c) flips status -> failed + writes a
// mark_failed audit on send-failure. We additionally write a single
// `bulk_execute` audit per row so the batch context is preserved.
//
// Request body: { ids: string[] }   (max 50)
// Response: BulkSendResult[] in the SAME order as the eligible ids submitted.
// ============================================

const BULK_EXECUTE_MAX_IDS = 50;
const USDC_BASE_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

interface BulkSendResult {
  id: string;
  success: boolean;
  status: 'paid' | 'failed';
  txHash?: string;
  error?: string;
}

router.post(
  '/bulk-execute',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);

      const rawIds = (req.body && Array.isArray(req.body.ids)) ? req.body.ids : null;
      if (!rawIds || rawIds.length === 0) {
        throw new AppError('ids must be a non-empty array', 400, 'VALIDATION_ERROR');
      }
      if (rawIds.length > BULK_EXECUTE_MAX_IDS) {
        throw new AppError(
          `Too many ids: ${rawIds.length} > ${BULK_EXECUTE_MAX_IDS}. ` +
            `Split the selection into smaller batches.`,
          400,
          'BULK_TOO_LARGE',
        );
      }

      const ids: string[] = [];
      for (const v of rawIds) {
        if (typeof v !== 'string' || !v.trim()) {
          throw new AppError('ids must be an array of non-empty strings', 400, 'VALIDATION_ERROR');
        }
        ids.push(v.trim());
      }

      // Single Prisma query for all candidates — then filter in-memory to the
      // eligible subset (USDC + approved + valid 0x wallet). Anything missing
      // from the DB result is silently skipped (caller's selection may
      // include a row that was just paid/rejected by another admin).
      const rows = await prisma.payout.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          payoutMethod: true,
          payoutWalletAddress: true,
          finalAmountUsd: true,
          hostUserId: true,
        },
      });

      const eligible: typeof rows = [];
      for (const r of rows) {
        if (r.payoutMethod !== 'usdc_base') continue;
        // passata-49102: also accept 'failed' so admins can re-try previously
        // failed USDC payouts from the same bulk-send UI without first
        // flipping them back to 'approved'. Matches the single-execute
        // handler's allowed-statuses set.
        if (r.status !== 'approved' && r.status !== 'failed') continue;
        if (!r.payoutWalletAddress || !USDC_BASE_WALLET_RE.test(r.payoutWalletAddress)) continue;
        // Self-payout guard applies to payment_admin actors. Drop these from
        // the eligible set so the batch doesn't 403 mid-loop; admin can
        // execute them via another admin.
        try {
          assertNotSelfPayout(actor, r.hostUserId);
        } catch {
          continue;
        }
        eligible.push(r);
      }

      if (eligible.length === 0) {
        // Empty batch is a 400 rather than a 200 with [] — the UI should
        // never reach here (it filters client-side too) so this is most
        // likely a stale selection.
        throw new AppError(
          'No eligible payouts in selection (need USDC + approved/failed + valid 0x wallet)',
          400,
          'NO_ELIGIBLE_PAYOUTS',
        );
      }

      // Pre-flight balance check — one RPC call, bail the whole batch if
      // funds are insufficient. Per-tx pre-flight inside sendUsdcPayment
      // still runs (and will catch issues mid-batch if balance drains).
      const totalUsd = eligible.reduce((sum, r) => sum + Number(r.finalAmountUsd), 0);
      try {
        const { address, balanceUsd } = await getPayoutWalletBalanceUsd();
        if (balanceUsd < totalUsd) {
          const shortfall = totalUsd - balanceUsd;
          throw new AppError(
            `Insufficient USDC balance: wallet ${address} has $${balanceUsd.toFixed(2)}, ` +
              `batch needs $${totalUsd.toFixed(2)} (short $${shortfall.toFixed(2)})`,
            400,
            'INSUFFICIENT_BALANCE',
          );
        }
      } catch (err: any) {
        // Re-throw AppErrors as-is; wrap viem/RPC errors into a 503 so the
        // admin sees a clear remediation hint instead of a raw stack.
        if (err instanceof AppError) throw err;
        const errMsg = err?.message || String(err);
        console.error(`[admin-payout] bulk-execute pre-flight balance check failed: ${errMsg}`);
        throw new AppError(
          `Pre-flight balance check failed: ${errMsg}`,
          503,
          'BALANCE_CHECK_FAILED',
        );
      }

      // SEQUENTIAL execution — nonce safety. Do NOT switch to Promise.all.
      const results: BulkSendResult[] = [];
      for (const row of eligible) {
        const priorStatus = row.status; // 'approved' or 'failed' (passata-49102)
        try {
          const updated = await executePayout({
            payoutId: row.id,
            actor: { email: actor.email, actorKind: actor.actorKind },
            body: {},
          });
          // Record a batch-context audit alongside the mark_paid audit that
          // executePayout already wrote.
          await prisma.payoutAudit.create({
            data: {
              payoutId: row.id,
              action: 'bulk_execute',
              oldStatus: priorStatus,
              newStatus: 'paid',
              actorEmail: actor.email,
              actorKind: actor.actorKind,
              note: `Bulk-send: ${eligible.length} payouts in batch`,
            },
          }).catch((e) => {
            // Audit-row failure shouldn't bubble — the mark_paid audit was
            // already written by executePayout.
            console.warn(`[admin-payout] bulk_execute audit write failed for ${row.id}:`, e?.message || e);
          });
          results.push({
            id: row.id,
            success: true,
            status: 'paid',
            txHash: updated?.transactionHash ?? undefined,
          });
        } catch (err: any) {
          // executePayout already flipped status -> failed + wrote a
          // mark_failed audit for USDC send-failures (lines 1722-1744 above).
          // Add a batch-context audit so the row's audit log shows "this
          // failure was part of a bulk send".
          const errMsg = err?.message || String(err);
          await prisma.payoutAudit.create({
            data: {
              payoutId: row.id,
              action: 'bulk_execute',
              oldStatus: priorStatus,
              newStatus: 'failed',
              actorEmail: actor.email,
              actorKind: actor.actorKind,
              note: `Bulk-send failure: ${errMsg.slice(0, 400)}`,
            },
          }).catch((e) => {
            console.warn(`[admin-payout] bulk_execute failure-audit write failed for ${row.id}:`, e?.message || e);
          });
          results.push({
            id: row.id,
            success: false,
            status: 'failed',
            error: errMsg,
          });
        }
      }

      res.json({ results });
    } catch (error) {
      next(error);
    }
  },
);

// Re-export the helper so other backend code (e.g. PR 5 execute route) can
// reuse the composed guard without re-deriving it.
export { requireAnyAdminOrPaymentAdmin, isFullAdmin };

export default router;

// ============================================
// coppa-91827: payout-wallet info sub-router
//
// Mounted separately at `/api/admin/payout-wallet` (see backend/src/index.ts)
// so the URL contract `/api/admin/payout-wallet/info` is a sibling of, not a
// child under, `/api/admin/payouts/*`. Lives in this file so the auth helper
// (`isPaymentAdmin`) and the wallet helper (`getPayoutWalletAddress`) stay
// colocated with the rest of the payout admin surface.
//
// GET /info — returns the hot wallet's public address (derived from
// USDC_PAYOUT_WALLET_PRIVATE_KEY) plus live ETH (gas) and USDC balances on
// Base mainnet so admins can deposit funds and verify they landed without
// leaving the dashboard.
// ============================================
const USDC_BASE_ADDRESS_FOR_INFO: `0x${string}` = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export const payoutWalletRouter = Router();

payoutWalletRouter.get(
  '/info',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!(await isPaymentAdmin(req.userEmail))) {
        throw new AppError('Admin only', 403, 'FORBIDDEN');
      }

      // Resolve the address before opening any RPC. If the env var is missing
      // or malformed, surface a 503 with a clear remediation hint instead of
      // leaking the underlying viem error.
      let address: `0x${string}`;
      try {
        address = getPayoutWalletAddress();
      } catch (err: any) {
        console.error('[admin-payout-wallet] getPayoutWalletAddress failed:', err?.message || err);
        throw new AppError(
          'Hot wallet not configured — set USDC_PAYOUT_WALLET_PRIVATE_KEY on backend Vercel.',
          503,
          'HOT_WALLET_NOT_CONFIGURED',
        );
      }

      const client = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
      });

      const [ethRaw, usdcRaw] = await Promise.all([
        client.getBalance({ address }),
        client.readContract({
          address: USDC_BASE_ADDRESS_FOR_INFO,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }) as Promise<bigint>,
      ]);

      res.json({
        address,
        chainId: 8453,
        ethBalance: formatUnits(ethRaw, 18),
        ethBalanceWei: ethRaw.toString(),
        usdcBalance: formatUnits(usdcRaw, 6),
        usdcBalanceUnits: usdcRaw.toString(),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);
