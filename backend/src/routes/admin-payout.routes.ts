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
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { unaccentMatchIds } from '../lib/accentSearch.js';
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
  getPerAddressPaidTotals,
  PER_ADDRESS_HARD_CAP_USD,
} from '../services/usdc-base.service.js';
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import { resolveWalletInput, resolveWalletInputWithMeta } from '../services/ens.service.js';
import { isMercuryBlocked } from '../lib/mercuryBlockedCountries.js';
import { notifyHostOfPaymentExecution } from '../services/payoutTelegramNotify.js';
import { emailHostOfPaymentExecution } from '../services/payoutEmailNotify.js';
import { notifyPaymentsTeam } from '../services/paymentsTeamNotify.js';
import {
  requireAdminOrRegionalUnderboss,
  parseRegionsQuery,
  type RegionalAuthRequest,
} from '../middleware/regionalUnderboss.js';
import { scorePartiesByIds } from '../lib/fakeDetectionScan.js';

const router = Router();

// ravioli-82931: 'withdrawn' added — host-soft-deleted rows show in the admin
// queue for transparency. They are excluded from per-party cap math
// (`assertWithinPartyCap` only sums paid|pending|approved) and from
// `partyTotals` (which only sums paid).
// provolone-92103: 'completed' added — terminal close-out status used by
// Mark-Party-Paid's "close pending claims" mode. Semantically equivalent to
// 'paid' for cap math (counts toward usedUsd) but distinct on the UI so admins
// can tell "city was paid out, possibly less than the requested claim amount"
// apart from a direct paid row.
// gnocchi-92104: 'queued' added — intermediate "wire request sent, awaiting
// settlement" status between approved and paid. Used when the wire-transfer
// email has been sent to the payments team / bank but the wire hasn't cleared
// yet. Money is committed (counts toward cap math like paid/approved) but
// the row hasn't terminated — admins flip queued → paid once settlement is
// confirmed, or queued → failed if the wire bounces.
const ALLOWED_PAYOUT_STATUSES = ['pending', 'approved', 'queued', 'rejected', 'paid', 'failed', 'withdrawn', 'completed'] as const;
const ALLOWED_PAYOUT_METHODS = ['mercury_card', 'wire', 'usdc_base'] as const;

/**
 * acciuga-62583: hard per-submission ceiling of $675 (cassoeula-92103, was $650) —
 * same value as `HARD_PER_TX_CEILING_USD` in usdc-base.service.ts (the
 * USDC-execute ceiling) but enforced here at SUBMISSION time across all admin
 * create/edit paths (external POST + PATCH). No override path. Inlined here
 * per task spec — mirror of the helper in payout.routes.ts so we don't extract
 * a shared module just for two callsites.
 */
const PER_SUBMISSION_MAX_USD = 675;

function assertWithinPerSubmissionCap(amountUsd: number) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
  if (amountUsd > PER_SUBMISSION_MAX_USD) {
    throw new AppError(
      `Payment requests are limited to $${PER_SUBMISSION_MAX_USD} per submission. Please reduce the amount or split into multiple submissions.`,
      400,
      'PER_SUBMISSION_CAP_EXCEEDED',
    );
  }
}

/**
 * prosciutto-92106: "proof of send" check for status='paid' rows.
 *
 * A paid payout has proof IFF the right per-method field is populated:
 *   - usdc_base    → transaction_hash (on-chain tx)
 *   - wire         → wire_reference (bank reference number)
 *   - mercury_card → mercury_card_last4 OR mercury_card_id
 *   - <any method> → external_proof_url (admin-attached out-of-band proof)
 *
 * Rows without ANY of these are "zombie paid" — flipped to status='paid' by
 * a code path that didn't persist proof of the actual send. Alvaro city
 * surfaced this: 4 zombie paid rows inflated the Paid tile by ~$2k while
 * only $655 actually went on-chain.
 *
 * Used by:
 *   - Backend Paid sums (`fetchPaidTotalsByParty`, KPI tile, by-city rollups)
 *   - Backend cap math (`assertWithinPartyCap`) so zombies don't block real sends
 *   - Backend `mark-paid` gate (proof required unless `proofless:true` override)
 *   - Frontend ledger ("no proof" chip on zombie rows)
 *
 * Status='completed' rows are EXCLUDED from this gate — the mark_pending_complete
 * reconcile mode (caciotta-92103 / provolone-92103) intentionally writes
 * 'completed' WITHOUT proof, because that path means "the city was paid in
 * full by some other means, this row's payment obligation is fulfilled."
 * Completed rows continue to count toward their own bucket but NOT toward Paid.
 *
 * The SQL fragment + Prisma `where` predicate exposed by this helper keep the
 * filter byte-identical across every callsite.
 */
const PAID_PROOF_SQL = `(
  (payout_method = 'usdc_base' AND transaction_hash IS NOT NULL AND transaction_hash <> '')
  OR (payout_method = 'wire' AND wire_reference IS NOT NULL AND wire_reference <> '')
  OR (payout_method = 'mercury_card' AND ((mercury_card_last4 IS NOT NULL AND mercury_card_last4 <> '') OR (mercury_card_id IS NOT NULL AND mercury_card_id <> '')))
  OR (external_proof_url IS NOT NULL AND external_proof_url <> '')
)`;

/**
 * Prisma `where` fragment that matches the SAME predicate as PAID_PROOF_SQL.
 * Use inside `prisma.payout.findMany`/`aggregate`/`count` calls when filtering
 * "paid rows that have actual proof of send."
 */
const PAID_HAS_PROOF_WHERE: Prisma.PayoutWhereInput = {
  OR: [
    { payoutMethod: 'usdc_base', transactionHash: { not: null, notIn: [''] } },
    { payoutMethod: 'wire', wireReference: { not: null, notIn: [''] } },
    {
      payoutMethod: 'mercury_card',
      OR: [
        { mercuryCardLast4: { not: null, notIn: [''] } },
        { mercuryCardId: { not: null, notIn: [''] } },
      ],
    },
    // Any method — externally-attached proof (e.g. lasagna-92103 external
    // payment record path that stamped externalProofUrl).
    { externalProofUrl: { not: null, notIn: [''] } },
  ],
};

/**
 * JS-side proof check (mirror of PAID_HAS_PROOF_WHERE) for use after rows are
 * loaded — e.g. when aggregating in JS over `allFiltered`. Keep in sync with
 * PAID_HAS_PROOF_WHERE / PAID_PROOF_SQL.
 */
function paidRowHasProof(row: {
  payoutMethod: string | null;
  transactionHash: string | null;
  wireReference: string | null;
  mercuryCardLast4: string | null;
  mercuryCardId: string | null;
  externalProofUrl: string | null;
}): boolean {
  if (row.externalProofUrl && row.externalProofUrl.trim()) return true;
  if (row.payoutMethod === 'usdc_base') {
    return !!(row.transactionHash && row.transactionHash.trim());
  }
  if (row.payoutMethod === 'wire') {
    return !!(row.wireReference && row.wireReference.trim());
  }
  if (row.payoutMethod === 'mercury_card') {
    return (
      !!(row.mercuryCardLast4 && row.mercuryCardLast4.trim()) ||
      !!(row.mercuryCardId && row.mercuryCardId.trim())
    );
  }
  return false;
}

/**
 * prosciutto-92106: gate for `mark-paid` endpoint. Throws PROOF_REQUIRED if
 * the request body doesn't carry the right proof field for the chosen
 * `payoutMethod`. Skipped when `proofless=true` (admin reconcile override).
 *
 * Note: this checks the BODY values that are about to be written, not what's
 * already on the row. Callers should merge any pre-existing proof onto the
 * `bodyProof` object before invoking if they want to honor stale-but-present
 * proof — for `mark-paid` we always require fresh proof in the body because
 * the whole point of the endpoint is "I'm marking this paid right now."
 */
function assertMarkPaidHasProof(args: {
  payoutMethod: string | null;
  bodyTransactionHash: string | null | undefined;
  bodyWireReference: string | null | undefined;
  bodyMercuryCardLast4: string | null | undefined;
  bodyMercuryCardId: string | null | undefined;
  bodyExternalProofUrl: string | null | undefined;
}): void {
  // External proof is always acceptable regardless of method (covers the
  // out-of-band reconcile cases — admin paid via PayPal, Venmo, etc.).
  if (args.bodyExternalProofUrl && String(args.bodyExternalProofUrl).trim()) {
    return;
  }
  if (args.payoutMethod === 'usdc_base') {
    if (args.bodyTransactionHash && String(args.bodyTransactionHash).trim()) return;
    throw new AppError(
      'transactionHash is required to mark a USDC payout paid (or pass externalProofUrl / set proofless=true with a note).',
      400,
      'PROOF_REQUIRED',
    );
  }
  if (args.payoutMethod === 'wire') {
    if (args.bodyWireReference && String(args.bodyWireReference).trim()) return;
    throw new AppError(
      'wireReference is required to mark a wire payout paid (or pass externalProofUrl / set proofless=true with a note).',
      400,
      'PROOF_REQUIRED',
    );
  }
  if (args.payoutMethod === 'mercury_card') {
    const last4 = args.bodyMercuryCardLast4 && String(args.bodyMercuryCardLast4).trim();
    const cardId = args.bodyMercuryCardId && String(args.bodyMercuryCardId).trim();
    if (last4 || cardId) return;
    throw new AppError(
      'mercuryCardLast4 or mercuryCardId is required to mark a Mercury card payout paid (or pass externalProofUrl / set proofless=true with a note).',
      400,
      'PROOF_REQUIRED',
    );
  }
  // No method = nothing to verify against; admin must explicitly opt into
  // proofless to mark something paid with no method set.
  throw new AppError(
    'Cannot mark a payout paid without a payment method — set payoutMethod first, or pass proofless=true with a note.',
    400,
    'PROOF_REQUIRED',
  );
}

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
  // bruschetta-58291: surface the party's country on the /payments admin
  // queue rows + power the Country filter dropdown in PayoutsFilterBar.
  country: true,
  // provatura-92107: surface region so the /payments by-city "Hide US cities"
  // toggle can filter rows where party.region === 'usa'.
  region: true,
  expectedGuests: true,
  // arugula-38633 v2 follow-up: surface the effective reimbursement cap on
  // the /payments admin dashboard. Raw `reimbursementCapUsd` + `eventTags`
  // are selected here so `serializePayout` can resolve them via the shared
  // `computeEffectiveCapUsd` helper (validated cap OR max numeric tag).
  reimbursementCapUsd: true,
  eventTags: true,
  // paesana-89172: needed to derive `primaryHostInCohosts` — admin warning
  // when a payout's recipient is the primary host but they're not in the
  // co_hosts JSONB (= invisible on the event UI).
  userId: true,
  coHosts: true,
  user: { select: { email: true } },
  // pinsa-92103: surface the "city closed out" timestamp. Drives the green
  // ✓ Closed pill on the by-city table + hides the Mark Paid affordance for
  // already-closed parties.
  paymentsClosedAt: true,
  // culatello-92106: per-event tax-form gate. Surfaced on /payments so admin
  // can flip it via the PayoutReviewModal checkbox + the city-expansion
  // pill — drives whether the host-side TaxFormSection renders.
  taxFormRequired: true,
  // mortadella-92106: admin-only city notes. Surfaced in the by-city
  // expansion for admin viewers and stripped from the response for
  // underbosses (see serializer below).
  adminNotes: true,
  // Track when the TG receipts reminder was last sent for this city.
  receiptsReminderSentAt: true,
  // City-level payment approval fields.
  paymentsApprovedUsd: true,
  paymentsApprovedAt: true,
  paymentsApprovedBy: true,
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

// argentina-92103: 'underboss' added so regional UBs can be recorded as
// the actor on payout_audit rows. Admin-class kinds are unchanged.
type AdminActorKind = 'admin' | 'super_admin' | 'payment_admin' | 'underboss';

/**
 * Loads the actor row + the currently-authenticated user's id (used for
 * self-payout restriction).
 *
 * Falls back to an underboss lookup when no admin row exists for the email,
 * so regional underbosses (argentina-92103) can be the actor on approve /
 * reject / unapprove / flag-ready mutations they're authorized to make.
 *
 * Throws 403 if neither an admin nor an active underboss record is found —
 * the route-level middleware (`requireAdminOrRegionalUnderboss`) should
 * have rejected such a caller already; this is defensive belt-and-braces.
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

  // Self-payout restriction needs the user id linked to this email so we can
  // compare to payout.hostUserId. Best-effort lookup — many actors are not
  // also hosts, in which case there's nothing to compare.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (admin) {
    const actorKind: AdminActorKind =
      admin.role === 'super_admin' ? 'super_admin' :
      admin.role === 'payment_admin' ? 'payment_admin' :
      'admin';
    return {
      email,
      adminRole: admin.role,
      actorKind,
      userId: user?.id ?? null,
      isFull: actorKind !== 'payment_admin',
    };
  }

  // argentina-92103: fallback to underboss. `requireAdminOrRegionalUnderboss`
  // should have already verified this UB has scope for the requested region;
  // here we just need to record them as the actor on the audit row.
  const ub = await prisma.underboss.findFirst({
    where: { isActive: true, email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (!ub) {
    throw new AppError('Actor record not found', 403, 'FORBIDDEN');
  }
  return {
    email,
    adminRole: 'underboss',
    actorKind: 'underboss',
    userId: user?.id ?? null,
    // Underbosses are "full" for self-payout purposes — they don't fall
    // under the payment_admin self-restriction rule. (The OUT_OF_SCOPE
    // gate already prevents them from acting on out-of-region payouts.)
    isFull: true,
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

/**
 * parmigiana-89172: aggregate `status === 'paid'` payout totals per party in a
 * single groupBy query. Used to surface an "Already paid" warning inline on
 * both the prepay queue rows AND the admin payouts table rows, so admins don't
 * accidentally double-pay (Osogbo, Seropédica, Dar es Salaam all got two USDC
 * sends within hours of each other before this landed).
 *
 * Returns a Map keyed by partyId so callers can do O(1) lookups. Parties with
 * no paid payouts are simply absent from the map — callers should default to
 * `{ paidUsd: 0, paidCount: 0 }` for those.
 */
async function fetchPaidTotalsByParty(
  partyIds: string[],
): Promise<Map<string, { paidUsd: number; paidCount: number }>> {
  if (partyIds.length === 0) return new Map();
  // prosciutto-92106: only count proven-paid rows. Zombie rows (status='paid'
  // without any proof field set) are excluded so the "Already paid" warning +
  // by-party rollups reflect what actually went out, not bookkeeping ghosts.
  const rows = await prisma.payout.groupBy({
    by: ['partyId'],
    where: {
      partyId: { in: partyIds },
      status: 'paid',
      AND: PAID_HAS_PROOF_WHERE,
    },
    _sum: { finalAmountUsd: true },
    _count: { id: true },
  });
  const m = new Map<string, { paidUsd: number; paidCount: number }>();
  for (const r of rows) {
    m.set(r.partyId, {
      paidUsd: r._sum.finalAmountUsd ? Number(r._sum.finalAmountUsd.toString()) : 0,
      paidCount: r._count.id,
    });
  }
  return m;
}

/**
 * tiramisu-49102 + fontina-92103: hard per-party cap enforcement. Sums every
 * COMMITTED payout for the party (status `paid` or `approved`) and throws
 * 409 PARTY_CAP_EXCEEDED if `usedUsd + proposedUsd` exceeds the party's
 * `effectiveReimbursementCapUsd`. Pending claims are excluded — hosts may
 * submit receipts above the approved cap; the cap only constrains what
 * admins commit (approve/pay).
 *
 * `ignorePayoutId` excludes a row from the existing-total — used by PATCH so a
 * row being edited doesn't count against itself.
 */
async function assertWithinPartyCap(
  partyId: string,
  proposedUsd: number,
  ignorePayoutId?: string,
): Promise<void> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { reimbursementCapUsd: true, eventTags: true },
  });
  if (!party) {
    throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
  }
  const effectiveCap = computeEffectiveCapUsd({
    reimbursementCapUsd: party.reimbursementCapUsd,
    eventTags: party.eventTags,
  });
  if (effectiveCap == null) return;

  // prosciutto-92106: cap math splits paid rows into proven vs zombie. Zombie
  // status='paid' rows (no transaction_hash / wire_reference / mercury card /
  // external proof) are excluded from usedUsd so they can't block legitimate
  // sends. Approved/queued/completed continue to count as before because:
  //   - approved/queued = "money committed, hasn't moved yet" (always counts)
  //   - completed       = intentional bookkeeping close-out (provolone-92103)
  // Only the `paid` bucket has the zombie problem, so only `paid` gets the
  // proof gate here.
  const baseWhere: any = { partyId };
  if (ignorePayoutId) {
    baseWhere.id = { not: ignorePayoutId };
  }
  // 1. approved + queued + completed — count regardless of proof.
  const committedAgg = await prisma.payout.aggregate({
    where: {
      ...baseWhere,
      status: { in: ['approved', 'queued', 'completed'] },
    },
    _sum: { finalAmountUsd: true },
  });
  // 2. paid — only count rows with proof of send.
  const provenPaidAgg = await prisma.payout.aggregate({
    where: {
      ...baseWhere,
      status: 'paid',
      AND: PAID_HAS_PROOF_WHERE,
    },
    _sum: { finalAmountUsd: true },
  });
  const usedUsd =
    (committedAgg._sum.finalAmountUsd
      ? Number(committedAgg._sum.finalAmountUsd.toString())
      : 0) +
    (provenPaidAgg._sum.finalAmountUsd
      ? Number(provenPaidAgg._sum.finalAmountUsd.toString())
      : 0);
  const remainingUsd = Math.max(0, effectiveCap - usedUsd);

  if (usedUsd + proposedUsd > effectiveCap + 1e-9) {
    throw new AppError(
      `This payment would exceed the party's $${effectiveCap.toFixed(2)} cap. $${remainingUsd.toFixed(2)} remaining.`,
      409,
      'PARTY_CAP_EXCEEDED',
    );
  }
}

/** Build a Prisma `where` clause from query-string filters. */
async function buildPayoutWhere(query: Request['query']): Promise<any> {
  const where: any = {};

  // coppa-92106: status accepts either a single status or a comma-separated
  // list (e.g. `paid,completed`) so the new Payments-ledger view can fetch
  // both terminal "money sent / row closed-out" buckets in one query. Unknown
  // entries are dropped; an empty resulting list = no filter (same as 'all').
  const status = query.status;
  if (typeof status === 'string' && status !== 'all' && status.trim().length > 0) {
    const parts = status
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ALLOWED_PAYOUT_STATUSES.includes(s as any));
    if (parts.length === 1) {
      where.status = parts[0];
    } else if (parts.length > 1) {
      where.status = { in: parts };
    }
  }

  // coppa-92106: opt-in `provenOnly=true` applies the prosciutto-92106
  // "has proof of send" predicate so the Payments-ledger view excludes
  // zombie status='paid' rows (no transaction_hash / wire_reference /
  // mercury_card_last4 / external_proof_url) from the result set. Used by the
  // new Payments view — totals already filter zombies out, this aligns the
  // row list with those totals.
  if (query.provenOnly === 'true' || query.provenOnly === '1') {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      PAID_HAS_PROOF_WHERE,
    ];
  }

  const method = query.payoutMethod;
  if (typeof method === 'string' && method !== 'all' && ALLOWED_PAYOUT_METHODS.includes(method as any)) {
    where.payoutMethod = method;
  }

  // salumi-89172: Purpose filter — 'event' | 'shipping' | 'all' (default).
  // When unset, both purposes are returned (existing behavior — pre-feature
  // all rows were implicitly 'event').
  const purpose = query.purpose;
  if (typeof purpose === 'string' && purpose !== 'all' && (purpose === 'event' || purpose === 'shipping')) {
    where.purpose = purpose;
  }

  const partyId = query.partyId;
  if (typeof partyId === 'string' && partyId.trim().length > 0) {
    where.partyId = partyId.trim();
  }

  // salame-83472: unified search — matches host.email, host.name, OR party.name
  // (case-insensitive contains). Replaces the previous `hostEmail`-only filter.
  // The implicit AND with the existing top-level `where.party` (underbossStatus
  // 'approved' from tartufo-58291 + optional country from bruschetta-58291) is
  // preserved by Prisma because top-level OR is AND'd with other top-level keys.
  const search = query.search;
  if (typeof search === 'string' && search.trim().length > 0) {
    const needle = search.trim();
    // diavola-83147: accent-insensitive search. Prefilter party + host ids via
    // the `unaccent` extension, then fold the FK `in` clauses into where.OR so
    // `jose` matches `José`, `munchen` matches `München`, etc.
    const [partyIds, hostIds] = await Promise.all([
      unaccentMatchIds(prisma, 'parties', ['name'], needle),
      unaccentMatchIds(prisma, 'User', ['name', 'email'], needle),
    ]);
    where.OR = [
      { partyId: { in: partyIds } },
      { hostUserId: { in: hostIds } },
    ];
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

  // bruschetta-58291: optional country filter — pulled out before assembling
  // `where.party` below so it merges cleanly with the tartufo-58291
  // `underbossStatus: 'approved'` filter (must NOT overwrite that gate).
  const country = query.country;
  const countryClause =
    typeof country === 'string' && country !== 'all' && country.trim().length > 0
      ? { country: country.trim() }
      : {};

  // mascarpone-49102: optional tag filter — single tag, "contains" semantic
  // on the party.event_tags String[] column. Prisma's `{ has: string }`
  // operator emits `event_tags @> ARRAY[$1]`. Folds into `where.party` below
  // alongside the approval gate + country clause; do NOT overwrite either.
  const tag = query.tag;
  const tagClause =
    typeof tag === 'string' && tag !== 'all' && tag.trim().length > 0
      ? { eventTags: { has: tag.trim() } }
      : {};

  // argentina-92103: regional scope filter — when /payments/latam (or any
  // future regional portal) sends `?regions=central-america,south-america`,
  // restrict the queue to parties whose `region` is in the list. Merged with
  // the existing approval gate + country/tag filters so all gates compose.
  const regionsFromQuery = parseRegionsQuery(query.regions);
  const regionClause = regionsFromQuery && regionsFromQuery.length > 0
    ? { region: { in: regionsFromQuery } }
    : {};

  // ciabatta-92110: the "Closed" status tab is a party-level pseudo-status —
  // filters on cities the admin has closed out (payments_closed_at set), not payout.status.
  const closedClause =
    query.status === 'closed' ? { paymentsClosedAt: { not: null } } : {};

  // tartufo-58291: hide payouts from unapproved parties from the admin queue
  // + CSV export. Existing rows from before the bresaola-49185 backend gate
  // shouldn't surface in routine review. Stats/totals reuse this same `where`
  // so they stay consistent. bruschetta-58291: merged with optional country
  // filter so both apply. mascarpone-49102: merged with optional tag filter
  // (single event_tag "has" match) so the queue can be sliced by tag.
  // argentina-92103: merged with optional region filter for regional portals.
  where.party = {
    underbossStatus: 'approved',
    ...countryClause,
    ...tagClause,
    ...regionClause,
    ...closedClause,
  };

  return where;
}

/**
 * paesana-89172: returns true when the party's primary host (party.user.email)
 * is present in the co_hosts JSONB array (case-insensitive email match), OR
 * the party doesn't have a User joined (rare). Returns false ONLY when we know
 * the primary host's email AND it's missing from co_hosts — that's the
 * suspicious-payment signal: the recipient is the event owner but they're
 * invisible in the Hosts UI / public page.
 */
function isPrimaryHostInCohosts(party: any): boolean {
  if (!party || typeof party !== 'object') return true;
  const ownerEmail = party.user?.email ? String(party.user.email).toLowerCase() : null;
  if (!ownerEmail) return true; // can't determine — don't flag
  const list = Array.isArray(party.coHosts) ? party.coHosts : [];
  return list.some((ch: any) =>
    ch && typeof ch === 'object'
    && typeof ch.email === 'string'
    && ch.email.toLowerCase() === ownerEmail
  );
}

/**
 * argentina-92103: derive whether a payout is currently "flagged ready for
 * payment" by a regional underboss. The signal is sticky until invalidated by
 * a downstream lifecycle event — once an admin marks it paid or anyone
 * rejects / reverts the row, the flag is considered consumed.
 *
 * Implementation: scan the row's `audits` (already sorted DESC by createdAt
 * in callsites that include them). The most recent `flag_ready` audit "wins"
 * iff there is NO subsequent `mark_paid` / `mark_queued` / `reject` /
 * `unapprove` audit at or after its timestamp (gnocchi-92104 added
 * `mark_queued` to the consume list).
 *
 * Returns `null` shape when the audits weren't loaded so older queries don't
 * accidentally claim "not flagged" — clients should treat `flaggedReady`
 * undefined as "unknown" but TS-wise we always emit a boolean.
 */
function deriveFlaggedReady(audits: any[] | undefined): {
  flaggedReady: boolean;
  flaggedReadyAt: string | null;
  flaggedReadyBy: string | null;
} {
  if (!Array.isArray(audits) || audits.length === 0) {
    return { flaggedReady: false, flaggedReadyAt: null, flaggedReadyBy: null };
  }
  // Find the most-recent flag_ready audit.
  let latestFlag: any = null;
  for (const a of audits) {
    if (a.action === 'flag_ready') {
      if (!latestFlag || (a.createdAt && a.createdAt > latestFlag.createdAt)) {
        latestFlag = a;
      }
    }
  }
  if (!latestFlag) {
    return { flaggedReady: false, flaggedReadyAt: null, flaggedReadyBy: null };
  }
  // Check whether a state-changing audit landed AT OR AFTER the flag.
  const flagTs = latestFlag.createdAt instanceof Date
    ? latestFlag.createdAt.getTime()
    : new Date(latestFlag.createdAt).getTime();
  const consumed = audits.some((a) => {
    if (a === latestFlag) return false;
    // gnocchi-92104: 'mark_queued' (wire request sent) also consumes the
    // flag — the payments team has visibly taken action, so re-flagging is
    // a stale signal.
    if (
      a.action !== 'mark_paid' &&
      a.action !== 'mark_queued' &&
      a.action !== 'reject' &&
      a.action !== 'unapprove'
    ) {
      return false;
    }
    const ts = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    return ts >= flagTs;
  });
  if (consumed) {
    return { flaggedReady: false, flaggedReadyAt: null, flaggedReadyBy: null };
  }
  const at = latestFlag.createdAt instanceof Date
    ? latestFlag.createdAt.toISOString()
    : new Date(latestFlag.createdAt).toISOString();
  return {
    flaggedReady: true,
    flaggedReadyAt: at,
    flaggedReadyBy: latestFlag.actorEmail ?? null,
  };
}

/** Shape a Prisma payout row for the API response. */
function serializePayout(row: any): any {
  const flag = deriveFlaggedReady(row.audits);
  return {
    id: row.id,
    partyId: row.partyId,
    hostUserId: row.hostUserId,
    // salumi-89172: shipping coordinator payouts can be filtered out of the
    // normal queue + show a "Shipping" pill in the admin UI.
    purpose: row.purpose ?? 'event',
    partyKitId: row.partyKitId ?? null,
    originalAmount: Number(row.originalAmount),
    originalCurrency: row.originalCurrency,
    exchangeRate: Number(row.exchangeRate),
    extractedAmountUsd: Number(row.extractedAmountUsd),
    finalAmountUsd: Number(row.finalAmountUsd),
    status: row.status,
    payoutMethod: row.payoutMethod,
    payoutWalletAddress: row.payoutWalletAddress,
    // caciotta-92104: original ENS input (e.g. `puebla.eth`) when the
    // canonical 0x came from ENS resolution. Null when the host typed a
    // 0x directly. Frontend renders "name.eth -> 0xa1b2..." in admin views.
    payoutWalletInput: row.payoutWalletInput ?? null,
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
      // mortadella-92103: per-receipt FX. Drives the reviewer pill
      // ("$X.YZ USD (1234.56 MXN @ rate)") so admins can see exactly what
      // each receipt was converted from. Null for receipts uploaded before
      // mortadella-92103 — those rows still have the parent payout's
      // headline FX, but no per-doc detail.
      originalAmount: d.originalAmount == null ? null : Number(d.originalAmount),
      originalCurrency: d.originalCurrency,
      exchangeRate: d.exchangeRate == null ? null : Number(d.exchangeRate),
      // taralli-92104: surface the structured line items so the admin
      // PayoutReviewModal can render the editable per-line grid. JSONB
      // column — `null` when OCR didn't extract any items (older rows
      // pre-formaggi-89172 or receipts the model couldn't parse).
      ocrLineItems: Array.isArray(d.ocrLineItems) ? d.ocrLineItems : null,
      ocrError: d.ocrError,
      sortOrder: d.sortOrder,
      // culatello-92104: admin-flagged duplicate receipts. Reviewer modal
      // dims these rows + excludes them from the OCR sum + the host PATCH
      // finalAmountUsd recompute path.
      isDuplicate: d.isDuplicate === true,
      // provola-92106: admin-flagged "ineligible for reimbursement". Distinct
      // from duplicate (legitimate purchase but doesn't qualify — alcohol,
      // tips, personal items). Same exclusion semantics as `isDuplicate` —
      // filtered out of every USD sum + the host recompute path.
      ineligible: d.ineligible === true,
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
          // bruschetta-58291: surface the party's country on the wire so the
          // /payments queue can render it as a subtitle and populate the
          // Country filter dropdown.
          country: row.party.country ?? null,
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
          // tagliatelle-49102: raw event_tags array surfaced so the
          // /payments PayoutReviewModal can render the tag chips + let
          // full admins add/remove tags via PATCH /api/parties/:id.
          eventTags: Array.isArray(row.party.eventTags) ? row.party.eventTags : [],
          // paesana-89172: surface the owner's id + a flag for whether they
          // appear in the co_hosts array. Frontend pairs this with
          // `payout.hostUserId` to flag suspicious admin-created prepayments
          // whose recipient is the primary host but isn't visible on the
          // event UI.
          userId: row.party.userId ?? null,
          primaryHostInCohosts: isPrimaryHostInCohosts(row.party),
          // pinsa-92103: payments-closed-at timestamp drives the by-city
          // ✓ Closed pill + hides the Mark Paid affordance for fully
          // closed-out cities (Ekiti, Tangier).
          paymentsClosedAt: row.party.paymentsClosedAt
            ? row.party.paymentsClosedAt.toISOString()
            : null,
          // culatello-92106: per-event tax-form gate. Drives the admin
          // checkbox in PayoutReviewModal + the pill in PayoutsByPartyTable.
          taxFormRequired: row.party.taxFormRequired === true,
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
    // argentina-92103: derived from the audit trail above. When `row.audits`
    // wasn't loaded (e.g. list endpoint), these surface as `false / null` so
    // the wire shape stays consistent. The list endpoint augments per-row
    // below via a follow-up query — see "flag-ready augmentation" in GET /.
    flaggedReady: flag.flaggedReady,
    flaggedReadyAt: flag.flaggedReadyAt,
    flaggedReadyBy: flag.flaggedReadyBy,
  };
}

/**
 * argentina-92103: bulk-fetch the latest `flag_ready` audit per payoutId and
 * derive the sticky flag state for each. Used by the LIST endpoint, which
 * doesn't include `audits` per row to keep the response small. Returns a
 * Map keyed by payoutId. Payouts with no flag entry are absent.
 *
 * Sticky semantics: the latest `flag_ready` audit wins UNLESS a subsequent
 * `mark_paid` / `mark_queued` / `reject` / `unapprove` audit exists at or
 * after it (gnocchi-92104 added `mark_queued` to the consume list).
 */
async function fetchFlaggedReadyByPayoutId(
  payoutIds: string[],
): Promise<Map<string, { at: string; by: string | null }>> {
  if (payoutIds.length === 0) return new Map();
  // Pull every relevant audit in one query so we can derive sticky state in
  // memory. `flag_ready` + the four "consumes" actions. This is bounded:
  // the page size of LIST is 100, and each payout typically has <20 audits.
  // gnocchi-92104: include 'mark_queued' so a wire-request-sent audit
  // invalidates a prior flag the same way mark_paid does.
  const audits = await prisma.payoutAudit.findMany({
    where: {
      payoutId: { in: payoutIds },
      action: { in: ['flag_ready', 'mark_paid', 'mark_queued', 'reject', 'unapprove'] },
    },
    select: {
      payoutId: true,
      action: true,
      actorEmail: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const latestFlag = new Map<string, { at: Date; by: string | null }>();
  const latestConsumeAt = new Map<string, Date>();
  for (const a of audits) {
    if (a.action === 'flag_ready') {
      const cur = latestFlag.get(a.payoutId);
      if (!cur || a.createdAt > cur.at) {
        latestFlag.set(a.payoutId, { at: a.createdAt, by: a.actorEmail ?? null });
      }
    } else {
      const cur = latestConsumeAt.get(a.payoutId);
      if (!cur || a.createdAt > cur) {
        latestConsumeAt.set(a.payoutId, a.createdAt);
      }
    }
  }
  const out = new Map<string, { at: string; by: string | null }>();
  for (const [payoutId, flag] of latestFlag.entries()) {
    const consume = latestConsumeAt.get(payoutId);
    if (consume && consume >= flag.at) continue; // sticky flag was invalidated
    out.set(payoutId, { at: flag.at.toISOString(), by: flag.by });
  }
  return out;
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
      // diavola-83147: accent-insensitive prefilter via the `unaccent` extension.
      const ids = await unaccentMatchIds(prisma, 'parties', ['name', 'custom_url', 'invite_code'], rawQ);
      const parties = await prisma.party.findMany({
        where: {
          underbossStatus: 'approved',
          id: { in: ids },
        },
        select: {
          id: true,
          name: true,
          inviteCode: true,
          userId: true,
          coHosts: true,
          // parmigiana-92104: surface country + event_tags so the
          // ExternalPaymentModal can render the SWC Hub reimbursement warning
          // (country='United States' OR event_tags includes 'SWC Hub') once a
          // party is picked. Frontend-only guardrail — no backend gating.
          country: true,
          eventTags: true,
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
            // parmigiana-92104: forwarded so the ExternalPaymentModal can
            // render the SWC Hub reimbursement warning on the selected party.
            country: p.country ?? null,
            eventTags: Array.isArray(p.eventTags) ? p.eventTags : [],
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
      const where = await buildPayoutWhere(req.query);
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
  // argentina-92103: regional underbosses can READ the prepay queue scoped to
  // their region via `?regions=`. Without the param, admin-class only.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      // argentina-92103: when a regional scope is supplied, narrow the
      // prepay queue to parties in that region. Same merge pattern as
      // `buildPayoutWhere` — region clause folds into the existing where.
      const regionsFromQuery = parseRegionsQuery(req.query.regions);
      const regionFilter = regionsFromQuery && regionsFromQuery.length > 0
        ? { region: { in: regionsFromQuery } }
        : {};
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
      // argentina-92103: optional regional scope merged in for /payments/latam.
      const parties = await prisma.party.findMany({
        where: {
          eventTags: { has: 'prepay' },
          underbossStatus: 'approved',
          ...regionFilter,
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
          // paesana-89172: primary host (parties.userId) + whether they
          // appear in co_hosts. Frontend flags amber when a candidate's
          // userId matches but the primary host isn't visible.
          userId: string | null;
          primaryHostInCohosts: boolean;
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
            // paesana-89172: shape this party for the warning helper. The
            // prepay-queue select already pulls `userId`, `coHosts`, and
            // `user.email` — reuse them via `isPrimaryHostInCohosts`.
            userId: p.userId ?? null,
            primaryHostInCohosts: isPrimaryHostInCohosts(p),
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
      //    in-flight payout for that party. "In-flight" = pending/approved/queued/paid
      //    (failed/rejected don't count — that prepayment never went through).
      //    gnocchi-92104: 'queued' (wire request sent, awaiting settlement) is
      //    in-flight too — we shouldn't surface a fresh prepay candidate while
      //    a wire is mid-flight.
      //    Run as a single grouped query: pull all matching payouts and bucket
      //    by partyId in memory.
      const inFlight = filteredCandidateUserIds.size
        ? await prisma.payout.findMany({
            where: {
              partyId: { in: optedInAssembled.map(r => r.partyMeta.id) },
              hostUserId: { in: Array.from(filteredCandidateUserIds) },
              status: { in: ['pending', 'approved', 'queued', 'paid'] },
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

      // parmigiana-89172: attach per-party "already paid" totals so the
      // admin sees inline warning before clicking Create Prepayment again.
      // Single aggregate query keyed by partyId; default 0/0 for parties
      // with no prior paid payouts.
      const finalPartyIds = finalRows.map(r => r.party.id);
      const paidTotals = await fetchPaidTotalsByParty(finalPartyIds);
      const rowsWithPaidTotals = finalRows.map(r => {
        const totals = paidTotals.get(r.party.id);
        return {
          ...r,
          partyPaidUsd: totals?.paidUsd ?? 0,
          partyPaidCount: totals?.paidCount ?? 0,
        };
      });

      res.json({ rows: rowsWithPaidTotals });
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
//   - mortazza-92103: supports `recipientHostUserId` (radio pick in the modal)
//     and `recipientEmail` (free-form "Other (specify)" path) so the admin
//     attributes the payment to the actual recipient cohost, not themselves.
//     Mirrors the bismarck-92103 prepay admin override. When override is used,
//     the audit row's `note` records "Recipient overridden to {email}".
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
      // mortazza-92103: `recipientHostUserId` (mirrors bismarck-92103 / prepay
      // override) and `recipientEmail` (free-form lookup for the "Other" path
      // in the modal) are both honored ahead of `hostUserId`. Either resolves
      // to the actual recipient User whose id ends up in `payouts.host_user_id`.
      // Legacy `hostUserId` from the v1 modal still works as a fallback.
      const rawHostUserId = typeof body.hostUserId === 'string' ? body.hostUserId.trim() : '';
      const recipientHostUserId =
        typeof body.recipientHostUserId === 'string' ? body.recipientHostUserId.trim() : '';
      const recipientEmail =
        typeof body.recipientEmail === 'string' ? body.recipientEmail.trim() : '';
      const finalAmountUsd = Number(body.finalAmountUsd);
      const rawMethod = typeof body.payoutMethod === 'string' ? body.payoutMethod : '';
      const adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() : '';

      if (!partyId) {
        throw new AppError('partyId is required', 400, 'VALIDATION_ERROR');
      }
      if (!rawHostUserId && !recipientHostUserId && !recipientEmail) {
        throw new AppError(
          'hostUserId, recipientHostUserId, or recipientEmail is required',
          400,
          'VALIDATION_ERROR',
        );
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

      // mortazza-92103: resolve the actual recipient. Precedence:
      //   1. `recipientHostUserId` (radio pick from the modal's candidate list)
      //   2. `recipientEmail` (free-form "Other (specify)" path — case-insensitive
      //      lookup on User.email; rejects with RECIPIENT_USER_NOT_FOUND when no
      //      match so the admin has to create the User first or pick a candidate)
      //   3. legacy `hostUserId` (v1 modal compatibility)
      // The endpoint is already gated by `requireAnyAdminOrPaymentAdmin`, so any
      // caller reaching this point is admin-class (admin / super_admin /
      // payment_admin). `assertNotSelfPayout` below still blocks payment_admin
      // from stamping themselves as the recipient.
      let hostUserId: string;
      let recipientOverrideNote: string | null = null;
      if (recipientHostUserId) {
        const targetUser = await prisma.user.findUnique({
          where: { id: recipientHostUserId },
          select: { id: true, email: true },
        });
        if (!targetUser) {
          throw new AppError(
            'recipientHostUserId does not match any User',
            400,
            'INVALID_RECIPIENT_HOST_USER_ID',
          );
        }
        hostUserId = targetUser.id;
        recipientOverrideNote = `Recipient overridden to ${targetUser.email}`;
      } else if (recipientEmail) {
        // mortazza-92103: "Other (specify)" free-form path. Case-insensitive
        // email lookup. No match → 400 RECIPIENT_USER_NOT_FOUND so the admin
        // is forced to create the User first or pick a known candidate.
        const targetUser = await prisma.user.findFirst({
          where: { email: { equals: recipientEmail, mode: 'insensitive' } },
          select: { id: true, email: true },
        });
        if (!targetUser) {
          throw new AppError(
            `No User found for email ${recipientEmail} — create the user first or pick a candidate from the list.`,
            400,
            'RECIPIENT_USER_NOT_FOUND',
          );
        }
        hostUserId = targetUser.id;
        recipientOverrideNote = `Recipient overridden to ${targetUser.email} (specified by email)`;
      } else {
        hostUserId = rawHostUserId;
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

      // lasagna-92103: admin amount is canonical on the external-record path
      // too. Removed the per-submission cap throw + the per-party cap throw.
      // Admins recording an out-of-band payment (already executed via bank /
      // Mercury dashboard / etc.) shouldn't be cap-gated at the API
      // boundary — they're documenting reality, not requesting an action.
      // The USDC execute hard ceiling is irrelevant here (these are external
      // payments, not on-chain sends). `body.allowOverSubmissionCap` is no
      // longer read; legacy clients that still send it are ignored (no-op).

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
      const cardId = typeof body.mercuryCardId === 'string' && body.mercuryCardId.trim()
        ? body.mercuryCardId.trim()
        : null;
      const extProof = typeof body.externalProofUrl === 'string' && body.externalProofUrl.trim()
        ? body.externalProofUrl.trim()
        : null;

      // prosciutto-92106: PROOF GATE on external-record path too. Same escape
      // hatch as mark-paid: full admins can set `proofless:true` with a note.
      // Without that, the row must carry method-appropriate proof. Otherwise
      // External Payment is the same zombie-creation vector — admins clicking
      // through with only an adminNote.
      const wantsProoflessExt = body.proofless === true;
      if (wantsProoflessExt) {
        if (actor.actorKind !== 'admin' && actor.actorKind !== 'super_admin') {
          throw new AppError(
            'Proofless external payment requires full admin (admin / super_admin) access.',
            403,
            'PROOFLESS_REQUIRES_ADMIN',
          );
        }
      } else {
        assertMarkPaidHasProof({
          payoutMethod: storedMethod,
          bodyTransactionHash: txHash,
          bodyWireReference: wireRef,
          bodyMercuryCardLast4: cardLast4,
          bodyMercuryCardId: cardId,
          bodyExternalProofUrl: extProof,
        });
      }

      // mortazza-92103: when the admin attributed the payment to a different
      // recipient than themselves, prepend the override marker so the audit
      // trail makes "Submitted by X but credited to Y" obvious at a glance.
      const composedNote = recipientOverrideNote
        ? `External payment recorded. ${recipientOverrideNote}. ${adminNotes}`
        : `External payment recorded. ${adminNotes}`;

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
            mercuryCardId: cardId,
            externalProofUrl: extProof,
            adminNotes: wantsProoflessExt
              ? `[proofless-mark-paid] ${composedNote}`
              : composedNote,
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
// GET /api/admin/payouts/by-party — etruria-92103
//
// Group-by-city view of the /payments admin queue. Same filters as the LIST
// endpoint scope the underlying payouts BEFORE grouping; the response shape is
// one row per Party with per-status counts/sums + receipt count + last
// activity, plus the underlying AdminPayout[] for the expansion section.
//
// Auth chain mirrors GET /:  admin/payment-admin OR regional underboss via
// `?regions=`. Funds-sending affordances stay admin-only and aren't reachable
// from this endpoint anyway.
//
// Literal `/by-party` MUST be declared before `/:id` so the literal path wins
// on route matching.
// ============================================
router.get(
  '/by-party',
  requireAuth,
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const where = await buildPayoutWhere(req.query);

      // 1. Fetch every payout matching the filter set — no skip cursor in v1.
      //    Same include shape as the LIST endpoint so `serializePayout` returns
      //    a consistent AdminPayout. Ordered DESC by createdAt so the inner
      //    payouts array per party is already newest-first.
      const payoutRows = await prisma.payout.findMany({
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
      });

      // 2. Per-party paid totals + flag-ready signal — same augmentation as
      //    the LIST endpoint so the embedded AdminPayout rows match shape.
      const uniquePartyIds = Array.from(
        new Set(
          payoutRows
            .map((p) => (p as any).party?.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );
      const [pagePaidTotals, pageFlagged] = await Promise.all([
        fetchPaidTotalsByParty(uniquePartyIds),
        fetchFlaggedReadyByPayoutId(payoutRows.map((p) => p.id)),
      ]);

      // 3. Per-party receipt count from payout_documents (kind='receipt'). One
      //    batched groupBy over every party id present in the filtered set.
      const receiptCounts = new Map<string, number>();
      if (uniquePartyIds.length > 0) {
        const docRows = await prisma.payoutDocument.groupBy({
          by: ['partyId'],
          where: { partyId: { in: uniquePartyIds }, kind: 'receipt' },
          _count: { id: true },
        });
        for (const r of docRows) {
          receiptCounts.set(r.partyId, r._count.id);
        }
      }

      // ricotta-92104: per-party event photos for the by-city expansion's
      // Event/Pizza preview sections. Mirrors the same select shape as the
      // per-payout serializer (admin-payout.routes.ts ~line 2189) so the
      // frontend's photo split logic (focaccia-92104: tag === 'Pizza' or
      // 'pizza-selfie' → Pizza photos, everything else → Event photos) can be
      // reused as-is. Admins see every photo regardless of moderation status;
      // the frontend renders a "Hidden" pill when `status !== 'approved'`.
      const eventPhotosByParty = new Map<string, any[]>();
      if (uniquePartyIds.length > 0) {
        const photoRows = await prisma.photo.findMany({
          where: { partyId: { in: uniquePartyIds }, deletedAt: null }, // provolone-58931
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            partyId: true,
            url: true,
            thumbnailUrl: true,
            fileName: true,
            mimeType: true,
            caption: true,
            status: true,
            starred: true,
            tags: true,
            uploaderName: true,
            createdAt: true,
          },
        });
        for (const p of photoRows) {
          const list = eventPhotosByParty.get(p.partyId) ?? [];
          list.push({
            id: p.id,
            url: p.url,
            thumbnailUrl: p.thumbnailUrl,
            fileName: p.fileName,
            mimeType: p.mimeType,
            caption: p.caption,
            status: p.status,
            starred: p.starred,
            tags: p.tags,
            uploaderName: p.uploaderName,
            createdAt: p.createdAt.toISOString(),
          });
          eventPhotosByParty.set(p.partyId, list);
        }
      }

      // 4. Group payouts by partyId in JS. Sum amounts by status, take the
      //    most recent updatedAt, count flagged-ready, capture the party meta
      //    from the first row encountered (PAYOUT_PARTY_SELECT is identical
      //    across rows in the same party).
      type Bucket = {
        partyMeta: any;
        pendingCount: number;
        pendingUsd: number;
        approvedCount: number;
        approvedUsd: number;
        paidCount: number;
        paidUsd: number;
        // prosciutto-92106: separate counters for zombie paid rows (status='paid'
        // but no transaction_hash / wire_reference / mercury card / external
        // proof). Frontend uses these to render a "no proof" chip + exclude
        // them from the headline "Paid" tile while preserving total row count.
        paidNoProofCount: number;
        paidNoProofUsd: number;
        rejectedCount: number;
        rejectedUsd: number;
        failedCount: number;
        failedUsd: number;
        withdrawnCount: number;
        withdrawnUsd: number;
        // provolone-92103: terminal close-out status for "city paid in full"
        // mark-pending-complete flow. Tracked separately from 'paid' so the
        // admin UI can show "X paid + Y completed" distinct rollups.
        // completedCount/completedUsd count ALL completed rows (proven or not)
        // for backward compatibility with existing consumers.
        completedCount: number;
        completedUsd: number;
        // bresaola-49340: subset of completed rows that lack per-row proof
        // (the proofless mark_pending_complete close-outs). The Paid headline
        // = completedUsd MINUS completedNoProofUsd, mirroring how paid rows are
        // split into paidUsd / paidNoProofUsd. New fields are additive so old
        // consumers reading completedUsd/completedCount don't change meaning.
        completedNoProofCount: number;
        completedNoProofUsd: number;
        flaggedReadyCount: number;
        lastActivityAt: Date;
        payouts: any[]; // raw Prisma rows; serialized below
      };

      const buckets = new Map<string, Bucket>();

      for (const row of payoutRows) {
        const partyMeta = (row as any).party;
        if (!partyMeta) continue;
        const partyId = partyMeta.id;
        const usd = Number(row.finalAmountUsd);
        let b = buckets.get(partyId);
        if (!b) {
          b = {
            partyMeta,
            pendingCount: 0, pendingUsd: 0,
            approvedCount: 0, approvedUsd: 0,
            paidCount: 0, paidUsd: 0,
            paidNoProofCount: 0, paidNoProofUsd: 0,
            rejectedCount: 0, rejectedUsd: 0,
            failedCount: 0, failedUsd: 0,
            withdrawnCount: 0, withdrawnUsd: 0,
            completedCount: 0, completedUsd: 0,
            completedNoProofCount: 0, completedNoProofUsd: 0,
            flaggedReadyCount: 0,
            lastActivityAt: row.updatedAt,
            payouts: [],
          };
          buckets.set(partyId, b);
        }
        if (row.updatedAt > b.lastActivityAt) b.lastActivityAt = row.updatedAt;
        switch (row.status) {
          case 'pending':
            b.pendingCount += 1; b.pendingUsd += usd; break;
          case 'approved':
            b.approvedCount += 1; b.approvedUsd += usd; break;
          case 'paid':
            // prosciutto-92106: only proven-paid rows go into paidUsd —
            // proofless ones go into the parallel paidNoProofUsd bucket
            // so the UI can flag them without losing them from the count.
            if (paidRowHasProof(row as any)) {
              b.paidCount += 1; b.paidUsd += usd;
            } else {
              b.paidNoProofCount += 1; b.paidNoProofUsd += usd;
            }
            break;
          case 'rejected':
            b.rejectedCount += 1; b.rejectedUsd += usd; break;
          case 'failed':
            b.failedCount += 1; b.failedUsd += usd; break;
          case 'withdrawn':
            b.withdrawnCount += 1; b.withdrawnUsd += usd; break;
          case 'completed':
            // provolone-92103: terminal close-out — counted in its own bucket.
            // bresaola-49340: split proof-gated vs proofless, mirroring the
            // 'paid' / paidNoProof split above. completedCount/completedUsd
            // still count ALL completed rows (backward compat); the proofless
            // subset is ALSO tracked so the Paid headline can subtract it.
            b.completedCount += 1; b.completedUsd += usd;
            if (!paidRowHasProof(row as any)) {
              b.completedNoProofCount += 1; b.completedNoProofUsd += usd;
            }
            break;
        }
        if (pageFlagged.has(row.id)) b.flaggedReadyCount += 1;
        b.payouts.push(row);
      }

      // 5. Serialize. Reuse `serializePayout` for the inner AdminPayout array
      //    so the embedded rows are byte-identical to the LIST endpoint's. Also
      //    apply the same per-party paidTotal + flag-ready augmentation so
      //    PayoutRow renders the "Already paid" caption + the green flag icon
      //    inside the expansion.
      const rows = Array.from(buckets.values()).map((b) => {
        const partyId = b.partyMeta.id;
        const totals = pagePaidTotals.get(partyId);
        const serializedPayouts = b.payouts.map((p) => {
          const sp = serializePayout(p);
          if (sp.party?.id) {
            sp.party.paidTotalUsd = totals?.paidUsd ?? 0;
            sp.party.paidTotalCount = totals?.paidCount ?? 0;
          }
          const flag = pageFlagged.get(sp.id);
          if (flag) {
            sp.flaggedReady = true;
            sp.flaggedReadyAt = flag.at;
            sp.flaggedReadyBy = flag.by;
          }
          return sp;
        });

        return {
          party: {
            id: partyId,
            name: b.partyMeta.name,
            customUrl: b.partyMeta.customUrl ?? null,
            inviteCode: b.partyMeta.inviteCode ?? null,
            country: b.partyMeta.country ?? null,
            // provatura-92107: region now selected via PAYOUT_PARTY_SELECT so
            // the by-city "Hide US cities" toggle can filter party.region.
            region: (b.partyMeta.region as string | null) ?? null,
            effectiveReimbursementCapUsd: computeEffectiveCapUsd({
              reimbursementCapUsd: b.partyMeta.reimbursementCapUsd,
              eventTags: b.partyMeta.eventTags,
            }),
            eventTags: Array.isArray(b.partyMeta.eventTags) ? b.partyMeta.eventTags : [],
            primaryHostInCohosts: isPrimaryHostInCohosts(b.partyMeta),
            userId: b.partyMeta.userId ?? null,
            // pinsa-92103: surface the close timestamp on the outer party so
            // the by-city table can hide the Mark paid button + render the
            // green ✓ Closed pill without expanding the row first.
            paymentsClosedAt: b.partyMeta.paymentsClosedAt
              ? b.partyMeta.paymentsClosedAt.toISOString()
              : null,
            // culatello-92106: per-event tax-form gate. Surfaced on the
            // outer city row so PayoutsByPartyTable can render the pill
            // before the admin expands the row.
            taxFormRequired: b.partyMeta.taxFormRequired === true,
            // mortadella-92106: admin-only city notes. Stripped to null for
            // underboss viewers so they never see the text — both the input
            // and the gating on the frontend are belt-and-braces but this
            // is the canonical server-side gate.
            adminNotes:
              req.viewerRole === 'admin'
                ? (b.partyMeta.adminNotes ?? null)
                : null,
            // When the TG receipts reminder was last sent.
            receiptsReminderSentAt: b.partyMeta.receiptsReminderSentAt
              ? b.partyMeta.receiptsReminderSentAt.toISOString()
              : null,
            // City-level payment approval.
            paymentsApprovedUsd: b.partyMeta.paymentsApprovedUsd
              ? Number(b.partyMeta.paymentsApprovedUsd)
              : null,
            paymentsApprovedAt: b.partyMeta.paymentsApprovedAt
              ? b.partyMeta.paymentsApprovedAt.toISOString()
              : null,
          },
          aggregates: {
            pendingCount: b.pendingCount,
            pendingUsd: b.pendingUsd,
            approvedCount: b.approvedCount,
            approvedUsd: b.approvedUsd,
            paidCount: b.paidCount,
            paidUsd: b.paidUsd,
            // prosciutto-92106: zombie paid totals — status='paid' but no
            // proof field set. Frontend renders a "no proof" chip on these
            // rows + omits them from the Paid headline tile.
            paidNoProofCount: b.paidNoProofCount,
            paidNoProofUsd: b.paidNoProofUsd,
            rejectedCount: b.rejectedCount,
            rejectedUsd: b.rejectedUsd,
            failedCount: b.failedCount,
            failedUsd: b.failedUsd,
            withdrawnCount: b.withdrawnCount,
            withdrawnUsd: b.withdrawnUsd,
            completedCount: b.completedCount,
            completedUsd: b.completedUsd,
            // bresaola-49340: proofless completed subset. Paid headline =
            // completedUsd - completedNoProofUsd. Additive fields; existing
            // consumers of completedUsd/completedCount keep their meaning.
            completedNoProofCount: b.completedNoProofCount,
            completedNoProofUsd: b.completedNoProofUsd,
            totalReceiptCount: receiptCounts.get(partyId) ?? 0,
            lastActivityAt: b.lastActivityAt.toISOString(),
            flaggedReadyCount: b.flaggedReadyCount,
          },
          payouts: serializedPayouts,
          // ricotta-92104: party-level event photos for the city expansion's
          // Event/Pizza preview sections. Same shape as the per-payout
          // serializer's `eventPhotos` so the frontend can reuse the
          // focaccia-92104 split rule (tags `Pizza`/`pizza-selfie` → Pizza
          // photos, everything else → Event photos).
          eventPhotos: eventPhotosByParty.get(partyId) ?? [],
        };
      });

      // pinsa-92103: optional `?hideClosed=true` filters out rows the admin
      // has explicitly closed out (Ekiti, Tangier). Doing this server-side
      // (vs. in the table component) keeps row counts honest and is cheap —
      // grouping has already happened and the bucket meta has the flag.
      const hideClosed = req.query.hideClosed === 'true' || req.query.hideClosed === '1';
      // stracchino-92108: also hide cities flagged with the `possible-scam` tag.
      const hideScams = req.query.hideScams === 'true' || req.query.hideScams === '1';
      const filteredRows = rows.filter((r) =>
        (!hideClosed || !r.party.paymentsClosedAt) &&
        (!hideScams || !(r.party.eventTags ?? []).includes('possible-scam'))
      );

      // 6. Sort outer rows. Default: most recent activity desc. The same
      //    `sort` query param shape is supported as the LIST endpoint for
      //    forward-compat, but only a handful of keys make sense at the
      //    party-row level — fall back to activity-desc for unknown values.
      //    lievito-92103: `activity_desc` and `activity_asc` are explicit
      //    options on the admin Sort dropdown (the latter useful for
      //    surfacing stale cities first).
      const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'activity_desc';
      filteredRows.sort((a, b) => {
        switch (sortRaw) {
          case 'amount_desc':
            return (b.aggregates.pendingUsd + b.aggregates.approvedUsd + b.aggregates.paidUsd)
                 - (a.aggregates.pendingUsd + a.aggregates.approvedUsd + a.aggregates.paidUsd);
          case 'amount_asc':
            return (a.aggregates.pendingUsd + a.aggregates.approvedUsd + a.aggregates.paidUsd)
                 - (b.aggregates.pendingUsd + b.aggregates.approvedUsd + b.aggregates.paidUsd);
          case 'name_asc':
            return a.party.name.localeCompare(b.party.name);
          case 'name_desc':
            return b.party.name.localeCompare(a.party.name);
          case 'activity_asc':
            return new Date(a.aggregates.lastActivityAt).getTime()
                 - new Date(b.aggregates.lastActivityAt).getTime();
          case 'activity_desc':
          default:
            return new Date(b.aggregates.lastActivityAt).getTime()
                 - new Date(a.aggregates.lastActivityAt).getTime();
        }
      });

      res.json({ rows: filteredRows, total: filteredRows.length });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// bufalina-60733: POST /api/admin/payouts/fake-detection-scores
//
// Surfaces each GPP party's existing fake-detection risk score (the same
// scorer that backs /underboss's review queue) as a compact map for the
// payments-admin by-city table badges + the send-payment confirmation gate.
//
// Body: { partyIds: string[] }  (string array, capped at 500).
// Response: { scores: Record<partyId, { score, tier, topFlags }> }
//   - `topFlags` = up to 3 fired-flag `detail` strings, highest weight first.
//   - tier `clean` entries (score < 10) are OMITTED to keep the payload small;
//     the frontend badge self-hides for anything below `medium` anyway.
//
// Auth: `requireAdminOrRegionalUnderboss()` — the SAME guard the by-party feed
// uses — NOT the underboss `__admin__`-only gate, so regional underbosses who
// drive the regional payment portals don't 403. This is a pure-read endpoint.
//
// Literal `/fake-detection-scores` MUST be declared before `/:id`.
// ============================================
router.post(
  '/fake-detection-scores',
  requireAuth,
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { partyIds?: unknown };
      const partyIds = body?.partyIds;
      if (
        !Array.isArray(partyIds) ||
        !partyIds.every(id => typeof id === 'string')
      ) {
        throw new AppError(
          'partyIds must be an array of strings',
          400,
          'INVALID_PARTY_IDS',
        );
      }
      if (partyIds.length > 500) {
        throw new AppError(
          'partyIds may contain at most 500 ids',
          400,
          'TOO_MANY_PARTY_IDS',
        );
      }

      const scores: Record<
        string,
        { score: number; tier: string; topFlags: string[] }
      > = {};

      if (partyIds.length > 0) {
        const rows = await scorePartiesByIds(partyIds);
        for (const r of rows) {
          // Omit clean events to keep the payload small.
          if (r.tier === 'clean') continue;
          const topFlags = r.flags
            .filter(f => f.fired)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 3)
            .map(f => f.detail);
          scores[r.id] = { score: r.score, tier: r.tier, topFlags };
        }
      }

      res.json({ scores });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// bianco-89172: GET /api/admin/payouts/wallet-paid-total
//
// Returns cumulative paid USDC for a single recipient wallet, optionally with
// a `wouldExceed` flag for a proposed additional amount. Backs the warning
// panels in PayoutReviewModal + BulkSendModal so admins can see "wallet X has
// already received $Y; sending $Z more would push past the $676 per-address
// cap" before they fire off a duplicate payment.
//
// Query params:
//   address (required): 0x...40 hex chars (case-insensitive)
//   amount  (optional): proposed additional USD. When set, response includes
//                       wouldExceed = (paidUsd + amount > capUsd). When
//                       omitted, wouldExceed = null.
//
// Admin-only (isPaymentAdmin via requireAnyAdminOrPaymentAdmin).
//
// coppa-49341: literal `/wallet-paid-total` MUST be declared before `/:id` so
// the literal path wins on route matching (same hazard as `/by-party` above).
// ============================================
router.get(
  '/wallet-paid-total',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const addressRaw = typeof req.query.address === 'string' ? req.query.address.trim() : '';
      if (!addressRaw || !/^0x[0-9a-fA-F]{40}$/.test(addressRaw)) {
        throw new AppError(
          'address query param must be a valid 0x-prefixed 40-char hex wallet',
          400,
          'VALIDATION_ERROR',
        );
      }

      let amount: number | null = null;
      if (req.query.amount != null && req.query.amount !== '') {
        const parsed = Number(req.query.amount);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new AppError(
            'amount query param must be a non-negative number',
            400,
            'VALIDATION_ERROR',
          );
        }
        amount = parsed;
      }

      const { paidUsd, paidCount } = await getPerAddressPaidTotals(addressRaw);
      const wouldExceed = amount == null ? null : paidUsd + amount > PER_ADDRESS_HARD_CAP_USD;

      res.json({
        address: addressRaw,
        paidUsd,
        paidCount,
        capUsd: PER_ADDRESS_HARD_CAP_USD,
        wouldExceed,
      });
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
  // argentina-92103: regional underbosses can READ the LATAM queue via
  // `?regions=central-america,south-america`. Without the param this still
  // requires admin-class. Filtering by `?regions=` is enforced inside
  // `buildPayoutWhere`.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const where = await buildPayoutWhere(req.query);

      const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1),
        100,
      );

      const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length > 0
        ? req.query.cursor
        : undefined;

      // arancino-92103: optional `?sort=` for the admin payouts queue. Default
      // (`created_desc`) preserves the prior implicit ordering — non-sorting
      // callers see no behavior change. Cursor pagination is keyed on
      // `createdAt`, so when the caller picks a non-default sort we fall back
      // to offset-based pagination (parses `cursor` as the offset count)
      // instead of encoding cursors per orderBy.
      // lievito-92103: `activity_desc` / `activity_asc` map to `updatedAt`
      // here so the per-payout view orders by most/least recently touched.
      // They use the same offset-pagination fallback as the amount sorts.
      const sortMap: Record<string, Prisma.PayoutOrderByWithRelationInput> = {
        created_desc: { createdAt: 'desc' },
        created_asc: { createdAt: 'asc' },
        amount_desc: { finalAmountUsd: 'desc' },
        amount_asc: { finalAmountUsd: 'asc' },
        activity_desc: { updatedAt: 'desc' },
        activity_asc: { updatedAt: 'asc' },
        // coppa-92106: order by actual paid_at timestamp for the new
        // Payments-ledger view. Rows with null paid_at (rare in proven set)
        // sort to the end via Prisma's default NULLS LAST.
        paid_at_desc: { paidAt: { sort: 'desc', nulls: 'last' } },
        paid_at_asc: { paidAt: { sort: 'asc', nulls: 'last' } },
      };
      const sortKey = typeof req.query.sort === 'string' && sortMap[req.query.sort]
        ? (req.query.sort as keyof typeof sortMap)
        : 'created_desc';
      const orderBy = sortMap[sortKey];
      const useOffsetPagination = sortKey !== 'created_desc';

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
        orderBy,
        take: limit + 1,
      };
      if (cursor) {
        if (useOffsetPagination) {
          const parsedOffset = parseInt(cursor, 10);
          if (Number.isFinite(parsedOffset) && parsedOffset > 0) {
            findArgs.skip = parsedOffset;
          }
        } else {
          findArgs.cursor = { id: cursor };
          findArgs.skip = 1;
        }
      }

      const rows = await prisma.payout.findMany(findArgs);

      let nextCursor: string | null = null;
      const page = rows.slice(0, limit);
      if (rows.length > limit) {
        if (useOffsetPagination) {
          // arancino-92103: encode cursor as the next offset so subsequent
          // "load more" calls keep the same sort.
          const currentOffset = typeof findArgs.skip === 'number' ? findArgs.skip : 0;
          nextCursor = String(currentOffset + limit);
        } else {
          nextCursor = page[page.length - 1]?.id ?? null;
        }
      }

      // Totals — computed over the filtered set (NOT just the current page),
      // so the dashboard pills reflect the user's current filters.
      // parmigiana-58291: also pull party { id, name, country } so we can build
      // the per-party totals rollup without a second query. Reuses the same
      // `where` clause, so the existing tartufo/bruschetta filters (status,
      // method, country, dateRange) and the approval gate all still apply.
      const allFiltered = await prisma.payout.findMany({
        where,
        select: {
          status: true,
          payoutMethod: true,
          finalAmountUsd: true,
          createdAt: true,
          paidAt: true,
          // prosciutto-92106: proof fields surface so paidRowHasProof() can
          // exclude zombie status='paid' rows (no proof set) from KPI totals,
          // per-party rollups, and the AVG PAYMENT committed-by-party sum.
          transactionHash: true,
          wireReference: true,
          mercuryCardLast4: true,
          mercuryCardId: true,
          externalProofUrl: true,
          party: {
            select: {
              id: true,
              name: true,
              country: true,
              // ciabatta-92110: needed to compute closedCitiesCount KPI.
              paymentsClosedAt: true,
            },
          },
        },
      });

      const byStatus: Record<string, number> = {};
      const byMethod: Record<string, number> = {};
      let totalUsdPending = 0;
      let totalUsdPaid = 0;
      let totalUsdThisMonth = 0;
      let awaitingReview = 0;

      // parmigiana-58291: per-party rollup over `status === 'paid'` rows.
      // Keyed by party.id; we accumulate sum + count and resolve to a sorted
      // array (descending by totalPaidUsd) for the response.
      const partyTotals = new Map<
        string,
        { partyId: string; partyName: string; country: string | null; totalPaidUsd: number; payoutCount: number }
      >();

      // cotechino-92103: per-party status-breakdown for the PAID CITIES
      // KPI. A party is "paid/complete" when it has at least one payout
      // in `paid` OR `completed` AND zero payouts in `pending` OR
      // `approved`. `rejected`/`failed`/`withdrawn` rows don't count
      // either way (dead claims). Same filter-window scope as the rest
      // of `totals` since this derives from `allFiltered`.
      const byPartyStatusCounts = new Map<
        string,
        { paidOrCompletedCount: number; pendingOrApprovedCount: number }
      >();

      // ciabatta-92110: distinct closed-out cities within the current filter window.
      const closedPartyIds = new Set<string>();

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      for (const r of allFiltered) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        // arugula-38633 v3 follow-up: bucket null methods under 'unset' so the
        // dashboard pills don't drop them from the count.
        const methodKey = r.payoutMethod ?? 'unset';
        byMethod[methodKey] = (byMethod[methodKey] || 0) + 1;
        const usd = Number(r.finalAmountUsd);
        if (r.status === 'pending') {
          totalUsdPending += usd;
          awaitingReview += 1;
        } else if (r.status === 'paid') {
          // prosciutto-92106: only proven-paid rows (have transaction_hash /
          // wire_reference / mercury_card_last4 / external_proof_url) count
          // toward the Paid KPI tile + per-party totals. Zombie status='paid'
          // rows (no proof field set) are excluded so the totals reflect
          // actual sends, not bookkeeping ghosts. Alvaro city had 4 such
          // zombie rows inflating its Paid tile from $655 → $2,621.
          const hasProof = paidRowHasProof(r as any);
          if (hasProof) {
            totalUsdPaid += usd;
            if (r.paidAt && r.paidAt >= startOfMonth) {
              totalUsdThisMonth += usd;
            }
            // parmigiana-58291: accumulate per-party totals. Only `paid` rows
            // count — pending/approved/rejected don't represent USD that left
            // the wallet. Guard against the (theoretically impossible) missing
            // party relation so a single bad row can't 500 the dashboard.
            if (r.party) {
              const existing = partyTotals.get(r.party.id);
              if (existing) {
                existing.totalPaidUsd += usd;
                existing.payoutCount += 1;
              } else {
                partyTotals.set(r.party.id, {
                  partyId: r.party.id,
                  partyName: r.party.name,
                  country: r.party.country,
                  totalPaidUsd: usd,
                  payoutCount: 1,
                });
              }
            }
          }
        }

        // cotechino-92103: tally paid/completed vs pending/approved
        // counts per party for the PAID CITIES KPI below.
        if (r.party) {
          const existing = byPartyStatusCounts.get(r.party.id) ?? {
            paidOrCompletedCount: 0,
            pendingOrApprovedCount: 0,
          };
          if (r.status === 'paid' || r.status === 'completed') {
            existing.paidOrCompletedCount += 1;
          } else if (r.status === 'pending' || r.status === 'approved') {
            existing.pendingOrApprovedCount += 1;
          }
          byPartyStatusCounts.set(r.party.id, existing);
        }

        // ciabatta-92110: collect distinct closed-out cities for the KPI.
        if (r.party?.paymentsClosedAt) closedPartyIds.add(r.party.id);
      }

      // cotechino-92103: count cities whose payouts are all "settled" —
      // at least one paid/completed row AND no in-flight pending/approved.
      let paidCitiesCount = 0;
      for (const counts of byPartyStatusCounts.values()) {
        if (counts.paidOrCompletedCount > 0 && counts.pendingOrApprovedCount === 0) {
          paidCitiesCount++;
        }
      }

      // ciabatta-92110: count of cities the admin has explicitly closed out
      // (payments_closed_at set) within the current filter window.
      const closedCitiesCount = closedPartyIds.size;

      // caciotta-92108: AVG PAYMENT = average proof-backed paid total per
      // closed-out city (payments_closed_at set). Numerator sums each closed
      // city's parmigiana-58291 `totalPaidUsd` (proof-backed `paid` rows only);
      // denominator is the count of closed cities, so a closed city with no
      // paid rows still counts as $0. Keeps Avg payment × Closed cities ≈
      // total paid to closed cities. Same filter-window scope (derives from
      // `allFiltered`).
      let avgUsd = 0;
      if (closedPartyIds.size > 0) {
        let closedPaidSum = 0;
        for (const pid of closedPartyIds) {
          closedPaidSum += partyTotals.get(pid)?.totalPaidUsd ?? 0;
        }
        avgUsd = closedPaidSum / closedPartyIds.size;
      }

      // taleggio-49183: the parmigiana-58291 top-level `byParty` aggregate
      // was removed — the per-row "Already paid: $X (N)" rendering on each
      // PayoutRow (populated below from `pagePaidTotals`) already shows the
      // same information under each event name, so the top-level list was
      // duplicative. The `partyTotals` Map above is left intact in case
      // future serialization consumers depend on it.

      // parmigiana-89172: attach a per-party "already paid" rollup to each
      // row's nested `party` object so the PayoutsTable can render an
      // inline "Already paid: $X (N)" warning under the event name. Per
      // PARTY, not per payout — collect the unique partyIds in the page
      // and run one aggregate query.
      const pagePartyIds = Array.from(
        new Set(
          page
            .map(p => (p as any).party?.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );
      const pagePaidTotals = await fetchPaidTotalsByParty(pagePartyIds);
      // argentina-92103: per-row "flagged ready for payment" augmentation.
      // The list query doesn't include `audits` to keep responses small, so
      // `serializePayout` can't derive the flag inline — instead we run one
      // batched audit query covering every payout in the page.
      const pageFlagged = await fetchFlaggedReadyByPayoutId(page.map(p => p.id));
      const serializedPayouts = page.map(p => {
        const serialized = serializePayout(p);
        if (serialized.party?.id) {
          const totals = pagePaidTotals.get(serialized.party.id);
          serialized.party.paidTotalUsd = totals?.paidUsd ?? 0;
          serialized.party.paidTotalCount = totals?.paidCount ?? 0;
        }
        const flag = pageFlagged.get(serialized.id);
        if (flag) {
          serialized.flaggedReady = true;
          serialized.flaggedReadyAt = flag.at;
          serialized.flaggedReadyBy = flag.by;
        }
        return serialized;
      });

      res.json({
        payouts: serializedPayouts,
        nextCursor,
        totals: {
          byStatus,
          byMethod,
          totalUsdPending,
          totalUsdPaid,
          totalUsdThisMonth,
          avgUsd,
          awaitingReview,
          paidCitiesCount,
          closedCitiesCount,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// GET /api/admin/payouts/usdc-daily-cap-remaining
//   - Used by the UI to show "Daily cap remaining: $Y" before USDC execute.
//   - MUST be declared BEFORE the parametric GET /:id route. Express matches
//     routes in declaration order, so if this literal GET sits after GET /:id
//     then "usdc-daily-cap-remaining" is captured as an :id param and the
//     detail handler 500s. Keep it up here alongside the other literal GETs.
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

// ============================================
// GET /api/admin/payouts/pizza-prices
//
// formaggi-89172: returns per-row pizza items extracted from payout-document
// OCR (`payout_documents.ocr_line_items`) plus a simple by-country aggregate,
// converted to USD via each payout's recorded `exchangeRate`. Backs future
// analytics; no frontend UI in this PR — admins can `curl` it for spot data.
//
// Optional query params:
//   - country?: string  — filter to a single Party.country (case-sensitive,
//     matches how the column is stored).
//   - currency?: string — filter to a single Payout.originalCurrency
//     (post-fetch, since the FX field lives on the payout, not the doc).
//   - since?: ISO date  — only payouts created on/after this timestamp.
// ============================================
router.get(
  '/pizza-prices',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const country = typeof req.query.country === 'string' && req.query.country.trim()
        ? req.query.country.trim()
        : null;
      const currency = typeof req.query.currency === 'string' && req.query.currency.trim()
        ? req.query.currency.trim().toUpperCase()
        : null;
      const sinceRaw = typeof req.query.since === 'string' && req.query.since.trim()
        ? req.query.since.trim()
        : null;

      let since: Date | null = null;
      if (sinceRaw) {
        const parsed = new Date(sinceRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new AppError(`Invalid \`since\` parameter: ${sinceRaw}`, 400, 'BAD_SINCE');
        }
        since = parsed;
      }

      // Build the payout filter — country lives on `payout.party.country`,
      // since on `payout.createdAt`. We can't filter `originalCurrency` at the
      // payout-document level (it's on the parent Payout), so we do that
      // post-fetch in-app.
      const payoutFilter: Prisma.PayoutWhereInput = {};
      if (country) payoutFilter.party = { country };
      if (since) payoutFilter.createdAt = { gte: since };

      const rows = await prisma.payoutDocument.findMany({
        where: {
          // Only receipts with a non-null line-items JSONB. `Prisma.DbNull` is
          // the SQL-NULL marker for JSON columns; without this filter we'd
          // pull every payout document ever inserted.
          ocrLineItems: { not: Prisma.DbNull },
          // Receipts without a parent payout (orphaned via Payout delete +
          // SetNull) can't be priced — skip them.
          payout: { is: payoutFilter },
          // culatello-92104: admin-marked duplicates aren't real prices —
          // exclude them from the analytics aggregate so the by-country
          // averages don't double-count the same purchase.
          isDuplicate: false,
          // provola-92106: admin-marked ineligible receipts (alcohol, tips,
          // personal items) aren't pizza prices either — same exclusion
          // pattern. The aggregate should reflect what hosts actually paid
          // for reimbursable items.
          ineligible: false,
        },
        select: {
          id: true,
          ocrLineItems: true,
          ocrCurrency: true,
          payout: {
            select: {
              originalCurrency: true,
              exchangeRate: true,
              createdAt: true,
              party: { select: { id: true, name: true, country: true, city: true } },
            },
          },
        },
      });

      type PizzaPriceRow = {
        documentId: string;
        partyId: string;
        partyName: string;
        country: string | null;
        city: string | null;
        itemName: string;
        qty: number;
        unitPriceOriginal: number;
        subtotalOriginal: number;
        currency: string;
        // formaggi-89172: exchangeRate on `payouts` is stored as
        // (USD amount) / (original amount). So multiplying an original-currency
        // unit price by exchangeRate yields USD.
        unitPriceUsd: number;
        subtotalUsd: number;
        payoutCreatedAt: string;
      };

      const pizzaPrices: PizzaPriceRow[] = [];
      for (const r of rows) {
        // `payout` is `is: payoutFilter`-narrowed but still typed nullable —
        // guard so TS knows we have a payout below.
        if (!r.payout) continue;

        const items = Array.isArray(r.ocrLineItems) ? (r.ocrLineItems as any[]) : [];
        if (items.length === 0) continue;

        const payoutCurrency = r.payout.originalCurrency ?? r.ocrCurrency ?? 'USD';
        if (currency && payoutCurrency.toUpperCase() !== currency) continue;

        const fx = Number(r.payout.exchangeRate?.toString() ?? '1');
        const safeFx = Number.isFinite(fx) && fx > 0 ? fx : 1;

        for (const it of items) {
          if (!it || typeof it !== 'object') continue;
          if (it.category !== 'pizza') continue;

          const qty = Number.isFinite(Number(it.qty)) && Number(it.qty) >= 0 ? Number(it.qty) : 1;
          const unitOrig = Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) >= 0
            ? Number(it.unitPrice)
            : 0;
          const subOrig = Number.isFinite(Number(it.subtotal)) && Number(it.subtotal) >= 0
            ? Number(it.subtotal)
            : qty * unitOrig;

          pizzaPrices.push({
            documentId: r.id,
            partyId: r.payout.party.id,
            partyName: r.payout.party.name,
            country: r.payout.party.country,
            city: r.payout.party.city,
            itemName: typeof it.name === 'string' ? it.name : '',
            qty,
            unitPriceOriginal: unitOrig,
            subtotalOriginal: subOrig,
            currency: payoutCurrency,
            unitPriceUsd: unitOrig * safeFx,
            subtotalUsd: subOrig * safeFx,
            payoutCreatedAt: r.payout.createdAt.toISOString(),
          });
        }
      }

      // Group by country, compute count + USD min/avg/max on unit price.
      // Zero-priced rows ([illegible] lines etc.) are excluded from the
      // aggregate so they don't drag the average down; the raw row is still
      // returned in `pizzaPrices` for completeness.
      type CountryAgg = {
        country: string;
        count: number;
        avgUnitPriceUsd: number;
        minUnitPriceUsd: number;
        maxUnitPriceUsd: number;
      };
      const byCountryMap = new Map<string, { sum: number; n: number; min: number; max: number }>();
      for (const p of pizzaPrices) {
        if (!p.country) continue;
        if (p.unitPriceUsd <= 0) continue;
        const key = p.country;
        const cur = byCountryMap.get(key);
        if (cur) {
          cur.sum += p.unitPriceUsd;
          cur.n += 1;
          if (p.unitPriceUsd < cur.min) cur.min = p.unitPriceUsd;
          if (p.unitPriceUsd > cur.max) cur.max = p.unitPriceUsd;
        } else {
          byCountryMap.set(key, {
            sum: p.unitPriceUsd,
            n: 1,
            min: p.unitPriceUsd,
            max: p.unitPriceUsd,
          });
        }
      }
      const byCountry: CountryAgg[] = Array.from(byCountryMap.entries())
        .map(([country, agg]) => ({
          country,
          count: agg.n,
          avgUnitPriceUsd: agg.sum / agg.n,
          minUnitPriceUsd: agg.min,
          maxUnitPriceUsd: agg.max,
        }))
        .sort((a, b) => b.count - a.count);

      res.json({
        filters: { country, currency, since: since?.toISOString() ?? null },
        totalRows: pizzaPrices.length,
        pizzaPrices,
        byCountry,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================
// GET /api/admin/payouts/:id — full detail incl. audit history
// ============================================
router.get(
  '/:id',
  requireAuth,
  // argentina-92103: regional underbosses can READ payout detail scoped to
  // their region via `?regions=`. The per-row "is this party in scope?"
  // check is enforced below for underbosses so they can't peek out-of-scope
  // rows by spoofing the query.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const row = await prisma.payout.findUnique({
        where: { id: req.params.id },
        include: {
          party: { select: { ...PAYOUT_PARTY_SELECT, region: true } },
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

      // argentina-92103: underbosses get blocked when the target party's
      // region isn't in the requested scope. Admins skip this check.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        if (!(row as any).party?.region || !regionsFromQuery.includes((row as any).party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

      const serialized = serializePayout(row);
      // tiramisu-49102: attach per-party "already paid" totals to the detail
      // response too so the Pay-again button on PayoutReviewModal can populate
      // the synthetic PrepayQueueRow with `partyPaidUsd` for the CreatePrepayment
      // modal's remaining-cap clamp. Cheap one-row aggregate.
      if (serialized.party?.id) {
        const totals = await fetchPaidTotalsByParty([serialized.party.id]);
        const t = totals.get(serialized.party.id);
        serialized.party.paidTotalUsd = t?.paidUsd ?? 0;
        serialized.party.paidTotalCount = t?.paidCount ?? 0;
      }

      // bottarga-92103: surface the party's event-level photos (uploaded via
      // the host Photos tab — separate from the pizza-kind documents attached
      // inside the payments flow) so admins reviewing a payout see the full
      // visual context of the party without bouncing to /host/:slug. Admins
      // see every photo regardless of moderation status; the frontend surfaces
      // a "Hidden from public" pill when `status !== 'approved'`.
      // focaccia-92104: surface `tags` so the frontend can split this list
      // into "Pizza photos" (tagged Pizza / pizza-selfie) vs "Event photos"
      // (everything else) in PayoutReviewModal's photo grids.
      const eventPhotos = await prisma.photo.findMany({
        where: { partyId: row.partyId, deletedAt: null }, // provolone-58931
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
          fileName: true,
          mimeType: true,
          caption: true,
          status: true,
          starred: true,
          tags: true,
          uploaderName: true,
          createdAt: true,
        },
      });
      (serialized as any).eventPhotos = eventPhotos.map((p) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        fileName: p.fileName,
        mimeType: p.mimeType,
        caption: p.caption,
        status: p.status,
        starred: p.starred,
        tags: p.tags,
        uploaderName: p.uploaderName,
        createdAt: p.createdAt.toISOString(),
      }));

      res.json({ payout: serialized });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// PATCH /api/admin/payouts/:id — edit amount / notes / method / target
//
// panettone-92103: admin PATCH NEVER auto-recomputes `finalAmountUsd` from the
// child receipts' OCR sum. The admin's `finalAmountUsd` (if provided in the
// body) is canonical; if it isn't provided, the existing `final_amount_usd`
// is preserved as-is. OCR is informational once admin has set an amount.
//
// Why: when a receipt OCR'd at e.g. $1500 (mis-read) and admin then set
// `finalAmountUsd = 200`, subsequent admin edits to OTHER fields (notes,
// wallet, method) used to re-trigger an OCR recompute path that summed the
// wrong OCR amounts back to $1500 and threw PER_SUBMISSION_CAP_EXCEEDED —
// admin couldn't save notes. Host-side PATCH (`payout.routes.ts`) keeps the
// OCR recompute since it's part of the host's in-progress upload UX
// (provolone-39042: only on `pending` status anyway).
// ============================================
router.patch(
  '/:id',
  requireAuth,
  // cannelloni-92103: regional underbosses can EDIT payouts on parties in
  // their region (via `?regions=`). Admins always pass. The per-row scope
  // check is inlined below for underbosses, matching the pattern used by
  // approve/reject/unapprove/flag-ready (argentina-92103).
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
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

      // cannelloni-92103: underboss-scope gate. Prevents a regional underboss
      // from editing an out-of-region payout by spoofing the `?regions=`
      // query. Admins skip this check.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        const party = await prisma.party.findUnique({
          where: { id: existing.partyId },
          select: { region: true },
        });
        if (!party?.region || !regionsFromQuery.includes(party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

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
          // lasagna-92103: admin amount is canonical. The admin PATCH edit
          // path is intentionally uncapped — no per-submission cap throw, no
          // per-party cap throw. Incident that motivated this: a Medellín
          // payout was OCR'd at $465,101.77 (COP→USD conversion error) and
          // the admin couldn't edit it down because aglio-62584's checkbox
          // override only covered the user-typed amount, not the in-flight
          // value the modal recomputed against the bad OCR sum. Admins can
          // always proceed; the soft $675 default is now informational in
          // the modal. The USDC execute hard ceiling
          // (HARD_PER_TX_CEILING_USD in usdc-base.service.ts) remains as a
          // separate safety net at on-chain send time — admins can split
          // executes or record as external payment to handle larger sums.
          // The per-party cap (tiramisu-49102) and per-address cap
          // (bianco-89172) likewise stay on the approve/mark-paid/execute
          // paths below; only the edit path is uncapped.
          // `body.allowOverSubmissionCap` is no longer read here; existing
          // frontends that still send it are ignored (no-op).
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
        // caciotta-92104: also persist the original input alongside the
        // resolved 0x so admin UI can render "name.eth -> 0xa1b2..." instead
        // of silently losing the ENS string at write time. Resolution failures
        // surface as 400 ENS_RESOLUTION_FAILED so the admin sees the problem
        // BEFORE clicking Execute (not as a silent fail at send time).
        if (payoutWalletAddress === null) {
          data.payoutWalletAddress = null;
          data.payoutWalletInput = null;
        } else {
          try {
            const resolved = await resolveWalletInputWithMeta(String(payoutWalletAddress));
            data.payoutWalletAddress = resolved.address;
            // Only persist the input when it differs from the canonical 0x
            // (i.e. when ENS was used). Storing the 0x in both columns is
            // redundant and clutters the display logic.
            data.payoutWalletInput = resolved.wasEns ? resolved.input : null;
          } catch (err: any) {
            throw new AppError(
              err?.message || 'Could not resolve wallet address',
              400,
              'ENS_RESOLUTION_FAILED'
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
  // argentina-92103: regional underbosses can APPROVE payouts on parties in
  // their region (via `?regions=`). Admins always pass. The per-row scope
  // check is inlined below for underbosses.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          status: true,
          hostUserId: true,
          partyId: true,
          finalAmountUsd: true,
        },
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

      // argentina-92103: underboss-scope gate. Prevents a regional underboss
      // from approving an out-of-region payout by spoofing the `?regions=`
      // query. Admins skip this check.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        const party = await prisma.party.findUnique({
          where: { id: existing.partyId },
          select: { region: true },
        });
        if (!party?.region || !regionsFromQuery.includes(party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

      // nduja-92106: admin-class can opt to bypass the per-party cap at
      // approve time via `allowOverPartyCap` (mirrors salame-92103's existing
      // override on /execute). Underbosses can NEVER skip the cap — only the
      // four admin-class roles (admin / super_admin / payment_admin) get the
      // ack pathway. The per-submission ceiling ($675), per-address cap, and
      // daily cap are unchanged.
      const allowOverPartyCap =
        actor.actorKind !== 'underboss' &&
        !!(req.body && req.body.allowOverPartyCap);

      // guanciale-49340: admin-class can also opt to bypass the per-address
      // ($676) hard cap in the inline autoExecute usdc_base branch via
      // `allowOverPerAddressCap`. The by-city SendPaymentModal sets this when
      // the amber per-address cap warning's ack has been ticked. The flag is
      // forwarded to executePayout (which already accepts/forwards it to
      // sendUsdcPayment); it is a no-op for wire/mercury (which execute via the
      // separate /execute call that carries its own ack).
      const allowOverPerAddressCap = !!(req.body && req.body.allowOverPerAddressCap);

      // bocconcini-49102: re-run the per-submission + per-party cap checks at
      // approve time so rows created/edited BEFORE the cap rules landed (or
      // rows whose party's cap was tightened after creation) can't be pushed
      // through to `approved` (and from there to `paid`). Helpers are
      // idempotent — better to over-check than to under-check.
      //
      // nduja-92106: skip the per-party throw when the admin has ticked the
      // override checkbox in PayoutReviewModal. Per-submission ceiling stays.
      assertWithinPerSubmissionCap(Number(existing.finalAmountUsd));
      if (!allowOverPartyCap) {
        await assertWithinPartyCap(
          existing.partyId,
          Number(existing.finalAmountUsd),
          existing.id,
        );
      }

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

        // nduja-92106: append `[override: party cap]` so the audit row
        // captures that the per-party cap was bypassed at approve time. Mirrors
        // salame-92103's mark_paid suffix on /execute.
        const baseNote = typeof note === 'string' && note ? note : null;
        const auditNote = allowOverPartyCap
          ? (baseNote ? `${baseNote} [override: party cap]` : '[override: party cap]')
          : baseNote;
        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'approve',
            oldStatus: 'pending',
            newStatus: 'approved',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note: auditNote,
          },
        });

        return row;
      });

      // argentina-92103: fire-and-forget Telegram + email to the payments
      // team when a regional underboss approves. Admins skip — they're
      // already on /payments. Silent no-op when env vars are unset.
      if (req.viewerRole === 'underboss') {
        void notifyPaymentsTeam({ kind: 'approved', payoutId: existing.id });
      }

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
              // nduja-92106: when the admin ticked the per-party cap override
              // ack on approve, the same flag has to flow into the inline
              // execute or the cap recheck inside executePayout will throw
              // (salame-92103 already wired the override on /execute; we just
              // forward it here).
              allowOverPartyCap,
              // guanciale-49340: forward the per-address cap override so the
              // inline USDC send can bypass the $676 hard cap when the admin
              // acked the by-city Send modal's per-address warning.
              allowOverPerAddressCap,
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
// POST /api/admin/payouts/:id/unapprove
//
// caprino-92103: revert an `approved` payout back to `pending` so the admin
// can re-review (or ask the host for more info before sending). Approval
// was previously a one-way door — the only "undo" was reject, which is a
// different terminal state.
//
// Atomic via prisma.$transaction:
//   1. Lookup payout (404 if missing).
//   2. Validate status === 'approved' (400 NOT_APPROVED otherwise).
//   3. status -> 'pending'; clear reviewedAt + reviewedBy.
//   4. Write payout_audit row with action='unapprove'.
//
// Preserves external_proof_url / transactionHash / paidAt from any prior
// execute attempt — those are history.
// ============================================
router.post(
  '/:id/unapprove',
  requireAuth,
  // argentina-92103: regional underbosses can REVERT approved payouts on
  // parties in their region (via `?regions=`). Per-row scope check below.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true, partyId: true },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status !== 'approved') {
        throw new AppError(
          `Cannot unapprove a payout in status '${existing.status}'`,
          400,
          'NOT_APPROVED',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      // argentina-92103: underboss-scope gate.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        const party = await prisma.party.findUnique({
          where: { id: existing.partyId },
          select: { region: true },
        });
        if (!party?.region || !regionsFromQuery.includes(party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

      const { note } = req.body || {};

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'pending',
            reviewedAt: null,
            reviewedBy: null,
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
            action: 'unapprove',
            oldStatus: 'approved',
            newStatus: 'pending',
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
// POST /api/admin/payouts/:id/unreject
//
// brie-92108: revert a `rejected` payout back to `pending` so the admin can
// re-review. Mirrors `unapprove` (approved -> pending) one step over for the
// rejected terminal state — rejection was previously a one-way door.
//
// Atomic via prisma.$transaction:
//   1. Lookup payout (404 if missing).
//   2. Validate status === 'rejected' (400 NOT_REJECTED otherwise).
//   3. status -> 'pending'; clear rejectionReason + reviewedAt + reviewedBy.
//   4. Write payout_audit row with action='unreject'.
// ============================================
router.post(
  '/:id/unreject',
  requireAuth,
  // argentina-92103: regional underbosses can REVERT rejected payouts on
  // parties in their region (via `?regions=`). Per-row scope check below.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true, partyId: true },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status !== 'rejected') {
        throw new AppError(
          `Cannot unreject a payout in status '${existing.status}'`,
          400,
          'NOT_REJECTED',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      // argentina-92103: underboss-scope gate.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        const party = await prisma.party.findUnique({
          where: { id: existing.partyId },
          select: { region: true },
        });
        if (!party?.region || !regionsFromQuery.includes(party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

      const { note } = req.body || {};

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'pending',
            rejectionReason: null,
            reviewedAt: null,
            reviewedBy: null,
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
            action: 'unreject',
            oldStatus: 'rejected',
            newStatus: 'pending',
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
// POST /api/admin/payouts/:id/reject
// ============================================
router.post(
  '/:id/reject',
  requireAuth,
  // argentina-92103: regional underbosses can REJECT payouts on parties in
  // their region (via `?regions=`). Per-row scope check below.
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true, partyId: true },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status === 'paid') {
        throw new AppError('Cannot reject a paid payout', 400, 'INVALID_STATE');
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      // argentina-92103: underboss-scope gate.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        const party = await prisma.party.findUnique({
          where: { id: existing.partyId },
          select: { region: true },
        });
        if (!party?.region || !regionsFromQuery.includes(party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

      const reason = typeof req.body?.rejectionReason === 'string'
        ? req.body.rejectionReason.trim()
        : '';
      if (!reason) {
        throw new AppError('rejectionReason is required', 400, 'VALIDATION_ERROR');
      }

      // gouda-92103: admin can suppress host notification on reject when
      // cleaning up bogus/duplicate/over-cap rows where the host already
      // knows (or doesn't need to be re-notified). Default is notify
      // (silent === false) so behavior matches today's contract. The audit
      // note captures `[silent]` so the trail records the suppression.
      const silent = req.body?.silent === true;
      const auditNote = silent ? `${reason} [silent]` : reason;

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
            note: auditNote,
          },
        });

        return row;
      });

      // gouda-92103: host-notification side effects belong here. The reject
      // endpoint does not currently fire an email or Telegram to the host
      // (the rejection reason on the host's payouts list is the visible
      // signal), so there is nothing to skip today. When a reject-notify
      // channel is added in the future, gate it behind `if (!silent) {...}`
      // here so this contract still holds.

      res.json({ payout: serializePayout(updated) });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// POST /api/admin/payouts/:id/flag-ready — argentina-92103
//
// Regional underboss (or admin) signals that this payout is ready to be
// paid by the payments team. Writes a `payout_audit` row with
// action='flag_ready' and fires Telegram + email notifications to the
// payments-team distribution (silent no-op when env vars unset).
//
// Status is NOT changed — the flag is a soft signal layered on top of
// the existing pending/approved lifecycle. Admins still need to execute /
// mark-paid to actually transition the row.
//
// The sticky-flag derivation (`serializePayout` + `fetchFlaggedReadyByPayoutId`)
// makes this idempotent: clicking twice doesn't change the wire state,
// and the flag self-invalidates once an admin marks the row paid /
// rejected / reverted.
// ============================================
router.post(
  '/:id/flag-ready',
  requireAuth,
  requireAdminOrRegionalUnderboss(),
  async (req: RegionalAuthRequest, res: Response, next: NextFunction) => {
    try {
      const actor = await loadActor(req);
      const existing = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, hostUserId: true, partyId: true },
      });
      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (
        existing.status === 'paid' ||
        existing.status === 'rejected' ||
        existing.status === 'withdrawn' ||
        existing.status === 'completed' ||
        // gnocchi-92104: a queued payout is already moving (wire request
        // sent, awaiting settlement) — re-flagging it as "ready for payment"
        // is a stale signal. Treat as terminal-ish for flag purposes.
        existing.status === 'queued'
      ) {
        // Flagging a terminal-state row is a no-op signal; reject up front
        // so the UI doesn't render a stale-looking flag icon afterward.
        throw new AppError(
          `Cannot flag a payout in status '${existing.status}'`,
          400,
          'INVALID_STATE',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      // argentina-92103: underboss-scope gate. Admins skip.
      if (req.viewerRole === 'underboss') {
        const regionsFromQuery = parseRegionsQuery(req.query.regions) ?? [];
        const party = await prisma.party.findUnique({
          where: { id: existing.partyId },
          select: { region: true },
        });
        if (!party?.region || !regionsFromQuery.includes(party.region)) {
          throw new AppError('This event is outside your region scope.', 403, 'OUT_OF_SCOPE');
        }
      }

      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;

      await prisma.payoutAudit.create({
        data: {
          payoutId: existing.id,
          action: 'flag_ready',
          oldStatus: existing.status,
          newStatus: existing.status, // status unchanged
          actorEmail: actor.email,
          actorKind: actor.actorKind,
          note,
        },
      });

      // Fire-and-forget — never block the response on notification delivery.
      void notifyPaymentsTeam({ kind: 'flag_ready', payoutId: existing.id });

      // Re-fetch with audits so `serializePayout` derives the fresh
      // `flaggedReady=true` value for the client.
      const fresh = await prisma.payout.findUnique({
        where: { id: existing.id },
        include: {
          party: { select: PAYOUT_PARTY_SELECT },
          host: { select: { id: true, name: true, email: true } },
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
          audits: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      });
      if (!fresh) {
        throw new AppError('Payout not found after flag', 500, 'INTERNAL');
      }
      res.json({ payout: serializePayout(fresh) });
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
        select: {
          id: true,
          status: true,
          hostUserId: true,
          partyId: true,
          finalAmountUsd: true,
          payoutMethod: true,
          // prosciutto-92106: include current proof so we can merge it with
          // body values for the proof gate (body proof takes priority).
          transactionHash: true,
          wireReference: true,
          mercuryCardLast4: true,
          mercuryCardId: true,
          externalProofUrl: true,
        },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status === 'paid') {
        throw new AppError('Payout is already paid', 400, 'INVALID_STATE');
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      // bocconcini-49102: re-run the per-submission + per-party cap checks at
      // mark-paid time too. mark-paid is the manual override that records an
      // out-of-band payment for an existing row — same gates apply.
      assertWithinPerSubmissionCap(Number(existing.finalAmountUsd));
      await assertWithinPartyCap(
        existing.partyId,
        Number(existing.finalAmountUsd),
        existing.id,
      );

      const {
        wireReference,
        transactionHash,
        mercuryCardLast4,
        mercuryCardId,
        externalProofUrl,
        note,
        // prosciutto-92106: admin escape hatch for legitimate proofless
        // reconcile cases. Requires a note so the audit trail explains why
        // proof wasn't recorded (e.g. "Mercury statement attached in #payments
        // channel — Q2 2026 reconcile"). Surfaced in the audit log with a
        // `[proofless-mark-paid]` marker for grep-ability.
        proofless,
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
      if (externalProofUrl !== undefined) {
        data.externalProofUrl = externalProofUrl == null ? null : String(externalProofUrl).trim();
      }

      // prosciutto-92106: PROOF GATE. Reject mark-paid attempts that don't
      // include proof of send for the row's method, unless the admin
      // explicitly opts into the `proofless` escape hatch with a note. This
      // is what prevents future zombie paid rows.
      //
      // The check sees both incoming body proof AND any pre-existing proof
      // already on the row, so admins can mark a row paid that already had
      // proof attached out-of-band (rare, but legal).
      const effectiveProof = {
        payoutMethod: existing.payoutMethod,
        bodyTransactionHash:
          (data.transactionHash ?? existing.transactionHash) as string | null,
        bodyWireReference:
          (data.wireReference ?? existing.wireReference) as string | null,
        bodyMercuryCardLast4:
          (data.mercuryCardLast4 ?? existing.mercuryCardLast4) as string | null,
        bodyMercuryCardId:
          (data.mercuryCardId ?? existing.mercuryCardId) as string | null,
        bodyExternalProofUrl:
          (data.externalProofUrl ?? existing.externalProofUrl) as string | null,
      };
      const wantsProofless = proofless === true;
      if (wantsProofless) {
        // Proofless requires (a) full admin (not payment_admin) and (b) a note.
        if (actor.actorKind !== 'admin' && actor.actorKind !== 'super_admin') {
          throw new AppError(
            'Proofless mark-paid requires full admin (admin / super_admin) access.',
            403,
            'PROOFLESS_REQUIRES_ADMIN',
          );
        }
        if (typeof note !== 'string' || !note.trim()) {
          throw new AppError(
            'Proofless mark-paid requires a note explaining why proof is unavailable.',
            400,
            'PROOFLESS_REQUIRES_NOTE',
          );
        }
      } else {
        assertMarkPaidHasProof(effectiveProof);
      }

      const auditNote = wantsProofless
        ? `[proofless-mark-paid] ${typeof note === 'string' ? note : ''}`.trim()
        : (typeof note === 'string' ? note : null);

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
            note: auditNote,
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
// POST /api/admin/payouts/:id/revert-paid — culatello-92103
//
// Flip a `paid` payout back to `approved` so the admin can re-execute or
// re-mark-paid. Mirrors `unapprove` (approved -> pending) one step further
// up the lifecycle for cases where an out-of-band payment was recorded in
// error (wrong recipient, wrong amount, never actually sent, etc.).
//
// Works for ALL payout methods — USDC, wire, mercury_card, external,
// off-platform — not just USDC. The original implementation gap was that
// `unapprove` returns 400 NOT_APPROVED on a paid row and no separate endpoint
// existed, so admins had no way to undo a `mark-paid` after the fact.
//
// On revert we clear the mark-paid metadata:
//   - paidAt -> null
//   - transactionHash, wireReference, mercuryCardId, mercuryCardLast4,
//     externalProofUrl -> null
//
// The audit trail (payout_audit rows) is preserved — both the original
// mark_paid audit and the new unmark_paid audit stay on the row so the
// reversal is auditable.
//
// Idempotent: rejects unless status === 'paid' (400 NOT_PAID).
// ============================================
router.post(
  '/:id/revert-paid',
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
      if (existing.status !== 'paid') {
        throw new AppError(
          `Cannot revert a payout in status '${existing.status}'`,
          400,
          'NOT_PAID',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      const { note } = req.body || {};

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'approved',
            paidAt: null,
            transactionHash: null,
            wireReference: null,
            mercuryCardId: null,
            mercuryCardLast4: null,
            externalProofUrl: null,
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
            action: 'unmark_paid',
            oldStatus: 'paid',
            newStatus: 'approved',
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
// POST /api/admin/payouts/:id/mark-queued — gnocchi-92104
//
// Flip an `approved` payout to `queued`, meaning "the wire transfer email
// request has been sent to the payments team / bank but the wire hasn't
// settled yet." Semantically between approved (admin signed off) and paid
// (money actually moved).
//
// `queued` counts toward the per-party committed cap the same as approved /
// paid / completed — it's money committed, just not yet settled.
//
// Valid transitions:
//   approved -> queued   (this endpoint)
//   queued   -> paid     (POST /:id/mark-paid; existing flow, accepts queued)
//   queued   -> failed   (mark-failed; existing flow accepts non-paid)
//   queued   -> approved (POST /:id/unmark-queued; admin "oops un-queue")
//
// Not method-gated — the typical use is wire payouts, but admins may queue
// any approved row when the settlement signal needs a staging step.
//
// Auth: admin / super_admin / payment_admin. payment_admin actors are
// blocked from queueing a row they would receive (assertNotSelfPayout).
//
// Body:
//   { note?: string }   — optional, written to payout_audit.note. Cap 500
//                         chars to match flag-ready's note budget.
// ============================================
router.post(
  '/:id/mark-queued',
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
          partyId: true,
          finalAmountUsd: true,
        },
      });

      if (!existing) {
        throw new AppError('Payout not found', 404, 'NOT_FOUND');
      }
      if (existing.status !== 'approved') {
        throw new AppError(
          `Can only queue an approved payout (current status: ${existing.status})`,
          400,
          'NOT_APPROVED',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      // Cap math: queueing the row promotes it from "committed" to
      // "committed-and-settling", but the cap rules already counted it
      // (approved is in the assertWithinPartyCap status array). Re-running the
      // checks here is belt-and-braces — if the party cap was tightened
      // between approve and queue, we surface the violation instead of
      // silently letting the wire request go out.
      assertWithinPerSubmissionCap(Number(existing.finalAmountUsd));
      await assertWithinPartyCap(
        existing.partyId,
        Number(existing.finalAmountUsd),
        existing.id,
      );

      const note = typeof req.body?.note === 'string'
        ? req.body.note.slice(0, 500)
        : null;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: { status: 'queued' },
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
            action: 'mark_queued',
            oldStatus: 'approved',
            newStatus: 'queued',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note,
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
// POST /api/admin/payouts/:id/unmark-queued — gnocchi-92104
//
// Flip a `queued` payout back to `approved`. The "admin oops un-queue" path
// — used when the wire request was sent in error and needs to be reset
// before settlement (e.g. wrong recipient details, duplicate request).
//
// Idempotent: rejects unless status === 'queued' (400 NOT_QUEUED).
// Audit trail (mark_queued + this unmark_queued) is preserved so the
// reversal is visible.
// ============================================
router.post(
  '/:id/unmark-queued',
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
      if (existing.status !== 'queued') {
        throw new AppError(
          `Cannot un-queue a payout in status '${existing.status}'`,
          400,
          'NOT_QUEUED',
        );
      }

      assertNotSelfPayout(actor, existing.hostUserId);

      const note = typeof req.body?.note === 'string'
        ? req.body.note.slice(0, 500)
        : null;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: { status: 'approved' },
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
            action: 'unmark_queued',
            oldStatus: 'queued',
            newStatus: 'approved',
            actorEmail: actor.email,
            actorKind: actor.actorKind,
            note,
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
  /**
   * bianco-89172: when true, skip the per-address $676 cumulative cap
   * pre-flight inside `sendUsdcPayment`. The admin UI sets this only when
   * the warning's acknowledgement checkbox has been ticked.
   */
  allowOverPerAddressCap?: boolean;
  /**
   * salame-92103: when true, skip the per-party cap re-check at execute
   * time. Matches the bianco-89172 / aglio-62584 override pattern — admin UI
   * sets this only when the over-party-cap warning's acknowledgement
   * checkbox has been ticked. Audited via the mark_paid note suffix.
   */
  allowOverPartyCap?: boolean;
}) {
  const { payoutId, actor, body, allowOverPerAddressCap, allowOverPartyCap } = params;

  const existing = await prisma.payout.findUnique({
    where: { id: payoutId },
    select: {
      id: true,
      status: true,
      hostUserId: true,
      payoutMethod: true,
      finalAmountUsd: true,
      payoutWalletAddress: true,
      partyId: true,
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

  // bocconcini-49102: re-run the per-submission + per-party cap checks at
  // execute time so rows approved before the cap rules landed (or rows whose
  // party cap was tightened after approval) can't be pushed through to
  // `paid`. Covers BOTH the direct POST /:id/execute route and the
  // `autoExecute: true` branch of POST /:id/approve, plus per-row checks in
  // POST /bulk-execute (which serially calls this helper). `assertWithinPartyCap`
  // re-queries on every call, so successive bulk rows see the freshly-paid
  // earlier rows in their `usedUsd` totals.
  //
  // salame-92103: when `allowOverPartyCap` is set (admin-class only, sourced
  // from the modal's acknowledgement checkbox), skip the per-party cap throw
  // so admins can execute a payment that exceeds the party's effective cap.
  // The per-submission ceiling ($675), per-address cap, and daily cap are
  // unchanged.
  assertWithinPerSubmissionCap(finalAmountUsd);
  if (!allowOverPartyCap) {
    await assertWithinPartyCap(existing.partyId, finalAmountUsd, existing.id);
  }

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

    // guanciale-49342: hoist the send result so the catch can distinguish a
    // genuine send failure (no txHash) from a post-send DB write failure
    // (txHash present — money already left the wallet). Never mark a payout
    // `failed` once the on-chain send has succeeded.
    let sendResult: Awaited<ReturnType<typeof sendUsdcPayment>> | null = null;
    try {
      sendResult = await sendUsdcPayment(existing.payoutWalletAddress, finalAmountUsd, {
        allowOverPerAddressCap: !!allowOverPerAddressCap,
      });
      const result = sendResult;

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payout.update({
          where: { id: existing.id },
          data: {
            status: 'paid',
            paidAt: new Date(),
            transactionHash: result.txHash,
            // caciotta-92104: when ENS was resolved at send time, persist
            // the canonical 0x back to `payoutWalletAddress` and preserve
            // the original ENS string in `payoutWalletInput`. Future retries
            // skip the lookup, and the admin UI can show "name.eth -> 0xa1b2..."
            // alongside the audit trail. No-op when the input was already 0x.
            ...(result.resolvedFromEns
              ? {
                  payoutWalletAddress: result.resolvedFromEns.address,
                  payoutWalletInput: result.resolvedFromEns.input,
                }
              : {}),
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
            // salame-92103: append the override marker so the audit row
            // captures that the per-party cap was bypassed for this payout.
            // caciotta-92104: when ENS was resolved, the audit note records
            // the name -> 0x mapping so the audit trail reflects what was
            // sent on-chain (the 0x) and where the human-readable input came
            // from (the ENS name).
            note: `USDC on Base sent: tx ${result.txHash}, ` +
              `from ${result.fromAddress} to ${result.toAddress}, ` +
              `$${result.amountUsd.toFixed(2)}` +
              (result.resolvedFromEns
                ? ` [resolved ENS ${result.resolvedFromEns.input} -> ${result.resolvedFromEns.address}]`
                : '') +
              (allowOverPartyCap ? ' [override: party cap]' : ''),
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
      const errMsg = err?.message || String(err);

      // guanciale-49342: if the on-chain send already SUCCEEDED (we have a
      // txHash) but the subsequent DB write threw, the money has already left
      // the wallet. Marking the row `failed` here would record an on-chain
      // payment as failed — a money-loss-of-record. Instead, recover by
      // recording `paid` (best-effort), and NEVER mark it failed.
      if (sendResult?.txHash) {
        console.error(
          `[admin-payout] CRITICAL: USDC sent (tx ${sendResult.txHash}) for payout ${existing.id} ` +
            `but DB write failed — attempting recovery: ${errMsg}`,
        );
        try {
          await prisma.payout.update({
            where: { id: existing.id },
            data: {
              status: 'paid',
              paidAt: new Date(),
              transactionHash: sendResult.txHash,
              ...(sendResult.resolvedFromEns
                ? {
                    payoutWalletAddress: sendResult.resolvedFromEns.address,
                    payoutWalletInput: sendResult.resolvedFromEns.input,
                  }
                : {}),
            },
          });
          await prisma.payoutAudit.create({
            data: {
              payoutId: existing.id,
              action: 'mark_paid',
              oldStatus: existing.status,
              newStatus: 'paid',
              actorEmail: actor.email,
              actorKind: actor.actorKind,
              note: `USDC sent tx ${sendResult.txHash} — recorded on retry after DB write failure`,
            },
          });
        } catch (recoveryErr: any) {
          // Recovery write ALSO failed. The money is gone but we cannot record
          // it. Log everything needed to reconcile by hand and surface a 500
          // that names the txHash. Do NOT mark the row failed.
          const recoveryMsg = recoveryErr?.message || String(recoveryErr);
          console.error(
            `[admin-payout] CRITICAL UNRECOVERABLE: USDC SENT (tx ${sendResult.txHash}) for payout ` +
              `${existing.id} to wallet ${existing.payoutWalletAddress} for $${finalAmountUsd.toFixed(2)} ` +
              `but BOTH the original DB write AND the recovery write failed — MANUAL RECONCILE REQUIRED. ` +
              `original error: ${errMsg} | recovery error: ${recoveryMsg}`,
          );
          // Host should still hear 'paid' — the money went out.
          void notifyHostOfPaymentExecution(existing.id, 'paid', {
            txHash: sendResult.txHash,
          });
          void emailHostOfPaymentExecution(existing.id, 'paid', {
            txHash: sendResult.txHash,
          });
          throw new AppError(
            `USDC payment SENT (tx ${sendResult.txHash}) but could not be recorded — ` +
              `MANUAL RECONCILE REQUIRED for payout ${existing.id}`,
            500,
            'USDC_SENT_RECORD_FAILED',
          );
        }

        // Recovery succeeded — money went out and is now recorded as paid.
        // Host should hear 'paid', not 'failed'.
        void notifyHostOfPaymentExecution(existing.id, 'paid', {
          txHash: sendResult.txHash,
        });
        void emailHostOfPaymentExecution(existing.id, 'paid', {
          txHash: sendResult.txHash,
        });
        // Re-fetch with the same include shape the success path returns so the
        // API responds 200 with the paid row.
        return prisma.payout.findUniqueOrThrow({
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
      }

      // Genuine send failure (no txHash) — keep the existing behavior exactly.
      // Flip to failed + record the error so the admin UI shows what happened.
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
          // salame-92103: append override marker when per-party cap was bypassed.
          note: `Wire executed out-of-band, reference: ${wireRef}` +
            (typeof body?.note === 'string' && body.note ? ` — ${body.note}` : '') +
            (allowOverPartyCap ? ' [override: party cap]' : ''),
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
          // salame-92103: append override marker when per-party cap was bypassed.
          note: `Mercury card issued via dashboard, last4=${last4Raw}` +
            (cardId ? `, id=${cardId}` : '') +
            (typeof body?.note === 'string' && body.note ? ` — ${body.note}` : '') +
            (allowOverPartyCap ? ' [override: party cap]' : ''),
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
        // bianco-89172: admin can acknowledge the per-address $676 cap
        // warning via the PayoutReviewModal checkbox; the frontend forwards
        // the flag here.
        allowOverPerAddressCap: !!(req.body && req.body.allowOverPerAddressCap),
        // salame-92103: admin can acknowledge the per-party cap warning via
        // the PayoutReviewModal checkbox; same admin-class gate as the route
        // itself (requireAnyAdminOrPaymentAdmin above).
        allowOverPartyCap: !!(req.body && req.body.allowOverPartyCap),
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

      // bianco-89172: a single batch-level acknowledgement covers every row.
      // BulkSendModal disables Send when any selected wallet would exceed the
      // per-address cap unless the admin ticks "Allow over-cap sends".
      const allowOverPerAddressCap = !!(req.body && req.body.allowOverPerAddressCap);
      // salame-92103: same batch-level acknowledgement model for the per-party
      // cap. BulkSendModal counts how many selected rows would push their
      // party past its cap and requires this ack before enabling Send.
      const allowOverPartyCap = !!(req.body && req.body.allowOverPartyCap);

      // SEQUENTIAL execution — nonce safety. Do NOT switch to Promise.all.
      const results: BulkSendResult[] = [];
      for (const row of eligible) {
        const priorStatus = row.status; // 'approved' or 'failed' (passata-49102)
        try {
          const updated = await executePayout({
            payoutId: row.id,
            actor: { email: actor.email, actorKind: actor.actorKind },
            body: {},
            allowOverPerAddressCap,
            allowOverPartyCap,
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

// ============================================
// PATCH /api/admin/payouts/documents/:docId — agnolotti-58291
//
// Admin per-receipt OCR correction. Updates ONLY the `payout_documents` row's
// `ocrAmount` and `ocrCurrency` fields. Does NOT recompute the parent payout's
// `finalAmountUsd` — admins use the existing edit-amount affordance on the
// payout itself for that. Useful for forensics and for correcting OCR drift
// when the model misread a receipt amount or currency.
//
// Auth: requireAnyAdminOrPaymentAdmin (admin / super_admin / payment_admin).
// Body: {
//   ocrAmount?: number | null,
//   ocrCurrency?: string | null,
//   // taralli-92104: structured line items the admin has manually edited
//   // in the reviewer modal. The OCR extractor still seeds the initial
//   // shape (formaggi-89172) but the admin's edits are authoritative —
//   // we do NOT re-run OCR here. Pass `null` to clear, `undefined` to
//   // leave untouched, or an array of { name, qty, unitPrice, subtotal,
//   // category? } to replace.
//   ocrLineItems?: Array<{
//     name?: string,
//     qty?: number,
//     unitPrice?: number,
//     subtotal?: number,
//     category?: 'pizza'|'beverage'|'topping'|'side'|'dessert'|'tax'|'tip'|'fee'|'other'
//   }> | null,
//   // culatello-92104: admin-marked duplicate flag. Reversible. Excluded
//   // from the reviewer modal's OCR sum, the host PATCH finalAmountUsd
//   // recompute, and the pizza-prices analytics aggregate.
//   isDuplicate?: boolean,
//   // provola-92106: admin-marked "ineligible for reimbursement" flag.
//   // Distinct from `isDuplicate` — this is a legitimate purchase that
//   // doesn't qualify for reimbursement under policy (alcohol, tips,
//   // personal items). Same exclusion semantics as `isDuplicate`.
//   ineligible?: boolean
// }
// Note: `ocrLineItems[*].ineligible` is supported in the same array — each
// line item may carry an optional `ineligible?: boolean` field that excludes
// only that line from sums. Stored alongside the existing fields in jsonb;
// no schema change. Sanitized in `sanitizeLineItem` below.
//   - null clears the field; undefined leaves it untouched.
//   - ocrAmount must be finite (or null).
//   - ocrCurrency must be a non-empty string ≤8 chars (or null).
//   - ocrLineItems must be an array; each entry is sanitized (qty/price
//     coerced to non-negative numbers, name to string, category to one
//     of the OcrLineItemCategory values — invalid categories fall back
//     to 'other').
//
// Audit: writes a payout_audit row with action='edit_amount' for amount/
// currency changes, and a separate action='edit_documents' row when
// ocrLineItems is touched. Skips audit when payoutId is null (orphaned
// receipt — parent payout was deleted; nothing to audit against).
// ============================================
router.patch(
  '/documents/:docId',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { docId } = req.params;
      const body = req.body || {};

      const doc = await prisma.payoutDocument.findUnique({
        where: { id: docId },
        select: {
          id: true,
          kind: true,
          payoutId: true,
          ocrAmount: true,
          ocrCurrency: true,
          // mortadella-92103: pull the existing original-amount + raw OCR
          // payload so we can re-run FX when admin changes the currency.
          originalAmount: true,
          originalCurrency: true,
          exchangeRate: true,
          ocrRaw: true,
          // taralli-92104: pull the existing line items so the audit row
          // can record old → new counts when the admin edits them.
          ocrLineItems: true,
          // culatello-92104: pull the old duplicate flag so the audit row
          // can record the transition (marked vs unmarked).
          isDuplicate: true,
          // provola-92106: pull the old ineligible flag so the audit row can
          // record the transition (marked vs unmarked) — same pattern as
          // culatello-92104.
          ineligible: true,
        },
      });
      if (!doc) {
        throw new AppError('Document not found', 404, 'NOT_FOUND');
      }

      // taralli-92104: sanitize an admin-supplied line item entry. Mirrors
      // the OCR-side sanitization in `services/ocr.service.ts` so a saved
      // edit is shape-compatible with the pizza-prices analytics consumer
      // (which reads `category`, `qty`, `unitPrice`, `subtotal`, `name`).
      // Defensive defaults: name → '' (empty allowed per task spec), qty/
      // prices clamped to non-negative finite numbers, unknown categories
      // collapse to 'other'.
      const ALLOWED_LINE_ITEM_CATEGORIES = [
        'pizza',
        'beverage',
        'topping',
        'side',
        'dessert',
        'tax',
        'tip',
        'fee',
        'other',
      ] as const;
      type SanitizedLineItem = {
        name: string;
        qty: number;
        unitPrice: number;
        subtotal: number;
        category: (typeof ALLOWED_LINE_ITEM_CATEGORIES)[number];
        // provola-92106: optional per-line "ineligible for reimbursement"
        // flag. Stored alongside the other line-item fields in jsonb; no
        // schema change. Only emitted when true so existing rows + admins
        // who never touched the flag don't get a `false` sprinkled into
        // every entry.
        ineligible?: boolean;
      };
      function sanitizeLineItem(raw: unknown, idx: number): SanitizedLineItem {
        if (!raw || typeof raw !== 'object') {
          throw new AppError(
            `ocrLineItems[${idx}] must be an object`,
            400,
            'VALIDATION_ERROR',
          );
        }
        const e = raw as Record<string, unknown>;
        const name = typeof e.name === 'string' ? e.name.trim() : '';

        const qtyNum = Number(e.qty);
        if (!Number.isFinite(qtyNum) || qtyNum < 0) {
          throw new AppError(
            `ocrLineItems[${idx}].qty must be a non-negative finite number`,
            400,
            'VALIDATION_ERROR',
          );
        }
        const qty = qtyNum;

        const unitNum = Number(e.unitPrice);
        if (!Number.isFinite(unitNum) || unitNum < 0) {
          throw new AppError(
            `ocrLineItems[${idx}].unitPrice must be a non-negative finite number`,
            400,
            'VALIDATION_ERROR',
          );
        }
        const unitPrice = unitNum;

        const subNum = Number(e.subtotal);
        if (!Number.isFinite(subNum) || subNum < 0) {
          throw new AppError(
            `ocrLineItems[${idx}].subtotal must be a non-negative finite number`,
            400,
            'VALIDATION_ERROR',
          );
        }
        const subtotal = subNum;

        const rawCategory = typeof e.category === 'string'
          ? e.category.toLowerCase().trim()
          : 'other';
        const category: SanitizedLineItem['category'] =
          (ALLOWED_LINE_ITEM_CATEGORIES as readonly string[]).includes(rawCategory)
            ? (rawCategory as SanitizedLineItem['category'])
            : 'other';

        // provola-92106: per-line "ineligible for reimbursement" flag. Only
        // accept strict boolean; ignore anything else (matches the receipt-
        // level isDuplicate / ineligible coercion stance — coercion would
        // hide caller bugs). Only emit when true so admins who never touched
        // it don't pollute every line with `ineligible:false`.
        const out: SanitizedLineItem = { name, qty, unitPrice, subtotal, category };
        if (e.ineligible === true) out.ineligible = true;
        return out;
      }

      const data: {
        ocrAmount?: number | null;
        ocrCurrency?: string | null;
        originalAmount?: number | null;
        originalCurrency?: string | null;
        exchangeRate?: number | null;
        ocrLineItems?: Prisma.InputJsonValue | typeof Prisma.DbNull;
        // culatello-92104: admin-only duplicate flag. Reversible — the same
        // toggle un-marks. Persisted to `payout_documents.is_duplicate`.
        isDuplicate?: boolean;
        // provola-92106: admin-only "ineligible for reimbursement" flag.
        // Distinct from `isDuplicate` — this is a legitimate purchase that
        // doesn't qualify under policy (alcohol, tips, personal items).
        // Reversible — same toggle un-marks. Persisted to
        // `payout_documents.ineligible`.
        ineligible?: boolean;
      } = {};

      if (body.ocrAmount !== undefined) {
        if (body.ocrAmount === null) {
          data.ocrAmount = null;
        } else {
          const n = Number(body.ocrAmount);
          if (!Number.isFinite(n) || n < 0) {
            throw new AppError(
              'ocrAmount must be a non-negative finite number or null',
              400,
              'VALIDATION_ERROR',
            );
          }
          data.ocrAmount = n;
        }
      }

      if (body.ocrCurrency !== undefined) {
        if (body.ocrCurrency === null) {
          data.ocrCurrency = null;
        } else {
          const c = String(body.ocrCurrency).trim();
          if (c.length === 0 || c.length > 8) {
            throw new AppError(
              'ocrCurrency must be a non-empty string of 1-8 characters or null',
              400,
              'VALIDATION_ERROR',
            );
          }
          data.ocrCurrency = c;
        }
      }

      // taralli-92104: accept the admin's manually-edited line items. `null`
      // clears the column (Prisma.DbNull writes a JSON null to the column);
      // an array replaces the existing items wholesale (no merge — admin's
      // edits in the modal are authoritative). Each entry is sanitized via
      // `sanitizeLineItem` above. Hard cap at 200 entries so a malicious
      // body can't blow up the row size.
      if (body.ocrLineItems !== undefined) {
        if (body.ocrLineItems === null) {
          data.ocrLineItems = Prisma.DbNull;
        } else {
          if (!Array.isArray(body.ocrLineItems)) {
            throw new AppError(
              'ocrLineItems must be an array of line items or null',
              400,
              'VALIDATION_ERROR',
            );
          }
          if (body.ocrLineItems.length > 200) {
            throw new AppError(
              'ocrLineItems may contain at most 200 entries',
              400,
              'VALIDATION_ERROR',
            );
          }
          const sanitized: SanitizedLineItem[] = body.ocrLineItems.map(
            (entry: unknown, idx: number) => sanitizeLineItem(entry, idx),
          );
          data.ocrLineItems = sanitized as unknown as Prisma.InputJsonValue;

          // Compute sum of eligible line items and update originalAmount.
          // This ensures the receipt total reflects the line items the admin
          // edited. Eligible = not marked ineligible at the line level.
          const eligibleSum = sanitized.reduce((sum, item) => {
            if (item.ineligible === true) return sum;
            return sum + item.subtotal;
          }, 0);
          // Always update the amount when line items are saved, even if sum
          // is 0 (all items ineligible). This ensures the receipt total
          // matches what the admin sees in the line item editor.
          if (sanitized.length > 0) {
            if (eligibleSum > 0) {
              // Has eligible items — set originalAmount so FX path runs below
              body.originalAmount = eligibleSum;
            } else {
              // All items ineligible — set ocrAmount directly to 0, no FX needed
              data.ocrAmount = 0;
              data.originalAmount = 0;
            }
          }
        }
      }

      // culatello-92104: admin-toggleable duplicate flag. Accept strict
      // boolean only — coercion would hide caller bugs. The flag is purely
      // a review-side annotation; it doesn't move money on its own. The
      // host PATCH recompute path (provolone-39042 + crocchetta-92103) and
      // the reviewer modal's OCR sum both filter `isDuplicate=true` rows.
      if (body.isDuplicate !== undefined) {
        if (typeof body.isDuplicate !== 'boolean') {
          throw new AppError(
            'isDuplicate must be a boolean',
            400,
            'VALIDATION_ERROR',
          );
        }
        data.isDuplicate = body.isDuplicate;
      }

      // provola-92106: admin-toggleable "ineligible for reimbursement"
      // flag. Strict boolean only (matches culatello-92104 `isDuplicate`
      // semantics — coercion would hide caller bugs). Independent of the
      // duplicate flag; both can be set on the same row. The reviewer
      // modal's OCR sum + the host PATCH recompute path + the pizza-prices
      // analytics aggregate all filter rows where this is true (same as
      // they already do for `isDuplicate`).
      if (body.ineligible !== undefined) {
        if (typeof body.ineligible !== 'boolean') {
          throw new AppError(
            'ineligible must be a boolean',
            400,
            'VALIDATION_ERROR',
          );
        }
        data.ineligible = body.ineligible;
      }

      // mortadella-92103 + caprino-92104: when admin changes the currency on a
      // doc that has a known original-amount (either persisted in the column,
      // buried in ocrRaw.ocr.amount, or — caprino-92104 — inferable from the
      // current ocr_amount on a legacy row), re-run FX so ocr_amount is the
      // correctly-converted USD value. Admin can override by passing both
      // ocrAmount + ocrCurrency explicitly; in that case we trust the admin's
      // numbers and skip FX.
      //
      // caprino-92104: also re-run FX when the admin sent BOTH originalAmount
      // + ocrCurrency together (the new editor's standard save shape). This is
      // distinct from `adminSetBothExplicitly` (which is ocrAmount + ocrCurrency
      // and means "trust the admin's USD value verbatim").
      const currencyChanged =
        data.ocrCurrency !== undefined && data.ocrCurrency !== doc.ocrCurrency;
      const adminSetBothExplicitly =
        body.ocrAmount !== undefined && body.ocrCurrency !== undefined;
      const adminSentOriginalAmountAndCurrency =
        body.originalAmount !== undefined
        && body.originalAmount !== null
        && body.ocrCurrency !== undefined
        && data.ocrCurrency != null;

      // Track whether the original amount was inferred from the legacy
      // ocrAmount fallback so we can record it in the audit note (helps when
      // forensically tracing FX recomputes on pre-mortadella receipts).
      let originalAmountInferred = false;

      if (
        (currencyChanged || adminSentOriginalAmountAndCurrency)
        && !adminSetBothExplicitly
        && data.ocrCurrency != null
      ) {
        // Resolve the original foreign-currency amount. Preference order:
        //   1. body.originalAmount if the admin provided it
        //   2. the existing originalAmount column (mortadella-92103+)
        //   3. ocrRaw.ocr.amount (pre-mortadella-92103 rows)
        //   4. caprino-92104: existing ocr_amount on the doc — treat it as
        //      the receipt's original-currency amount. This is the legacy-row
        //      fallback for pre-mortadella receipts where neither column nor
        //      ocr_raw has data; without it the PATCH would 400 with
        //      FX_ORIGINAL_AMOUNT_MISSING and the admin would be stuck.
        //      Audit row records `originalAmountInferred: true` so this
        //      fallback is traceable.
        let originalAmount: number | null = null;
        if (body.originalAmount !== undefined && body.originalAmount !== null) {
          const n = Number(body.originalAmount);
          if (!Number.isFinite(n) || n <= 0) {
            throw new AppError(
              'originalAmount must be a positive number',
              400,
              'VALIDATION_ERROR',
            );
          }
          originalAmount = n;
        } else if (doc.originalAmount != null) {
          originalAmount = Number(doc.originalAmount.toString());
        } else if (
          doc.ocrRaw
          && typeof doc.ocrRaw === 'object'
          && 'ocr' in (doc.ocrRaw as any)
          && typeof (doc.ocrRaw as any).ocr?.amount === 'number'
        ) {
          originalAmount = (doc.ocrRaw as any).ocr.amount;
        } else if (doc.ocrAmount != null) {
          originalAmount = Number(doc.ocrAmount.toString());
          originalAmountInferred = true;
        }

        if (originalAmount == null) {
          throw new AppError(
            'Cannot re-convert FX: original-currency amount unknown. Pass originalAmount in the body, or set both ocrAmount and ocrCurrency explicitly.',
            400,
            'FX_ORIGINAL_AMOUNT_MISSING',
          );
        }

        const { convertToUSD } = await import('../services/fx.service.js');
        const fx = await convertToUSD(originalAmount, data.ocrCurrency);
        if (fx.source === 'unresolved' || fx.usdAmount == null) {
          throw new AppError(
            `Could not convert ${originalAmount} ${data.ocrCurrency} to USD — unresolved currency.`,
            400,
            'CURRENCY_UNRESOLVED',
          );
        }
        if (fx.source === 'unknown' || fx.exchangeRate == null) {
          // caprino-92104: distinguish "we don't know this currency" /
          // "network providers all failed" from "currency was missing". The
          // frontend surfaces FX_RATE_UNAVAILABLE with a retry-or-set-USD
          // affordance.
          throw new AppError(
            `Could not fetch an exchange rate for ${data.ocrCurrency}. Try again, or set the USD value manually.`,
            400,
            'FX_RATE_UNAVAILABLE',
          );
        }
        data.ocrAmount = fx.usdAmount;
        data.originalAmount = originalAmount;
        data.originalCurrency = fx.originalCurrency;
        data.exchangeRate = fx.exchangeRate;
      } else if (
        body.originalAmount !== undefined
        && body.originalAmount !== null
        && data.originalAmount === undefined
      ) {
        // Admin updated originalAmount directly (e.g. correcting a misread
        // number on an already-correct currency). Re-run FX on the doc's
        // existing currency too.
        //
        // caprino-92104: previously this silently no-op'd on FX failure
        // (`if (fx.usdAmount != null...)`), which meant the admin's edit
        // didn't persist but they got a 200 response. Now we throw the same
        // FX_RATE_UNAVAILABLE the currency-changed branch throws.
        const n = Number(body.originalAmount);
        if (!Number.isFinite(n) || n <= 0) {
          throw new AppError(
            'originalAmount must be a positive number',
            400,
            'VALIDATION_ERROR',
          );
        }
        const cur = data.ocrCurrency ?? doc.ocrCurrency;
        if (!cur) {
          throw new AppError(
            'Cannot re-convert FX: receipt has no currency. Set ocrCurrency in the same request.',
            400,
            'CURRENCY_UNRESOLVED',
          );
        }
        const { convertToUSD } = await import('../services/fx.service.js');
        const fx = await convertToUSD(n, cur);
        if (fx.source === 'unresolved' || fx.usdAmount == null) {
          throw new AppError(
            `Could not convert ${n} ${cur} to USD — unresolved currency.`,
            400,
            'CURRENCY_UNRESOLVED',
          );
        }
        if (fx.source === 'unknown' || fx.exchangeRate == null) {
          throw new AppError(
            `Could not fetch an exchange rate for ${cur}. Try again, or set the USD value manually.`,
            400,
            'FX_RATE_UNAVAILABLE',
          );
        }
        data.ocrAmount = fx.usdAmount;
        data.originalAmount = n;
        data.originalCurrency = fx.originalCurrency;
        data.exchangeRate = fx.exchangeRate;
      }

      if (Object.keys(data).length === 0) {
        throw new AppError('No editable fields supplied', 400, 'VALIDATION_ERROR');
      }

      // Run the update + audit atomically. Audit only fires when there's a
      // parent payout — orphaned receipts (payoutId IS NULL) have nothing to
      // audit against, since payout_audit.payout_id is NOT NULL with CASCADE.
      const oldAmount = doc.ocrAmount == null ? null : Number(doc.ocrAmount.toString());
      const oldCurrency = doc.ocrCurrency;
      // taralli-92104: track whether the admin's edit changed the amount/
      // currency fields vs only line items, so the audit row is recorded
      // under the most accurate action (edit_amount vs edit_documents).
      const amountOrCurrencyChanged =
        data.ocrAmount !== undefined || data.ocrCurrency !== undefined;
      const lineItemsChanged = data.ocrLineItems !== undefined;
      const oldLineItemsCount = Array.isArray(doc.ocrLineItems)
        ? (doc.ocrLineItems as unknown[]).length
        : 0;
      const actor = await loadActor(req);

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payoutDocument.update({
          where: { id: docId },
          data: {
            ocrAmount: data.ocrAmount === undefined
              ? undefined
              : data.ocrAmount === null
                ? null
                : (data.ocrAmount as any),
            ocrCurrency: data.ocrCurrency === undefined
              ? undefined
              : data.ocrCurrency,
            // mortadella-92103: persist the re-derived FX detail when set.
            originalAmount: data.originalAmount === undefined
              ? undefined
              : data.originalAmount === null
                ? null
                : (data.originalAmount as any),
            originalCurrency: data.originalCurrency === undefined
              ? undefined
              : data.originalCurrency,
            exchangeRate: data.exchangeRate === undefined
              ? undefined
              : data.exchangeRate === null
                ? null
                : (data.exchangeRate as any),
            // taralli-92104: persist the admin's edited line items. The
            // backend's POST /backfill-line-items + initial OCR extractor
            // remain the seed paths; this PATCH is purely user-driven
            // correction so we trust the sanitized payload.
            ocrLineItems: data.ocrLineItems === undefined
              ? undefined
              : data.ocrLineItems,
            // culatello-92104: persist the duplicate-flag toggle.
            isDuplicate: data.isDuplicate === undefined
              ? undefined
              : data.isDuplicate,
            // provola-92106: persist the ineligible-flag toggle. Independent
            // of `isDuplicate` — both columns can be true on the same row,
            // though the UI prefers duplicate as the primary visual signal.
            ineligible: data.ineligible === undefined
              ? undefined
              : data.ineligible,
          },
        });

        if (doc.payoutId) {
          // Use action='edit_amount' (existing enum value) and stash the
          // before/after in `note` JSON so forensics tools can pick this up
          // alongside the regular amount edits.
          const newAmount = data.ocrAmount === undefined
            ? oldAmount
            : data.ocrAmount;
          const newCurrency = data.ocrCurrency === undefined
            ? oldCurrency
            : data.ocrCurrency;
          if (amountOrCurrencyChanged) {
            await tx.payoutAudit.create({
              data: {
                payoutId: doc.payoutId,
                action: 'edit_amount',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: JSON.stringify({
                  scope: 'receipt',
                  documentId: docId,
                  oldAmount,
                  newAmount,
                  oldCurrency,
                  newCurrency,
                  // caprino-92104: flag rows where we fell through to the
                  // legacy ocr_amount fallback so forensics tools can
                  // distinguish "FX recompute with known original" from
                  // "FX recompute: original amount inferred from prior
                  // ocr_amount value".
                  ...(originalAmountInferred
                    ? {
                      note: 'FX recompute: original amount inferred from prior ocr_amount value',
                      originalAmountInferred: true,
                    }
                    : {}),
                }),
              },
            });
          }
          // taralli-92104: separate audit row for line item edits so the
          // forensics tools can attribute them distinctly from amount/
          // currency tweaks. Action='edit_documents' is the existing enum
          // value used for receipt-attached changes (PayoutAuditEntry type).
          if (lineItemsChanged) {
            const newLineItemsCount = Array.isArray(data.ocrLineItems)
              ? (data.ocrLineItems as unknown[]).length
              : 0;
            await tx.payoutAudit.create({
              data: {
                payoutId: doc.payoutId,
                action: 'edit_documents',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: JSON.stringify({
                  scope: 'receipt',
                  documentId: docId,
                  message: 'edited line items',
                  oldLineItemsCount,
                  newLineItemsCount,
                }),
              },
            });
          }
          // culatello-92104: audit row for duplicate-flag transitions.
          // Only records when the value actually changes (matches the
          // amount/currency audit precedent above — no-op PATCHes don't
          // pollute the audit log).
          if (
            data.isDuplicate !== undefined
            && data.isDuplicate !== doc.isDuplicate
          ) {
            await tx.payoutAudit.create({
              data: {
                payoutId: doc.payoutId,
                action: 'edit_documents',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: JSON.stringify({
                  scope: 'receipt',
                  documentId: docId,
                  message: data.isDuplicate
                    ? 'marked duplicate'
                    : 'unmarked duplicate',
                  oldIsDuplicate: doc.isDuplicate,
                  newIsDuplicate: data.isDuplicate,
                }),
              },
            });
          }
          // provola-92106: audit row for ineligible-flag transitions.
          // Mirrors the culatello-92104 duplicate-audit precedent above —
          // separate row per transition, only fires on actual value change.
          // Uses the existing `edit_documents` action so it shows up in the
          // forensics tools alongside the duplicate-flag toggles.
          if (
            data.ineligible !== undefined
            && data.ineligible !== doc.ineligible
          ) {
            await tx.payoutAudit.create({
              data: {
                payoutId: doc.payoutId,
                action: 'edit_documents',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: JSON.stringify({
                  scope: 'receipt',
                  documentId: docId,
                  message: data.ineligible
                    ? 'marked ineligible'
                    : 'unmarked ineligible',
                  oldIneligible: doc.ineligible,
                  newIneligible: data.ineligible,
                }),
              },
            });
          }
        }

        return row;
      });

      res.json({
        document: {
          id: updated.id,
          kind: updated.kind,
          url: updated.url,
          fileName: updated.fileName,
          fileSize: updated.fileSize,
          mimeType: updated.mimeType,
          ocrAmount: updated.ocrAmount == null ? null : Number(updated.ocrAmount),
          ocrCurrency: updated.ocrCurrency,
          ocrConfidence: updated.ocrConfidence == null ? null : Number(updated.ocrConfidence),
          // mortadella-92103: surface the per-receipt FX detail so the
          // reviewer modal can render an inline "X.YZ CUR → $X.YZ USD"
          // pill without re-fetching.
          originalAmount: updated.originalAmount == null ? null : Number(updated.originalAmount),
          originalCurrency: updated.originalCurrency,
          exchangeRate: updated.exchangeRate == null ? null : Number(updated.exchangeRate),
          // taralli-92104: echo the persisted line items so the modal can
          // sync its draft state to the canonical row without re-fetching.
          ocrLineItems: Array.isArray(updated.ocrLineItems) ? updated.ocrLineItems : null,
          // culatello-92104: echo the persisted duplicate flag.
          isDuplicate: updated.isDuplicate === true,
          // provola-92106: echo the persisted ineligible flag so the modal
          // can update its optimistic override without a parent refetch.
          ineligible: updated.ineligible === true,
          ocrError: updated.ocrError,
          sortOrder: updated.sortOrder,
          uploadedByUserId: updated.uploadedByUserId ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// POST /api/admin/payouts/backfill-line-items — provola-92103
//
// One-shot ops endpoint to re-OCR existing receipts that were uploaded before
// formaggi-89172 added structured `ocr_line_items` extraction. OPENAI_API_KEY
// only exists on the backend Vercel deploy (auto-classifier blocks pulling it
// locally), so the backfill MUST run server-side.
//
// Auth: requireAnyAdminOrPaymentAdmin (admin / super_admin / payment_admin).
// Body: { limit?: number }  // 1..50, default 25
//
// Behavior:
//  - Selects up to `limit` receipts where `ocr_line_items IS NULL` and the
//    URL is present, oldest first.
//  - Calls `analyzeReceipt(url)` sequentially with a 500ms throttle between
//    iterations (gentle on OpenAI rate limits).
//  - On success, writes ONLY `ocr_line_items` — leaves `ocr_amount`,
//    `ocr_currency`, `ocr_confidence`, `ocr_raw` untouched so admin-approved
//    payout totals don't shift. `merchant` and `receiptDate` are returned by
//    the OCR service but have no DB columns yet, so they're discarded here.
//  - On failure, the error is logged + pushed onto `failed` and we continue.
//
// pancetta-92104: the original implementation only wrote `ocr_line_items` on
// success, so failed docs (429 quota errors, timeouts, bad images) stayed
// queryable as candidates forever. The loop script kept hitting the same
// failed docs every iteration and burned through our OpenAI quota. Now we
// always stamp `ocr_attempted_at` + bump `ocr_attempt_count` (success OR
// failure), the candidate filter excludes docs attempted in the last 24h
// AND caps at 3 attempts, and the loop short-circuits if the FIRST error
// looks like a 429/quota response.
//
// Returns:
//   { processed, succeeded, failed: [{id, error}], remaining, done,
//     quotaExceeded? }
//
// Loop externally with backend/scripts/loop-backfill-line-items.cjs (which
// also breaks on `quotaExceeded: true`).
// ============================================

/**
 * pancetta-92104: detect the OpenAI 429/quota-exceeded response shape so the
 * backfill loop can short-circuit instead of waiting through the remaining
 * throttled iterations. Defensive: matches either the literal 429 status
 * code substring or the word "quota" in the error message.
 */
function isQuotaError(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('429') || lower.includes('quota');
}

/**
 * pancetta-92104: 24-hour cooldown between automatic OCR re-attempts on a
 * single doc. Admin can bypass via `POST /:docId/retry-ocr` (resets both
 * counter columns to zero).
 */
const OCR_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const OCR_MAX_AUTO_ATTEMPTS = 3;

router.post(
  '/backfill-line-items',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { analyzeReceipt } = await import('../services/ocr.service.js');

      const body = (req.body || {}) as { limit?: unknown };
      const rawLimit = body.limit === undefined ? 25 : Number(body.limit);
      if (!Number.isFinite(rawLimit)) {
        throw new AppError('limit must be a finite number', 400, 'VALIDATION_ERROR');
      }
      const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));

      // pancetta-92104: candidates are receipts with no line items yet, a
      // non-empty URL, AND either never attempted OR last attempted >24h
      // ago, AND under the per-doc attempt cap. This is the surgical fix
      // for the re-OCR-loop bug — failed docs stop being "free candidates
      // every iteration" once their attempt marker is set.
      const cooldownCutoff = new Date(Date.now() - OCR_RETRY_COOLDOWN_MS);
      const candidates = await prisma.payoutDocument.findMany({
        where: {
          kind: 'receipt',
          ocrLineItems: { equals: Prisma.DbNull },
          url: { not: '' },
          ocrAttemptCount: { lt: OCR_MAX_AUTO_ATTEMPTS },
          OR: [
            { ocrAttemptedAt: null },
            { ocrAttemptedAt: { lt: cooldownCutoff } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true, url: true },
      });

      const failed: Array<{ id: string; error: string }> = [];
      let succeeded = 0;
      let quotaExceeded = false;

      for (let i = 0; i < candidates.length; i++) {
        const doc = candidates[i];
        try {
          const result = await analyzeReceipt(doc.url);
          // Additive write: ONLY ocr_line_items + attempt marker. Do not
          // overwrite ocr_amount / ocr_currency / ocr_confidence / ocr_raw
          // — admins may have already approved payouts based on those.
          // Clear any prior ocrError since this attempt succeeded.
          await prisma.payoutDocument.update({
            where: { id: doc.id },
            data: {
              ocrLineItems: (result.lineItems ?? []) as unknown as Prisma.InputJsonValue,
              ocrAttemptedAt: new Date(),
              ocrAttemptCount: { increment: 1 },
              ocrError: null,
            },
          });
          succeeded += 1;
        } catch (err: any) {
          const message = err?.message ? String(err.message) : String(err);
          console.error(
            `[backfill-line-items] doc=${doc.id} url=${doc.url} failed: ${message}`,
          );
          // pancetta-92104: persist the attempt marker on failure too —
          // this is the bug fix. Without this, a failed doc stays a
          // candidate forever and the loop burns quota retrying it.
          // Truncate the error to 500 chars to keep the column sane.
          await prisma.payoutDocument.update({
            where: { id: doc.id },
            data: {
              ocrAttemptedAt: new Date(),
              ocrAttemptCount: { increment: 1 },
              ocrError: message.slice(0, 500),
            },
          });
          failed.push({ id: doc.id, error: message });

          // Short-circuit on quota errors: no point waiting through the
          // remaining 500ms throttles when the account is rate-limited.
          if (isQuotaError(message)) {
            quotaExceeded = true;
            break;
          }
        }

        // Throttle between iterations (skip the wait after the last one).
        if (i < candidates.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // pancetta-92104: `remaining` reflects docs still eligible for the
      // NEXT loop call (same cooldown + cap filters). A doc that just
      // failed today won't count again until 24h pass.
      const remaining = await prisma.payoutDocument.count({
        where: {
          kind: 'receipt',
          ocrLineItems: { equals: Prisma.DbNull },
          url: { not: '' },
          ocrAttemptCount: { lt: OCR_MAX_AUTO_ATTEMPTS },
          OR: [
            { ocrAttemptedAt: null },
            { ocrAttemptedAt: { lt: cooldownCutoff } },
          ],
        },
      });

      res.json({
        processed: candidates.length,
        succeeded,
        failed,
        remaining,
        done: remaining === 0,
        // pancetta-92104: loop driver checks this and breaks early so it
        // doesn't spam more requests once the account is rate-limited.
        quotaExceeded,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================
// pancetta-92104: POST /documents/:docId/retry-ocr
//
// Admin-only: reset a single doc's `ocr_attempted_at` and `ocr_attempt_count`
// so it becomes a candidate again on the next backfill call. Useful for
// un-sticking docs that hit the 3-attempt cap once the underlying OpenAI
// quota issue is resolved (or to retry a one-off failure manually).
//
// If `runNow` is true (default), also re-runs analyzeReceipt synchronously
// and stamps the result. Otherwise just clears the counters and the doc
// gets picked up by the next backfill batch.
//
// Returns:
//   { document: <updated row> }
// ============================================
router.post(
  '/documents/:docId/retry-ocr',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { docId } = req.params;
      const body = (req.body || {}) as { runNow?: unknown };
      const runNow = body.runNow === undefined ? true : Boolean(body.runNow);

      const existing = await prisma.payoutDocument.findUnique({
        where: { id: docId },
        select: { id: true, url: true, kind: true, party: { select: { country: true } } },
      });
      if (!existing) {
        throw new AppError('Document not found', 404, 'NOT_FOUND');
      }

      // Always clear the cooldown + counter first so the next backfill
      // call (whether we run inline below or not) will pick this row up.
      await prisma.payoutDocument.update({
        where: { id: docId },
        data: {
          ocrAttemptedAt: null,
          ocrAttemptCount: 0,
          ocrError: null,
        },
      });

      let ranInline = false;
      let inlineError: string | null = null;

      if (runNow && existing.kind === 'receipt' && existing.url) {
        const { analyzeReceipt } = await import('../services/ocr.service.js');
        const { convertToUSD } = await import('../services/fx.service.js');
        try {
          // crescenza-92110: a full fresh re-read — amount + currency + line
          // items — not just line items. Mirror the ocr-preview FX pattern in
          // payout.routes.ts so the unresolved-currency case is handled
          // identically (CURRENCY_UNRESOLVED, no synthetic USD value).
          // crescenza-92110: pass the party country prior (same as ocr-preview)
          // so ambiguous-currency receipts (e.g. EGP) resolve instead of
          // nulling the amount with CURRENCY_UNRESOLVED.
          const result = await analyzeReceipt({
            imageUrl: existing.url,
            partyCountry: existing.party?.country ?? null,
          });
          const fx = await convertToUSD(result.amount, result.currency);
          const unresolved = fx.source === 'unresolved';
          await prisma.payoutDocument.update({
            where: { id: docId },
            data: {
              ocrLineItems: (result.lineItems ?? []) as unknown as Prisma.InputJsonValue,
              ocrConfidence: new Decimal(result.confidence),
              ocrRaw: { ocr: result.raw, fx: { source: fx.source, rate: fx.exchangeRate } } as Prisma.InputJsonValue,
              // Even unresolved rows keep originalAmount — the admin needs to
              // see what the receipt said so they can pick the right currency.
              originalAmount: new Decimal(fx.originalAmount),
              ocrAmount: unresolved ? null : new Decimal(fx.usdAmount!),
              ocrCurrency: unresolved ? null : fx.originalCurrency,
              exchangeRate: unresolved
                ? null
                : (fx.exchangeRate != null ? new Decimal(fx.exchangeRate) : null),
              ocrError: unresolved ? 'CURRENCY_UNRESOLVED' : null,
              ocrAttemptedAt: new Date(),
              ocrAttemptCount: { increment: 1 },
            },
          });
          ranInline = true;
        } catch (err: any) {
          inlineError = err?.message ? String(err.message) : String(err);
          await prisma.payoutDocument.update({
            where: { id: docId },
            data: {
              ocrAttemptedAt: new Date(),
              ocrAttemptCount: { increment: 1 },
              ocrError: inlineError.slice(0, 500),
            },
          });
        }
      }

      const updated = await prisma.payoutDocument.findUnique({
        where: { id: docId },
        select: {
          id: true,
          kind: true,
          url: true,
          fileName: true,
          ocrAmount: true,
          ocrCurrency: true,
          ocrConfidence: true,
          originalAmount: true,
          originalCurrency: true,
          exchangeRate: true,
          ocrError: true,
          ocrAttemptedAt: true,
          ocrAttemptCount: true,
          ocrLineItems: true,
          sortOrder: true,
        },
      });

      res.json({
        document: updated && {
          id: updated.id,
          kind: updated.kind,
          url: updated.url,
          fileName: updated.fileName,
          ocrAmount: updated.ocrAmount == null ? null : Number(updated.ocrAmount),
          ocrCurrency: updated.ocrCurrency,
          ocrConfidence:
            updated.ocrConfidence == null ? null : Number(updated.ocrConfidence),
          originalAmount:
            updated.originalAmount == null ? null : Number(updated.originalAmount),
          originalCurrency: updated.originalCurrency,
          exchangeRate:
            updated.exchangeRate == null ? null : Number(updated.exchangeRate),
          ocrError: updated.ocrError,
          ocrAttemptedAt: updated.ocrAttemptedAt
            ? updated.ocrAttemptedAt.toISOString()
            : null,
          ocrAttemptCount: updated.ocrAttemptCount,
          ocrLineItems: Array.isArray(updated.ocrLineItems)
            ? updated.ocrLineItems
            : null,
          sortOrder: updated.sortOrder,
        },
        ranInline,
        inlineError,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================
// crocchetta-92106 + crocchetta-92107: Telegram receipts reminder.
//
// Sends a Telegram nudge via the Molto Benny bot (`TELEGRAM_BOT_TOKEN`) to:
//   1. The host's private DM, using `parties.host_telegram_chat_id` — set
//      when the host links Telegram via the `/start <token>` deeplink (see
//      backend/src/routes/telegram-webhook.routes.ts). When null, the host
//      DM is silently skipped and `hostDmSent=false` with a reason returned
//      to the caller.
//   2. The city's Telegram group chat — chat_id passed in the request body
//      as `groupChatId`, resolved client-side from the same GPP sheet that
//      powers the /underboss broadcast tooling (`fetchSheetCities` →
//      `SheetCity.groupId`). When the party's city has no group_id on file,
//      the frontend omits the field and the backend skips the group post
//      with `groupReason: 'no city TG group set'`. This mirrors the
//      per-row chat_id pattern used by /api/telegram/broadcast — the
//      backend never fetches the sheet itself.
//
// Both messages carry the same body:
//   "Make sure you've uploaded receipts and photos to rsv.pizza/<custom_url>"
//
// No DB writes — we surface success/failure per channel in the response and
// emit a single console line with the `[crocchetta-92106][tg-reminder]`
// marker for grep-driven audit recovery.
//
// Auth: admin / super_admin / payment_admin via
// `requireAnyAdminOrPaymentAdmin` — same gate as the other by-city actions
// (Mark party paid, Send payment, Flag scam). Regional underbosses don't see
// the menu item.
// ============================================

async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const body = await resp.text();
        detail = body.slice(0, 200);
      } catch {
        // ignore — surface just the status
      }
      return {
        ok: false,
        reason: `Telegram API returned ${resp.status}${detail ? `: ${detail}` : ''}`,
      };
    }
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      reason: `Telegram fetch failed: ${err?.message || String(err)}`,
    };
  }
}

router.post(
  '/:partyId/tg-receipts-reminder',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;

      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: {
          id: true,
          customUrl: true,
          inviteCode: true,
          name: true,
          hostTelegramChatId: true,
        },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }

      // Prefer custom_url for the public link; fall back to invite_code so
      // the URL always resolves even on parties without a custom slug.
      const slug = party.customUrl || party.inviteCode;
      const text = `Make sure you've uploaded receipts and photos to rsv.pizza/${slug}`;

      // Host DM — only when the party has a linked Telegram chat id.
      let hostDmSent = false;
      let hostDmReason: string | undefined;
      if (party.hostTelegramChatId) {
        const result = await sendTelegramMessage(
          party.hostTelegramChatId.toString(),
          text,
        );
        if (result.ok) {
          hostDmSent = true;
        } else {
          hostDmReason = result.reason;
        }
      } else {
        hostDmReason = 'Host has not linked Telegram (no host_telegram_chat_id on file)';
      }

      // Group chat — per-city chat_id supplied by the caller. The frontend
      // resolves it from the GPP sheet (`SheetCity.groupId`) using the same
      // city→chat_id map that /underboss uses for its broadcast tooling. We
      // intentionally don't fetch the sheet from the backend; mirrors the
      // `/api/telegram/broadcast` contract where the client supplies chatIds.
      const rawGroupChatId =
        typeof req.body?.groupChatId === 'string' ? req.body.groupChatId.trim() : '';
      let groupSent = false;
      let groupReason: string | undefined;
      if (rawGroupChatId) {
        const result = await sendTelegramMessage(rawGroupChatId, text);
        if (result.ok) {
          groupSent = true;
        } else {
          groupReason = result.reason;
        }
      } else {
        groupReason = 'no city TG group set';
      }

      // Record when the reminder was sent (if at least one message succeeded).
      if (hostDmSent || groupSent) {
        await prisma.party.update({
          where: { id: partyId },
          data: { receiptsReminderSentAt: new Date() },
        });
      }

      // Grep-marker audit line. Includes party id, slug, and per-channel
      // outcome so post-hoc recovery is one `vercel logs | grep` away.
      console.log(
        `[crocchetta-92106][tg-reminder] party=${party.id} slug=${slug} host_dm=${
          hostDmSent ? 'ok' : `skipped:${hostDmReason ?? 'unknown'}`
        } group=${groupSent ? 'ok' : `skipped:${groupReason ?? 'unknown'}`}`,
      );

      res.json({
        hostDmSent,
        ...(hostDmReason ? { hostDmReason } : {}),
        groupSent,
        ...(groupReason ? { groupReason } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /:partyId/tg-wallet-reminder
//
// Sibling of tg-receipts-reminder: DMs the primary host (when their Telegram
// is linked) and posts to the city's GPP group chat, telling the host to
// submit their payout wallet address on the host page's Payments tab. Same
// per-channel send + skip-reason contract; the only differences are the
// message text + target URL. We don't persist a "sent at" timestamp for this
// one (no DB column), so unlike receipts there's no last-sent sub-label.
router.post(
  '/:partyId/tg-wallet-reminder',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;

      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: {
          id: true,
          customUrl: true,
          inviteCode: true,
          name: true,
          hostTelegramChatId: true,
        },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }

      const slug = party.customUrl || party.inviteCode;
      const text = `Please submit your payout wallet address so we can reimburse you: rsv.pizza/host/${slug}/payments`;

      let hostDmSent = false;
      let hostDmReason: string | undefined;
      if (party.hostTelegramChatId) {
        const result = await sendTelegramMessage(
          party.hostTelegramChatId.toString(),
          text,
        );
        if (result.ok) {
          hostDmSent = true;
        } else {
          hostDmReason = result.reason;
        }
      } else {
        hostDmReason = 'Host has not linked Telegram (no host_telegram_chat_id on file)';
      }

      const rawGroupChatId =
        typeof req.body?.groupChatId === 'string' ? req.body.groupChatId.trim() : '';
      let groupSent = false;
      let groupReason: string | undefined;
      if (rawGroupChatId) {
        const result = await sendTelegramMessage(rawGroupChatId, text);
        if (result.ok) {
          groupSent = true;
        } else {
          groupReason = result.reason;
        }
      } else {
        groupReason = 'no city TG group set';
      }

      console.log(
        `[tg-wallet-reminder] party=${party.id} slug=${slug} host_dm=${
          hostDmSent ? 'ok' : `skipped:${hostDmReason ?? 'unknown'}`
        } group=${groupSent ? 'ok' : `skipped:${groupReason ?? 'unknown'}`}`,
      );

      res.json({
        hostDmSent,
        ...(hostDmReason ? { hostDmReason } : {}),
        groupSent,
        ...(groupReason ? { groupReason } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================
// City-level payment approval. Admin can approve a total amount for the party
// before sending payment. Shows as a thumbs-up button to the left of Send.
// ============================================

/**
 * POST /api/admin/payouts/:partyId/approve-city
 *
 * Body: { amountUsd: number } — the approved total for this city.
 *       Send amountUsd: null to clear the approval.
 *
 * Records who approved and when. The frontend shows a filled thumbs-up icon
 * when approved and includes the approved amount in the Send Payment modal.
 */
router.post(
  '/:partyId/approve-city',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const { amountUsd } = req.body ?? {};

      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: { id: true, name: true },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }

      // Clear approval when amountUsd is null/undefined.
      const clearing = amountUsd == null;
      const updated = await prisma.party.update({
        where: { id: partyId },
        data: clearing
          ? {
              paymentsApprovedUsd: null,
              paymentsApprovedAt: null,
              paymentsApprovedBy: null,
            }
          : {
              paymentsApprovedUsd: Number(amountUsd),
              paymentsApprovedAt: new Date(),
              paymentsApprovedBy: req.userId,
            },
        select: {
          id: true,
          name: true,
          paymentsApprovedUsd: true,
          paymentsApprovedAt: true,
        },
      });

      console.log(
        `[approve-city] party=${party.id} name="${party.name}" amount=${
          clearing ? 'cleared' : amountUsd
        } by=${req.userId}`,
      );

      res.json({
        partyId: updated.id,
        partyName: updated.name,
        paymentsApprovedUsd: updated.paymentsApprovedUsd
          ? Number(updated.paymentsApprovedUsd)
          : null,
        paymentsApprovedAt: updated.paymentsApprovedAt
          ? updated.paymentsApprovedAt.toISOString()
          : null,
      });
    } catch (err) {
      next(err);
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

// ============================================
// panettone-92103: party-level "mark party paid" bulk action.
//
// Exported as a separate Router (mounted at `/api/admin/parties` in
// `index.ts`) so the URL is `POST /api/admin/parties/:partyId/mark-paid`.
// Lives in this file to share the existing actor / audit / serialization
// helpers with the rest of the admin-payout surface.
//
// Use case: admin paid the host the full amount out-of-band (Venmo, bank
// wire, etc.) and wants to close out every in-flight payout for that party
// in one click instead of clicking through each row.
//
// Auth: admin / super_admin / payment_admin (`requireAnyAdminOrPaymentAdmin`).
// Regional underbosses are NOT allowed — funds-acknowledgement counts as a
// funds-sending mutation, same gate as `mark-paid` / `execute`.
// ============================================
export const partyMarkPaidRouter = Router();

const ALLOWED_MARK_PAID_METHODS = ['mercury_card', 'wire', 'usdc_base', 'external'] as const;

/**
 * GET /api/admin/parties/:partyId/mark-paid-preview
 *
 * Returns the in-flight (pending + approved) payout list + count + total for
 * a party, so the MarkPartyPaidModal can render the impact summary before the
 * admin confirms. Read-only; no mutations.
 */
partyMarkPaidRouter.get(
  '/:partyId/mark-paid-preview',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: {
          id: true,
          name: true,
          // pinsa-92103: surface so the modal can branch into close-out mode
          // when there's nothing in-flight but the city still needs a "done"
          // signal (e.g. Ekiti / Tangier — all rows already paid).
          paymentsClosedAt: true,
        },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }

      const payouts = await prisma.payout.findMany({
        where: {
          partyId,
          // gnocchi-92104: 'queued' (wire-request-sent, awaiting settlement) is
          // in-flight too — Mark Party Paid should be able to roll it forward
          // to 'paid' alongside pending + approved when the admin confirms the
          // settlement out-of-band.
          status: { in: ['pending', 'approved', 'queued'] },
        },
        select: {
          id: true,
          status: true,
          finalAmountUsd: true,
          payoutMethod: true,
          host: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const totalUsd = payouts.reduce(
        (sum, p) => sum + Number(p.finalAmountUsd),
        0,
      );

      // caciotta-92103 + pinsa-92103: surface the already-paid payouts on this
      // party. Caciotta uses count + sum to warn the modal about
      // double-counting (and to pick suggestedMode). Pinsa uses the same data
      // for the close-out body copy ("Existing paid records (N payments,
      // $X.XX total) stay unchanged") and the `eligible` flag that drives
      // Mark Paid button visibility in the by-city table.
      const paidAgg = await prisma.payout.aggregate({
        where: { partyId, status: 'paid' },
        _count: { _all: true },
        _sum: { finalAmountUsd: true },
      });
      const paidCount = paidAgg._count?._all ?? 0;
      const paidTotalUsd = Number(paidAgg._sum?.finalAmountUsd ?? 0);
      // caciotta-92103 aliases — same data, surfaced under the field names the
      // existing modal already reads.
      const existingPaidCount = paidCount;
      const existingPaidUsd = paidTotalUsd;

      // caciotta-92103 + provolone-92103: recommend `mark_pending_complete`
      // when the city has ANY existing paid amount — Snax's directive is that
      // "marked paid" should default to "this is everything the city will
      // receive; close out the in-flight claims as completed (not withdrawn)."
      // Otherwise `mark_paid` (the legacy "create new paid rows" behavior).
      const suggestedMode: 'mark_paid' | 'mark_pending_complete' =
        existingPaidCount > 0 && existingPaidUsd >= totalUsd
          ? 'mark_pending_complete'
          : 'mark_paid';

      const paymentsClosedAt = party.paymentsClosedAt
        ? party.paymentsClosedAt.toISOString()
        : null;

      // pinsa-92103: the by-city table uses `eligible` to decide whether to
      // render the Mark Paid button. True when there's work to do (anything
      // in-flight) OR when the city has paid history but no close stamp
      // (Ekiti / Tangier). Cities with no payouts at all stay ineligible —
      // there's nothing to close.
      const eligible = payouts.length > 0 || (paymentsClosedAt === null && paidCount > 0);

      res.json({
        party: { id: party.id, name: party.name, paymentsClosedAt },
        count: payouts.length,
        totalUsd,
        existingPaidCount,
        existingPaidUsd,
        suggestedMode,
        paidCount,
        paidTotalUsd,
        paymentsClosedAt,
        eligible,
        payouts: payouts.map((p) => ({
          id: p.id,
          status: p.status,
          finalAmountUsd: Number(p.finalAmountUsd),
          payoutMethod: p.payoutMethod ?? null,
          hostName: p.host?.name ?? null,
          hostEmail: p.host?.email ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/admin/parties/:partyId/mark-paid
 *
 * Body:
 *   {
 *     mode?: 'mark_paid' | 'mark_pending_complete' | 'withdraw_pending' | 'auto';
 *                          // caciotta-92103 + provolone-92103: how to close
 *                          // out the in-flight rows.
 *                          //   'mark_paid' — legacy behavior: every pending
 *                          //     + approved row flips to status='paid'.
 *                          //     Creates new paid amounts on /payments.
 *                          //   'mark_pending_complete' (provolone-92103) —
 *                          //     flips pending + approved rows to
 *                          //     status='completed'. Means "the city was
 *                          //     fully paid by the org, even if the org paid
 *                          //     less than the claim amount; this row's
 *                          //     payment obligation is fulfilled." Receipts
 *                          //     stay attached to the party.
 *                          //   'withdraw_pending' (deprecated, kept for
 *                          //     backward-compat during rolling deploy) —
 *                          //     same as 'mark_pending_complete' (aliased).
 *                          //   'auto' (default) — picks
 *                          //     'mark_pending_complete' when the party
 *                          //     already has paid payouts whose sum >= the
 *                          //     pending+approved being acted on; else
 *                          //     'mark_paid'. Prevents double-counting
 *                          //     external payments.
 *     note?: string;       // shared admin note appended (with timestamp) to
 *                          // each payout's admin_notes; also written to
 *                          // payout_audit.note
 *     paidMethod?: 'mercury_card' | 'wire' | 'usdc_base' | 'external';
 *                          // optional; if set, stamps payout_method on each
 *                          // row ONLY when currently null. Existing methods
 *                          // are preserved so we don't lie about how an
 *                          // already-routed payout was paid. Only relevant
 *                          // for 'mark_paid' — ignored for
 *                          // 'mark_pending_complete'.
 *   }
 *
 * Atomic via `prisma.$transaction`. For each in-flight payout on the party:
 *
 *   mode='mark_paid':
 *     1. status -> 'paid'
 *     2. paid_at -> now()
 *     3. admin_notes: append "[YYYY-MM-DDTHH:MM:SS] <note>" on a new line
 *        preserving any existing notes; no-op when note is missing/blank.
 *     4. payout_method: set to `paidMethod` ONLY IF currently null. (External
 *        payouts that had no on-platform method get stamped; existing methods
 *        are left untouched.)
 *     5. payout_audit row with action='mark_paid', old_status, new_status='paid'.
 *
 *   mode='mark_pending_complete' (provolone-92103):
 *     1. status -> 'completed'
 *     2. paid_at / payout_method UNCHANGED — the row was never actually paid
 *        by us directly; the city was paid in full by some other means and
 *        this claim is being closed out as part of that completion.
 *     3. admin_notes: append "[YYYY-MM-DDTHH:MM:SS] Marked complete via Mark
 *        Party Paid; city fully paid; <note>" on a new line.
 *     4. payout_audit row with action='mark_paid' (the closest valid action
 *        in the check constraint), old_status, new_status='completed'.
 *
 * Returns `{ count, mode, party: { id, name }, payoutIds }`. count=0 with
 * HTTP 200 when there are no in-flight payouts to flip — not an error.
 * `mode` is the resolved mode (auto -> mark_paid or mark_pending_complete) so
 * the frontend can render the correct success toast.
 */
partyMarkPaidRouter.post(
  '/:partyId/mark-paid',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const actor = await loadActor(req);

      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: {
          id: true,
          name: true,
          // pinsa-92103: needed so we don't double-stamp paymentsClosedAt
          // on a city that's already marked closed.
          paymentsClosedAt: true,
        },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }

      const body = req.body || {};
      const note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
      const paidMethod =
        typeof body.paidMethod === 'string' && body.paidMethod.trim()
          ? body.paidMethod.trim()
          : null;
      if (paidMethod && !ALLOWED_MARK_PAID_METHODS.includes(paidMethod as any)) {
        throw new AppError('Invalid paidMethod', 400, 'VALIDATION_ERROR');
      }
      // 'external' isn't a stored payoutMethod enum value — it's the modal's
      // "leave unchanged / off-platform" sentinel. Treat it as "don't stamp
      // a method" rather than persisting the literal string.
      const methodToStamp = paidMethod && paidMethod !== 'external' ? paidMethod : null;

      // caciotta-92103 + provolone-92103: mode selector. Default 'auto' picks
      // mark_pending_complete when the party already has enough paid rows to
      // cover the in-flight sum (prevents double-counting after an external
      // payment was recorded). Otherwise it falls through to the legacy
      // mark_paid path.
      //
      // 'withdraw_pending' is accepted as a legacy alias for
      // 'mark_pending_complete' so a rolling deploy doesn't 400 stale
      // frontends.
      const rawMode = typeof body.mode === 'string' ? body.mode.trim() : 'auto';
      if (!['mark_paid', 'mark_pending_complete', 'withdraw_pending', 'auto'].includes(rawMode)) {
        throw new AppError('Invalid mode', 400, 'VALIDATION_ERROR');
      }
      const requestedMode =
        rawMode === 'withdraw_pending'
          ? ('mark_pending_complete' as const)
          : (rawMode as 'mark_paid' | 'mark_pending_complete' | 'auto');

      // Find all in-flight payouts BEFORE the transaction so we can do per-row
      // self-payout checks + log a clean count even if zero match.
      // gnocchi-92104: 'queued' (wire-request-sent, awaiting settlement) is
      // in-flight too — Mark Party Paid flips it forward along with the
      // pending/approved rows.
      const inflight = await prisma.payout.findMany({
        where: {
          partyId,
          status: { in: ['pending', 'approved', 'queued'] },
        },
        select: {
          id: true,
          status: true,
          hostUserId: true,
          adminNotes: true,
          payoutMethod: true,
          finalAmountUsd: true,
          // pancetta-49350: proof fields surface so paidRowHasProof(p) can be
          // evaluated per in-flight row. Rows WITHOUT payment proof are closed
          // out as 'withdrawn' (not 'completed') so never-sent claims don't
          // inflate a city's Paid total.
          transactionHash: true,
          wireReference: true,
          mercuryCardLast4: true,
          mercuryCardId: true,
          externalProofUrl: true,
        },
      });

      // Resolve 'auto' to a concrete mode. Even at count=0 we resolve so the
      // response carries a meaningful `mode` value.
      let resolvedMode: 'mark_paid' | 'mark_pending_complete';
      if (requestedMode === 'auto') {
        const inflightUsd = inflight.reduce(
          (sum, p) => sum + Number(p.finalAmountUsd),
          0,
        );
        // prosciutto-92106: only count proven-paid rows when deciding
        // whether the city is already "covered." Zombie status='paid' rows
        // without proof shouldn't trigger the mark_pending_complete branch.
        const existingPaid = await prisma.payout.findMany({
          where: {
            partyId,
            status: 'paid',
            AND: PAID_HAS_PROOF_WHERE,
          },
          select: { finalAmountUsd: true },
        });
        const existingPaidUsd = existingPaid.reduce(
          (sum, p) => sum + Number(p.finalAmountUsd),
          0,
        );
        resolvedMode =
          existingPaid.length > 0 && existingPaidUsd >= inflightUsd
            ? 'mark_pending_complete'
            : 'mark_paid';
      } else {
        resolvedMode = requestedMode;
      }

      if (inflight.length === 0) {
        // pinsa-92103: nothing in-flight. If the city has any paid rows AND
        // isn't already marked closed, treat this as a close-out: stamp
        // payments_closed_at and return `action: 'closed'` so the modal can
        // flash the right toast. Cities with no payouts at all stay
        // unchanged — there's nothing to close.
        // prosciutto-92106: also count `completed` rows here — the
        // mark_paid bookkeeping mode now writes 'completed' instead of
        // 'paid' so the "has any settled rows" check must include both.
        const paidCount = await prisma.payout.count({
          where: { partyId, status: { in: ['paid', 'completed'] } },
        });

        if (paidCount > 0 && !party.paymentsClosedAt) {
          const closedAt = new Date();
          const updated = await prisma.party.update({
            where: { id: partyId },
            data: { paymentsClosedAt: closedAt },
            select: { id: true, name: true, paymentsClosedAt: true },
          });
          res.json({
            count: 0,
            party: {
              id: updated.id,
              name: updated.name,
              paymentsClosedAt: updated.paymentsClosedAt
                ? updated.paymentsClosedAt.toISOString()
                : null,
            },
            payoutIds: [],
            action: 'closed',
          });
          return;
        }

        // Either no paid rows at all, or already-closed — no-op. Surface the
        // current close timestamp so the frontend can refresh its UI either
        // way.
        res.json({
          count: 0,
          mode: resolvedMode,
          party: {
            id: party.id,
            name: party.name,
            paymentsClosedAt: party.paymentsClosedAt
              ? party.paymentsClosedAt.toISOString()
              : null,
          },
          payoutIds: [],
          action: party.paymentsClosedAt ? 'already_closed' : 'noop',
        });
        return;
      }

      // Self-payout guard — payment_admin actors can't mark their own row
      // paid. Even one self-row in the batch aborts the whole operation
      // (atomic semantics; safer than silently skipping one row).
      // Applies to both modes: mark_pending_complete of one's own pending row
      // is a permission concern too (a payment_admin shouldn't close out
      // their own claim without a second pair of eyes).
      for (const p of inflight) {
        assertNotSelfPayout(actor, p.hostUserId);
      }

      const now = new Date();
      const noteTimestamp = now.toISOString();
      const updatedIds: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const p of inflight) {
          // Preserve existing admin_notes, append the bulk note with a
          // timestamp on its own line so the trail is readable. For the
          // mark_pending_complete path (provolone-92103) we prefix the note
          // so the audit trail makes clear *why* a pending row was closed
          // out (vs a host self-withdraw via ravioli-82931's DELETE
          // endpoint).
          // pancetta-49350: "without an associated transaction" is interpreted
          // as "without any payment proof" — using the SAME definition as the
          // paidRowHasProof() helper (transaction_hash OR wire_reference OR
          // mercury_card_last4/id OR external_proof_url, keyed on payoutMethod).
          // So a genuinely wire/mercury/usdc/externally-paid in-flight row is
          // closed out as 'completed' (counts as Paid), while a never-sent row
          // is set to 'withdrawn' (does NOT count as Paid). Receipts
          // (payout_documents) are NEVER touched in either branch.
          const hasProof = paidRowHasProof(p);

          let nextAdminNotes: string | null | undefined = undefined;
          const noteBody = !hasProof
            ? `Marked-complete sweep: no payment proof — withdrawn (not counted as paid). Receipts retained.${note ? `; ${note}` : ''}`
            : resolvedMode === 'mark_pending_complete'
              ? `Marked complete via Mark Party Paid; city fully paid${note ? `; ${note}` : ''}`
              : note;
          if (noteBody) {
            const existing = p.adminNotes && p.adminNotes.trim() ? p.adminNotes : '';
            const appended = `[${noteTimestamp}] ${noteBody}`;
            nextAdminNotes = existing
              ? `${existing}\n${appended}`
              : appended;
          }

          if (!hasProof) {
            // pancetta-49350: no payment proof on this in-flight row. The city
            // is being marked complete, but money was never actually sent for
            // this claim — so close it out as 'withdrawn' instead of
            // 'completed'. 'withdrawn' is excluded from Paid totals (see the
            // status bucketing earlier in this file), preventing never-sent
            // rows from inflating a city's Paid figure.
            //
            // Do NOT touch paid_at, payout_method, or any payout_documents —
            // the host's uploaded receipts stay attached and visible in the
            // receipts library.
            const data: any = {
              status: 'withdrawn',
            };
            if (nextAdminNotes !== undefined) {
              data.adminNotes = nextAdminNotes;
            }

            await tx.payout.update({
              where: { id: p.id },
              data,
            });

            // 'cancel' is the valid payout_audit action for a -> 'withdrawn'
            // transition: the host self-withdraw flow (ravioli-82931, in
            // payout.routes.ts) documents that 'withdraw' is NOT in the action
            // CHECK constraint and uses 'cancel' for exactly this transition.
            // newStatus carries the real target ('withdrawn').
            await tx.payoutAudit.create({
              data: {
                payoutId: p.id,
                action: 'cancel',
                oldStatus: p.status,
                newStatus: 'withdrawn',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: noteBody,
              },
            });
          } else if (resolvedMode === 'mark_paid') {
            // Only stamp payoutMethod when (a) admin supplied one AND (b) the
            // row currently has none. Preserves the truth of how routed rows
            // were originally configured.
            const shouldStampMethod = !!methodToStamp && !p.payoutMethod;

            // prosciutto-92106: the bulk Mark Party Paid flow doesn't take
            // per-row proof in the body — it's a bulk bookkeeping action. To
            // avoid creating zombie status='paid' rows that inflate the Paid
            // KPI tile without proof, we now write 'completed' for this mode
            // too (matching mark_pending_complete semantically). The audit
            // row preserves the legacy 'mark_paid' action so existing log
            // filters keep working. paidAt is still stamped so the
            // close-out timestamp on the row reflects the action time.
            const data: any = {
              status: 'completed',
              paidAt: now,
            };
            if (nextAdminNotes !== undefined) {
              data.adminNotes = nextAdminNotes;
            }
            if (shouldStampMethod) {
              data.payoutMethod = methodToStamp;
            }

            await tx.payout.update({
              where: { id: p.id },
              data,
            });

            await tx.payoutAudit.create({
              data: {
                payoutId: p.id,
                action: 'mark_paid',
                oldStatus: p.status,
                // prosciutto-92106: was 'paid' — now 'completed' to match the
                // bookkeeping intent. See the data block comment above.
                newStatus: 'completed',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: note,
              },
            });
          } else {
            // resolvedMode === 'mark_pending_complete' (provolone-92103)
            // Flip to status='completed' — a terminal "city was paid in full
            // by the org, this row's payment obligation is fulfilled" signal.
            // Don't touch paid_at or payout_method — this isn't a direct
            // paid record; the city's payment landed via some other means
            // and this claim is being closed out as complete.
            const data: any = {
              status: 'completed',
            };
            if (nextAdminNotes !== undefined) {
              data.adminNotes = nextAdminNotes;
            }

            await tx.payout.update({
              where: { id: p.id },
              data,
            });

            // 'mark_paid' is the closest valid action enum value for
            // closing a row out as completed; the new_status field carries
            // the actual transition target. Adding 'mark_complete' to the
            // CHECK enum would require a separate migration — defer until
            // we have a reason to filter the audit log by it.
            await tx.payoutAudit.create({
              data: {
                payoutId: p.id,
                action: 'mark_paid',
                oldStatus: p.status,
                newStatus: 'completed',
                actorEmail: actor.email,
                actorKind: actor.actorKind,
                note: noteBody,
              },
            });
          }

          updatedIds.push(p.id);
        }

        // pinsa-92103 + caciotta-92103 + provolone-92103: when this run leaves
        // nothing in-flight, auto-stamp paymentsClosedAt. Skip if already
        // closed. We re-query inside the tx so the check is atomic with the
        // status flips.
        //
        // For mark_paid: every flipped row is now 'paid', so the city has
        // paid history by construction — safe to close.
        // For mark_pending_complete: the flipped rows are 'completed', which
        // itself is a terminal close-out signal — also safe to close. (The
        // semantic guard "never close a city with zero real payments" is
        // preserved by the fact that the admin is taking an explicit
        // close-out action.)
        if (!party.paymentsClosedAt && updatedIds.length > 0) {
          // gnocchi-92104: include 'queued' in the in-flight check so a city
          // with a pending wire settlement isn't prematurely closed.
          const remainingInflight = await tx.payout.count({
            where: { partyId, status: { in: ['pending', 'approved', 'queued'] } },
          });
          if (remainingInflight === 0) {
            await tx.party.update({
              where: { id: partyId },
              data: { paymentsClosedAt: now },
            });
          }
        }
      });

      // Re-read so the response surfaces the (possibly newly stamped)
      // paymentsClosedAt. Cheap follow-up read — one indexed pkey lookup.
      const finalParty = await prisma.party.findUnique({
        where: { id: partyId },
        select: { id: true, name: true, paymentsClosedAt: true },
      });

      res.json({
        count: updatedIds.length,
        mode: resolvedMode,
        party: {
          id: party.id,
          name: party.name,
          paymentsClosedAt: finalParty?.paymentsClosedAt
            ? finalParty.paymentsClosedAt.toISOString()
            : null,
        },
        payoutIds: updatedIds,
        // caciotta-92103 + provolone-92103: action mirrors the resolved mode
        // so the frontend doesn't have to infer it. 'mark_pending_complete'
        // is its own action value distinct from pinsa's
        // 'closed'/'already_closed'/'noop'.
        action: resolvedMode === 'mark_pending_complete' ? 'mark_pending_complete' : 'mark_paid',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================
// POST /api/admin/parties/:partyId/reopen
//
// Undo an accidental city close. Clears `payments_closed_at` and reverts the
// payouts the close flipped to `completed` back to their pre-close status.
//
// The `mark_pending_complete` path of Mark Party Paid stamps the close
// timestamp AND flips pending/approved/queued rows to `completed` in one
// transaction, so a clean undo has to do both. We identify which rows the close
// touched by their most-recent `new_status='completed'` audit landing at/after
// `payments_closed_at`, and restore each to that audit's `old_status`. Rows
// that became `completed` in an EARLIER action (before this close) are left
// untouched — they weren't part of the mistake.
//
// A pure close-out (no in-flight rows, just a stamped timestamp) reverts
// nothing — only the timestamp is cleared.
//
// Idempotent: 400 NOT_CLOSED if the city isn't currently closed.
// ============================================
partyMarkPaidRouter.post(
  '/:partyId/reopen',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const actor = await loadActor(req);

      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: { id: true, name: true, paymentsClosedAt: true },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }
      if (!party.paymentsClosedAt) {
        throw new AppError('City is not closed', 400, 'NOT_CLOSED');
      }
      const closedAt = party.paymentsClosedAt;

      const body = req.body || {};
      const note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

      const reopenedIds: string[] = [];
      await prisma.$transaction(async (tx) => {
        const completed = await tx.payout.findMany({
          where: { partyId, status: 'completed' },
          select: { id: true },
        });
        for (const p of completed) {
          // The transition INTO 'completed' carries the pre-close status in
          // its old_status. Only undo rows the close itself flipped (audit
          // at/after the close stamp); skip rows completed in an earlier pass.
          const lastComplete = await tx.payoutAudit.findFirst({
            where: { payoutId: p.id, newStatus: 'completed' },
            orderBy: { createdAt: 'desc' },
            select: { oldStatus: true, createdAt: true },
          });
          if (!lastComplete || lastComplete.createdAt < closedAt) continue;
          const restoreTo = lastComplete.oldStatus || 'approved';
          await tx.payout.update({
            where: { id: p.id },
            data: { status: restoreTo },
          });
          await tx.payoutAudit.create({
            data: {
              payoutId: p.id,
              action: 'unmark_paid',
              oldStatus: 'completed',
              newStatus: restoreTo,
              actorEmail: actor.email,
              actorKind: actor.actorKind,
              note: note
                ? `Reopened city; ${note}`
                : 'Reopened city — reverted completed close-out to pre-close status',
            },
          });
          reopenedIds.push(p.id);
        }

        await tx.party.update({
          where: { id: partyId },
          data: { paymentsClosedAt: null },
        });
      });

      res.json({
        party: { id: party.id, name: party.name, paymentsClosedAt: null },
        reopenedCount: reopenedIds.length,
        payoutIds: reopenedIds,
      });
    } catch (err) {
      next(err);
    }
  },
);
