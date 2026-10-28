/**
 * sfincione-40417: Pizza Price Index API.
 *
 * Mounted at /api/admin/pizza-index (before the /api/admin catch-all) and a
 * public aggregates-only router at /api/pizza-index.
 *
 * Auth (decision 12.3): superadmins / admins / payment admins (full access),
 * AND active underbosses, who are restricted to parties in their scope
 * (regions + cities, reusing helpers/underbossScope). Spend-incurring /
 * bulk-ops endpoints (sync, llm-pass, vision-pass, photo-pass) and non-merchant preset
 * writes are full-admin only. Every edit records verified_by / updated_by.
 *
 * This router NEVER writes to payout_documents.
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isPaymentAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { getUnderbossScope, partyMatchesScope, buildScopedWhereClause } from '../helpers/underbossScope.js';
import {
  CONFIDENCE,
  MAX_ROUND_DIAMETER_CM,
  MIN_ROUND_DIAMETER_CM,
  STANDARD_SIZES_CM,
  computeAreaCm2,
  normalizeMerchantKey,
  roundArea,
  type PizzaShape,
} from '../services/pizzaSize.service.js';
import {
  reresolveUnverified,
  syncPizzaLineItems,
} from '../services/pizzaLineSync.service.js';
import { reallocateDocDiscounts } from '../services/pizzaLineDocs.service.js';
import { runLlmPass, runVisionPass } from '../services/pizzaIndexLlm.service.js';
import {
  MAX_PHOTOS_PER_PARTY,
  galleryPhotos,
  payoutPizzaPhotos,
  photoCandidatesSql,
  readPhotoEstimate,
  runPhotoPass,
  type PhotoEstimate,
} from '../services/pizzaPhotoPass.service.js';
import {
  INDEX_LEVELS,
  aggregate,
  cachedIndex,
  fetchIndexRows,
  flagOutliers,
  getPublicPizzaIndex,
  invalidatePizzaIndexCache,
  refreshOutliers,
  regionToContinent,
  scopeSql,
  selectRows,
  type IndexFilters,
  type IndexLevel,
  type IndexScope,
  type SizeLadder,
} from '../services/pizzaIndex.service.js';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface PizzaActor {
  email: string;
  kind: 'admin' | 'underboss';
  /** Unrestricted (admin / payment admin / '__admin__' underboss). */
  full: boolean;
  scope: IndexScope;
}
interface PizzaRequest extends AuthRequest {
  actor?: PizzaActor;
}

/** Reviewer gate: admin class OR active underboss (scoped). */
async function requireReviewer(req: PizzaRequest, _res: Response, next: NextFunction) {
  try {
    const email = (req.userEmail ?? '').toLowerCase();
    if (!email) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    if (await isPaymentAdmin(email)) {
      req.actor = { email, kind: 'admin', full: true, scope: { full: true, regions: [], cities: [] } };
      return next();
    }
    if (await isUnderboss(email)) {
      const s = await getUnderbossScope(email);
      if (!s.isAdmin && s.regions.length === 0 && s.cities.length === 0) {
        throw new AppError('Your underboss account has no regions or cities assigned', 403, 'NO_SCOPE');
      }
      req.actor = {
        email,
        kind: 'underboss',
        full: s.isAdmin,
        scope: { full: s.isAdmin, regions: s.regions, cities: s.cities },
      };
      return next();
    }
    throw new AppError('Admin, payments admin or underboss access required', 403, 'FORBIDDEN');
  } catch (err) {
    next(err);
  }
}

function requireFull(req: PizzaRequest, _res: Response, next: NextFunction) {
  if (!req.actor?.full) return next(new AppError('Admin access required', 403, 'FORBIDDEN'));
  next();
}

const reviewerChain = [requireAuth, requireReviewer];
const fullChain = [requireAuth, requireReviewer, requireFull];

function underbossScopeOf(actor: PizzaActor) {
  return { isAdmin: actor.full, regions: actor.scope.regions, cities: actor.scope.cities };
}

// ---------------------------------------------------------------------------
// Types (shared with the frontend)
// ---------------------------------------------------------------------------

export type ExcludedReason = 'lump_sum' | 'not_pizza' | 'zero_price' | 'duplicate_line' | 'unreadable' | 'other';
export const EXCLUDED_REASONS: ExcludedReason[] = ['lump_sum', 'not_pizza', 'zero_price', 'duplicate_line', 'unreadable', 'other'];

export interface PizzaLineDto {
  id: string;
  documentId: string;
  partyId: string;
  lineIndex: number;
  rawName: string;
  merchant: string | null;
  merchantKey: string | null;
  qty: number;
  unitPriceList: number;
  unitPriceNet: number | null;
  discountAmount: number | null;
  discountLabel: string | null;
  currency: string;
  fxRate: number;
  unitPriceUsd: number;
  sizeLabel: string | null;
  shape: PizzaShape | 'other' | null;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  areaCm2: number | null;
  style: string | null;
  sizeSource: 'parsed' | 'preset' | 'llm' | 'web' | 'manual' | null;
  sizeConfidence: number | null;
  presetId: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  updatedBy: string | null;
  excluded: boolean;
  excludedReason: ExcludedReason | null;
  isBundle: boolean;
  outlierFlag: boolean;
  notes: string | null;
  sourceCategory: string;
  /** unitPriceUsd / areaCm2 (null when area unknown). */
  usdPerCm2: number | null;
  localPerCm2: number | null;
  /** What this line's per-cm^2 price implies for a 25/30/35/40 cm pizza (USD). */
  sizeLadderUsd: SizeLadder | null;
  /** Photo-pass size suggestion (never counted in the index until a reviewer accepts it). */
  photoEstimate: PhotoEstimate | null;
}

type DbLine = Prisma.PizzaLineItemGetPayload<object>;

const n = (v: Prisma.Decimal | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

function ladderFor(perCm2: number | null): SizeLadder | null {
  if (perCm2 === null) return null;
  const out = {} as SizeLadder;
  for (const d of STANDARD_SIZES_CM) out[String(d) as keyof SizeLadder] = Math.round(perCm2 * roundArea(d) * 10000) / 10000;
  return out;
}

export function toLineDto(r: DbLine): PizzaLineDto {
  const area = n(r.areaCm2);
  const usd = Number(r.unitPriceUsd);
  const list = Number(r.unitPriceList);
  const usdPerCm2 = area && area > 0 && usd > 0 ? usd / area : null;
  return {
    id: r.id,
    documentId: r.documentId,
    partyId: r.partyId,
    lineIndex: r.lineIndex,
    rawName: r.rawName,
    merchant: r.merchant,
    merchantKey: r.merchantKey,
    qty: Number(r.qty),
    unitPriceList: list,
    unitPriceNet: n(r.unitPriceNet),
    discountAmount: n(r.discountAmount),
    discountLabel: r.discountLabel,
    currency: r.currency,
    fxRate: Number(r.fxRate),
    unitPriceUsd: usd,
    sizeLabel: r.sizeLabel,
    shape: r.shape as PizzaLineDto['shape'],
    diameterCm: n(r.diameterCm),
    lengthCm: n(r.lengthCm),
    widthCm: n(r.widthCm),
    sliceFraction: n(r.sliceFraction),
    areaCm2: area,
    style: r.style,
    sizeSource: r.sizeSource as PizzaLineDto['sizeSource'],
    sizeConfidence: n(r.sizeConfidence),
    presetId: r.presetId,
    verifiedBy: r.verifiedBy,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    updatedBy: r.updatedBy,
    excluded: r.excluded,
    excludedReason: r.excludedReason as ExcludedReason | null,
    isBundle: r.isBundle,
    outlierFlag: r.outlierFlag,
    notes: r.notes,
    sourceCategory: r.sourceCategory,
    usdPerCm2,
    localPerCm2: area && area > 0 && list > 0 ? list / area : null,
    sizeLadderUsd: ladderFor(usdPerCm2),
    photoEstimate: readPhotoEstimate(r.photoEstimate),
  };
}

export interface PizzaPresetDto {
  id: string;
  scope: 'merchant' | 'chain' | 'country' | 'global';
  merchantKey: string | null;
  country: string | null;
  sizeLabel: string;
  shape: PizzaShape;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  areaCm2: number | null;
  source: 'manual' | 'web' | 'llm';
  sourceUrl: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

type DbPreset = Prisma.PizzaSizePresetGetPayload<object>;

function toPresetDto(p: DbPreset, hideEmail = false): PizzaPresetDto {
  const dims = {
    shape: p.shape as PizzaShape,
    diameterCm: n(p.diameterCm), lengthCm: n(p.lengthCm), widthCm: n(p.widthCm), sliceFraction: n(p.sliceFraction),
  };
  return {
    id: p.id,
    scope: p.scope as PizzaPresetDto['scope'],
    merchantKey: p.merchantKey,
    country: p.country,
    sizeLabel: p.sizeLabel,
    shape: dims.shape,
    diameterCm: dims.diameterCm,
    lengthCm: dims.lengthCm,
    widthCm: dims.widthCm,
    sliceFraction: dims.sliceFraction,
    areaCm2: computeAreaCm2(dims),
    source: p.source as PizzaPresetDto['source'],
    sourceUrl: p.sourceUrl,
    notes: p.notes,
    createdBy: hideEmail ? null : p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const bool = (v: unknown): boolean | undefined =>
  v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' ? false : undefined;
function numField(body: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null || v === '') return null;
  const x = Number(v);
  if (!Number.isFinite(x)) throw new AppError(`${key} must be a number`, 400, 'BAD_REQUEST');
  return x;
}
const intQ = (v: unknown, def: number, min: number, max: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(Math.max(Math.trunc(x), min), max) : def;
};

interface DimsInput {
  shape: PizzaShape;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
}

/** Validate + normalize dims for a shape; throws 400 on nonsense. */
function validateDims(d: DimsInput): DimsInput & { areaCm2: number } {
  const out: DimsInput = { ...d };
  if (d.shape === 'round') {
    out.lengthCm = null; out.widthCm = null; out.sliceFraction = null;
    if (!(d.diameterCm && d.diameterCm >= MIN_ROUND_DIAMETER_CM && d.diameterCm <= MAX_ROUND_DIAMETER_CM)) {
      throw new AppError(`Round diameter must be ${MIN_ROUND_DIAMETER_CM}-${MAX_ROUND_DIAMETER_CM} cm`, 400, 'INVALID_SIZE');
    }
  } else if (d.shape === 'rect') {
    out.diameterCm = null; out.sliceFraction = null;
    if (!(d.lengthCm && d.widthCm && d.lengthCm >= 15 && d.lengthCm <= 150 && d.widthCm >= 10 && d.widthCm <= 100)) {
      throw new AppError('Rect length must be 15-150 cm and width 10-100 cm', 400, 'INVALID_SIZE');
    }
  } else if (d.shape === 'slice') {
    out.lengthCm = null; out.widthCm = null;
    if (!(d.diameterCm && d.diameterCm >= MIN_ROUND_DIAMETER_CM && d.diameterCm <= MAX_ROUND_DIAMETER_CM)) {
      throw new AppError('Slice needs the parent pie diameter (15-60 cm)', 400, 'INVALID_SIZE');
    }
    if (!(d.sliceFraction && d.sliceFraction > 0 && d.sliceFraction <= 1)) {
      throw new AppError('sliceFraction must be in (0, 1]', 400, 'INVALID_SIZE');
    }
  } else {
    throw new AppError('shape must be round, rect or slice', 400, 'INVALID_SIZE');
  }
  const area = computeAreaCm2(out);
  if (area === null) throw new AppError('Could not compute area from the given dimensions', 400, 'INVALID_SIZE');
  return { ...out, areaCm2: area };
}

async function loadLineInScope(id: string, actor: PizzaActor) {
  const line = await prisma.pizzaLineItem.findUnique({
    where: { id },
    include: { party: { select: { region: true, city: true, name: true, eventType: true } } },
  });
  if (!line) throw new AppError('Pizza line not found', 404, 'NOT_FOUND');
  if (!actor.full && !partyMatchesScope(line.party, underbossScopeOf(actor))) {
    throw new AppError('This line is outside your scope', 403, 'FORBIDDEN');
  }
  return line;
}

async function scopedPartyIds(actor: PizzaActor): Promise<string[] | undefined> {
  if (actor.full) return undefined;
  if (actor.scope.regions.length === 0 && actor.scope.cities.length === 0) return [];
  const where = buildScopedWhereClause(underbossScopeOf(actor));
  const rows = await prisma.party.findMany({ where: where ?? {}, select: { id: true } });
  return rows.map((r) => r.id);
}

/** SQL: parties (alias p) that are OUTSIDE the actor's scope. */
function outOfScopeSql(actor: PizzaActor): Prisma.Sql {
  const cities = actor.scope.cities.map((c) => c.trim().toLowerCase()).filter(Boolean);
  return Prisma.sql`AND NOT (coalesce(p.region = ANY(${actor.scope.regions}::text[]), false)
    OR coalesce(lower(trim(p.city)) = ANY(${cities}::text[]), false))`;
}

/** Underbosses may only manage a merchant whose lines are ALL within their scope. */
async function assertMerchantInScope(actor: PizzaActor, merchantKey: string | null | undefined) {
  if (actor.full || !merchantKey) return;
  const [{ c }] = await prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
    SELECT count(*)::int AS c FROM pizza_line_items li JOIN parties p ON p.id = li.party_id
    WHERE li.merchant_key = ${merchantKey} ${outOfScopeSql(actor)}`);
  if (c > 0) throw new AppError('This merchant has receipts outside your scope', 403, 'OUT_OF_SCOPE');
}

function scopeKey(actor: PizzaActor): string {
  return actor.full ? 'full' : `ub:${actor.scope.regions.join(',')}|${actor.scope.cities.join(',')}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// POST /sync   (full admin)  body: { limit?: 1-300 (default 100), force?: boolean, forceBefore?: ISO string, docIds?: string[] }
//   force:true loop: first call omits forceBefore; the response returns `forceBefore`; pass it back on every
//   following call until remaining is 0 (docs synced after that instant are skipped, so it advances).
// ===========================================================================
router.post('/sync', ...fullChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const docIds = Array.isArray(body.docIds) ? body.docIds.filter((x): x is string => typeof x === 'string') : undefined;
    const fb = str(body.forceBefore);
    const forceBeforeIn = fb && !Number.isNaN(new Date(fb).getTime()) ? new Date(fb) : undefined;
    const stats = await syncPizzaLineItems({
      limit: intQ(body.limit, 100, 1, 300),
      force: bool(body.force) ?? false,
      forceBefore: forceBeforeIn,
      docIds,
    });
    const outliers = await flagOutliers();
    invalidatePizzaIndexCache();
    res.json({ ...stats, outliersFlagged: outliers.flagged, outlierFlagsChanged: outliers.changed });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// POST /llm-pass   (full admin)  body: { limit?: 1-30 (default 10), docIds?, dryRun? }
// ===========================================================================
router.post('/llm-pass', ...fullChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const docIds = Array.isArray(body.docIds) ? body.docIds.filter((x): x is string => typeof x === 'string') : undefined;
    const result = await runLlmPass({ limit: intQ(body.limit, 10, 1, 30), docIds, dryRun: bool(body.dryRun) ?? false });
    invalidatePizzaIndexCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// POST /vision-pass   (full admin)
//   body: { limit?: 1-25 (default 10), docIds?, dryRun?, requireLlmPass? (default true),
//           includeLowConfidence? (default false: only lines with no area) }
// ===========================================================================
router.post('/vision-pass', ...fullChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const docIds = Array.isArray(body.docIds) ? body.docIds.filter((x): x is string => typeof x === 'string') : undefined;
    const result = await runVisionPass({
      limit: intQ(body.limit, 10, 1, 25),
      docIds,
      dryRun: bool(body.dryRun) ?? false,
      requireLlmPass: bool(body.requireLlmPass) ?? true,
      includeLowConfidence: bool(body.includeLowConfidence) ?? false,
    });
    invalidatePizzaIndexCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// POST /photo-pass   (full admin)  body: { limit?: 1-10 parties (default 5), partyIds?, dryRun? }
//   Stores a size SUGGESTION per unsized line from the party's pizza photos; the
//   index is unchanged until a reviewer accepts it.
// ===========================================================================
router.post('/photo-pass', ...fullChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const partyIds = Array.isArray(body.partyIds) ? body.partyIds.filter((x): x is string => typeof x === 'string') : undefined;
    if (partyIds?.some((id) => !UUID_RE.test(id))) throw new AppError('partyIds must be UUIDs', 400, 'INVALID_PARTY_ID');
    res.json(await runPhotoPass({ limit: intQ(body.limit, 5, 1, 10), partyIds, dryRun: bool(body.dryRun) ?? false }));
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// GET /status   (reviewers; scoped for underbosses)
// ===========================================================================
export interface PizzaStatusResponse {
  docsWithItems: number;
  docsSynced: number;
  docsPendingSync: number;
  docsPendingLlm: number;
  docsPendingVision: number;
  lines: number;
  verifiedLines: number;
  unresolvedLines: number;
  excludedLines: number;
  bundleLines: number;
  outlierLines: number;
  bySource: Record<string, number>;
  /** Parties with unsized lines and photos that the photo pass hasn't covered yet. */
  partiesPendingPhoto: number;
  /** Unverified, unsized lines that have a photo-pass suggestion waiting. */
  linesWithPhotoEstimate: number;
}
router.get('/status', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const sc = scopeSql(actor.scope, 'p');
    const [docs] = await prisma.$queryRaw<Array<{ with_items: number; synced: number; pending_llm: number }>>(Prisma.sql`
      SELECT count(*)::int AS with_items,
             count(s.document_id)::int AS synced,
             count(*) FILTER (WHERE s.document_id IS NOT NULL AND s.llm_pass_at IS NULL)::int AS pending_llm
      FROM payout_documents d JOIN parties p ON p.id = d.party_id
      LEFT JOIN pizza_line_sync s ON s.document_id = d.id
      WHERE d.kind = 'receipt' AND d.is_duplicate = false AND d.ineligible = false
        AND d.ocr_line_items IS NOT NULL AND jsonb_typeof(d.ocr_line_items) = 'array' ${sc}`);
    const [lines] = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      SELECT count(*)::int AS lines,
             count(*) FILTER (WHERE li.verified_at IS NOT NULL)::int AS verified,
             count(*) FILTER (WHERE li.area_cm2 IS NULL AND NOT li.excluded AND NOT li.is_bundle)::int AS unresolved,
             count(*) FILTER (WHERE li.excluded)::int AS excluded,
             count(*) FILTER (WHERE li.is_bundle)::int AS bundles,
             count(*) FILTER (WHERE li.outlier_flag AND li.verified_at IS NULL)::int AS outliers,
             count(*) FILTER (WHERE li.photo_estimate IS NOT NULL AND li.area_cm2 IS NULL AND li.verified_at IS NULL
                              AND NOT li.excluded AND NOT li.is_bundle)::int AS photo_estimates
      FROM pizza_line_items li JOIN parties p ON p.id = li.party_id
      JOIN payout_documents d ON d.id = li.document_id
      WHERE d.is_duplicate = false AND d.ineligible = false ${sc}`);
    const sources = await prisma.$queryRaw<Array<{ src: string; c: number }>>(Prisma.sql`
      SELECT coalesce(li.size_source, 'none') AS src, count(*)::int AS c
      FROM pizza_line_items li JOIN parties p ON p.id = li.party_id
      JOIN payout_documents d ON d.id = li.document_id
      WHERE d.is_duplicate = false AND d.ineligible = false AND NOT li.excluded ${sc}
      GROUP BY 1`);
    const body: PizzaStatusResponse = {
      docsWithItems: docs.with_items,
      docsSynced: docs.synced,
      docsPendingSync: docs.with_items - docs.synced,
      docsPendingLlm: docs.pending_llm,
      docsPendingVision: 0,
      lines: lines.lines,
      verifiedLines: lines.verified,
      unresolvedLines: lines.unresolved,
      excludedLines: lines.excluded,
      bundleLines: lines.bundles,
      outlierLines: lines.outliers,
      bySource: Object.fromEntries(sources.map((s) => [s.src, s.c])),
      partiesPendingPhoto: 0,
      linesWithPhotoEstimate: lines.photo_estimates,
    };
    const [v] = await prisma.$queryRaw<Array<{ c: number }>>(Prisma.sql`
      SELECT count(DISTINCT d.id)::int AS c
      FROM pizza_line_sync s JOIN payout_documents d ON d.id = s.document_id JOIN parties p ON p.id = d.party_id
      WHERE s.vision_pass_at IS NULL AND s.llm_pass_at IS NOT NULL AND d.mime_type LIKE 'image/%'
        AND d.is_duplicate = false AND d.ineligible = false ${sc}
        AND EXISTS (SELECT 1 FROM pizza_line_items li WHERE li.document_id = d.id AND NOT li.excluded
                    AND NOT li.is_bundle AND li.verified_at IS NULL AND li.area_cm2 IS NULL)`);
    body.docsPendingVision = v.c;
    // Same candidate rule as the pass itself (incl. back-off), so "run until done" can reach 0.
    const [ph] = await prisma.$queryRaw<Array<{ c: number }>>(Prisma.sql`
      SELECT count(*)::int AS c ${photoCandidatesSql({ scope: sc })}`);
    body.partiesPendingPhoto = ph.c;
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// GET /queue   (reviewers; underbosses see only in-scope parties)
//   query: status=unverified|verified|all (default unverified)
//          country, merchant (substring of merchant key), source=parsed|preset|llm|web|manual|none,
//          outlier=true, excluded=true (show excluded lines instead of hiding them),
//          bundles=include|exclude|only (default include), partyId, documentId, minConfidence,
//          photoEstimate=true (only lines with a photo-pass suggestion),
//          limit (receipts, 1-100, default 20), offset
// ===========================================================================
export interface PizzaQueueReceipt {
  document: {
    id: string; url: string; mimeType: string; fileName: string;
    sourceReceiptIndex: number | null; sourceReceiptCount: number | null;
  };
  party: { id: string; name: string; city: string | null; country: string | null; region: string | null; date: string | null };
  merchant: string | null;
  currency: string | null;
  receiptDiscounts: Array<{ label: string; amount: number }>;
  lines: PizzaLineDto[];
  /** kind='pizza' photos from the same party (context only). */
  pizzaPhotoUrls: string[];
  /** Approved event-gallery photos (pizza-tagged/starred first), minus any already in pizzaPhotoUrls. */
  galleryPhotoUrls: string[];
}
export interface PizzaQueueResponse {
  total: number;
  limit: number;
  offset: number;
  progress: {
    totalLines: number; verifiedLines: number; totalPizzas: number; verifiedPizzas: number;
    unresolvedLines: number; outlierLines: number; bundleLines: number;
  };
  receipts: PizzaQueueReceipt[];
}

router.get('/queue', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const q = req.query;
    const status = str(q.status) ?? 'unverified';
    const limit = intQ(q.limit, 20, 1, 100);
    const offset = intQ(q.offset, 0, 0, 100000);
    await refreshOutliers();

    const cond: Prisma.Sql[] = [
      Prisma.sql`d.kind = 'receipt'`,
      Prisma.sql`d.is_duplicate = false`,
      Prisma.sql`d.ineligible = false`,
    ];
    if (bool(q.excluded)) cond.push(Prisma.sql`li.excluded = true`);
    else cond.push(Prisma.sql`li.excluded = false`);
    if (status === 'unverified') cond.push(Prisma.sql`li.verified_at IS NULL`);
    else if (status === 'verified') cond.push(Prisma.sql`li.verified_at IS NOT NULL`);
    const country = str(q.country);
    if (country) cond.push(Prisma.sql`p.country = ${country}`);
    const merchant = str(q.merchant);
    if (merchant) cond.push(Prisma.sql`li.merchant_key ILIKE ${'%' + (normalizeMerchantKey(merchant) ?? merchant) + '%'}`);
    const source = str(q.source);
    if (source === 'none') cond.push(Prisma.sql`li.size_source IS NULL`);
    else if (source) cond.push(Prisma.sql`li.size_source = ${source}`);
    if (bool(q.outlier)) cond.push(Prisma.sql`li.outlier_flag = true`);
    if (bool(q.photoEstimate)) cond.push(Prisma.sql`li.photo_estimate IS NOT NULL`);
    const bundles = str(q.bundles) ?? 'include';
    if (bundles === 'exclude') cond.push(Prisma.sql`li.is_bundle = false`);
    if (bundles === 'only') cond.push(Prisma.sql`li.is_bundle = true`);
    const partyId = str(q.partyId);
    if (partyId) cond.push(Prisma.sql`li.party_id = ${partyId}::uuid`);
    const documentId = str(q.documentId);
    if (documentId) cond.push(Prisma.sql`li.document_id = ${documentId}::uuid`);
    const minConf = Number(q.minConfidence);
    if (Number.isFinite(minConf)) cond.push(Prisma.sql`coalesce(li.size_confidence, 0) >= ${minConf}`);
    const sc = scopeSql(actor.scope, 'p');
    const where = Prisma.sql`WHERE ${Prisma.join(cond, ' AND ')} ${sc}`;
    const from = Prisma.sql`FROM pizza_line_items li
      JOIN payout_documents d ON d.id = li.document_id
      JOIN parties p ON p.id = li.party_id`;

    const [{ total }] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT count(DISTINCT li.document_id)::int AS total ${from} ${where}`);
    const docRows = await prisma.$queryRaw<{ document_id: string }[]>(Prisma.sql`
      SELECT li.document_id ${from} ${where}
      GROUP BY li.document_id
      ORDER BY bool_or(li.verified_at IS NULL) DESC,
               bool_or(li.outlier_flag) DESC,
               min(coalesce(li.size_confidence, 0)) ASC,
               max(li.qty) DESC,
               li.document_id
      LIMIT ${limit} OFFSET ${offset}`);
    const docIds = docRows.map((r) => r.document_id);

    const [pg] = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      SELECT count(*)::int AS total_lines,
             count(*) FILTER (WHERE li.verified_at IS NOT NULL)::int AS verified_lines,
             coalesce(sum(li.qty), 0)::float8 AS total_pizzas,
             coalesce(sum(li.qty) FILTER (WHERE li.verified_at IS NOT NULL), 0)::float8 AS verified_pizzas,
             count(*) FILTER (WHERE li.area_cm2 IS NULL AND NOT li.is_bundle)::int AS unresolved,
             count(*) FILTER (WHERE li.outlier_flag AND li.verified_at IS NULL)::int AS outliers,
             count(*) FILTER (WHERE li.is_bundle)::int AS bundles
      FROM pizza_line_items li
      JOIN payout_documents d ON d.id = li.document_id
      JOIN parties p ON p.id = li.party_id
      WHERE d.kind = 'receipt' AND d.is_duplicate = false AND d.ineligible = false AND li.excluded = false ${sc}`);

    const receipts: PizzaQueueReceipt[] = [];
    if (docIds.length) {
      const [lines, docs, syncs] = await Promise.all([
        prisma.pizzaLineItem.findMany({ where: { documentId: { in: docIds } }, orderBy: [{ lineIndex: 'asc' }] }),
        prisma.payoutDocument.findMany({
          where: { id: { in: docIds } },
          select: {
            id: true, url: true, mimeType: true, fileName: true, sourceReceiptIndex: true, sourceReceiptCount: true,
            party: { select: { id: true, name: true, city: true, country: true, region: true, date: true } },
          },
        }),
        prisma.pizzaLineSync.findMany({ where: { documentId: { in: docIds } }, select: { documentId: true, discounts: true } }),
      ]);
      const partyIds = [...new Set(docs.map((d) => d.party.id))];
      const [photoByParty, galleryByParty] = await Promise.all([
        payoutPizzaPhotos(partyIds, MAX_PHOTOS_PER_PARTY),
        galleryPhotos(partyIds, MAX_PHOTOS_PER_PARTY),
      ]);
      const linesByDoc = new Map<string, PizzaLineDto[]>();
      for (const l of lines) {
        const a = linesByDoc.get(l.documentId) ?? [];
        a.push(toLineDto(l));
        linesByDoc.set(l.documentId, a);
      }
      const docById = new Map(docs.map((d) => [d.id, d]));
      const syncById = new Map(syncs.map((s) => [s.documentId, s]));
      for (const id of docIds) {
        const d = docById.get(id);
        if (!d) continue;
        const ls = linesByDoc.get(id) ?? [];
        const disc = syncById.get(id)?.discounts;
        receipts.push({
          document: {
            id: d.id, url: d.url, mimeType: d.mimeType, fileName: d.fileName,
            sourceReceiptIndex: d.sourceReceiptIndex, sourceReceiptCount: d.sourceReceiptCount,
          },
          party: {
            id: d.party.id, name: d.party.name, city: d.party.city, country: d.party.country,
            region: d.party.region, date: d.party.date ? d.party.date.toISOString() : null,
          },
          merchant: ls.find((l) => l.merchant)?.merchant ?? null,
          currency: ls[0]?.currency ?? null,
          receiptDiscounts: Array.isArray(disc) ? (disc as unknown as Array<{ label: string; amount: number }>) : [],
          lines: ls,
          pizzaPhotoUrls: photoByParty.get(d.party.id) ?? [],
          galleryPhotoUrls: (galleryByParty.get(d.party.id) ?? []).filter(
            (u) => !(photoByParty.get(d.party.id) ?? []).includes(u),
          ),
        });
      }
    }

    const body: PizzaQueueResponse = {
      total,
      limit,
      offset,
      progress: {
        totalLines: pg.total_lines, verifiedLines: pg.verified_lines,
        totalPizzas: pg.total_pizzas, verifiedPizzas: pg.verified_pizzas,
        unresolvedLines: pg.unresolved, outlierLines: pg.outliers, bundleLines: pg.bundles,
      },
      receipts,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// PATCH /lines/:id   (reviewers; underbosses only for in-scope lines)
//   body (all optional):
//     shape: 'round'|'rect'|'slice', diameterCm, lengthCm, widthCm, sliceFraction, sizeLabel, style
//     excluded: boolean, excludedReason: ExcludedReason (default 'other' when excluded)
//     isBundle: boolean
//     qty, unitPriceList            (reviewer override of an OCR misread; never written back to the receipt)
//     notes: string|null
//     verify: boolean   default true when any size/exclude/bundle field is sent; false clears nothing
//     unverify: true    clears verification
//   Setting any size field => size_source='manual', size_confidence=1.00.
//   Verifying records verified_by = caller email. Returns { line: PizzaLineDto }.
// ===========================================================================
router.patch('/lines/:id', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cur = await loadLineInScope(req.params.id, actor);
    const data: Prisma.PizzaLineItemUpdateInput = { updatedBy: actor.email, updatedAt: new Date() };

    const sizeKeys = ['shape', 'diameterCm', 'lengthCm', 'widthCm', 'sliceFraction'] as const;
    const sizeTouched = sizeKeys.some((k) => k in body);
    const labelTouched = 'sizeLabel' in body;
    if (sizeTouched) {
      // A bare diameter on an unsized line means a round pie.
      const fallbackShape = cur.shape ?? ('diameterCm' in body && !('lengthCm' in body) ? 'round' : null);
      const shape = (str(body.shape) ?? fallbackShape) as PizzaShape | 'other' | null;
      if (shape === 'other' || shape === null) throw new AppError('shape is required (round, rect or slice)', 400, 'INVALID_SIZE');
      const pick = (k: 'diameterCm' | 'lengthCm' | 'widthCm' | 'sliceFraction') => {
        const v = numField(body, k);
        return v !== undefined ? v : n(cur[k]);
      };
      const dims = validateDims({
        shape,
        diameterCm: pick('diameterCm'),
        lengthCm: pick('lengthCm'),
        widthCm: pick('widthCm'),
        sliceFraction: pick('sliceFraction'),
      });
      Object.assign(data, {
        shape: dims.shape,
        diameterCm: dims.diameterCm,
        lengthCm: dims.lengthCm,
        widthCm: dims.widthCm,
        sliceFraction: dims.sliceFraction,
        areaCm2: dims.areaCm2,
        sizeSource: 'manual',
        sizeConfidence: CONFIDENCE.manual,
        preset: { disconnect: true },
      });
    }
    if (labelTouched) {
      const label = body.sizeLabel === null ? null : str(body.sizeLabel)?.toLowerCase().slice(0, 40) ?? null;
      data.sizeLabel = label;
    } else if (sizeTouched && !cur.sizeLabel) {
      if (data.shape === 'slice') {
        const frac = Number(data.sliceFraction);
        const denom = frac > 0 ? Math.round(1 / frac) : null;
        data.sizeLabel = `slice (${denom && Math.abs(1 / denom - frac) < 0.005 ? `1/${denom}` : frac} of ${Math.round(Number(data.diameterCm))}cm)`;
      } else if (data.shape === 'rect') {
        data.sizeLabel = `${Number(data.lengthCm)}x${Number(data.widthCm)}cm`;
      } else if (data.diameterCm) {
        data.sizeLabel = `${Math.round(Number(data.diameterCm))}cm`;
      }
    }
    if ('style' in body) data.style = body.style === null ? null : str(body.style)?.slice(0, 20) ?? null;
    if ('notes' in body) data.notes = body.notes === null ? null : str(body.notes)?.slice(0, 500) ?? null;

    const excludedIn = bool(body.excluded);
    if (excludedIn !== undefined) {
      data.excluded = excludedIn;
      if (excludedIn) {
        const reason = (str(body.excludedReason) ?? 'other') as ExcludedReason;
        if (!EXCLUDED_REASONS.includes(reason)) throw new AppError(`excludedReason must be one of ${EXCLUDED_REASONS.join(', ')}`, 400, 'BAD_REQUEST');
        data.excludedReason = reason;
      } else {
        data.excludedReason = null;
      }
    }
    const bundleIn = bool(body.isBundle);
    if (bundleIn !== undefined) data.isBundle = bundleIn;

    const qty = numField(body, 'qty');
    if (qty !== undefined) {
      if (qty === null || qty <= 0 || qty > 999999) throw new AppError('qty must be > 0', 400, 'BAD_REQUEST');
      data.qty = qty;
    }
    const unit = numField(body, 'unitPriceList');
    if (unit !== undefined) {
      if (unit === null || unit < 0) throw new AppError('unitPriceList must be >= 0', 400, 'BAD_REQUEST');
      data.unitPriceList = unit;
      data.unitPriceUsd = Math.round(unit * Number(cur.fxRate) * 10000) / 10000;
      if (unit > 0 && cur.excludedReason === 'zero_price' && excludedIn === undefined) {
        data.excluded = false;
        data.excludedReason = null;
      }
    }

    // Verification.
    const touchedAnything = sizeTouched || labelTouched || excludedIn !== undefined || bundleIn !== undefined;
    const wantVerify = bool(body.verify) ?? touchedAnything;
    if (bool(body.unverify)) {
      data.verifiedAt = null;
      data.verifiedBy = null;
    } else if (wantVerify) {
      const willBeExcluded = excludedIn ?? cur.excluded;
      const willBeBundle = bundleIn ?? cur.isBundle;
      const area = 'areaCm2' in data ? (data.areaCm2 as number | null) : n(cur.areaCm2);
      if (!willBeExcluded && !willBeBundle && !(area && area > 0)) {
        throw new AppError('A size is required to verify (or exclude the line / mark it as a bundle)', 400, 'SIZE_REQUIRED');
      }
      data.verifiedAt = new Date();
      data.verifiedBy = actor.email;
    }

    const updated = await prisma.pizzaLineItem.update({ where: { id: cur.id }, data });
    if (qty !== undefined || unit !== undefined) await reallocateDocDiscounts(cur.documentId);
    invalidatePizzaIndexCache();
    const fresh = qty !== undefined || unit !== undefined
      ? await prisma.pizzaLineItem.findUniqueOrThrow({ where: { id: updated.id } })
      : updated;
    res.json({ line: toLineDto(fresh) });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// POST /lines/:id/apply-to-merchant   body: { sizeLabel?: string }
//   Upserts a MERCHANT preset from this line's resolved size under
//   `sizeLabel` (default: the line's label, else 'default') and re-resolves
//   the merchant's other UNVERIFIED lines with that label (size_source=preset,
//   confidence 0.85). Lines with printed (parsed) or manual sizes are left alone.
//   Underbosses: only in-scope sibling lines are updated.
//   Returns { preset: PizzaPresetDto, updatedLines: number }
// ===========================================================================
router.post('/lines/:id/apply-to-merchant', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const line = await loadLineInScope(req.params.id, actor);
    if (!line.merchantKey) throw new AppError('This line has no merchant to apply to', 400, 'NO_MERCHANT');
    await assertMerchantInScope(actor, line.merchantKey);
    const shape = line.shape as PizzaShape | 'other' | null;
    if (!shape || shape === 'other' || !line.areaCm2) throw new AppError('Set a size on this line first', 400, 'SIZE_REQUIRED');
    const label = (str(body.sizeLabel) ?? line.sizeLabel ?? 'default').toLowerCase().slice(0, 40);
    const dims = validateDims({
      shape, diameterCm: n(line.diameterCm), lengthCm: n(line.lengthCm), widthCm: n(line.widthCm), sliceFraction: n(line.sliceFraction),
    });

    const existing = await prisma.pizzaSizePreset.findFirst({
      where: { scope: 'merchant', merchantKey: line.merchantKey, country: null, sizeLabel: label },
    });
    const presetData = {
      shape: dims.shape, diameterCm: dims.diameterCm, lengthCm: dims.lengthCm, widthCm: dims.widthCm,
      sliceFraction: dims.sliceFraction, source: 'manual', notes: `from line ${line.id}`,
    };
    const preset = existing
      ? await prisma.pizzaSizePreset.update({ where: { id: existing.id }, data: { ...presetData, updatedAt: new Date() } })
      : await prisma.pizzaSizePreset.create({
          data: { scope: 'merchant', merchantKey: line.merchantKey, sizeLabel: label, createdBy: actor.email, ...presetData },
        });

    const sc = scopeSql(actor.scope, 'p');
    const updated = await prisma.$executeRaw(Prisma.sql`
      UPDATE pizza_line_items li SET
        shape = ${dims.shape}, diameter_cm = ${dims.diameterCm}, length_cm = ${dims.lengthCm},
        width_cm = ${dims.widthCm}, slice_fraction = ${dims.sliceFraction}, area_cm2 = ${dims.areaCm2},
        size_label = ${label}, size_source = 'preset', size_confidence = ${CONFIDENCE.merchant},
        preset_id = ${preset.id}::uuid, updated_by = ${actor.email}, updated_at = now()
      FROM parties p
      WHERE p.id = li.party_id ${sc}
        AND li.merchant_key = ${line.merchantKey}
        AND li.id <> ${line.id}::uuid
        AND li.verified_at IS NULL AND li.excluded = false AND li.is_bundle = false
        AND (li.size_source IS NULL OR li.size_source IN ('preset', 'llm', 'web'))
        AND coalesce(li.size_label, 'default') = ${label}`);
    invalidatePizzaIndexCache();
    res.json({ preset: toPresetDto(preset, !actor.full), updatedLines: Number(updated) });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// Presets   GET /presets?scope=&country=&merchantKey=&q=
//           POST /presets   PATCH /presets/:id   DELETE /presets/:id
//   Underbosses may write MERCHANT-scope presets only (re-resolves their
//   in-scope unverified lines); chain/country/global writes are full-admin.
//   body: { scope, merchantKey? | merchantName?, country?, sizeLabel, shape,
//           diameterCm?, lengthCm?, widthCm?, sliceFraction?, source?, sourceUrl?, notes? }
// ===========================================================================
router.get('/presets', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query;
    const where: Prisma.PizzaSizePresetWhereInput = {};
    const scope = str(q.scope);
    if (scope) where.scope = scope;
    const country = str(q.country);
    if (country) where.country = country;
    const mk = str(q.merchantKey);
    if (mk) where.merchantKey = mk;
    const text = str(q.q);
    if (text) where.OR = [{ merchantKey: { contains: text.toLowerCase() } }, { country: { contains: text, mode: 'insensitive' } }, { sizeLabel: { contains: text.toLowerCase() } }];
    const rows = await prisma.pizzaSizePreset.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { country: 'asc' }, { merchantKey: 'asc' }, { sizeLabel: 'asc' }],
      take: 1000,
    });
    if (req.actor!.full) return res.json({ presets: rows.map((r) => toPresetDto(r)) });
    // Underbosses: non-merchant presets + merchant presets seen in their scope; no emails.
    const keys = await prisma.$queryRaw<{ k: string }[]>(Prisma.sql`
      SELECT DISTINCT li.merchant_key AS k FROM pizza_line_items li JOIN parties p ON p.id = li.party_id
      WHERE li.merchant_key IS NOT NULL ${scopeSql(req.actor!.scope, 'p')}`);
    const visible = new Set(keys.map((r) => r.k));
    res.json({
      presets: rows
        .filter((r) => r.scope !== 'merchant' || (r.merchantKey && visible.has(r.merchantKey)))
        .map((r) => toPresetDto(r, true)),
    });
  } catch (err) {
    next(err);
  }
});

function parsePresetBody(body: Record<string, unknown>, cur?: DbPreset) {
  const scope = (str(body.scope) ?? cur?.scope) as PizzaPresetDto['scope'] | undefined;
  if (!scope || !['merchant', 'chain', 'country', 'global'].includes(scope)) {
    throw new AppError('scope must be merchant, chain, country or global', 400, 'BAD_REQUEST');
  }
  let merchantKey: string | null = cur?.merchantKey ?? null;
  if ('merchantKey' in body || 'merchantName' in body) {
    merchantKey = normalizeMerchantKey(str(body.merchantKey) ?? str(body.merchantName) ?? null);
  }
  let country: string | null = cur?.country ?? null;
  if ('country' in body) country = str(body.country) ?? null;
  if ((scope === 'merchant' || scope === 'chain') && !merchantKey) throw new AppError('merchantKey (or merchantName) is required', 400, 'BAD_REQUEST');
  if (scope === 'country' && !country) throw new AppError('country is required', 400, 'BAD_REQUEST');
  if (scope === 'global' || scope === 'country') merchantKey = null;
  if (scope === 'global' || scope === 'merchant') country = null;
  const sizeLabel = (str(body.sizeLabel) ?? cur?.sizeLabel)?.toLowerCase().slice(0, 40);
  if (!sizeLabel) throw new AppError('sizeLabel is required', 400, 'BAD_REQUEST');
  const shape = (str(body.shape) ?? cur?.shape) as PizzaShape | undefined;
  const pick = (k: 'diameterCm' | 'lengthCm' | 'widthCm' | 'sliceFraction') => {
    const v = numField(body, k);
    return v !== undefined ? v : cur ? n(cur[k]) : null;
  };
  const dims = validateDims({
    shape: shape as PizzaShape,
    diameterCm: pick('diameterCm'), lengthCm: pick('lengthCm'), widthCm: pick('widthCm'), sliceFraction: pick('sliceFraction'),
  });
  const source = (str(body.source) ?? cur?.source ?? 'manual') as string;
  if (!['manual', 'web', 'llm'].includes(source)) throw new AppError('source must be manual, web or llm', 400, 'BAD_REQUEST');
  return {
    scope, merchantKey, country, sizeLabel, source,
    shape: dims.shape, diameterCm: dims.diameterCm, lengthCm: dims.lengthCm, widthCm: dims.widthCm, sliceFraction: dims.sliceFraction,
    sourceUrl: 'sourceUrl' in body ? str(body.sourceUrl) ?? null : cur?.sourceUrl ?? null,
    notes: 'notes' in body ? str(body.notes)?.slice(0, 500) ?? null : cur?.notes ?? null,
  };
}

function assertPresetWriteAllowed(actor: PizzaActor, scope: string) {
  if (!actor.full && scope !== 'merchant') {
    throw new AppError('Only admins can edit chain, country or global presets', 403, 'FORBIDDEN');
  }
}

async function afterPresetChange(actor: PizzaActor) {
  const partyIds = await scopedPartyIds(actor);
  const changed = await reresolveUnverified(partyIds ? { partyIds } : {});
  invalidatePizzaIndexCache();
  return changed;
}

router.post('/presets', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const p = parsePresetBody((req.body ?? {}) as Record<string, unknown>);
    assertPresetWriteAllowed(actor, p.scope);
    await assertMerchantInScope(actor, p.merchantKey);
    const dup = await prisma.pizzaSizePreset.findFirst({
      where: { scope: p.scope, merchantKey: p.merchantKey, country: p.country, sizeLabel: p.sizeLabel },
    });
    if (dup) throw new AppError('A preset with this scope/merchant/country/label already exists', 409, 'DUPLICATE');
    const created = await prisma.pizzaSizePreset.create({ data: { ...p, createdBy: actor.email } });
    const reresolved = await afterPresetChange(actor);
    res.status(201).json({ preset: toPresetDto(created, !actor.full), reresolvedLines: reresolved });
  } catch (err) {
    next(err);
  }
});

router.patch('/presets/:id', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const cur = await prisma.pizzaSizePreset.findUnique({ where: { id: req.params.id } });
    if (!cur) throw new AppError('Preset not found', 404, 'NOT_FOUND');
    assertPresetWriteAllowed(actor, cur.scope);
    const p = parsePresetBody((req.body ?? {}) as Record<string, unknown>, cur);
    assertPresetWriteAllowed(actor, p.scope);
    await assertMerchantInScope(actor, cur.merchantKey);
    await assertMerchantInScope(actor, p.merchantKey);
    const dup = await prisma.pizzaSizePreset.findFirst({
      where: { scope: p.scope, merchantKey: p.merchantKey, country: p.country, sizeLabel: p.sizeLabel, NOT: { id: cur.id } },
    });
    if (dup) throw new AppError('A preset with this scope/merchant/country/label already exists', 409, 'DUPLICATE');
    const updated = await prisma.pizzaSizePreset.update({ where: { id: cur.id }, data: { ...p, updatedAt: new Date() } });
    const reresolved = await afterPresetChange(actor);
    res.json({ preset: toPresetDto(updated, !actor.full), reresolvedLines: reresolved });
  } catch (err) {
    next(err);
  }
});

router.delete('/presets/:id', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const cur = await prisma.pizzaSizePreset.findUnique({ where: { id: req.params.id } });
    if (!cur) throw new AppError('Preset not found', 404, 'NOT_FOUND');
    assertPresetWriteAllowed(actor, cur.scope);
    await assertMerchantInScope(actor, cur.merchantKey);
    await prisma.pizzaSizePreset.delete({ where: { id: cur.id } });
    const reresolved = await afterPresetChange(actor);
    res.json({ ok: true, reresolvedLines: reresolved });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// GET /index   (reviewers; underboss numbers are computed over their scope only)
//   query: level=global|continent|country|city|merchant (default country)
//          verifiedOnly=true|false (default false => verified OR size_confidence>=0.8; unverified outliers dropped)
//          includeBundles=true|false (default false)
//          publishedOnly=true|false (default false; unpublished groups are returned with published=false)
//          sort=parties|cheapest (default parties)
//   IndexGroup.key/label: country & continent => both the name; city => key 'city|country' (lowercase),
//   label 'City, Country', plus plain `city` and `country`; merchant => key = merchantKey, label = display name.
//   /index/lines + /index filters expect: country=<country name>, city=<plain city name>, continent=<name>, merchantKey=<group.key>.
//          country, city, continent, merchantKey, year  (filters)
// ===========================================================================
export interface PizzaBundleRow {
  lineId: string; documentId: string; partyId: string; partyName: string;
  country: string | null; city: string | null; merchant: string | null; rawName: string;
  qty: number; currency: string; unitPriceList: number; unitPriceUsd: number;
  totalUsd: number; perPizzaUsd: number | null;
  sizeKnown: boolean; areaCm2: number | null; usdPerCm2: number | null;
  verified: boolean; eventYear: number | null;
  documentUrl: string | null; documentMimeType: string | null;
  sourceReceiptIndex: number | null; sourceReceiptCount: number | null;
}
export interface PizzaIndexResponse {
  level: IndexLevel;
  filters: Record<string, unknown>;
  generatedAt: string;
  basis: { verifiedOnly: boolean; includeBundles: boolean; minPartiesNote: string };
  groups: ReturnType<typeof aggregate>;
  bundles: PizzaBundleRow[];
  meta: { rowsInView: number; rowsUsed: number; excludedUnverifiedOutliers: number; excludedLowConfidence: number };
}

function parseIndexFilters(q: Record<string, unknown>): IndexFilters {
  const year = Number(q.year);
  return {
    country: str(q.country) ?? null,
    city: str(q.city) ?? null,
    continent: str(q.continent) ?? null,
    merchantKey: str(q.merchantKey) ?? null,
    year: Number.isFinite(year) && year > 2000 ? Math.trunc(year) : null,
  };
}

router.get('/index', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const q = req.query as Record<string, unknown>;
    const level = (str(q.level) ?? 'country') as IndexLevel;
    if (!INDEX_LEVELS.includes(level)) throw new AppError(`level must be one of ${INDEX_LEVELS.join(', ')}`, 400, 'BAD_REQUEST');
    const verifiedOnly = bool(q.verifiedOnly) ?? false;
    const includeBundles = bool(q.includeBundles) ?? false;
    const publishedOnly = bool(q.publishedOnly) ?? false;
    const sort = str(q.sort) === 'cheapest' ? 'cheapest' : 'parties';
    const filters = parseIndexFilters(q);
    const key = `index:${scopeKey(actor)}:${level}:${verifiedOnly}:${includeBundles}:${publishedOnly}:${sort}:${JSON.stringify(filters)}`;
    await refreshOutliers();
    const body = await cachedIndex<PizzaIndexResponse>(key, async () => {
      const rows = await fetchIndexRows(actor.scope, filters);
      const used = selectRows(rows, { verifiedOnly, includeBundles });
      const core = rows.filter((r) => !r.isBundle || includeBundles);
      const bundles = await fetchBundles(actor.scope, filters);
      return {
        level,
        filters: { ...filters },
        generatedAt: new Date().toISOString(),
        basis: {
          verifiedOnly, includeBundles,
          minPartiesNote: 'groups with fewer than minParties distinct parties have published=false (show greyed, "n<3")',
        },
        groups: aggregate(rows, { level, verifiedOnly, includeBundles, publishedOnly, sort }),
        bundles,
        meta: {
          rowsInView: rows.length,
          rowsUsed: used.length,
          excludedUnverifiedOutliers: core.filter((r) => !r.isVerified && r.outlierFlag).length,
          excludedLowConfidence: core.filter((r) => !r.isVerified && !r.outlierFlag && (r.sizeConfidence ?? 0) < 0.8).length,
        },
      };
    });
    res.json(body);
  } catch (err) {
    next(err);
  }
});

async function fetchBundles(scope: IndexScope, f: IndexFilters): Promise<PizzaBundleRow[]> {
  const cond: Prisma.Sql[] = [];
  if (f.country) cond.push(Prisma.sql`AND p.country = ${f.country}`);
  if (f.city) cond.push(Prisma.sql`AND lower(trim(p.city)) = ${f.city.trim().toLowerCase()}`);
  if (f.merchantKey) cond.push(Prisma.sql`AND li.merchant_key = ${f.merchantKey}`);
  if (f.year) cond.push(Prisma.sql`AND COALESCE(EXTRACT(YEAR FROM p.date)::int, EXTRACT(YEAR FROM d.created_at)::int) = ${f.year}`);
  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
    SELECT li.id AS line_id, li.document_id, li.party_id, p.name AS party_name, p.country, p.city, p.region,
           li.merchant, li.raw_name, li.qty::float8 AS qty, li.currency::text AS currency,
           li.unit_price_list::float8 AS unit_price_list, li.unit_price_usd::float8 AS unit_price_usd,
           li.area_cm2::float8 AS area_cm2, (li.verified_at IS NOT NULL) AS verified,
           d.url AS document_url, d.mime_type AS document_mime_type,
           d.source_receipt_index, d.source_receipt_count,
           COALESCE(EXTRACT(YEAR FROM p.date)::int, EXTRACT(YEAR FROM d.created_at)::int) AS event_year
    FROM pizza_line_items li
    JOIN payout_documents d ON d.id = li.document_id
    JOIN parties p ON p.id = li.party_id
    WHERE li.is_bundle = true AND li.excluded = false AND d.kind = 'receipt'
      AND d.is_duplicate = false AND d.ineligible = false AND li.unit_price_usd > 0
      ${cond.length ? Prisma.join(cond, ' ') : Prisma.empty} ${scope.full ? Prisma.empty : scopeSql(scope, 'p')}
    ORDER BY li.unit_price_usd * li.qty DESC
    LIMIT 500`);
  return rows
    .filter((r) => !f.continent || regionToContinent(r.region) === f.continent)
    .map((r) => {
      const total = r.unit_price_usd * r.qty;
      const area = r.area_cm2 && r.area_cm2 > 0 ? r.area_cm2 : null;
      return {
        lineId: r.line_id, documentId: r.document_id, partyId: r.party_id, partyName: r.party_name,
        country: r.country, city: r.city, merchant: r.merchant, rawName: r.raw_name,
        qty: r.qty, currency: r.currency, unitPriceList: r.unit_price_list, unitPriceUsd: r.unit_price_usd,
        totalUsd: Math.round(total * 100) / 100,
        perPizzaUsd: r.qty > 0 ? Math.round((total / r.qty) * 100) / 100 : null,
        sizeKnown: area !== null, areaCm2: area, usdPerCm2: area ? r.unit_price_usd / area : null,
        verified: !!r.verified, eventYear: r.event_year,
        documentUrl: r.document_url, documentMimeType: r.document_mime_type,
        sourceReceiptIndex: r.source_receipt_index, sourceReceiptCount: r.source_receipt_count,
      };
    });
}

// ===========================================================================
// GET /index/lines   (drill-down; opens receipts in the lightbox via documentId)
//   query: same filters as /index plus applyPolicy=true|false (default true => only lines the
//          index would use for verifiedOnly/includeBundles), verifiedOnly, includeBundles, limit (<=500)
//   Returns { lines: IndexLineDto[] } sorted by usdPerCm2 desc.
// ===========================================================================
router.get('/index/lines', ...reviewerChain, async (req: PizzaRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const q = req.query as Record<string, unknown>;
    const filters = parseIndexFilters(q);
    const limit = intQ(q.limit, 200, 1, 500);
    let rows = await fetchIndexRows(actor.scope, filters);
    if (bool(q.applyPolicy) ?? true) {
      rows = selectRows(rows, { verifiedOnly: bool(q.verifiedOnly) ?? false, includeBundles: bool(q.includeBundles) ?? false });
    }
    rows.sort((a, b) => b.usdPerCm2 - a.usdPerCm2);
    res.json({
      total: rows.length,
      lines: rows.slice(0, limit).map((r) => ({
        ...r,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        sizeLadderUsd: ladderFor(r.usdPerCm2),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

// ===========================================================================
// PUBLIC  GET /api/pizza-index   (no auth)
//   Aggregates only: country level, >= 3 parties, GPP 2026 data, verified or
//   high-confidence sizes, bundles excluded. No party names, merchants, or
//   receipt images. Cached 1h (in-process + Cache-Control).
//   Response: PublicPizzaIndex (see services/pizzaIndex.service.ts)
// ===========================================================================
export const publicPizzaIndexRouter = Router();
publicPizzaIndexRouter.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const body = await getPublicPizzaIndex();
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600');
    res.json(body);
  } catch (err) {
    next(err);
  }
});
