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
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { analyzeReceipt } from '../services/ocr.service.js';
import { convertToUSD } from '../services/fx.service.js';

const router = Router();

// Path-scope auth + soft-launch gate to /:partyId/payouts ONLY. The router is
// mounted at /api/parties (alongside many sibling routers including partyRoutes
// after it), so an unconditioned `router.use(...)` here would gate every
// /api/parties/* request — which broke host guest approvals system-wide.
router.use('/:partyId/payouts', requireAuth);
router.use('/:partyId/payouts', async (req, res, next) => {
  try {
    await assertCanUsePayouts(req as AuthRequest);
    next();
  } catch (err) {
    next(err);
  }
});

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
    if (typeof addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(addr.trim())) {
      throw new AppError(
        'usdc_base requires a valid 0x… wallet address',
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
 * Soft-launch gate: this feature is currently limited to underbosses + admins.
 * Remove this check (and all callsites below) when opening up to all hosts.
 */
async function isUnderbossOrAdmin(email?: string): Promise<boolean> {
  if (await isSuperAdmin(email)) return true;
  if (await isAdmin(email)) return true;
  if (await isUnderboss(email)) return true;
  return false;
}

async function assertCanUsePayouts(req: AuthRequest): Promise<void> {
  if (!(await isUnderbossOrAdmin(req.userEmail))) {
    throw new AppError(
      'The payouts feature is currently in soft launch for underbosses and admins only.',
      403,
      'FORBIDDEN',
    );
  }
}

async function isAnyAdmin(email?: string): Promise<boolean> {
  if (await isSuperAdmin(email)) return true;
  if (await isAdmin(email)) return true;
  return false;
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
    } = req.body || {};

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!Array.isArray(receiptPhotos) || receiptPhotos.length === 0) {
      throw new AppError('At least one receipt photo is required', 400, 'NO_RECEIPTS');
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

    validatePayoutMethod(payoutMethod);
    validateMethodSpecificFields(payoutMethod, { payoutWalletAddress, payoutBankDetails });

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

    // OCR every receipt in parallel (Promise.allSettled so one failure doesn't kill the rest).
    const ocrPromises = (receiptPhotos as IncomingDocument[]).map(async (r) => {
      try {
        const ocr = await analyzeReceipt(r.url);
        const fx = await convertToUSD(ocr.amount, ocr.currency);
        return { ok: true as const, doc: r, ocr, fx };
      } catch (err: any) {
        return { ok: false as const, doc: r, error: err?.message || 'OCR failed' };
      }
    });
    const ocrResults = await Promise.allSettled(ocrPromises);

    // Compute the OCR sum + locked exchange rate.
    // Strategy: sum the USD-converted amounts (already locked at submission time
    // via the fx call above). Use the first successful conversion's source/rate
    // as the "headline" exchangeRate + originalCurrency on the row. Per-receipt
    // detail is preserved on the documents.
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
        'Could not determine payout amount — OCR returned $0 for all receipts and no manual amount was provided',
        400,
        'INVALID_AMOUNT'
      );
    }

    if (!req.userId) {
      throw new AppError('Authenticated user has no userId', 500, 'NO_USER_ID');
    }

    // Create the payout + its documents atomically.
    const payout = await prisma.payout.create({
      data: {
        partyId,
        hostUserId: req.userId,
        originalAmount: new Decimal(originalAmount || extractedUsdSum),
        originalCurrency,
        exchangeRate: new Decimal(exchangeRate),
        extractedAmountUsd: new Decimal(extractedUsdSum),
        finalAmountUsd: new Decimal(finalUsd),
        status: 'pending',
        payoutMethod,
        payoutWalletAddress: payoutMethod === 'usdc_base' ? (payoutWalletAddress as string).trim() : null,
        ...(payoutMethod === 'wire' && payoutBankDetails && typeof payoutBankDetails === 'object'
          ? { payoutBankDetails: payoutBankDetails as Prisma.InputJsonValue }
          : {}),
        mercuryCardLast4: payoutMethod === 'mercury_card' && typeof mercuryCardLast4 === 'string'
          ? mercuryCardLast4.slice(-4)
          : null,
        hostNotes: typeof hostNotes === 'string' && hostNotes.trim().length > 0
          ? hostNotes.trim()
          : null,
        documents: { create: docsToCreate },
      },
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
    });

    // Optional: save host defaults
    if (saveAsDefault === true) {
      try {
        await prisma.user.update({
          where: { id: req.userId },
          data: {
            preferredPayoutMethod: payoutMethod,
            ...(payoutMethod === 'usdc_base' && typeof payoutWalletAddress === 'string'
              ? { payoutWalletAddress: payoutWalletAddress.trim() }
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
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
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
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!payout) {
      throw new AppError('Payout not found', 404, 'NOT_FOUND');
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
    } = req.body || {};

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const existing = await prisma.payout.findFirst({
      where: { id: payoutId, partyId },
    });
    if (!existing) {
      throw new AppError('Payout not found', 404, 'NOT_FOUND');
    }
    if (existing.status !== 'pending') {
      throw new AppError(
        'Payouts can only be edited while pending; this one is ' + existing.status,
        400,
        'PAYOUT_NOT_PENDING'
      );
    }

    const data: Record<string, any> = {};

    if (payoutMethod !== undefined) {
      validatePayoutMethod(payoutMethod);
      validateMethodSpecificFields(payoutMethod, {
        payoutWalletAddress: payoutWalletAddress ?? existing.payoutWalletAddress,
        payoutBankDetails: payoutBankDetails ?? (existing.payoutBankDetails as any),
      });
      data.payoutMethod = payoutMethod;
      // Clear stale method-specific fields when method changes
      if (payoutMethod !== 'usdc_base') data.payoutWalletAddress = null;
      if (payoutMethod !== 'wire') data.payoutBankDetails = Prisma.JsonNull;
      if (payoutMethod !== 'mercury_card') data.mercuryCardLast4 = null;
    }

    if (payoutWalletAddress !== undefined) {
      data.payoutWalletAddress = payoutWalletAddress === null
        ? null
        : String(payoutWalletAddress).trim();
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

    const updated = await prisma.payout.update({
      where: { id: payoutId },
      data,
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
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
      throw new AppError('Payout not found', 404, 'NOT_FOUND');
    }
    if (existing.status !== 'pending') {
      throw new AppError(
        'Only pending payouts can be cancelled',
        400,
        'PAYOUT_NOT_PENDING'
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
