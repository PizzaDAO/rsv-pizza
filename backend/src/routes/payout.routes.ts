/**
 * Host-facing payout routes (arugula-38633, PR 3/5).
 *
 * Mounted at `/api/parties`. Endpoints:
 *   POST   /:partyId/payouts                Create a new payout request (with parallel OCR)
 *   GET    /:partyId/payouts                List payouts for a party (host view)
 *   GET    /:partyId/payouts/:payoutId      Detail (host or any admin)
 *   PATCH  /:partyId/payouts/:payoutId      Update (host, while status='pending' only)
 *   DELETE /:partyId/payouts/:payoutId      Cancel (host, while status='pending' only)
 *   POST   /:partyId/payouts/ocr-preview    OCR a single uploaded image without saving
 *
 * Admin execution + approval/rejection endpoints land in PR 4 / PR 5.
 */

import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { analyzeReceipt } from '../services/ocr.service.js';
import { convertToUSD } from '../services/fx.service.js';
import { looksLikeEnsName, resolveWalletInput } from '../services/ens.service.js';
import { isMercuryBlocked } from '../lib/mercuryBlockedCountries.js';

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
    adminNotes: p.adminNotes ?? null,
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
      throw new AppError('wire requires payoutBankDetails', 400, 'MISSING_BANK_DETAILS');
    }
    if (typeof d.accountHolderName !== 'string' || !d.accountHolderName.trim()) {
      throw new AppError('payoutBankDetails.accountHolderName is required', 400, 'MISSING_BANK_DETAILS');
    }
    if (typeof d.bankName !== 'string' || !d.bankName.trim()) {
      throw new AppError('payoutBankDetails.bankName is required', 400, 'MISSING_BANK_DETAILS');
    }
    // Either US routing+account OR international iban/swift must be present.
    const hasUs = typeof d.routingNumber === 'string' && typeof d.accountNumber === 'string';
    const hasIntl = typeof d.iban === 'string' || typeof d.swift === 'string';
    if (!hasUs && !hasIntl) {
      throw new AppError(
        'payoutBankDetails must include routingNumber+accountNumber OR iban/swift',
        400,
        'MISSING_BANK_DETAILS'
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

async function isAnyAdmin(email?: string): Promise<boolean> {
  if (await isSuperAdmin(email)) return true;
  if (await isAdmin(email)) return true;
  return false;
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
    } = req.body || {};

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
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
        hostUserId: req.userId,
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

    const payouts = await prisma.payout.findMany({
      where: { partyId },
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

    const existing = await prisma.payout.findFirst({
      where: { id: payoutId, partyId },
      include: { documents: true },
    });
    if (!existing) {
      throw new AppError('Payment not found', 404, 'NOT_FOUND');
    }
    if (existing.status !== 'pending') {
      throw new AppError(
        'Payments can only be edited while pending; this one is ' + existing.status,
        400,
        'NOT_EDITABLE'
      );
    }

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

    if (receiptsChanged) {
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
    if (existing.status !== 'pending') {
      throw new AppError(
        'Only pending payments can be cancelled',
        400,
        'PAYOUT_NOT_PENDING'
      );
    }

    // gouda-83912: only the cohost who submitted the payout (or any admin)
    // may delete it. Other cohosts on the same party can see the row but
    // cannot mutate it.
    const isAdminCaller = await isAnyAdmin(req.userEmail);
    if (!isAdminCaller && existing.hostUserId !== req.userId) {
      throw new AppError(
        'Only the cohost who submitted this payment can cancel it.',
        403,
        'FORBIDDEN_NOT_OWNER',
      );
    }

    await prisma.payout.delete({ where: { id: payoutId } });

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
