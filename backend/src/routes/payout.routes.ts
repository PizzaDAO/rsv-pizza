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
import { looksLikeEnsName, resolveWalletInput } from '../services/ens.service.js';
import { isMercuryBlocked } from '../lib/mercuryBlockedCountries.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';

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
    ocrError: d.ocrError ?? null,
    sortOrder: d.sortOrder,
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
 * acciuga-62583: hard per-submission ceiling of $625. Independent of the
 * per-party cap (tiramisu-49102): even on uncapped parties, no single payout
 * row can exceed $625. Same numeric value as `HARD_PER_TX_CEILING_USD` in
 * usdc-base.service.ts (the USDC-execute ceiling) but enforced here at
 * SUBMISSION time across all methods — no override path. Hosts split larger
 * expenses across multiple submissions.
 */
const PER_SUBMISSION_MAX_USD = 625;

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

  const where: any = {
    partyId,
    status: { in: ['paid', 'pending', 'approved'] },
  };
  if (ignorePayoutId) {
    where.id = { not: ignorePayoutId };
  }
  const existingTotal = await prisma.payout.aggregate({
    where,
    _sum: { finalAmountUsd: true },
  });
  const usedUsd = existingTotal._sum.finalAmountUsd
    ? Number(existingTotal._sum.finalAmountUsd.toString())
    : 0;
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

      const ocr = await analyzeReceipt(imageUrl);
      const fx = await convertToUSD(ocr.amount, ocr.currency);

      res.json({
        amount: fx.usdAmount,
        currency: 'USD',
        originalAmount: fx.originalAmount,
        originalCurrency: fx.originalCurrency,
        exchangeRate: fx.exchangeRate,
        confidence: ocr.confidence,
        items: ocr.items,
        fxSource: fx.source,
        conversionNote:
          fx.originalCurrency !== 'USD'
            ? `Converted from ${fx.originalAmount.toLocaleString()} ${fx.originalCurrency} → $${fx.usdAmount.toFixed(2)} USD (1 ${fx.originalCurrency} = $${fx.exchangeRate.toFixed(6)} USD)`
            : undefined,
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
      // when no provider can serve the currency. Reject that case so the
      // host gets explicit feedback (and so the dropdown reverts client-side).
      if (fx.source === 'unknown') {
        throw new AppError(
          `Could not look up exchange rate for currency "${originalCurrency.trim().toUpperCase()}".`,
          400,
          'UNKNOWN_CURRENCY'
        );
      }

      res.json({
        usdAmount: fx.usdAmount,
        originalAmount: fx.originalAmount,
        originalCurrency: fx.originalCurrency,
        exchangeRate: fx.exchangeRate,
        source: fx.source,
        conversionNote:
          fx.originalCurrency !== 'USD'
            ? `Converted from ${fx.originalAmount.toLocaleString()} ${fx.originalCurrency} → $${fx.usdAmount.toFixed(2)} USD (1 ${fx.originalCurrency} = $${fx.exchangeRate.toFixed(6)} USD)`
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
}

router.post('/:partyId/payouts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      pizzaPhotos = [],
      receiptPhotos = [],
      hostNotes,
      payoutMethod,
      payoutWalletAddress,
      payoutBankDetails,
      mercuryCardLast4,
      finalAmountUsd,
      saveAsDefault,
      estimatedAttendance,
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
              const ocr = await analyzeReceipt(r.url);
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
      ocrRaw: any;
      ocrError: string | null;
      sortOrder: number;
    }> = [];

    let idx = 0;
    for (const settled of ocrResults) {
      // Promise.allSettled always resolves; the inner promise we created also
      // always resolves to either ok or error, so settled.value is defined.
      const result = settled.status === 'fulfilled' ? settled.value : null;
      const doc = (receiptPhotos as IncomingDocument[])[idx];
      if (result && result.ok) {
        const { ocr, fx } = result;
        extractedUsdSum += fx.usdAmount;
        if (!foundFirstRate) {
          originalAmount = fx.originalAmount;
          originalCurrency = fx.originalCurrency;
          exchangeRate = fx.exchangeRate;
          foundFirstRate = true;
        }
        docsToCreate.push({
          kind: 'receipt',
          url: doc.url,
          fileName: doc.fileName || extractFileName(doc.url),
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : 0,
          mimeType: doc.mimeType || 'image/jpeg',
          ocrAmount: new Decimal(fx.usdAmount),
          ocrCurrency: fx.originalCurrency,
          ocrConfidence: new Decimal(ocr.confidence),
          ocrRaw: { ocr: ocr.raw, fx: { source: fx.source, rate: fx.exchangeRate } },
          ocrError: null,
          sortOrder: idx,
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
          ocrRaw: null,
          ocrError: err,
          sortOrder: idx,
        });
      }
      idx++;
    }

    // Pizza photos: no OCR, just persist
    (pizzaPhotos as IncomingDocument[]).forEach((p, i) => {
      docsToCreate.push({
        kind: 'pizza',
        url: p.url,
        fileName: p.fileName || extractFileName(p.url),
        fileSize: typeof p.fileSize === 'number' ? p.fileSize : 0,
        mimeType: p.mimeType || 'image/jpeg',
        ocrAmount: null,
        ocrCurrency: null,
        ocrConfidence: null,
        ocrRaw: null,
        ocrError: null,
        sortOrder: i,
      });
    });

    // Final amount: host override (if provided) or OCR sum
    const finalUsd = typeof finalAmountUsd === 'number' && finalAmountUsd > 0
      ? finalAmountUsd
      : extractedUsdSum;

    if (finalUsd <= 0) {
      throw new AppError(
        'Could not determine payment amount — OCR returned $0 for all receipts and no manual amount was provided',
        400,
        'INVALID_AMOUNT'
      );
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
        ? adminNotesRaw.trim()
        : null;

    // taleggio-30219: resolve the wallet input once, BEFORE the create, so
    // we persist a canonical 0x address even if the host typed an ENS name.
    // Reused by the `saveAsDefault` write below so we don't resolve twice.
    let resolvedWallet: string | null = null;
    if (hasMethod && payoutMethod === 'usdc_base' && typeof payoutWalletAddress === 'string') {
      resolvedWallet = await resolveWalletOrThrow(payoutWalletAddress);
    }

    // pancetta-37195: stamp each new document with the uploader.
    const uploaderUserId = req.userId ?? null;
    const uploaderEmail = req.userEmail ?? null;
    const docsToCreateStamped = docsToCreate.map(d => ({
      ...d,
      uploadedByUserId: uploaderUserId,
      uploadedByEmail: uploaderEmail,
    }));

    // Create the payout + its documents atomically.
    const payout = await prisma.payout.create({
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
        ...(hasMethod && payoutMethod === 'wire' && payoutBankDetails && typeof payoutBankDetails === 'object'
          ? { payoutBankDetails: payoutBankDetails as Prisma.InputJsonValue }
          : {}),
        mercuryCardLast4: hasMethod && payoutMethod === 'mercury_card' && typeof mercuryCardLast4 === 'string'
          ? mercuryCardLast4.slice(-4)
          : null,
        hostNotes: typeof hostNotes === 'string' && hostNotes.trim().length > 0
          ? hostNotes.trim()
          : null,
        // bismarck-92103: admin-supplied adminNotes (e.g. "Prepayment for X")
        // when an admin creates a prepayment on behalf of a cohost.
        adminNotes: initialAdminNotes,
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
 * ravioli-82931: the host's submitted receipts (kind='receipt' documents)
 * across ALL their payouts on this party, including withdrawn. Lets hosts see
 * what they've previously submitted even after they withdrew the request.
 *
 * Mounted BEFORE `/:partyId/payouts/:payoutId` so the literal path wins over
 * the dynamic param. Auth mirrors `gouda-83912`: requires `canUserEditParty`
 * AND the caller must be the submitter (`hostUserId === req.userId`) OR an
 * admin. Other cohosts on the same party can't see each other's receipts.
 */
router.get('/:partyId/payouts/receipts-library', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const isAdminCaller = await isAnyAdmin(req.userEmail);

    // Pull all receipt documents for payouts on this party where the caller
    // is the submitter (or admin — admins can see across all submitters).
    const payoutWhere: any = { partyId };
    if (!isAdminCaller) {
      payoutWhere.hostUserId = req.userId;
    }

    const docs = await prisma.payoutDocument.findMany({
      where: {
        kind: 'receipt',
        payout: payoutWhere,
      },
      include: {
        payout: { select: { id: true, status: true } },
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
        createdAt: d.createdAt.toISOString(),
      })),
    });
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
      if (payoutMethod !== 'usdc_base') data.payoutWalletAddress = null;
      if (payoutMethod !== 'wire') data.payoutBankDetails = Prisma.JsonNull;
      if (payoutMethod !== 'mercury_card') data.mercuryCardLast4 = null;
    }

    if (payoutWalletAddress !== undefined) {
      // taleggio-30219: resolve ENS → 0x before persisting. Null clears the field.
      data.payoutWalletAddress = payoutWalletAddress === null
        ? null
        : await resolveWalletOrThrow(String(payoutWalletAddress));
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
        ? hostNotes.trim()
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
    if (removeDocumentIds !== undefined && !Array.isArray(removeDocumentIds)) {
      throw new AppError('removeDocumentIds must be an array', 400, 'INVALID_REMOVE_IDS');
    }

    const newReceipts: IncomingDocument[] = Array.isArray(receiptPhotos) ? receiptPhotos : [];
    const newPizza: IncomingDocument[] = Array.isArray(pizzaPhotos) ? pizzaPhotos : [];
    const removeIds: string[] = Array.isArray(removeDocumentIds)
      ? removeDocumentIds.filter((s: unknown): s is string => typeof s === 'string')
      : [];

    if (newReceipts.length > 10) {
      throw new AppError('Max 10 receipt photos', 400, 'TOO_MANY_RECEIPTS');
    }
    if (newPizza.length > 10) {
      throw new AppError('Max 10 pizza photos', 400, 'TOO_MANY_PIZZA_PHOTOS');
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

    // Run OCR on each new receipt in parallel BEFORE the transaction so the
    // transaction stays short and we can roll up the new OCR sum cleanly.
    const ocrResults = newReceipts.length === 0
      ? []
      : await Promise.allSettled(
          newReceipts.map(async (r) => {
            try {
              const ocr = await analyzeReceipt(r.url);
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
      ocrRaw: any;
      ocrError: string | null;
      sortOrder: number;
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
        newOcrSum += fx.usdAmount;
        if (firstFxBox.value === null) {
          firstFxBox.value = {
            originalAmount: fx.originalAmount,
            originalCurrency: fx.originalCurrency,
            exchangeRate: fx.exchangeRate,
          };
        }
        newReceiptDocs.push({
          kind: 'receipt',
          url: doc.url,
          fileName: doc.fileName || extractFileName(doc.url),
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : 0,
          mimeType: doc.mimeType || 'image/jpeg',
          ocrAmount: new Decimal(fx.usdAmount),
          ocrCurrency: fx.originalCurrency,
          ocrConfidence: new Decimal(ocr.confidence),
          ocrRaw: { ocr: ocr.raw, fx: { source: fx.source, rate: fx.exchangeRate } },
          ocrError: null,
          sortOrder: i,
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
          ocrRaw: null,
          ocrError: err,
          sortOrder: i,
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
      ocrRaw: null,
      ocrError: null,
      sortOrder: i,
    }));

    const documentsChanged = newReceiptDocs.length > 0 || newPizzaDocs.length > 0 || removeIds.length > 0;
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
      const removedSet = new Set(removeIds);
      const survivingReceipts = existing.documents.filter(
        d => d.kind === 'receipt' && !removedSet.has(d.id)
      );
      const survivingOcrSum = survivingReceipts.reduce(
        (sum, d) => sum + (d.ocrAmount != null ? Number(d.ocrAmount.toString()) : 0),
        0
      );
      const fullOcrSum = survivingOcrSum + newOcrSum;
      recomputedExtractedUsd = new Decimal(fullOcrSum);

      if (!explicitAmount && fullOcrSum > 0) {
        recomputedAmount = new Decimal(fullOcrSum);
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
      if (newReceiptDocs.length > 0 || newPizzaDocs.length > 0) {
        // pancetta-37195: stamp the editing user on every new document so
        // the per-receipt "Uploaded by X" line shows the cohost who added it,
        // not the original payout submitter.
        const uploaderUserId = req.userId ?? null;
        const uploaderEmail = req.userEmail ?? null;
        await tx.payoutDocument.createMany({
          data: [...newReceiptDocs, ...newPizzaDocs].map(d => ({
            ...d,
            payoutId: existing.id,
            uploadedByUserId: uploaderUserId,
            uploadedByEmail: uploaderEmail,
            ocrRaw: d.ocrRaw === null ? Prisma.JsonNull : (d.ocrRaw as Prisma.InputJsonValue),
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
              ? `Host edit (${newReceiptDocs.length} new receipt(s), ${newPizzaDocs.length} new photo(s), ${removeIds.length} removed)`
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
            note: `Host edit (${newReceiptDocs.length} new receipt(s), ${newPizzaDocs.length} new photo(s), ${removeIds.length} removed)`,
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
