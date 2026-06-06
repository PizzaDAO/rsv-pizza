/**
 * Host-facing payout routes (arugula-38633, PR 3/5).
 *
 * Mounted at `/api/parties`. Endpoints:
 *   POST   /:partyId/payouts                          Create a new payout request (with parallel OCR)
 *   GET    /:partyId/payouts                          List active payouts for a party (excludes withdrawn)
 *   GET    /:partyId/payouts/receipts-library         Submitter's receipts across all statuses incl. withdrawn (ravioli-82931)
 *   GET    /:partyId/payouts/:payoutId                Detail (host or any admin)
 *   PATCH  /:partyId/payouts/:payoutId                Update (host, while status='pending' only)
 *   DELETE /:partyId/payouts/:payoutId                Soft-withdraw — sets status='withdrawn' (ravioli-82931)
 *   POST   /:partyId/payouts/ocr-preview              OCR a single uploaded image without saving
 *
 * Admin execution + approval/rejection endpoints land in PR 4 / PR 5.
 */

import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isPaymentAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { analyzeReceipt } from '../services/ocr.service.js';
import { convertToUSD } from '../services/fx.service.js';
import { sanitizeForPg, sanitizePgString } from '../lib/sanitizePg.js';
import { looksLikeEnsName, resolveWalletInput, resolveWalletInputWithMeta } from '../services/ens.service.js';
import { isMercuryBlocked } from '../lib/mercuryBlockedCountries.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import {
  getLatestSubmittedTaxFormForUser,
  getYtdPayoutTotalUsd,
} from './tax-form.routes.js';
import { getPayoutCaps } from '../lib/privateConfig.js';

const router = Router();

// Path-scope auth on /:partyId/payouts ONLY. The router is mounted at
// /api/parties (alongside many sibling routers including partyRoutes after
// it), so an unconditioned `router.use(...)` here would gate every
// /api/parties/* request — which broke host guest approvals system-wide.
router.use('/:partyId/payouts', requireAuth);

// Aggressive rate limit on the OCR-preview endpoint to prevent OpenAI quota abuse.
// 20 calls/hour/user, keyed by userId (falls back to IP).
const ocrPreviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'OCR preview rate limit reached (20/hour). Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const auth = req as AuthRequest;
    return auth.userId || req.ip || 'unknown';
  },
});

// Valid payout methods (mirrors the CHECK constraint in the DB)
const PAYOUT_METHODS = ['mercury_card', 'wire', 'usdc_base'] as const;
type PayoutMethod = (typeof PAYOUT_METHODS)[number];

// gelato-72831: hosts can withdraw their own payment requests while the row is
// still in a non-terminal state. `pending` is the initial state; `approved`
// means an admin OK'd it but no money has moved yet (Mercury card not issued,
// USDC not sent, wire not initiated). Withdrawing an approved row is the
// host's only out when the admin approved a non-compliant amount (e.g.
// post-bocconcini-49102 cap recheck would now reject the row at execute time).
// `paid`, `rejected`, and `failed` remain terminal from the host side.
const WITHDRAWABLE_STATUSES = ['pending', 'approved'] as const;

// ---------- helpers ----------

/**
 * porchetta-58296: payout-submission readiness. Returns whether the event has
 * each of the three host-designated role photos (group / box_stack / pizza)
 * AND at least one receipt. Role photos must be dated after the event start
 * (party.date NULL ⇒ no cutoff, mirroring the photo-feed rule). Single
 * round-trip via per-role EXISTS + a receipt EXISTS on payout_documents.
 */
export async function getPayoutSubmissionReadiness(partyId: string) {
  const rows = await prisma.$queryRaw<{
    has_group: boolean;
    has_box: boolean;
    has_pizza: boolean;
    has_receipt: boolean;
  }[]>(Prisma.sql`
    WITH pa AS (SELECT date FROM parties WHERE id = ${partyId}::uuid)
    SELECT
      EXISTS (SELECT 1 FROM photos p, pa WHERE p.party_id = ${partyId}::uuid AND p.deleted_at IS NULL
                AND p.payout_role = 'group'     AND (pa.date IS NULL OR p.created_at >= pa.date)) AS has_group,
      EXISTS (SELECT 1 FROM photos p, pa WHERE p.party_id = ${partyId}::uuid AND p.deleted_at IS NULL
                AND p.payout_role = 'box_stack' AND (pa.date IS NULL OR p.created_at >= pa.date)) AS has_box,
      EXISTS (SELECT 1 FROM photos p, pa WHERE p.party_id = ${partyId}::uuid AND p.deleted_at IS NULL
                AND p.payout_role = 'pizza'     AND (pa.date IS NULL OR p.created_at >= pa.date)) AS has_pizza,
      EXISTS (SELECT 1 FROM payout_documents pd WHERE pd.party_id = ${partyId}::uuid AND pd.kind = 'receipt') AS has_receipt
  `);
  const row = rows[0];
  return {
    hasGroupPhoto: !!row?.has_group,
    hasBoxStackPhoto: !!row?.has_box,
    hasPizzaPhoto: !!row?.has_pizza,
    hasReceipt: !!row?.has_receipt,
  };
}

/**
 * Serialize a Prisma Payout (with optional documents) to the JSON shape the
 * frontend expects. Converts Decimal → number, Date → ISO string.
 */
function serializePayout(p: any) {
  return {
    id: p.id,
    partyId: p.partyId,
    hostUserId: p.hostUserId,
    // salumi-89172: surface the payout purpose + the optional kit it's tied
    // to so the host-side list can distinguish event reimbursements from
    // shipping-coordinator receipts.
    purpose: p.purpose ?? 'event',
    partyKitId: p.partyKitId ?? null,
    // pancetta-37195: surface the submitter so cohosts can tell who created
    // the payout. host is included via the prisma findUnique/findMany below.
    hostName: p.host?.name ?? null,
    hostEmail: p.host?.email ?? null,
    originalAmount: numberFromDecimal(p.originalAmount),
    originalCurrency: p.originalCurrency,
    exchangeRate: numberFromDecimal(p.exchangeRate),
    extractedAmountUsd: numberFromDecimal(p.extractedAmountUsd),
    finalAmountUsd: numberFromDecimal(p.finalAmountUsd),
    status: p.status,
    payoutMethod: p.payoutMethod,
    payoutWalletAddress: p.payoutWalletAddress ?? null,
    // caciotta-92104: original user input (ENS name) when the resolved 0x
    // came from ENS resolution. Null otherwise — frontend uses this to
    // render "name.eth -> 0xa1b2..." in admin views.
    payoutWalletInput: p.payoutWalletInput ?? null,
    payoutBankDetails: p.payoutBankDetails ?? null,
    mercuryCardId: p.mercuryCardId ?? null,
    mercuryCardLast4: p.mercuryCardLast4 ?? null,
    hostNotes: p.hostNotes ?? null,
    rejectionReason: p.rejectionReason ?? null,
    reviewedBy: p.reviewedBy ?? null,
    reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    transactionHash: p.transactionHash ?? null,
    wireReference: p.wireReference ?? null,
    externalProofUrl: p.externalProofUrl ?? null,
    // salame-92110: snapshot of the host's tax form at submission time.
    // Null on pre-feature payouts and on shipping-coordinator receipts.
    taxFormId: p.taxFormId ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    documents: Array.isArray(p.documents) ? p.documents.map(serializeDocument) : undefined,
  };
}

function serializeDocument(d: any) {
  return {
    id: d.id,
    kind: d.kind,
    url: d.url,
    fileName: d.fileName,
    fileSize: d.fileSize,
    mimeType: d.mimeType,
    ocrAmount: d.ocrAmount != null ? numberFromDecimal(d.ocrAmount) : null,
    ocrCurrency: d.ocrCurrency ?? null,
    ocrConfidence: d.ocrConfidence != null ? numberFromDecimal(d.ocrConfidence) : null,
    // mortadella-92103: per-receipt FX detail. Old rows have null for all
    // three (no migration backfill — the parent payout's headline FX is
    // still the source of truth for those).
    originalAmount: d.originalAmount != null ? numberFromDecimal(d.originalAmount) : null,
    originalCurrency: d.originalCurrency ?? null,
    exchangeRate: d.exchangeRate != null ? numberFromDecimal(d.exchangeRate) : null,
    ocrError: d.ocrError ?? null,
    sortOrder: d.sortOrder,
    // soppressata-92110: surface admin exclusion flags read-only so hosts can
    // see which receipts / OCR line items were excluded from their total.
    isDuplicate: d.isDuplicate ?? false,
    ineligible: d.ineligible ?? false,
    ocrLineItems: d.ocrLineItems ?? null,
    // pancetta-37195: surface the per-doc uploader so cohosts can tell who
    // attached each receipt/photo. Live name from the join; cached email is
    // the fallback if the User row is later deleted.
    uploadedByUserId: d.uploadedByUserId ?? null,
    uploadedByName: d.uploadedBy?.name ?? null,
    uploadedByEmail: d.uploadedByEmail ?? d.uploadedBy?.email ?? null,
  };
}

function numberFromDecimal(d: any): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d.toString());
}

/**
 * Validate that an image URL is a Supabase Storage URL in the `event-images`
 * bucket under `payouts/{partyId}/`. Prevents arbitrary-URL OCR-burning.
 *
 * Accepts both public-URL form
 *   https://<project>.supabase.co/storage/v1/object/public/event-images/payouts/<partyId>/...
 * and the raw object form too.
 */
/**
 * bocconcino-92104: receipts can now be PDFs. The OCR pipeline (gpt-4o
 * vision) is image-only, so for PDFs the frontend uploads a sibling
 * `.thumb.png` rendered client-side from page 1; we feed that to OCR.
 *
 * This helper returns the URL suitable for OCR consumption — the PNG thumb
 * for PDFs, or the canonical URL for images. The display logic uses the
 * same convention via `frontend/src/lib/pdfUtils.ts`.
 *
 * If the file is a PDF but no thumbnail was uploaded (e.g. client-side
 * pdfjs render failed), the OCR call will 404 on fetch and we'll persist
 * the receipt with an ocrError — the host can still attach it and fix the
 * amount manually.
 */
function deriveOcrUrl(doc: { url: string; mimeType?: string | null }): string {
  const mime = (doc.mimeType || '').toLowerCase();
  const looksLikePdf =
    mime === 'application/pdf' || doc.url.toLowerCase().split('?')[0].endsWith('.pdf');
  return looksLikePdf ? `${doc.url}.thumb.png` : doc.url;
}

function assertSupabasePayoutUrl(imageUrl: string, partyId: string): void {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new AppError('imageUrl is not a valid URL', 400, 'INVALID_IMAGE_URL');
  }
  if (!/\.supabase\.co$/.test(url.hostname)) {
    throw new AppError('imageUrl must be hosted on Supabase Storage', 400, 'INVALID_IMAGE_URL');
  }
  // Path must include "/event-images/" and "/payouts/<partyId>/"
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.includes('/event-images/')) {
    throw new AppError('imageUrl must point into the event-images bucket', 400, 'INVALID_IMAGE_URL');
  }
  const expectedSegment = `/event-images/payouts/${partyId}/`;
  // Also accept the public-render path that has /object/public/ prefix.
  if (!pathname.includes(expectedSegment)) {
    throw new AppError(
      `imageUrl must be under payouts/${partyId}/ in the event-images bucket`,
      400,
      'INVALID_IMAGE_URL_SCOPE'
    );
  }
}

function validatePayoutMethod(method: unknown): asserts method is PayoutMethod {
  if (typeof method !== 'string' || !(PAYOUT_METHODS as readonly string[]).includes(method)) {
    throw new AppError(
      `payoutMethod must be one of: ${PAYOUT_METHODS.join(', ')}`,
      400,
      'INVALID_PAYOUT_METHOD'
    );
  }
}

function validateMethodSpecificFields(
  method: PayoutMethod,
  body: { payoutWalletAddress?: unknown; payoutBankDetails?: unknown }
) {
  if (method === 'usdc_base') {
    const addr = body.payoutWalletAddress;
    // taleggio-30219: accept either a 0x address OR an ENS-shaped name here.
    // Actual ENS resolution is deferred to the async write site below — this
    // validator is synchronous and only checks shape.
    const trimmed = typeof addr === 'string' ? addr.trim() : '';
    const is0x = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
    const isEns = trimmed.length > 0 && looksLikeEnsName(trimmed);
    if (!is0x && !isEns) {
      throw new AppError(
        'usdc_base requires a valid 0x… wallet address or ENS name (e.g. alice.eth)',
        400,
        'INVALID_WALLET_ADDRESS'
      );
    }
  }
  if (method === 'wire') {
    const d = body.payoutBankDetails as Record<string, unknown> | undefined;
    if (!d || typeof d !== 'object') {
      throw new AppError(
        'wire requires payoutBankDetails with an email',
        400,
        'MISSING_BANK_DETAILS',
      );
    }
    const email = typeof d.email === 'string' ? d.email.trim() : '';
    if (!email) {
      throw new AppError(
        'payoutBankDetails.email is required for wire payouts',
        400,
        'MISSING_BANK_EMAIL',
      );
    }
    // Loose email shape check — same regex used elsewhere in the app
    // (e.g. PaymentDetailsCard.tsx). We're not trying to parse RFC 5322.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError(
        'payoutBankDetails.email must be a valid email address',
        400,
        'INVALID_BANK_EMAIL',
      );
    }
  }
}

/**
 * taleggio-30219: resolve a host-supplied wallet input (0x or ENS) to a
 * canonical 0x address, converting thrown errors to a 400 AppError so the
 * existing error-middleware shape carries through.
 */
async function resolveWalletOrThrow(input: string): Promise<string> {
  try {
    return await resolveWalletInput(input);
  } catch (err: any) {
    throw new AppError(
      err?.message || 'Could not resolve wallet address',
      400,
      'INVALID_WALLET_ADDRESS'
    );
  }
}

/**
 * caciotta-92104: same as `resolveWalletOrThrow` but also returns the original
 * input + whether it was ENS. Used by POST/PATCH so we can persist the human-
 * readable input (e.g. `puebla.eth`) alongside the canonical 0x address.
 */
async function resolveWalletOrThrowWithMeta(input: string): Promise<{
  address: string;
  /** The original input when ENS was used, null otherwise (no display needed). */
  walletInput: string | null;
}> {
  try {
    const resolved = await resolveWalletInputWithMeta(input);
    return {
      address: resolved.address,
      walletInput: resolved.wasEns ? resolved.input : null,
    };
  } catch (err: any) {
    throw new AppError(
      err?.message || 'Could not resolve wallet address',
      400,
      'INVALID_WALLET_ADDRESS'
    );
  }
}

// payment_admin is the superset role for /payments — covers admin + super_admin too.
async function isAnyAdmin(email?: string): Promise<boolean> {
  return isPaymentAdmin(email);
}

/**
 * bresaola-49185: Payments app is gated on party approval. Unapproved parties
 * cannot submit/edit payouts or run OCR previews — those actions all create or
 * mutate Payout rows and we don't want them piling up before underboss review.
 *
 * GET and DELETE are NOT gated: hosts must still be able to see existing
 * payouts and withdraw pending/approved ones even if approval is later revoked.
 *
 * Throws 403 PARTY_NOT_APPROVED when the party isn't approved (or doesn't
 * exist — we don't leak the existence distinction since the action is gated
 * regardless).
 */
async function assertPartyApproved(partyId: string): Promise<void> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { underbossStatus: true },
  });
  if (!party || party.underbossStatus !== 'approved') {
    throw new AppError(
      'This event must be approved before submitting payments.',
      403,
      'PARTY_NOT_APPROVED',
    );
  }
}

/**
 * pizzaiolo-92103: gate host payout submission on the submitting user having
 * a valid saved payment method. Re-introduces the gate that arugula-38633 v3
 * removed — admins shouldn't have to chase hosts for method details after the
 * receipt is already in the queue.
 *
 * "Valid" mirrors the frontend `methodValid` check in PaymentDetailsCard:
 *   - method must be one of usdc_base | mercury_card | wire
 *   - usdc_base: payoutWalletAddress must be a non-empty trimmed string. NOT
 *     gated on the strict 0x regex — ENS strings are valid (taleggio-30219).
 *   - wire: payoutBankDetails.email must match the loose email regex
 *   - mercury_card: no extra fields required
 *
 * Throws 400 PAYMENT_METHOD_NOT_SET when no method is set, 400
 * PAYMENT_METHOD_INCOMPLETE when method is set but its required field is
 * missing/invalid. Admin /external POSTs bypass this gate (admin records
 * off-platform sends).
 */
async function assertUserHasValidPayoutMethod(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      preferredPayoutMethod: true,
      payoutWalletAddress: true,
      payoutBankDetails: true,
    },
  });
  if (!user) {
    throw new AppError('User not found', 401, 'UNAUTHORIZED');
  }
  const m = user.preferredPayoutMethod;
  if (m == null) {
    throw new AppError(
      'Set your payment method on the Payments tab before submitting a receipt.',
      400,
      'PAYMENT_METHOD_NOT_SET',
    );
  }
  if (m === 'usdc_base' && !(user.payoutWalletAddress ?? '').trim()) {
    throw new AppError(
      'Set your USDC wallet address before submitting a receipt.',
      400,
      'PAYMENT_METHOD_INCOMPLETE',
    );
  }
  if (m === 'wire') {
    const bank = user.payoutBankDetails as { email?: unknown } | null;
    const email = bank && typeof bank.email === 'string' ? bank.email : '';
    const ok = email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!ok) {
      throw new AppError(
        'Set the email address for bank correspondence before submitting a receipt.',
        400,
        'PAYMENT_METHOD_INCOMPLETE',
      );
    }
  }
  // mercury_card: no extra fields required.
}

/**
 * pepperoni-47301: Mercury (our virtual debit card issuer) cannot issue cards
 * to hosts in sanctioned/restricted countries. When the host (or admin) tries
 * to submit `mercury_card` for a party whose `country` matches the block list,
 * we reject with 400 `MERCURY_COUNTRY_BLOCKED`. No-op for any other method or
 * when `method` is undefined.
 */
async function assertMercuryAllowed(
  partyId: string,
  method: string | null | undefined,
): Promise<void> {
  if (method !== 'mercury_card') return;
  const party = await prisma.party.findUnique({
    where: { id: partyId },
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

/**
 * acciuga-62583: hard per-submission ceiling. Independent of the per-party cap
 * (tiramisu-49102): even on uncapped parties, no single payout row can exceed
 * the cap. Enforced at SUBMISSION time across all methods — no override path.
 * Hosts split larger expenses across multiple submissions.
 *
 * marinara-71630 P2: the cap value now comes from app_config via
 * `getPayoutCaps().perSubmissionMaxUsd` (real values out of committed source).
 * The caller resolves the caps (async) and passes the number in.
 */
function assertWithinPerSubmissionCap(amountUsd: number, perSubmissionMaxUsd: number) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
  if (amountUsd > perSubmissionMaxUsd) {
    throw new AppError(
      `Payment requests are limited to $${perSubmissionMaxUsd} per submission. Please reduce the amount or split into multiple submissions.`,
      400,
      'PER_SUBMISSION_CAP_EXCEEDED',
    );
  }
}

/**
 * tiramisu-49102: hard per-party cap enforcement.
 *
 * Sums every existing payout for the party that is `pending | approved | paid`
 * and rejects with 409 PARTY_CAP_EXCEEDED if `usedUsd + proposedUsd` would
 * exceed the party's `effectiveReimbursementCapUsd` (validated cap OR max
 * numeric event tag). Parties without an effective cap stay uncapped.
 *
 * Skips a row when `ignorePayoutId` is supplied — used by PATCH edits so the
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
    // Defensive — callers above already verified the party exists.
    throw new AppError('Party not found', 404, 'NOT_FOUND');
  }

  const effectiveCap = computeEffectiveCapUsd({
    reimbursementCapUsd: party.reimbursementCapUsd,
    eventTags: party.eventTags,
  });
  if (effectiveCap == null) return;

  // prosciutto-92106: paid rows count toward usedUsd only when they carry
  // proof of send (transaction_hash / wire_reference / mercury_card / external
  // proof). Zombie status='paid' rows without proof are ignored so hosts
  // aren't blocked by bookkeeping ghosts when submitting receipts. pending /
  // approved / queued continue to count unconditionally (they represent
  // money committed-but-not-yet-sent; the proof gate doesn't apply).
  const baseWhere: any = { partyId };
  if (ignorePayoutId) {
    baseWhere.id = { not: ignorePayoutId };
  }
  const committedAgg = await prisma.payout.aggregate({
    where: {
      ...baseWhere,
      // gnocchi-92104: 'queued' (wire request sent, awaiting settlement) is
      // money committed and counts against the cap the same as approved.
      status: { in: ['pending', 'approved', 'queued'] },
    },
    _sum: { finalAmountUsd: true },
  });
  const provenPaidAgg = await prisma.payout.aggregate({
    where: {
      ...baseWhere,
      status: 'paid',
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
        { externalProofUrl: { not: null, notIn: [''] } },
      ],
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

// ---------- POST /:partyId/payouts/ocr-preview ----------

router.post(
  '/:partyId/payouts/ocr-preview',
  ocrPreviewLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const { imageUrl } = req.body || {};

      if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
        throw new AppError('imageUrl is required', 400, 'MISSING_IMAGE_URL');
      }

      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // bresaola-49185: block OCR previews on unapproved parties — the
      // surrounding Payments UI is hidden, but a determined direct caller
      // would otherwise still burn OpenAI quota.
      await assertPartyApproved(partyId);

      assertSupabasePayoutUrl(imageUrl, partyId);

      // mortadella-92103: country prior for ambiguous-symbol receipts. We
      // already loaded the canEdit signal above; pulling country here is a
      // single extra column read.
      const partyForCountry = await prisma.party.findUnique({
        where: { id: partyId },
        select: { country: true },
      });
      // scamorza-58296: graceful fallback. A transient OCR/FX failure used to
      // bubble to next(error) → bare HTTP 500, dead-ending the host with an
      // "internal server error" on the receipt row. Instead, catch here and
      // return a shape-compatible 200 that flags OCR_FAILED so the frontend
      // drops the host into a manual USD-amount entry field (mirrors the
      // POST /payouts allSettled resilience for the preview path).
      let ocr: Awaited<ReturnType<typeof analyzeReceipt>>;
      let fx: Awaited<ReturnType<typeof convertToUSD>>;
      try {
        ocr = await analyzeReceipt({
          imageUrl,
          partyCountry: partyForCountry?.country ?? null,
        });
        fx = await convertToUSD(ocr.amount, ocr.currency);
      } catch (err) {
        console.warn(`[ocr-preview] OCR failed for party ${partyId}; returning manual-entry fallback.`, err);
        return res.json({
          amount: 0,
          currency: 'USD',
          originalAmount: 0,
          originalCurrency: '',
          exchangeRate: 0,
          confidence: 0,
          items: [],
          lineItems: null,
          ocrRaw: null,
          fxSource: 'unresolved',
          conversionNote: undefined,
          ocrError: 'OCR_FAILED',
        });
      }

      // mortadella-92103: when FX can't resolve (no currency from OCR + no
      // country prior + no override), surface that to the host so they can
      // fix it with the currency override dropdown. We still return shape-
      // compatible fields so the frontend type doesn't have to branch.
      const unresolved = fx.source === 'unresolved';
      res.json({
        amount: unresolved ? 0 : (fx.usdAmount ?? 0),
        currency: 'USD',
        originalAmount: fx.originalAmount,
        originalCurrency: unresolved ? '' : (fx.originalCurrency ?? ''),
        exchangeRate: unresolved ? 0 : (fx.exchangeRate ?? 0),
        confidence: ocr.confidence,
        items: ocr.items,
        // provolone-49301: expose the structured line items + raw OCR payload
        // (already computed in this same analyzeReceipt call — zero extra
        // compute) so the frontend can forward them at submit. POST /payouts
        // then persists them and SKIPS a second gpt-4o pass, while still
        // re-running the free convertToUSD to re-lock FX authoritatively.
        lineItems: ocr.lineItems ?? null,
        ocrRaw: ocr.raw ?? null,
        fxSource: fx.source,
        conversionNote: unresolved
          ? `Currency could not be determined automatically — please pick the correct currency to convert ${fx.originalAmount.toLocaleString()} to USD.`
          : fx.originalCurrency && fx.originalCurrency !== 'USD' && fx.usdAmount != null && fx.exchangeRate != null
            ? `Converted from ${fx.originalAmount.toLocaleString()} ${fx.originalCurrency} → $${fx.usdAmount.toFixed(2)} USD (1 ${fx.originalCurrency} = $${fx.exchangeRate.toFixed(6)} USD)`
            : undefined,
        // mortadella-92103: explicit signal so the frontend can warn the host.
        ocrError: unresolved ? 'CURRENCY_UNRESOLVED' : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ---------- POST /:partyId/payouts/convert-fx ----------

/**
 * focaccia-89172: host-side currency override. OCR sometimes misreads a
 * currency symbol (e.g. `₹` as `$`) and the resulting USD conversion is
 * wildly off. This endpoint wraps `convertToUSD` so the host can pick the
 * correct currency from a dropdown on each receipt row; the row's locked
 * FX fields are then replaced in-place client-side.
 *
 * Pure FX lookup — no OCR. Same auth + rate-limit shape as ocr-preview.
 */
router.post(
  '/:partyId/payouts/convert-fx',
  ocrPreviewLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const { originalAmount, originalCurrency } = req.body || {};

      const amt = Number(originalAmount);
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new AppError(
          'originalAmount must be a positive number',
          400,
          'INVALID_AMOUNT'
        );
      }
      if (typeof originalCurrency !== 'string' || originalCurrency.trim().length === 0) {
        throw new AppError(
          'originalCurrency is required',
          400,
          'INVALID_CURRENCY'
        );
      }

      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // bresaola-49185: same approval gate as ocr-preview — no FX lookups
      // (which can touch external APIs) on unapproved parties.
      await assertPartyApproved(partyId);

      const fx = await convertToUSD(amt, originalCurrency.trim());

      // convertToUSD never throws — it returns source='unknown' with rate=1
      // when no provider can serve the currency, and 'unresolved' when no
      // currency was supplied at all. Reject those so the host gets explicit
      // feedback (and so the dropdown reverts client-side).
      if (fx.source === 'unknown' || fx.source === 'unresolved') {
        throw new AppError(
          `Could not look up exchange rate for currency "${originalCurrency.trim().toUpperCase()}".`,
          400,
          'UNKNOWN_CURRENCY'
        );
      }

      // After the guard above, usdAmount/exchangeRate/originalCurrency are
      // all non-null. Use `!` rather than coalescing zeros so a future bug
      // surfaces as a 500 instead of a silent $0 stamp.
      res.json({
        usdAmount: fx.usdAmount!,
        originalAmount: fx.originalAmount,
        originalCurrency: fx.originalCurrency!,
        exchangeRate: fx.exchangeRate!,
        source: fx.source,
        conversionNote:
          fx.originalCurrency !== 'USD'
            ? `Converted from ${fx.originalAmount.toLocaleString()} ${fx.originalCurrency} → $${fx.usdAmount!.toFixed(2)} USD (1 ${fx.originalCurrency} = $${fx.exchangeRate!.toFixed(6)} USD)`
            : undefined,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ---------- POST /:partyId/payouts ----------

interface IncomingDocument {
  url: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  // provolone-49301: optional preview-OCR payload forwarded from the host
  // upload step (ocr-preview ran gpt-4o once already). When a valid
  // ocrOriginalAmount is present we trust the original-currency OCR fields
  // and SKIP a second analyzeReceipt pass, still re-running the free
  // convertToUSD to re-lock FX server-side. We NEVER trust a client-supplied
  // USD amount or exchange rate — those always come from convertToUSD.
  ocrOriginalAmount?: number;
  ocrOriginalCurrency?: string | null;
  ocrConfidence?: number;
  ocrLineItems?: unknown;
  ocrRaw?: unknown;
  ocrError?: string | null;
}

router.post('/:partyId/payouts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      pizzaPhotos = [],
      // pomodoro-92110: event photos (cap 30) persist as kind:'event' docs and
      // mirror to the gallery exactly like pizza photos.
      eventPhotos = [],
      receiptPhotos = [],
      hostNotes,
      payoutMethod,
      payoutWalletAddress,
      payoutBankDetails,
      mercuryCardLast4,
      finalAmountUsd,
      saveAsDefault,
      estimatedAttendance,
      // porchetta-58296: host must affirm "I have submitted all my receipts and
      // they are itemized." before the payout can be created.
      receiptAttested,
      // bismarck-92103: admin-only override so the resulting Payout row is
      // credited to the chosen cohost (not the admin creating it). When set
      // AND the caller is an admin, `recipientHostUserId` replaces the
      // default `req.userId` for `hostUserId`. Preserves pancetta-37195
      // attribution — "Submitted by X" reads correctly.
      recipientHostUserId,
      // salumi-89172: optional payout purpose + tied kit. Shipping
      // coordinators submit `purpose='shipping'` with `partyKitId` set to
      // the kit the receipt belongs to. Event-reimbursement flows leave
      // both unset; the column defaults to 'event'.
      purpose: bodyPurpose,
      partyKitId: bodyPartyKitId,
    } = req.body || {};

    // salumi-89172: validate purpose. Default 'event' preserves all existing
    // flows. 'shipping' is only allowed when `partyKitId` is also supplied
    // AND the kit actually belongs to this party (checked below after the
    // party-edit gate).
    const purpose: 'event' | 'shipping' =
      bodyPurpose === 'shipping' ? 'shipping' : 'event';
    const partyKitIdInput =
      typeof bodyPartyKitId === 'string' && bodyPartyKitId.trim().length > 0
        ? bodyPartyKitId.trim()
        : null;
    if (purpose === 'shipping' && !partyKitIdInput) {
      throw new AppError(
        'partyKitId is required for shipping receipts',
        400,
        'PARTY_KIT_ID_REQUIRED',
      );
    }
    if (purpose !== 'shipping' && partyKitIdInput) {
      // Refuse to silently drop a kit id on a non-shipping payout — it almost
      // certainly indicates a frontend bug rather than intent.
      throw new AppError(
        'partyKitId may only be set when purpose="shipping"',
        400,
        'INVALID_PARTY_KIT_ID',
      );
    }

    // salumi-89172: shipping receipts are submitted by shipping coordinators
    // who don't necessarily have edit access on the party — they manage
    // logistics, not the event itself. When `purpose='shipping'`, swap the
    // canUserEditParty gate for a shipping-coordinator / admin check that
    // mirrors the auth used by `/api/shipping/*`.
    const isShippingPurpose = purpose === 'shipping';

    // bismarck-92103: admins creating prepayments on behalf of a cohost don't
    // need party edit access — they're operating from the /payments admin
    // dashboard. When the recipient override is in play AND the caller is an
    // admin, skip the canUserEditParty gate. (Self-edit access is still
    // enforced for all other callers via the existing check.)
    const recipientOverrideRequested =
      typeof recipientHostUserId === 'string' && recipientHostUserId.trim().length > 0;
    const skipPartyEditCheck =
      (recipientOverrideRequested && (await isAnyAdmin(req.userEmail))) ||
      isShippingPurpose;
    if (!skipPartyEditCheck) {
      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canEdit) {
        if (recipientOverrideRequested) {
          throw new AppError(
            'Only payment admins, admins, or super admins can create prepayments on behalf of other hosts.',
            403,
            'FORBIDDEN_PREPAY',
          );
        }
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }
    }

    // salumi-89172: for shipping receipts, require the caller to be an admin
    // OR an active shipping coordinator. Also enforce that the kit belongs
    // to the party in the URL — submitters can't cross parties.
    if (isShippingPurpose) {
      const email = req.userEmail?.toLowerCase() || '';
      const callerIsAdmin = await isAnyAdmin(req.userEmail);
      let allowed = callerIsAdmin;
      if (!allowed && email) {
        const coord = await prisma.shippingCoordinator.findFirst({
          where: { email, isActive: true },
          select: { id: true },
        });
        allowed = !!coord;
      }
      if (!allowed) {
        throw new AppError(
          'Shipping receipts require admin or shipping-coordinator access.',
          403,
          'FORBIDDEN_SHIPPING_PAYOUT',
        );
      }
      // Verify the kit exists AND belongs to this party. Cross-party submits
      // would otherwise let a coordinator file a receipt under a kit they
      // don't actually handle.
      const kit = await prisma.partyKit.findUnique({
        where: { id: partyKitIdInput! },
        select: { id: true, partyId: true },
      });
      if (!kit) {
        throw new AppError('Kit not found', 404, 'KIT_NOT_FOUND');
      }
      if (kit.partyId !== partyId) {
        throw new AppError(
          'Kit does not belong to this party',
          400,
          'KIT_PARTY_MISMATCH',
        );
      }
    }

    // bresaola-49185: block payout creation on unapproved parties. Admins
    // creating prepayments still need the party to be approved — there's no
    // legitimate reason to disburse funds for a party the underboss hasn't
    // approved yet.
    await assertPartyApproved(partyId);

    // pizzaiolo-92103: gate host submission on the submitter having a valid
    // saved payment method. Re-introduces the gate arugula-38633 v3 removed.
    // SKIP when an admin is creating a prepayment ON BEHALF OF a cohost
    // (bismarck-92103) — the admin's own method isn't the relevant signal in
    // that flow. Shipping-coordinator submissions DO get the gate (they're
    // recipients of the resulting payout, same as event-reimbursement hosts).
    // Admins recording fully off-platform sends use POST /api/admin/payouts/external
    // and don't pass through this handler at all.
    if (!req.userId) {
      throw new AppError('Authenticated user has no userId', 500, 'NO_USER_ID');
    }
    const adminPrepayingForCohost =
      recipientOverrideRequested && (await isAnyAdmin(req.userEmail));
    if (!adminPrepayingForCohost) {
      await assertUserHasValidPayoutMethod(req.userId);
    }

    // porchetta-58296: gate submission on the host having (1) attested their
    // receipts, (2) at least one receipt on file (incoming or already stored),
    // and (3) all three designated event role photos (group/box_stack/pizza).
    // Applies to ALL purposes (incl. shipping) for now. Mirrored client-side as
    // a disabled submit button; enforced here so an API bypass still fails.
    if (receiptAttested !== true) {
      throw new AppError(
        'Confirm your receipts are submitted and itemized before submitting.',
        400,
        'RECEIPT_ATTESTATION_REQUIRED',
      );
    }
    const incomingReceiptCount = Array.isArray(receiptPhotos) ? receiptPhotos.length : 0;
    const submissionReadiness = await getPayoutSubmissionReadiness(partyId);
    if (incomingReceiptCount < 1 && !submissionReadiness.hasReceipt) {
      throw new AppError(
        'Upload at least one receipt before submitting.',
        400,
        'RECEIPTS_REQUIRED',
      );
    }
    if (!submissionReadiness.hasGroupPhoto) {
      throw new AppError(
        'Designate a group photo before submitting.',
        400,
        'GROUP_PHOTO_REQUIRED',
      );
    }
    if (!submissionReadiness.hasBoxStackPhoto) {
      throw new AppError(
        'Designate a box stack photo before submitting.',
        400,
        'BOX_STACK_PHOTO_REQUIRED',
      );
    }
    if (!submissionReadiness.hasPizzaPhoto) {
      throw new AppError(
        'Designate a pizza photo before submitting.',
        400,
        'PIZZA_PHOTO_REQUIRED',
      );
    }

    // salame-92110 + culatello-92106: tax-form gate.
    //
    // culatello-92106 moved the required-vs-not decision behind a per-event
    // admin-controlled flag (`parties.tax_form_required`). When the flag is
    // false (the default) the gate is skipped entirely — the host can submit
    // payouts without a tax form. When admin has flipped the flag to true on
    // /payments, the salame-92110 logic runs: a W-9 / W-8BEN / W-8BEN-E must
    // exist before the receipt can be submitted, and the latest form is
    // snapshotted onto the resulting payout.
    //
    // Inside the flagged-on branch, the salame-92110 required-vs-not logic
    // still applies (latest form OR projected YTD ≥ the W-9 threshold), but in
    // practice both reduce to "form must exist" because the flag is the gate.
    //
    // Skipped entirely (regardless of party flag) when:
    //   - purpose='shipping' (shipping coordinators don't take taxable income
    //     via this flow), OR
    //   - an admin is prepaying on behalf of a cohost.
    //
    // The recipient for the gate is the admin-overridden `recipientHostUserId`
    // when applicable, else the authenticated submitter. We collapse the
    // admin-override resolution here (a couple of lines below the same logic
    // runs for `effectiveHostUserId`).
    let taxFormSnapshotId: string | null = null;
    const skipTaxFormGate = isShippingPurpose || adminPrepayingForCohost;
    if (!skipTaxFormGate) {
      // culatello-92106: read the per-event flag before doing anything else.
      // We always still snapshot the latest form onto the payout when one
      // exists (so admin can review historical submissions even if the flag
      // later flips off), but we only THROW when the flag is on.
      const partyForTaxGate = await prisma.party.findUnique({
        where: { id: partyId },
        select: { taxFormRequired: true },
      });
      const partyTaxFormRequired = partyForTaxGate?.taxFormRequired === true;
      const gateRecipientUserId =
        recipientOverrideRequested && typeof recipientHostUserId === 'string'
          ? recipientHostUserId.trim()
          : req.userId;
      if (gateRecipientUserId) {
        if (partyTaxFormRequired) {
          // Per-event flag is ON — enforce salame-92110 gate.
          // marinara-71630 P2: W-9 YTD threshold from app_config (env-free).
          const [latestForm, ytdTotal, { w9ThresholdUsd }] = await Promise.all([
            getLatestSubmittedTaxFormForUser(gateRecipientUserId),
            getYtdPayoutTotalUsd(gateRecipientUserId),
            getPayoutCaps(),
          ]);
          const incomingAmount =
            typeof finalAmountUsd === 'number' && finalAmountUsd > 0 ? finalAmountUsd : 0;
          const projectedYtd = ytdTotal + incomingAmount;
          const required = latestForm != null || projectedYtd >= w9ThresholdUsd;
          if (required && !latestForm) {
            throw new AppError(
              'A tax form (W-9, W-8BEN, or W-8BEN-E) is required before this payment can be submitted.',
              400,
              'TAX_FORM_REQUIRED',
            );
          }
          if (latestForm) {
            taxFormSnapshotId = latestForm.id;
          }
        } else {
          // Per-event flag is OFF — skip the throw, but still snapshot the
          // form when the host has one on file so admin's TaxFormReviewPanel
          // keeps working (and so flipping the flag on later doesn't lose the
          // attribution to past payouts).
          const latestForm = await getLatestSubmittedTaxFormForUser(gateRecipientUserId);
          if (latestForm) {
            taxFormSnapshotId = latestForm.id;
          }
        }
      }
    }

    // Validate optional one-shot attendance setup. Only persisted to the party
    // below if the party's current expectedGuests is null (see updateMany call).
    let validatedAttendance: number | null = null;
    if (estimatedAttendance !== undefined && estimatedAttendance !== null) {
      const n = Number(estimatedAttendance);
      if (!Number.isInteger(n) || n < 1) {
        throw new AppError(
          'estimatedAttendance must be a positive integer',
          400,
          'INVALID_ATTENDANCE'
        );
      }
      validatedAttendance = n;
    }

    // arugula-38633 v3 follow-up: receipts are now optional. If the host
    // submits with no receipts, we use `finalAmountUsd` as the source of
    // truth and default FX fields to USD passthrough below.
    if (!Array.isArray(receiptPhotos)) {
      throw new AppError('receiptPhotos must be an array', 400, 'INVALID_RECEIPTS');
    }
    if (!Array.isArray(pizzaPhotos)) {
      throw new AppError('pizzaPhotos must be an array', 400, 'INVALID_PIZZA_PHOTOS');
    }
    if (receiptPhotos.length > 10) {
      throw new AppError('Max 10 receipt photos', 400, 'TOO_MANY_RECEIPTS');
    }
    if (pizzaPhotos.length > 10) {
      throw new AppError('Max 10 pizza photos', 400, 'TOO_MANY_PIZZA_PHOTOS');
    }
    // pomodoro-92110: event photos validated with a higher cap (30).
    if (!Array.isArray(eventPhotos)) {
      throw new AppError('eventPhotos must be an array', 400, 'INVALID_EVENT_PHOTOS');
    }
    if (eventPhotos.length > 30) {
      throw new AppError('Max 30 event photos', 400, 'TOO_MANY_EVENT_PHOTOS');
    }
    // When zero receipts are supplied, finalAmountUsd MUST be a positive number.
    if (
      receiptPhotos.length === 0
      && (typeof finalAmountUsd !== 'number' || !(finalAmountUsd > 0))
    ) {
      throw new AppError(
        'finalAmountUsd is required (and must be > 0) when no receipts are uploaded',
        400,
        'NO_AMOUNT',
      );
    }

    // arugula-38633 v3 follow-up: payoutMethod is now optional. When the
    // host hasn't set their payment details yet, the payout persists with
    // payout_method=NULL and the admin nags before execute.
    const hasMethod = payoutMethod !== undefined && payoutMethod !== null;
    if (hasMethod) {
      validatePayoutMethod(payoutMethod);
      validateMethodSpecificFields(payoutMethod, { payoutWalletAddress, payoutBankDetails });
      // pepperoni-47301: reject `mercury_card` for parties in sanctioned countries.
      await assertMercuryAllowed(partyId, payoutMethod);
    }

    // Validate every uploaded URL points into our bucket
    for (const r of receiptPhotos as IncomingDocument[]) {
      if (!r || typeof r.url !== 'string') {
        throw new AppError('Each receiptPhoto must have a url', 400, 'INVALID_RECEIPT');
      }
      assertSupabasePayoutUrl(r.url, partyId);
    }
    for (const p of pizzaPhotos as IncomingDocument[]) {
      if (!p || typeof p.url !== 'string') {
        throw new AppError('Each pizzaPhoto must have a url', 400, 'INVALID_PIZZA_PHOTO');
      }
      assertSupabasePayoutUrl(p.url, partyId);
    }
    // pomodoro-92110: same bucket-scope validation for event photos.
    for (const p of eventPhotos as IncomingDocument[]) {
      if (!p || typeof p.url !== 'string') {
        throw new AppError('Each eventPhoto must have a url', 400, 'INVALID_EVENT_PHOTO');
      }
      assertSupabasePayoutUrl(p.url, partyId);
    }

    // mortadella-92103: read the party's country once so OCR can use it as a
    // currency prior when the receipt symbol is ambiguous (the `$` problem
    // in MX/AR/CL/CO/UY/...). One column read, hoisted above the parallel
    // OCR fan-out so it's shared across receipts.
    const partyForOcr = await prisma.party.findUnique({
      where: { id: partyId },
      select: { country: true },
    });
    const partyCountry = partyForOcr?.country ?? null;

    // arugula-38633 v3 follow-up: skip the parallel-OCR step when there are
    // no receipts — the host supplied `finalAmountUsd` directly. FX fields
    // collapse to USD passthrough below.
    const ocrResults: PromiseSettledResult<
      | { ok: true; doc: IncomingDocument; ocr: any; fx: any }
      | { ok: false; doc: IncomingDocument; error: string }
    >[] = receiptPhotos.length === 0
      ? []
      : await Promise.allSettled(
          (receiptPhotos as IncomingDocument[]).map(async (r) => {
            try {
              // provolone-49301: when the frontend forwards the preview-OCR
              // payload (gpt-4o already ran once on upload), trust the
              // original-currency fields and SKIP a second analyzeReceipt
              // pass. We still re-run the FREE convertToUSD below to re-lock
              // FX authoritatively — the USD amount + exchange rate ALWAYS
              // come from the server, never from the client.
              if (Number.isFinite(r.ocrOriginalAmount) && (r.ocrOriginalAmount as number) >= 0) {
                const ocr = {
                  amount: r.ocrOriginalAmount as number,
                  currency: (typeof r.ocrOriginalCurrency === 'string' && r.ocrOriginalCurrency.trim()) ? r.ocrOriginalCurrency.trim().slice(0, 8) : null,
                  confidence: Math.min(1, Math.max(0, Number(r.ocrConfidence) || 0)),
                  lineItems: Array.isArray(r.ocrLineItems) ? (r.ocrLineItems as any[]).slice(0, 100) : undefined,
                  raw: r.ocrRaw ?? null,
                };
                const fx = await convertToUSD(ocr.amount, ocr.currency);
                return { ok: true as const, doc: r, ocr, fx };
              }
              // Fallback (no forwarded payload, e.g. old clients): OCR here.
              // bocconcino-92104: PDFs are OCR'd via their `.thumb.png` sibling.
              const ocr = await analyzeReceipt({
                imageUrl: deriveOcrUrl(r),
                partyCountry,
              });
              const fx = await convertToUSD(ocr.amount, ocr.currency);
              return { ok: true as const, doc: r, ocr, fx };
            } catch (err: any) {
              return { ok: false as const, doc: r, error: err?.message || 'OCR failed' };
            }
          })
        );

    // Compute the OCR sum + locked exchange rate.
    // Strategy: sum the USD-converted amounts (already locked at submission time
    // via the fx call above). Use the first successful conversion's source/rate
    // as the "headline" exchangeRate + originalCurrency on the row. Per-receipt
    // detail is preserved on the documents. When there are no receipts at all,
    // we fall back to USD passthrough using the host-supplied finalAmountUsd.
    let extractedUsdSum = 0;
    let originalAmount = 0;
    let originalCurrency = 'USD';
    let exchangeRate = 1;
    let foundFirstRate = false;

    const docsToCreate: Array<{
      kind: string;
      url: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      ocrAmount: Decimal | null;
      ocrCurrency: string | null;
      ocrConfidence: Decimal | null;
      // mortadella-92103: per-receipt original-amount / original-currency /
      // exchange-rate columns. ocrAmount stays USD; these capture what the
      // host actually paid in the source currency + the locked FX rate.
      originalAmount: Decimal | null;
      originalCurrency: string | null;
      exchangeRate: Decimal | null;
      ocrRaw: any;
      // formaggi-89172: per-line structured items extracted from the receipt.
      // null for pizza-photo rows + receipts whose OCR errored.
      ocrLineItems: any;
      ocrError: string | null;
      sortOrder: number;
      // napoletana-58211: filled in below for kind='pizza' docs after we
      // insert the canonical photos row. Receipts keep this null.
      photoId: string | null;
    }> = [];

    let idx = 0;
    for (const settled of ocrResults) {
      // Promise.allSettled always resolves; the inner promise we created also
      // always resolves to either ok or error, so settled.value is defined.
      const result = settled.status === 'fulfilled' ? settled.value : null;
      const doc = (receiptPhotos as IncomingDocument[])[idx];
      if (result && result.ok) {
        const { ocr, fx } = result;
        // mortadella-92103: refuse to count an unresolved-currency receipt
        // toward the sum. The row is still persisted (so the receipt image
        // and OCR amount are preserved for forensics + host override) but
        // ocrAmount is NULL and ocrError carries CURRENCY_UNRESOLVED. Host
        // /admin must pick the correct currency via the override dropdown.
        const unresolved = fx.source === 'unresolved' || fx.usdAmount == null;
        if (!unresolved) {
          extractedUsdSum += fx.usdAmount!;
          if (!foundFirstRate) {
            originalAmount = fx.originalAmount;
            originalCurrency = fx.originalCurrency ?? 'USD';
            exchangeRate = fx.exchangeRate ?? 1;
            foundFirstRate = true;
          }
        }
        docsToCreate.push({
          kind: 'receipt',
          url: doc.url,
          fileName: doc.fileName || extractFileName(doc.url),
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : 0,
          mimeType: doc.mimeType || 'image/jpeg',
          ocrAmount: unresolved ? null : new Decimal(fx.usdAmount!),
          ocrCurrency: unresolved ? null : fx.originalCurrency,
          ocrConfidence: new Decimal(ocr.confidence),
          // mortadella-92103: persist the raw foreign-currency amount + ISO
          // code + locked rate per receipt. Even unresolved rows carry
          // originalAmount (the host needs to see what the receipt said).
          originalAmount: new Decimal(fx.originalAmount),
          originalCurrency: unresolved ? null : (fx.originalCurrency ?? null),
          exchangeRate: unresolved ? null : (fx.exchangeRate != null ? new Decimal(fx.exchangeRate) : null),
          ocrRaw: sanitizeForPg({ ocr: ocr.raw, fx: { source: fx.source, rate: fx.exchangeRate } }),
          // formaggi-89172: structured per-line items for pizza-price analytics.
          ocrLineItems: ocr.lineItems && ocr.lineItems.length > 0 ? sanitizeForPg(ocr.lineItems) : null,
          ocrError: unresolved ? 'CURRENCY_UNRESOLVED' : null,
          sortOrder: idx,
          photoId: null,
        });
      } else {
        const err = result && !result.ok ? result.error : 'Unexpected OCR result';
        docsToCreate.push({
          kind: 'receipt',
          url: doc.url,
          fileName: doc.fileName || extractFileName(doc.url),
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : 0,
          mimeType: doc.mimeType || 'image/jpeg',
          ocrAmount: null,
          ocrCurrency: null,
          ocrConfidence: null,
          originalAmount: null,
          originalCurrency: null,
          exchangeRate: null,
          ocrRaw: null,
          ocrLineItems: null,
          ocrError: err,
          sortOrder: idx,
          photoId: null,
        });
      }
      idx++;
    }

    // porchetta-58296: pizza/event photos are no longer persisted as payout
    // documents. The NewPayoutForm now designates role photos in the gallery
    // (`photos.payout_role`) instead of uploading kind='pizza'/'event' docs
    // here. Only receipts (kind='receipt') are created from this handler going
    // forward. The `pizzaPhotos`/`eventPhotos` body fields are still accepted +
    // validated above for back-compat with old clients but are otherwise
    // ignored.

    // Final amount: host override (if provided) or OCR sum
    const hasExplicitAmount = typeof finalAmountUsd === 'number' && finalAmountUsd > 0;
    let finalUsd = hasExplicitAmount
      ? (finalAmountUsd as number)
      : extractedUsdSum;

    if (finalUsd <= 0) {
      throw new AppError(
        'Could not determine payment amount — OCR returned $0 for all receipts and no manual amount was provided',
        400,
        'INVALID_AMOUNT'
      );
    }

    // crocchetta-92103: default the payout's amount to min(receipts_sum, party_cap).
    // Receipts persist as evidence of the host's gross claim; final_amount_usd is
    // what we'll reimburse. Admin can edit later to over-cap. Host's explicit
    // `finalAmountUsd` body field bypasses the clamp (matching speck-89172's
    // "hosts can submit any amount" — the warning still surfaces in UI).
    if (!hasExplicitAmount) {
      const partyForCap = await prisma.party.findUnique({
        where: { id: partyId },
        select: { reimbursementCapUsd: true, eventTags: true },
      });
      const cap = computeEffectiveCapUsd({
        reimbursementCapUsd: partyForCap?.reimbursementCapUsd,
        eventTags: partyForCap?.eventTags,
      });
      if (typeof cap === 'number' && cap > 0 && finalUsd > cap) {
        finalUsd = cap;
      }
    }

    // speck-89172: host POST is no longer cap-enforced. Hosts can submit any
    // positive amount; admin moderates over-cap rows from /payments (which
    // surfaces an amber flag on rows that exceed the party's effective cap).
    // The acciuga-62583 / tiramisu-49102 helpers remain in this file because
    // admin PATCH (aglio-62584) still uses the per-submission ceiling.

    // arugula-38633 v3 follow-up: zero-receipts path — default the FX fields
    // to USD passthrough using finalUsd. (extractedUsdSum stays 0; we surface
    // finalUsd as both originalAmount and extractedAmountUsd so the row reads
    // cleanly in the admin UI.)
    const noReceiptsFallback = receiptPhotos.length === 0;
    const effectiveExtractedUsd = noReceiptsFallback ? finalUsd : extractedUsdSum;
    const effectiveOriginalAmount = noReceiptsFallback
      ? finalUsd
      : (originalAmount || extractedUsdSum);
    const effectiveOriginalCurrency = noReceiptsFallback ? 'USD' : originalCurrency;
    const effectiveExchangeRate = noReceiptsFallback ? 1 : exchangeRate;

    if (!req.userId) {
      throw new AppError('Authenticated user has no userId', 500, 'NO_USER_ID');
    }

    // bismarck-92103: admin-only override — if `recipientHostUserId` is set
    // AND the caller is an admin (or super_admin), the payout is created
    // ON BEHALF OF that user (`hostUserId` = the recipient, not the admin).
    // Non-admin callers passing the field are silently ignored — falling
    // through to `req.userId` keeps the existing behavior intact.
    let effectiveHostUserId: string = req.userId;
    const callerIsAdmin = await isAnyAdmin(req.userEmail);
    if (typeof recipientHostUserId === 'string' && recipientHostUserId.trim()) {
      if (callerIsAdmin) {
        const targetUser = await prisma.user.findUnique({
          where: { id: recipientHostUserId.trim() },
          select: { id: true },
        });
        if (!targetUser) {
          throw new AppError(
            'recipientHostUserId does not match any User',
            400,
            'INVALID_RECIPIENT_HOST_USER_ID',
          );
        }
        effectiveHostUserId = targetUser.id;
      }
    }

    // bismarck-92103: admins can also stamp `adminNotes` directly on the new
    // payout (used by the prepay-queue "Create prepayment" modal). Non-admin
    // callers cannot set adminNotes via this endpoint.
    const adminNotesRaw = (req.body || {}).adminNotes;
    const initialAdminNotes =
      callerIsAdmin && typeof adminNotesRaw === 'string' && adminNotesRaw.trim().length > 0
        ? sanitizePgString(adminNotesRaw.trim())
        : null;

    // taleggio-30219: resolve the wallet input once, BEFORE the create, so
    // we persist a canonical 0x address even if the host typed an ENS name.
    // Reused by the `saveAsDefault` write below so we don't resolve twice.
    // caciotta-92104: also capture the original input so we can persist
    // `payoutWalletInput` for display.
    let resolvedWallet: string | null = null;
    let resolvedWalletInput: string | null = null;
    if (hasMethod && payoutMethod === 'usdc_base' && typeof payoutWalletAddress === 'string') {
      const r = await resolveWalletOrThrowWithMeta(payoutWalletAddress);
      resolvedWallet = r.address;
      resolvedWalletInput = r.walletInput;
    }

    // pancetta-37195: stamp each new document with the uploader.
    // agnolotti-58291: also stamp `partyId` so the document is party-scoped
    // independent of the payoutId association (which is now SET NULL on
    // payout delete). The nested `documents: { create: ... }` below uses the
    // implicit `payoutId` from the parent create; partyId must be set
    // explicitly since it's a sibling FK, not a back-relation.
    const uploaderUserId = req.userId ?? null;
    const uploaderEmail = req.userEmail ?? null;

    // napoletana-58211: the `photos` table is the canonical store for ALL
    // party photos. For each kind='pizza' payout doc, insert the photos row
    // FIRST (auto-approved + auto-starred so it surfaces immediately on the
    // event gallery + /photos feed), then create the payout_documents row
    // with `photoId` pointing at it. Receipts (kind='receipt') stay
    // payout-only — photoId remains null. Wrapped in a transaction so a
    // photos-insert failure aborts the whole submission and we never leave
    // an orphan payout_documents row.
    const payout = await prisma.$transaction(async (tx) => {
      const now = new Date();
      // guanciale-92108: sequential (not Promise.all) — concurrent queries on the interactive tx client + the default 5s timeout blew up on large multi-photo submissions ("Transaction already closed" 500). Serial also makes the sicilian-58196 dedup catch intra-submission duplicates.
      const docsToCreateStamped: Array<
        (typeof docsToCreate)[number] & {
          partyId: string;
          uploadedByUserId: string | null;
          uploadedByEmail: string | null;
        }
      > = [];
      for (const d of docsToCreate) {
        let photoId: string | null = d.photoId;
        // pomodoro-92110: event docs mirror to the gallery identically to pizza.
        if (d.kind === 'pizza' || d.kind === 'event') {
          // sicilian-58196: dedup pre-check. If a photo with the same
          // (partyId, fileSize, mimeType) already exists, reuse its id
          // instead of inserting a new row. Same bytes uploaded a second
          // time via the payout flow should NOT create a duplicate row in
          // the canonical `photos` table.
          const dup = await tx.photo.findFirst({
            where: {
              partyId,
              fileSize: d.fileSize,
              mimeType: d.mimeType,
            },
            select: { id: true },
          });
          if (dup) {
            photoId = dup.id;
          } else {
            const photo = await tx.photo.create({
              data: {
                partyId,
                url: d.url,
                fileName: d.fileName,
                fileSize: d.fileSize,
                mimeType: d.mimeType,
                // uploadedBy is a Guest FK; payout submitters are Users.
                // Leave null and rely on uploaderEmail for attribution.
                uploadedBy: null,
                uploaderName: null,
                uploaderEmail: uploaderEmail,
                status: 'approved',
                starred: true,
                starredAt: now,
                reviewedAt: now,
                reviewedBy: uploaderUserId,
              },
              select: { id: true },
            });
            photoId = photo.id;
          }
        }
        docsToCreateStamped.push({
          ...d,
          partyId,
          uploadedByUserId: uploaderUserId,
          uploadedByEmail: uploaderEmail,
          photoId,
        });
      }

      return tx.payout.create({
        data: {
          partyId,
          // bismarck-92103: when admins create prepayments on behalf of a
          // cohost, `effectiveHostUserId` is the cohost; otherwise it's the
          // authenticated submitter (req.userId).
          hostUserId: effectiveHostUserId,
          // salumi-89172: persist purpose + tied kit. Defaults to 'event' /
          // null when the body didn't supply them, matching pre-feature
          // behavior.
          purpose,
          partyKitId: partyKitIdInput,
          originalAmount: new Decimal(effectiveOriginalAmount),
          originalCurrency: effectiveOriginalCurrency,
          exchangeRate: new Decimal(effectiveExchangeRate),
          extractedAmountUsd: new Decimal(effectiveExtractedUsd),
          finalAmountUsd: new Decimal(finalUsd),
          status: 'pending',
          // arugula-38633 v3 follow-up: payoutMethod is optional. Persist null
          // when the host hasn't set their payment details yet.
          payoutMethod: hasMethod ? payoutMethod : null,
          payoutWalletAddress: resolvedWallet,
          // caciotta-92104: preserve original ENS input alongside 0x. Null
          // when the host typed a 0x directly (no display difference to show).
          payoutWalletInput: resolvedWalletInput,
          ...(hasMethod && payoutMethod === 'wire' && payoutBankDetails && typeof payoutBankDetails === 'object'
            ? { payoutBankDetails: payoutBankDetails as Prisma.InputJsonValue }
            : {}),
          mercuryCardLast4: hasMethod && payoutMethod === 'mercury_card' && typeof mercuryCardLast4 === 'string'
            ? mercuryCardLast4.slice(-4)
            : null,
          hostNotes: typeof hostNotes === 'string' && hostNotes.trim().length > 0
            ? sanitizePgString(hostNotes.trim())
            : null,
          // bismarck-92103: admin-supplied adminNotes (e.g. "Prepayment for X")
          // when an admin creates a prepayment on behalf of a cohost.
          adminNotes: initialAdminNotes,
          // salame-92110: snapshot of the recipient host's tax form at submit
          // time (W-9 / W-8BEN / W-8BEN-E). Null on shipping-purpose receipts
          // and on admin-prepay rows where the gate is skipped.
          taxFormId: taxFormSnapshotId,
          documents: { create: docsToCreateStamped },
        },
        include: {
          host: { select: { id: true, name: true, email: true } },
          documents: {
            orderBy: { sortOrder: 'asc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
          },
        },
      });
    }, { timeout: 20000, maxWait: 10000 });

    // One-shot: persist the host's attendance estimate to the party, but only
    // if it hasn't already been set. updateMany no-ops gracefully when the row
    // already has a non-null expectedGuests value, so we never overwrite.
    if (validatedAttendance != null) {
      try {
        await prisma.party.updateMany({
          where: { id: partyId, expectedGuests: null },
          data: { expectedGuests: validatedAttendance },
        });
      } catch (err) {
        // Non-fatal — the payout itself succeeded.
        console.warn('[payouts] failed to persist expectedGuests:', err);
      }
    }

    // Optional: save host defaults. Only meaningful when a method is set —
    // skip entirely on zero-method submissions (arugula-38633 v3 follow-up).
    if (saveAsDefault === true && hasMethod) {
      try {
        await prisma.user.update({
          where: { id: req.userId },
          data: {
            preferredPayoutMethod: payoutMethod,
            // taleggio-30219: reuse the already-resolved 0x — don't resolve
            // twice (ENS lookups are cheap but not free, and we want a
            // consistent address across the payout and the user default).
            ...(payoutMethod === 'usdc_base' && resolvedWallet
              ? { payoutWalletAddress: resolvedWallet }
              : {}),
            ...(payoutMethod === 'wire' && payoutBankDetails && typeof payoutBankDetails === 'object'
              ? { payoutBankDetails: payoutBankDetails as Prisma.InputJsonValue }
              : {}),
          },
        });
      } catch (err) {
        // Non-fatal — defaults are a UX nicety, not a requirement.
        console.warn('[payouts] failed to save host defaults:', err);
      }
    }

    res.status(201).json({ payout: serializePayout(payout) });
  } catch (error) {
    next(error);
  }
});

// ---------- GET /:partyId/payouts ----------

router.get('/:partyId/payouts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // ravioli-82931: hide withdrawn rows from the active host payouts list.
    // They remain reachable via the receipts-library endpoint below so hosts
    // can still see receipts they uploaded on rows they later withdrew.
    const payouts = await prisma.payout.findMany({
      where: { partyId, status: { not: 'withdrawn' } },
      include: {
        host: { select: { id: true, name: true, email: true } },
        documents: {
          orderBy: { sortOrder: 'asc' },
          include: { uploadedBy: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ payouts: payouts.map(serializePayout) });
  } catch (error) {
    next(error);
  }
});

// ---------- GET /:partyId/payouts/receipts-library ----------

/**
 * ravioli-82931 + agnolotti-58291: party-scoped receipts library.
 *
 * Every `kind='receipt'` `payout_documents` row belonging to this party is
 * returned, regardless of which cohost uploaded it or which payout it was
 * attached to (or whether the parent payout was later withdrawn / hard-
 * deleted — receipts now survive payout deletion via `partyId` FK +
 * `payoutId` SET NULL).
 *
 * Auth: `canUserEditParty` only. Any cohost with edit access on the party
 * sees ALL the party's receipts. The "submitter-only" filter from
 * `gouda-83912` was removed by agnolotti-58291 so the receipts library is
 * a shared per-event resource.
 *
 * Mounted BEFORE `/:partyId/payouts/:payoutId` so the literal path wins over
 * the dynamic param.
 */
router.get('/:partyId/payouts/receipts-library', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // agnolotti-58291: query payout_documents by partyId directly (no join
    // through payouts.partyId). payoutId is nullable now — receipts attached
    // to a since-deleted payout still surface here with `payoutId === null`.
    const docs = await prisma.payoutDocument.findMany({
      where: { partyId, kind: 'receipt' },
      include: {
        payout: { select: { id: true, status: true, hostUserId: true } },
        // agnolotti-58291: surface uploader name/email so the UI can render
        // "uploaded by X" — useful now that cohosts see each other's receipts.
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      receipts: docs.map((d) => ({
        id: d.id,
        payoutId: d.payoutId,
        payoutStatus: d.payout?.status ?? null,
        url: d.url,
        fileName: d.fileName,
        fileSize: d.fileSize,
        mimeType: d.mimeType,
        ocrAmount: d.ocrAmount != null ? numberFromDecimal(d.ocrAmount) : null,
        ocrCurrency: d.ocrCurrency ?? null,
        ocrConfidence: d.ocrConfidence != null ? numberFromDecimal(d.ocrConfidence) : null,
        // soppressata-92110: admin exclusion flags (read-only) so the library
        // can dim + pill receipts excluded from the host's reimbursement total.
        isDuplicate: d.isDuplicate ?? false,
        ineligible: d.ineligible ?? false,
        // agnolotti-58291: uploader attribution. Falls back to cached email
        // if the User row is later deleted.
        uploadedByUserId: d.uploadedByUserId ?? null,
        uploadedByName: d.uploadedBy?.name ?? null,
        uploadedByEmail: d.uploadedByEmail ?? d.uploadedBy?.email ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ---------- GET /:partyId/payouts/submission-readiness ----------

/**
 * porchetta-58296: drives the NewPayoutForm submit gate. Returns whether the
 * event has each of the three host-designated role photos (group/box_stack/
 * pizza) and at least one receipt. Auth mirrors the receipts-library guard
 * (`canUserEditParty`). Mounted BEFORE `/:partyId/payouts/:payoutId` so the
 * literal path wins over the dynamic param.
 */
router.get('/:partyId/payouts/submission-readiness', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const readiness = await getPayoutSubmissionReadiness(partyId);
    res.json(readiness);
  } catch (error) {
    next(error);
  }
});

// ---------- GET /:partyId/payouts/:payoutId ----------

router.get('/:partyId/payouts/:payoutId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, payoutId } = req.params;

    const adminAccess = await isAnyAdmin(req.userEmail);
    const canEdit = adminAccess || (await canUserEditParty(partyId, req.userId, req.userEmail));
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const payout = await prisma.payout.findFirst({
      where: { id: payoutId, partyId },
      include: {
        host: { select: { id: true, name: true, email: true } },
        documents: {
          orderBy: { sortOrder: 'asc' },
          include: { uploadedBy: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!payout) {
      throw new AppError('Payment not found', 404, 'NOT_FOUND');
    }

    res.json({ payout: serializePayout(payout) });
  } catch (error) {
    next(error);
  }
});

// ---------- PATCH /:partyId/payouts/:payoutId ----------

router.patch('/:partyId/payouts/:payoutId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, payoutId } = req.params;
    const {
      payoutMethod,
      payoutWalletAddress,
      payoutBankDetails,
      hostNotes,
      finalAmountUsd,
      mercuryCardLast4,
      // arugula-38633 (edit-receipts): hosts can swap photos/receipts on
      // payouts that are still pending. All three arrays are optional and
      // are applied transactionally below.
      receiptPhotos,
      pizzaPhotos,
      // pomodoro-92110: event photos (cap 30) on edit.
      eventPhotos,
      removeDocumentIds,
    } = req.body || {};

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // bresaola-49185: block edits on unapproved parties (e.g. if approval
    // was revoked after the payout was first created). GET + DELETE remain
    // open so hosts can still see and cancel pending rows.
    await assertPartyApproved(partyId);

    const existing = await prisma.payout.findFirst({
      where: { id: payoutId, partyId },
      include: { documents: true },
    });
    if (!existing) {
      throw new AppError('Payment not found', 404, 'NOT_FOUND');
    }

    // provolone-39042: split doc-only edits from amount/method/wallet edits so
    // hosts can attach receipts to already-approved payouts (Adama incident:
    // host couldn't add a receipt to their $200 approved wire). The admin
    // PATCH route stays unrestricted — this is host-side only.
    const hasAmountOrMethodChanges =
      payoutMethod !== undefined ||
      payoutWalletAddress !== undefined ||
      payoutBankDetails !== undefined ||
      finalAmountUsd !== undefined ||
      mercuryCardLast4 !== undefined ||
      hostNotes !== undefined;

    // Paid/failed/rejected payouts are frozen entirely on the host side.
    if (
      existing.status === 'paid' ||
      existing.status === 'rejected' ||
      existing.status === 'failed'
    ) {
      throw new AppError(
        `Payments cannot be edited once ${existing.status}.`,
        400,
        'NOT_EDITABLE'
      );
    }

    // Approved payouts: doc-only edits allowed, but amount/method/wallet/notes
    // are frozen so the admin-approved amount can't be silently changed.
    if (existing.status === 'approved' && hasAmountOrMethodChanges) {
      throw new AppError(
        'Approved payments cannot have amount, method, wallet, or notes changed. Ask an admin to revert to pending first.',
        400,
        'APPROVED_NOT_EDITABLE'
      );
    }

    // Pending payouts fall through unchanged — anything goes.

    // gouda-83912: only the cohost who submitted the payout (or any admin)
    // may edit it. Other cohosts on the same party can see the row but
    // cannot mutate it.
    const isAdminCaller = await isAnyAdmin(req.userEmail);
    if (!isAdminCaller && existing.hostUserId !== req.userId) {
      throw new AppError(
        'Only the cohost who submitted this payment can edit it.',
        403,
        'FORBIDDEN_NOT_OWNER',
      );
    }

    const data: Record<string, any> = {};

    if (payoutMethod !== undefined) {
      validatePayoutMethod(payoutMethod);
      validateMethodSpecificFields(payoutMethod, {
        payoutWalletAddress: payoutWalletAddress ?? existing.payoutWalletAddress,
        payoutBankDetails: payoutBankDetails ?? (existing.payoutBankDetails as any),
      });
      // pepperoni-47301: reject `mercury_card` for parties in sanctioned countries.
      await assertMercuryAllowed(partyId, payoutMethod);
      data.payoutMethod = payoutMethod;
      // Clear stale method-specific fields when method changes
      if (payoutMethod !== 'usdc_base') {
        data.payoutWalletAddress = null;
        // caciotta-92104: paired with payoutWalletAddress; never leave a
        // stale ENS string after the host switches to wire/mercury.
        data.payoutWalletInput = null;
      }
      if (payoutMethod !== 'wire') data.payoutBankDetails = Prisma.JsonNull;
      if (payoutMethod !== 'mercury_card') data.mercuryCardLast4 = null;
    }

    if (payoutWalletAddress !== undefined) {
      // taleggio-30219: resolve ENS → 0x before persisting. Null clears the field.
      // caciotta-92104: also persist the original input alongside the resolved
      // 0x so admin UI can render "name.eth -> 0xa1b2...". Null clears both.
      if (payoutWalletAddress === null) {
        data.payoutWalletAddress = null;
        data.payoutWalletInput = null;
      } else {
        const r = await resolveWalletOrThrowWithMeta(String(payoutWalletAddress));
        data.payoutWalletAddress = r.address;
        data.payoutWalletInput = r.walletInput;
      }
    }
    if (payoutBankDetails !== undefined) {
      data.payoutBankDetails = payoutBankDetails === null
        ? Prisma.JsonNull
        : (payoutBankDetails as Prisma.InputJsonValue);
    }
    if (mercuryCardLast4 !== undefined) {
      data.mercuryCardLast4 = mercuryCardLast4 === null
        ? null
        : String(mercuryCardLast4).slice(-4);
    }
    if (hostNotes !== undefined) {
      data.hostNotes = typeof hostNotes === 'string' && hostNotes.trim().length > 0
        ? sanitizePgString(hostNotes.trim())
        : null;
    }
    if (finalAmountUsd !== undefined) {
      const n = Number(finalAmountUsd);
      if (!Number.isFinite(n) || n <= 0) {
        throw new AppError('finalAmountUsd must be a positive number', 400, 'INVALID_AMOUNT');
      }
      // speck-89172: host PATCH is no longer cap-enforced. The amber flag on
      // /payments rows surfaces over-cap edits for admin moderation; admin
      // PATCH (aglio-62584) retains the per-submission ceiling via the
      // override checkbox.
      data.finalAmountUsd = new Decimal(n);
    }

    // ---- arugula-38633 (edit-receipts): document edits ----

    // Validate input shapes.
    if (receiptPhotos !== undefined && !Array.isArray(receiptPhotos)) {
      throw new AppError('receiptPhotos must be an array', 400, 'INVALID_RECEIPTS');
    }
    if (pizzaPhotos !== undefined && !Array.isArray(pizzaPhotos)) {
      throw new AppError('pizzaPhotos must be an array', 400, 'INVALID_PIZZA_PHOTOS');
    }
    if (eventPhotos !== undefined && !Array.isArray(eventPhotos)) {
      throw new AppError('eventPhotos must be an array', 400, 'INVALID_EVENT_PHOTOS');
    }
    if (removeDocumentIds !== undefined && !Array.isArray(removeDocumentIds)) {
      throw new AppError('removeDocumentIds must be an array', 400, 'INVALID_REMOVE_IDS');
    }

    const newReceipts: IncomingDocument[] = Array.isArray(receiptPhotos) ? receiptPhotos : [];
    const newPizza: IncomingDocument[] = Array.isArray(pizzaPhotos) ? pizzaPhotos : [];
    const newEvent: IncomingDocument[] = Array.isArray(eventPhotos) ? eventPhotos : [];
    const removeIds: string[] = Array.isArray(removeDocumentIds)
      ? removeDocumentIds.filter((s: unknown): s is string => typeof s === 'string')
      : [];

    if (newReceipts.length > 10) {
      throw new AppError('Max 10 receipt photos', 400, 'TOO_MANY_RECEIPTS');
    }
    // pomodoro-92110: caps enforced as a TOTAL (surviving existing + new), not
    // per-batch. `removeIds` is already filtered above; survivors = existing
    // docs of that kind that aren't being removed in this same PATCH.
    const removedSet = new Set(removeIds);
    const survivingPizza = existing.documents.filter(
      d => d.kind === 'pizza' && !removedSet.has(d.id)
    ).length;
    const survivingEvent = existing.documents.filter(
      d => d.kind === 'event' && !removedSet.has(d.id)
    ).length;
    if (survivingPizza + newPizza.length > 10) {
      throw new AppError('Max 10 pizza photos', 400, 'TOO_MANY_PIZZA_PHOTOS');
    }
    if (survivingEvent + newEvent.length > 30) {
      throw new AppError('Max 30 event photos', 400, 'TOO_MANY_EVENT_PHOTOS');
    }

    // Verify each new URL points into the bucket scoped to this party.
    for (const r of newReceipts) {
      if (!r || typeof r.url !== 'string') {
        throw new AppError('Each receiptPhoto must have a url', 400, 'INVALID_RECEIPT');
      }
      assertSupabasePayoutUrl(r.url, partyId);
    }
    for (const p of newPizza) {
      if (!p || typeof p.url !== 'string') {
        throw new AppError('Each pizzaPhoto must have a url', 400, 'INVALID_PIZZA_PHOTO');
      }
      assertSupabasePayoutUrl(p.url, partyId);
    }
    // pomodoro-92110: same bucket-scope validation for event photos.
    for (const p of newEvent) {
      if (!p || typeof p.url !== 'string') {
        throw new AppError('Each eventPhoto must have a url', 400, 'INVALID_EVENT_PHOTO');
      }
      assertSupabasePayoutUrl(p.url, partyId);
    }

    // Verify every removeId actually belongs to this payout.
    const existingDocIds = new Set(existing.documents.map(d => d.id));
    for (const id of removeIds) {
      if (!existingDocIds.has(id)) {
        throw new AppError(
          `Document ${id} does not belong to this payout`,
          400,
          'INVALID_REMOVE_ID'
        );
      }
    }

    // mortadella-92103: country prior for OCR (`$` ambiguity).
    const partyForPatchOcr = await prisma.party.findUnique({
      where: { id: partyId },
      select: { country: true },
    });
    const patchPartyCountry = partyForPatchOcr?.country ?? null;

    // Run OCR on each new receipt in parallel BEFORE the transaction so the
    // transaction stays short and we can roll up the new OCR sum cleanly.
    const ocrResults = newReceipts.length === 0
      ? []
      : await Promise.allSettled(
          newReceipts.map(async (r) => {
            try {
              // provolone-49301: trust the forwarded preview-OCR payload and
              // skip a second analyzeReceipt pass when present (parity with
              // POST /payouts). USD + rate still come from convertToUSD.
              if (Number.isFinite(r.ocrOriginalAmount) && (r.ocrOriginalAmount as number) >= 0) {
                const ocr = {
                  amount: r.ocrOriginalAmount as number,
                  currency: (typeof r.ocrOriginalCurrency === 'string' && r.ocrOriginalCurrency.trim()) ? r.ocrOriginalCurrency.trim().slice(0, 8) : null,
                  confidence: Math.min(1, Math.max(0, Number(r.ocrConfidence) || 0)),
                  lineItems: Array.isArray(r.ocrLineItems) ? (r.ocrLineItems as any[]).slice(0, 100) : undefined,
                  raw: r.ocrRaw ?? null,
                };
                const fx = await convertToUSD(ocr.amount, ocr.currency);
                return { ok: true as const, doc: r, ocr, fx };
              }
              // Fallback (no forwarded payload): OCR here.
              // bocconcino-92104: PDFs are OCR'd via their `.thumb.png` sibling.
              const ocr = await analyzeReceipt({
                imageUrl: deriveOcrUrl(r),
                partyCountry: patchPartyCountry,
              });
              const fx = await convertToUSD(ocr.amount, ocr.currency);
              return { ok: true as const, doc: r, ocr, fx };
            } catch (err: any) {
              return { ok: false as const, doc: r, error: err?.message || 'OCR failed' };
            }
          })
        );

    // Build the receipt-document creates from the OCR results.
    const newReceiptDocs: Array<{
      kind: string;
      url: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      ocrAmount: Decimal | null;
      ocrCurrency: string | null;
      ocrConfidence: Decimal | null;
      // mortadella-92103: per-receipt FX persistence.
      originalAmount: Decimal | null;
      originalCurrency: string | null;
      exchangeRate: Decimal | null;
      ocrRaw: any;
      // formaggi-89172: per-line structured items extracted from the receipt.
      ocrLineItems: any;
      ocrError: string | null;
      sortOrder: number;
      // napoletana-58211: kept here for shape parity with newPizzaDocs so the
      // combined createMany call below has a uniform input type. Receipts
      // always carry null.
      photoId: string | null;
    }> = [];
    let newOcrSum = 0;
    interface FxHeadline {
      originalAmount: number;
      originalCurrency: string;
      exchangeRate: number;
    }
    // Note: typed via an array slot to avoid TS narrowing the `null` initializer
    // through the forEach closure boundary.
    const firstFxBox: { value: FxHeadline | null } = { value: null };

    ocrResults.forEach((settled, i) => {
      const doc = newReceipts[i];
      const result = settled.status === 'fulfilled' ? settled.value : null;
      if (result && result.ok) {
        const { ocr, fx } = result;
        // mortadella-92103: don't count unresolved-currency receipts in the
        // sum. Same rules as the POST aggregator.
        const unresolved = fx.source === 'unresolved' || fx.usdAmount == null;
        if (!unresolved) {
          newOcrSum += fx.usdAmount!;
          if (firstFxBox.value === null && fx.originalCurrency && fx.exchangeRate != null) {
            firstFxBox.value = {
              originalAmount: fx.originalAmount,
              originalCurrency: fx.originalCurrency,
              exchangeRate: fx.exchangeRate,
            };
          }
        }
        newReceiptDocs.push({
          kind: 'receipt',
          url: doc.url,
          fileName: doc.fileName || extractFileName(doc.url),
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : 0,
          mimeType: doc.mimeType || 'image/jpeg',
          ocrAmount: unresolved ? null : new Decimal(fx.usdAmount!),
          ocrCurrency: unresolved ? null : fx.originalCurrency,
          ocrConfidence: new Decimal(ocr.confidence),
          originalAmount: new Decimal(fx.originalAmount),
          originalCurrency: unresolved ? null : (fx.originalCurrency ?? null),
          exchangeRate: unresolved ? null : (fx.exchangeRate != null ? new Decimal(fx.exchangeRate) : null),
          ocrRaw: sanitizeForPg({ ocr: ocr.raw, fx: { source: fx.source, rate: fx.exchangeRate } }),
          // formaggi-89172: structured per-line items for pizza-price analytics.
          ocrLineItems: ocr.lineItems && ocr.lineItems.length > 0 ? sanitizeForPg(ocr.lineItems) : null,
          ocrError: unresolved ? 'CURRENCY_UNRESOLVED' : null,
          sortOrder: i,
          photoId: null,
        });
      } else {
        const err = result && !result.ok ? result.error : 'Unexpected OCR result';
        newReceiptDocs.push({
          kind: 'receipt',
          url: doc.url,
          fileName: doc.fileName || extractFileName(doc.url),
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : 0,
          mimeType: doc.mimeType || 'image/jpeg',
          ocrAmount: null,
          ocrCurrency: null,
          ocrConfidence: null,
          originalAmount: null,
          originalCurrency: null,
          exchangeRate: null,
          ocrRaw: null,
          ocrLineItems: null,
          ocrError: err,
          sortOrder: i,
          photoId: null,
        });
      }
    });

    const newPizzaDocs = newPizza.map((p, i) => ({
      kind: 'pizza',
      url: p.url,
      fileName: p.fileName || extractFileName(p.url),
      fileSize: typeof p.fileSize === 'number' ? p.fileSize : 0,
      mimeType: p.mimeType || 'image/jpeg',
      ocrAmount: null,
      ocrCurrency: null,
      ocrConfidence: null,
      // mortadella-92103: pizza photos have no FX detail.
      originalAmount: null as Decimal | null,
      originalCurrency: null as string | null,
      exchangeRate: null as Decimal | null,
      ocrRaw: null,
      ocrLineItems: null,
      ocrError: null,
      sortOrder: i,
      // napoletana-58211: filled in inside the transaction below — we
      // insert the canonical photos row first, then attach its id.
      photoId: null as string | null,
    }));

    // pomodoro-92110: event photos — same shape as newPizzaDocs (kind:'event'),
    // mirrored to the gallery in the transaction below.
    const newEventDocs = newEvent.map((p, i) => ({
      kind: 'event',
      url: p.url,
      fileName: p.fileName || extractFileName(p.url),
      fileSize: typeof p.fileSize === 'number' ? p.fileSize : 0,
      mimeType: p.mimeType || 'image/jpeg',
      ocrAmount: null,
      ocrCurrency: null,
      ocrConfidence: null,
      originalAmount: null as Decimal | null,
      originalCurrency: null as string | null,
      exchangeRate: null as Decimal | null,
      ocrRaw: null,
      ocrLineItems: null,
      ocrError: null,
      sortOrder: i,
      photoId: null as string | null,
    }));

    const documentsChanged = newReceiptDocs.length > 0 || newPizzaDocs.length > 0 || newEventDocs.length > 0 || removeIds.length > 0;
    const explicitAmount = data.finalAmountUsd !== undefined;

    // If receipts changed AND host didn't pass finalAmountUsd, recompute from
    // the remaining + newly-added receipt OCR sums. We compute *post-removal*
    // sum by walking the existing docs minus the removed ids.
    let recomputedAmount: Decimal | null = null;
    let recomputedExtractedUsd: Decimal | null = null;
    let recomputedOriginalAmount: Decimal | null = null;
    let recomputedOriginalCurrency: string | null = null;
    let recomputedExchangeRate: Decimal | null = null;

    const receiptsChanged = newReceiptDocs.length > 0 || removeIds.some(
      id => existing.documents.find(d => d.id === id)?.kind === 'receipt'
    );

    // provolone-39042: only pending payouts auto-recompute finalAmountUsd from
    // the OCR sum when receipts change. Approved payouts keep their
    // admin-approved amount even if new receipts are attached — the OCR sum
    // becomes informational only.
    const allowRecompute = existing.status === 'pending';

    if (receiptsChanged && allowRecompute) {
      // pomodoro-92110: reuse the hoisted `removedSet` declared above (total-cap
      // check) instead of re-declaring it here.
      const survivingReceipts = existing.documents.filter(
        d => d.kind === 'receipt' && !removedSet.has(d.id)
      );
      // culatello-92104: admin-flagged duplicates are excluded from the
      // recompute sum so the admin's intent (these two receipts are the
      // same purchase) propagates back to the payout's finalAmountUsd on
      // the next host-side edit. Receipts persist for evidence either way.
      // provola-92106: admin-flagged ineligible receipts (alcohol, tips,
      // personal items) get the same exclusion treatment — distinct from
      // duplicate but identical math. The reviewer modal's `ocrSum` already
      // mirrors this filter; this keeps the host PATCH recompute consistent.
      const survivingOcrSum = survivingReceipts.reduce(
        (sum, d) =>
          sum
          + (d.isDuplicate || d.ineligible
            ? 0
            : d.ocrAmount != null
              ? Number(d.ocrAmount.toString())
              : 0),
        0
      );
      const fullOcrSum = survivingOcrSum + newOcrSum;
      recomputedExtractedUsd = new Decimal(fullOcrSum);

      if (!explicitAmount && fullOcrSum > 0) {
        recomputedAmount = new Decimal(fullOcrSum);

        // crocchetta-92103: clamp the recomputed amount to the party's effective
        // cap. Receipts retain their full OCR amounts as evidence; the payout's
        // final_amount_usd reflects what we'll actually reimburse. Admin PATCH
        // (panettone-92103) bypasses this path entirely.
        const partyForCap = await prisma.party.findUnique({
          where: { id: partyId },
          select: { reimbursementCapUsd: true, eventTags: true },
        });
        const cap = computeEffectiveCapUsd({
          reimbursementCapUsd: partyForCap?.reimbursementCapUsd,
          eventTags: partyForCap?.eventTags,
        });
        const recomputedNum = Number(recomputedAmount.toString());
        if (typeof cap === 'number' && cap > 0 && recomputedNum > cap) {
          recomputedAmount = new Decimal(cap);
        }
      }

      // If this is the first receipt OCR'd successfully, pull FX headline
      // fields from it. Otherwise leave existing headline FX in place.
      const hadAnyOcr = existing.documents.some(
        d => d.kind === 'receipt' && !removedSet.has(d.id) && d.ocrAmount != null
      );
      const fx = firstFxBox.value;
      if (!hadAnyOcr && fx) {
        recomputedOriginalAmount = new Decimal(fx.originalAmount);
        recomputedOriginalCurrency = fx.originalCurrency;
        recomputedExchangeRate = new Decimal(fx.exchangeRate);
      }
    }

    const oldAmount = Number(existing.finalAmountUsd.toString());
    const newAmount = explicitAmount
      ? Number((data.finalAmountUsd as Decimal).toString())
      : (recomputedAmount != null ? Number(recomputedAmount.toString()) : oldAmount);
    const amountChanged = newAmount !== oldAmount;

    // speck-89172: cap enforcement on receipt-edit recompute removed — the
    // amber flag on /payments rows surfaces over-cap edits for admin
    // moderation. Admin PATCH (aglio-62584) retains the per-submission
    // ceiling via its override checkbox.

    // Single transaction: delete removed docs, insert new docs, update payout,
    // write the audit row(s).
    const updated = await prisma.$transaction(async (tx) => {
      if (removeIds.length > 0) {
        await tx.payoutDocument.deleteMany({
          where: { id: { in: removeIds }, payoutId: existing.id },
        });
      }
      if (newReceiptDocs.length > 0 || newPizzaDocs.length > 0 || newEventDocs.length > 0) {
        // pancetta-37195: stamp the editing user on every new document so
        // the per-receipt "Uploaded by X" line shows the cohost who added it,
        // not the original payout submitter.
        const uploaderUserId = req.userId ?? null;
        const uploaderEmail = req.userEmail ?? null;

        // napoletana-58211: insert photos rows for each new pizza doc FIRST
        // (auto-approved + auto-starred) and stamp photoId so the
        // payout_documents row links to the canonical photos record. If any
        // photos.create fails, the surrounding transaction aborts and the
        // patch is rolled back. Receipts skip this step (photoId stays null).
        // pomodoro-92110: event docs mirror to the gallery exactly like pizza,
        // so iterate both arrays here.
        //
        // sicilian-58196: dedup pre-check before insert — if a photo already
        // exists with the same (partyId, fileSize, mimeType), reuse it
        // instead of creating a duplicate row.
        const now = new Date();
        for (const d of [...newPizzaDocs, ...newEventDocs]) {
          const dup = await tx.photo.findFirst({
            where: {
              partyId,
              fileSize: d.fileSize,
              mimeType: d.mimeType,
            },
            select: { id: true },
          });
          if (dup) {
            d.photoId = dup.id;
            continue;
          }
          const photo = await tx.photo.create({
            data: {
              partyId,
              url: d.url,
              fileName: d.fileName,
              fileSize: d.fileSize,
              mimeType: d.mimeType,
              uploadedBy: null,
              uploaderName: null,
              uploaderEmail: uploaderEmail,
              status: 'approved',
              starred: true,
              starredAt: now,
              reviewedAt: now,
              reviewedBy: uploaderUserId,
            },
            select: { id: true },
          });
          d.photoId = photo.id;
        }

        await tx.payoutDocument.createMany({
          data: [...newReceiptDocs, ...newPizzaDocs, ...newEventDocs].map(d => ({
            ...d,
            // agnolotti-58291: stamp partyId on every new doc — the FK is now
            // NOT NULL party-side, optional payout-side.
            partyId,
            payoutId: existing.id,
            uploadedByUserId: uploaderUserId,
            uploadedByEmail: uploaderEmail,
            ocrRaw: d.ocrRaw === null ? Prisma.JsonNull : (d.ocrRaw as Prisma.InputJsonValue),
            // formaggi-89172: same JsonNull handling as ocrRaw — Prisma needs
            // an explicit JsonNull marker (not JS null) to insert a SQL NULL
            // into a JSONB column via createMany.
            ocrLineItems: d.ocrLineItems == null ? Prisma.JsonNull : (d.ocrLineItems as Prisma.InputJsonValue),
          })),
        });
      }

      // Apply scalar updates + (optionally) recomputed amount/FX.
      const finalData = { ...data };
      if (recomputedAmount && !explicitAmount) {
        finalData.finalAmountUsd = recomputedAmount;
      }
      if (recomputedExtractedUsd) {
        finalData.extractedAmountUsd = recomputedExtractedUsd;
      }
      if (recomputedOriginalAmount) {
        finalData.originalAmount = recomputedOriginalAmount;
        finalData.originalCurrency = recomputedOriginalCurrency;
        finalData.exchangeRate = recomputedExchangeRate;
      }

      const row = Object.keys(finalData).length > 0
        ? await tx.payout.update({
            where: { id: payoutId },
            data: finalData,
            include: {
              host: { select: { id: true, name: true, email: true } },
              documents: {
                orderBy: { sortOrder: 'asc' },
                include: { uploadedBy: { select: { id: true, name: true, email: true } } },
              },
            },
          })
        : await tx.payout.findUniqueOrThrow({
            where: { id: payoutId },
            include: {
              host: { select: { id: true, name: true, email: true } },
              documents: {
                orderBy: { sortOrder: 'asc' },
                include: { uploadedBy: { select: { id: true, name: true, email: true } } },
              },
            },
          });

      // Audit: write a row when amount changes OR docs change. Mirror the
      // admin edit_amount shape; use a distinct 'edit_documents' action when
      // only documents (no amount) changed.
      const auditActorEmail = req.userEmail || 'unknown';
      if (amountChanged) {
        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'edit_amount',
            oldAmount: new Decimal(oldAmount) as any,
            newAmount: new Decimal(newAmount) as any,
            actorEmail: auditActorEmail,
            actorKind: 'host',
            note: documentsChanged
              ? `Host edit (${newReceiptDocs.length} new receipt(s), ${newPizzaDocs.length} new pizza photo(s), ${newEventDocs.length} new event photo(s), ${removeIds.length} removed)`
              : 'Host edit',
          },
        });
      } else if (documentsChanged) {
        await tx.payoutAudit.create({
          data: {
            payoutId: existing.id,
            action: 'edit_documents',
            actorEmail: auditActorEmail,
            actorKind: 'host',
            note: `Host edit (${newReceiptDocs.length} new receipt(s), ${newPizzaDocs.length} new pizza photo(s), ${newEventDocs.length} new event photo(s), ${removeIds.length} removed)`,
          },
        });
      }

      return row;
    });

    res.json({ payout: serializePayout(updated) });
  } catch (error) {
    next(error);
  }
});

// ---------- DELETE /:partyId/payouts/:payoutId ----------

/**
 * ravioli-82931: soft-withdraw. Replaced the hard-delete from gelato-72831
 * with `status = 'withdrawn'` so the linked payout_documents (receipts) are
 * preserved. Withdrawn rows are hidden from the host's active list (see GET
 * above) and from `assertWithinPartyCap`'s per-party sum (it only counts
 * `paid|pending|approved`), but remain reachable for the host's receipts
 * library and visible in the admin queue for transparency.
 *
 * The HTTP verb stays DELETE for backward-compat with the cancelPayout API
 * client; the response shape is unchanged.
 */
router.delete('/:partyId/payouts/:payoutId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, payoutId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const existing = await prisma.payout.findFirst({
      where: { id: payoutId, partyId },
    });
    if (!existing) {
      throw new AppError('Payment not found', 404, 'NOT_FOUND');
    }
    if (!WITHDRAWABLE_STATUSES.includes(existing.status as (typeof WITHDRAWABLE_STATUSES)[number])) {
      throw new AppError(
        'This payment can no longer be withdrawn',
        400,
        'PAYOUT_NOT_WITHDRAWABLE'
      );
    }

    // gouda-83912: only the cohost who submitted the payout (or any admin)
    // may withdraw it. Other cohosts on the same party can see the row but
    // cannot mutate it.
    const isAdminCaller = await isAnyAdmin(req.userEmail);
    if (!isAdminCaller && existing.hostUserId !== req.userId) {
      throw new AppError(
        'Only the cohost who submitted this payment can withdraw it.',
        403,
        'FORBIDDEN_NOT_OWNER',
      );
    }

    // ravioli-82931: soft-delete via status flip + 'cancel' audit row. Using
    // 'cancel' (already in the action enum) instead of adding a new
    // 'withdraw' constraint value to keep this PR DB-migration-scope small.
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: 'withdrawn' },
      });
      await tx.payoutAudit.create({
        data: {
          payoutId,
          action: 'cancel',
          oldStatus: existing.status,
          newStatus: 'withdrawn',
          actorEmail: (req.userEmail || '').toLowerCase(),
          actorKind: 'host',
          note: 'Host withdrew payment request (receipts preserved).',
        },
      });
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---------- helpers (file name parsing) ----------

function extractFileName(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  } catch {
    return 'upload';
  }
}

export default router;
