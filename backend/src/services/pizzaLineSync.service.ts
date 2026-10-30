/**
 * sfincione-40417: hash-based sync of pizza lines out of
 * payout_documents.ocr_line_items into pizza_line_items.
 *
 * HARD RULE: this module NEVER writes to payout_documents (or any payout
 * table). It only reads them and writes the pizza_* side tables, so it cannot
 * regress the payout flow.
 *
 * sfincione-40417 (pizza count): a receipt with NO priceable itemized pizza line
 * but a pizza count (auto-filled or host-entered) gets ONE synthetic estimated
 * line (line_index -1, source_category 'lump_sum') = base / count. The index
 * view flags it is_lump_sum (estimated tier only).
 *
 * Shape: a pure planner (`planDocSync`, unit tested) + a thin DB layer
 * (`syncPizzaLineItems`).
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  computeAreaCm2,
  looksLikeBundle,
  normalizeMerchantKey,
  parseSize,
  resolveFromReportedDims,
  resolveSize,
  type ResolvedSize,
  type SizePreset,
} from './pizzaSize.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrItemLike {
  name?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  subtotal?: unknown;
  category?: unknown;
  size?: { label?: string | null; diameterCm?: number | null; lengthCm?: number | null; widthCm?: number | null } | null;
}

export interface DiscountLine {
  label: string;
  /** Positive amount in the receipt's currency. */
  amount: number;
}

export interface DocContext {
  documentId: string;
  partyId: string;
  country: string | null;
  merchant: string | null;
  currency: string;
  fxRate: number;
  discounts: DiscountLine[];
  /** sfincione-40417 (pizza count): the receipt's count/size + total, when known. */
  count?: DocCount | null;
}

export interface DocCount {
  pizzaCount: number | null;
  countSource: string | null; // 'ocr' | 'llm' | 'host'
  sizeCm: number | null;
  sizeLabel: string | null;
  sizeSource: string | null;
  /** Receipt total in `totalCurrency` (null = unknown -> no receipt_total line). */
  receiptTotal: number | null;
  totalCurrency: string | null;
  totalFxRate: number | null;
}

/** line_index of the synthetic per-receipt lump-sum line (real lines are >= 0). */
export const LUMP_SUM_LINE_INDEX = -1;

/** Numeric/plain view of an existing pizza_line_items row. */
export interface ExistingLine {
  id: string;
  rawName?: string;
  lineIndex: number;
  lineFingerprint: string;
  sourceCategory: string;
  merchant: string | null;
  qty: number;
  unitPriceList: number;
  sizeLabel: string | null;
  shape: string | null;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  areaCm2: number | null;
  style: string | null;
  sizeSource: string | null;
  sizeConfidence: number | null;
  presetId: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  excluded: boolean;
  excludedReason: string | null;
  isBundle: boolean;
  outlierFlag: boolean;
  notes: string | null;
}

/** Column values to persist for a line (everything except id/created_at). */
export interface LineWrite {
  existingId: string | null;
  documentId: string;
  partyId: string;
  lineIndex: number;
  lineFingerprint: string;
  sourceCategory: string;
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
  shape: string | null;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  areaCm2: number | null;
  style: string | null;
  sizeSource: string | null;
  sizeConfidence: number | null;
  presetId: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  excluded: boolean;
  excludedReason: string | null;
  isBundle: boolean;
  outlierFlag: boolean;
  notes: string | null;
  /** Set when an existing row's text changed: its photo-pass suggestion no longer applies. */
  clearPhotoEstimate?: boolean;
}

export interface DocPlan {
  writes: LineWrite[];
  /** line_index values whose rows must be deleted. */
  deleteLineIndexes: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_QTY = 999_999;

export function lineFingerprint(name: string, qty: number, unitPrice: number): string {
  return crypto
    .createHash('md5')
    .update(`${name.trim().toLowerCase()}|${qty}|${unitPrice}`)
    .digest('hex');
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Receipt-level discount lines (negative amounts) from the raw model output. */
export function extractDiscounts(rawItems: unknown): DiscountLine[] {
  if (!Array.isArray(rawItems)) return [];
  const out: DiscountLine[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const e = it as Record<string, unknown>;
    const sub = num(e.subtotal, NaN);
    const unit = num(e.unitPrice, NaN);
    const qty = num(e.qty, 1) || 1;
    let amount: number | null = null;
    if (Number.isFinite(sub) && sub < 0) amount = Math.abs(sub);
    else if (Number.isFinite(unit) && unit < 0) amount = Math.abs(unit * qty);
    if (amount && amount > 0) {
      out.push({ label: typeof e.name === 'string' ? e.name.trim().slice(0, 120) : 'discount', amount });
    }
  }
  return out;
}

/**
 * Allocate a receipt-level discount pro rata across the pizza lines that carry
 * a positive price. Mutates `unitPriceNet`/`discountAmount`/`discountLabel`.
 * List price is untouched (the index uses list price).
 */
export function allocateDiscounts(lines: LineWrite[], discounts: DiscountLine[]): void {
  const total = discounts.reduce((a, d) => a + d.amount, 0);
  const priced = lines.filter((l) => !l.excluded && l.unitPriceList > 0 && l.qty > 0);
  const base = priced.reduce((a, l) => a + l.qty * l.unitPriceList, 0);
  for (const l of lines) {
    l.unitPriceNet = null;
    l.discountAmount = null;
    l.discountLabel = null;
  }
  if (total <= 0 || base <= 0) return;
  const label = discounts.map((d) => d.label).join('; ').slice(0, 200);
  for (const l of priced) {
    const perUnit = (total * l.unitPriceList) / base; // share of total / qty == total * unit / base
    const capped = Math.min(perUnit, l.unitPriceList);
    l.discountAmount = round4(capped);
    l.unitPriceNet = round4(l.unitPriceList - capped);
    l.discountLabel = label;
  }
}

function resolvedToFields(r: ResolvedSize) {
  return {
    sizeLabel: r.sizeLabel,
    shape: r.shape,
    diameterCm: r.diameterCm,
    lengthCm: r.lengthCm,
    widthCm: r.widthCm,
    sliceFraction: r.sliceFraction,
    areaCm2: r.areaCm2,
    style: r.style,
    sizeSource: r.sizeSource,
    sizeConfidence: r.sizeConfidence,
    presetId: r.presetId,
  };
}

/** Steps 1-2 of the resolver for one OCR line (parse, OCR-reported size, presets). */
export function resolveForItem(
  item: OcrItemLike,
  name: string,
  presets: SizePreset[],
  ctx: { merchantKey: string | null; country: string | null },
): ResolvedSize {
  const sizeLabel = item.size?.label ?? '';
  const parsed = parseSize(sizeLabel ? `${name} ${sizeLabel}` : name);
  const fromText = resolveSize(parsed, presets, ctx);
  if (fromText.sizeSource === 'parsed') return fromText;
  // OCR may have read printed dimensions the name regex can't see.
  if (item.size && (item.size.diameterCm || (item.size.lengthCm && item.size.widthCm))) {
    const rep = resolveFromReportedDims(
      {
        label: item.size.label ?? parsed.word,
        diameterCm: item.size.diameterCm ?? null,
        lengthCm: item.size.lengthCm ?? null,
        widthCm: item.size.widthCm ?? null,
        style: parsed.style,
      },
      0.9,
      'parsed',
    );
    if (rep) return rep;
  }
  return fromText;
}

const SIZE_WORDS = new Set(['personal', 'small', 'medium', 'regular', 'large', 'xl', 'family', 'mega']);
/** A stored size_label that is a size WORD can be fed back to the resolver as a hint. */
export function labelHint(label: string | null | undefined): string | null {
  const l = (label ?? '').trim().toLowerCase();
  return SIZE_WORDS.has(l) ? l : null;
}

function currentFields(e: ExistingLine) {
  return {
    sizeLabel: e.sizeLabel, shape: e.shape, diameterCm: e.diameterCm, lengthCm: e.lengthCm,
    widthCm: e.widthCm, sliceFraction: e.sliceFraction, areaCm2: e.areaCm2, style: e.style,
    sizeSource: e.sizeSource, sizeConfidence: e.sizeConfidence, presetId: e.presetId,
  };
}

/** Build the write for a brand-new (or fingerprint-reset) line. */
export function buildFreshWrite(
  item: OcrItemLike,
  idx: number,
  existingId: string | null,
  doc: DocContext,
  presets: SizePreset[],
  category: string,
  merchant: string | null,
  merchantKey: string | null,
): LineWrite {
  const rawName = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '[illegible]';
  const clearPhotoEstimate = existingId !== null;
  const qtyRaw = num(item.qty, 1);
  const qty = Math.min(Math.max(qtyRaw, 0), MAX_QTY);
  const unit = Math.max(num(item.unitPrice, 0), 0);
  const resolved = resolveForItem(item, rawName, presets, { merchantKey, country: doc.country });
  const zero = unit <= 0 || qty <= 0;
  return {
    existingId,
    ...(clearPhotoEstimate ? { clearPhotoEstimate } : {}),
    documentId: doc.documentId,
    partyId: doc.partyId,
    lineIndex: idx,
    lineFingerprint: lineFingerprint(rawName, qtyRaw, unit),
    sourceCategory: category,
    rawName,
    merchant,
    merchantKey,
    qty,
    unitPriceList: unit,
    unitPriceNet: null,
    discountAmount: null,
    discountLabel: null,
    currency: doc.currency,
    fxRate: doc.fxRate,
    unitPriceUsd: round4(unit * doc.fxRate),
    ...resolvedToFields(resolved),
    verifiedAt: null,
    verifiedBy: null,
    excluded: zero,
    excludedReason: zero ? 'zero_price' : null,
    isBundle: looksLikeBundle(rawName),
    outlierFlag: false,
    notes: null,
  };
}

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

/**
 * Decide what to write/delete for one document.
 *  - unchanged fingerprint  -> keep size/verification (+ qty/price overrides);
 *    unverified parsed/preset/unresolved lines are re-resolved so new presets apply
 *  - changed fingerprint    -> reset verification, re-resolve, replace
 *  - vanished line / no longer pizza (source_category 'pizza') -> delete
 *  - LLM-promoted lines (source_category != 'pizza') survive while unchanged
 */
export function planDocSync(
  items: OcrItemLike[],
  existing: ExistingLine[],
  doc: DocContext,
  presets: SizePreset[],
): DocPlan {
  const byIndex = new Map(existing.map((e) => [e.lineIndex, e]));
  const writes: LineWrite[] = [];
  const keep = new Set<number>();
  const merchantKeyDoc = normalizeMerchantKey(doc.merchant);

  items.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const rawName = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '[illegible]';
    const qtyRaw = num(item.qty, 1);
    const qty = Math.min(Math.max(qtyRaw, 0), MAX_QTY);
    const unit = Math.max(num(item.unitPrice, 0), 0);
    const category = typeof item.category === 'string' ? item.category.toLowerCase() : 'other';
    const fp = lineFingerprint(rawName, qtyRaw, unit);
    const prev = byIndex.get(idx);

    const isPizzaCat = category === 'pizza';
    const prevSurvives = !!prev && prev.lineFingerprint === fp && (isPizzaCat || prev.sourceCategory !== 'pizza');
    if (!isPizzaCat && !(prev && prev.lineFingerprint === fp && prev.sourceCategory !== 'pizza')) return; // not ours
    keep.add(idx);

    const merchant = doc.merchant ?? prev?.merchant ?? null;
    const merchantKey = normalizeMerchantKey(merchant) ?? merchantKeyDoc;

    if (prevSurvives && prev) {
      // Keep everything the humans / LLM decided; refresh money + merchant.
      const qtyKept = prev.qty;
      const unitKept = prev.unitPriceList;
      let fields = currentFields(prev);
      const reResolve =
        !prev.verifiedAt && (prev.sizeSource === null || prev.sizeSource === 'preset' || prev.sizeSource === 'parsed');
      if (reResolve) {
        // Feed the stored size word back in so an OCR-printed label survives re-resolve.
        const hint = labelHint(prev.sizeLabel);
        const hinted: OcrItemLike = !item.size?.label && hint ? { ...item, size: { ...(item.size ?? {}), label: hint } } : item;
        fields = resolvedToFields(resolveForItem(hinted, rawName, presets, { merchantKey, country: doc.country }));
        if (fields.sizeSource === null && prev.sizeSource === null) fields = { ...fields, style: fields.style ?? prev.style };
      }
      writes.push({
        existingId: prev.id,
        documentId: doc.documentId,
        partyId: doc.partyId,
        lineIndex: idx,
        lineFingerprint: fp,
        sourceCategory: prev.sourceCategory,
        rawName,
        merchant,
        merchantKey,
        qty: qtyKept,
        unitPriceList: unitKept,
        unitPriceNet: null,
        discountAmount: null,
        discountLabel: null,
        currency: doc.currency,
        fxRate: doc.fxRate,
        unitPriceUsd: round4(unitKept * doc.fxRate),
        ...fields,
        verifiedAt: prev.verifiedAt,
        verifiedBy: prev.verifiedBy,
        excluded: prev.excluded,
        excludedReason: prev.excludedReason,
        isBundle: prev.isBundle,
        outlierFlag: prev.outlierFlag,
        notes: prev.notes,
      });
      return;
    }

    // New line, or fingerprint changed -> fresh resolve, verification reset.
    writes.push(buildFreshWrite(item, idx, prev?.id ?? null, doc, presets, category, merchant, merchantKey));
  });

  allocateDiscounts(writes, doc.discounts);

  // sfincione-40417 (pizza count): AFTER discounts, so they never land on the synthetic line.
  const lump = buildLumpSumWrite(items, writes, existing, doc, presets);
  if (lump) {
    writes.push(lump);
    keep.add(LUMP_SUM_LINE_INDEX);
  }

  const deleteLineIndexes = existing.filter((e) => !keep.has(e.lineIndex)).map((e) => e.lineIndex);
  return { writes, deleteLineIndexes };
}

/**
 * The synthetic estimated per-pizza line for a receipt with a count but no
 * priceable itemized pizza line. Pure. Returns null when it doesn't apply
 * (a stale existing -1 line is then deleted by the caller via `keep`).
 */
export function buildLumpSumWrite(
  items: OcrItemLike[],
  writes: LineWrite[],
  existing: ExistingLine[],
  doc: DocContext,
  presets: SizePreset[],
): LineWrite | null {
  const c = doc.count;
  const count = c?.pizzaCount ?? 0;
  if (!c || !(count > 0)) return null;
  // Itemized lines always win.
  if (writes.some((w) => !w.excluded && !w.isBundle && w.unitPriceList > 0)) return null;

  // Base: the pizza-ish lines when there are any (trims tax/tip/drinks the OCR split
  // off), else the receipt total.
  let base = 0;
  let mode: 'pizza_lines' | 'receipt_total' = 'receipt_total';
  let currency = doc.currency;
  let fxRate = doc.fxRate;
  // Excluded lines are skipped (except lump_sum ones); LLM-flagged bundle lines ARE the lump sum.
  const pizzaish = writes.filter(
    (w) => w.lineIndex >= 0 && (w.excludedReason === 'lump_sum' || (!w.excluded && (w.sourceCategory === 'pizza' || w.isBundle))),
  );
  if (pizzaish.length > 0) {
    mode = 'pizza_lines';
    for (const w of pizzaish) {
      const it = items[w.lineIndex];
      const sub = it ? num((it as OcrItemLike).subtotal, 0) : 0;
      base += sub > 0 ? sub : w.qty * w.unitPriceList;
    }
  } else {
    if (!(c.receiptTotal && c.receiptTotal > 0) || !c.totalCurrency || !(c.totalFxRate && c.totalFxRate > 0)) return null;
    base = c.receiptTotal;
    currency = c.totalCurrency;
    fxRate = c.totalFxRate;
  }
  if (!(base > 0)) return null;

  const qty = Math.min(count, MAX_QTY);
  const unit = base / count;
  const rawName = `Lump sum: ${count} pizzas${c.sizeCm ? ` (${c.sizeCm} cm)` : ''}`;
  const fp = lineFingerprint(rawName, count, round4(unit));
  const prev = existing.find((e) => e.lineIndex === LUMP_SUM_LINE_INDEX);
  const merchant = doc.merchant ?? prev?.merchant ?? null;
  const merchantKey = normalizeMerchantKey(merchant);
  const notes = `lump_sum:${c.countSource ?? 'ocr'}:${mode}`;

  const sameFp = !!prev && prev.lineFingerprint === fp;
  let fields: ReturnType<typeof currentFields>;
  if (sameFp && prev && prev.verifiedAt) {
    fields = currentFields(prev); // a human verified this size: keep it
  } else {
    const src: 'manual' | 'parsed' | 'llm' = c.sizeSource === 'host' ? 'manual' : c.sizeSource === 'llm' ? 'llm' : 'parsed';
    let resolved: ResolvedSize | null = null;
    if (c.sizeCm) {
      resolved = resolveFromReportedDims({ shape: 'round', diameterCm: c.sizeCm }, 0.5, src);
    }
    if (!resolved) {
      const word = c.sizeLabel && c.sizeLabel !== 'mixed' ? c.sizeLabel : null;
      resolved = resolveForItem(word ? { size: { label: word } } : {}, 'pizza', presets, { merchantKey, country: doc.country });
    }
    const capped: ResolvedSize = {
      ...resolved,
      sizeConfidence: resolved.sizeConfidence === null ? null : Math.min(resolved.sizeConfidence, 0.5),
    };
    fields = resolvedToFields(capped);
  }

  return {
    existingId: prev?.id ?? null,
    ...(prev && !sameFp ? { clearPhotoEstimate: true } : {}),
    documentId: doc.documentId,
    partyId: doc.partyId,
    lineIndex: LUMP_SUM_LINE_INDEX,
    lineFingerprint: fp,
    sourceCategory: 'lump_sum',
    rawName,
    merchant,
    merchantKey,
    qty,
    unitPriceList: unit,
    unitPriceNet: null,
    discountAmount: null,
    discountLabel: null,
    currency,
    fxRate,
    unitPriceUsd: round4(unit * fxRate),
    ...fields,
    verifiedAt: sameFp && prev ? prev.verifiedAt : null,
    verifiedBy: sameFp && prev ? prev.verifiedBy : null,
    excluded: sameFp && prev ? prev.excluded : false,
    excludedReason: sameFp && prev ? prev.excludedReason : null,
    isBundle: false,
    outlierFlag: sameFp && prev ? prev.outlierFlag : false,
    notes,
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export async function loadPresets(): Promise<SizePreset[]> {
  const rows = await prisma.pizzaSizePreset.findMany();
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope as SizePreset['scope'],
    merchantKey: r.merchantKey,
    country: r.country,
    sizeLabel: r.sizeLabel,
    shape: r.shape as SizePreset['shape'],
    diameterCm: r.diameterCm === null ? null : Number(r.diameterCm),
    lengthCm: r.lengthCm === null ? null : Number(r.lengthCm),
    widthCm: r.widthCm === null ? null : Number(r.widthCm),
    sliceFraction: r.sliceFraction === null ? null : Number(r.sliceFraction),
  }));
}

const dn = (v: Prisma.Decimal | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

type DbLine = Awaited<ReturnType<typeof prisma.pizzaLineItem.findMany>>[number];

export function dbLineToExisting(r: DbLine): ExistingLine {
  return {
    id: r.id,
    rawName: r.rawName,
    lineIndex: r.lineIndex,
    lineFingerprint: r.lineFingerprint,
    sourceCategory: r.sourceCategory,
    merchant: r.merchant,
    qty: Number(r.qty),
    unitPriceList: Number(r.unitPriceList),
    sizeLabel: r.sizeLabel,
    shape: r.shape,
    diameterCm: dn(r.diameterCm),
    lengthCm: dn(r.lengthCm),
    widthCm: dn(r.widthCm),
    sliceFraction: dn(r.sliceFraction),
    areaCm2: dn(r.areaCm2),
    style: r.style,
    sizeSource: r.sizeSource,
    sizeConfidence: dn(r.sizeConfidence),
    presetId: r.presetId,
    verifiedAt: r.verifiedAt,
    verifiedBy: r.verifiedBy,
    excluded: r.excluded,
    excludedReason: r.excludedReason,
    isBundle: r.isBundle,
    outlierFlag: r.outlierFlag,
    notes: r.notes,
  };
}

/** Prisma create/update data for a LineWrite (area recomputed defensively). */
export function writeToData(w: LineWrite) {
  const area =
    w.areaCm2 ??
    computeAreaCm2({
      shape: w.shape as 'round' | 'rect' | 'slice' | null,
      diameterCm: w.diameterCm, lengthCm: w.lengthCm, widthCm: w.widthCm, sliceFraction: w.sliceFraction,
    });
  return {
    documentId: w.documentId,
    partyId: w.partyId,
    lineIndex: w.lineIndex,
    lineFingerprint: w.lineFingerprint,
    sourceCategory: w.sourceCategory,
    rawName: w.rawName,
    merchant: w.merchant,
    merchantKey: w.merchantKey,
    qty: w.qty,
    unitPriceList: w.unitPriceList,
    unitPriceNet: w.unitPriceNet,
    discountAmount: w.discountAmount,
    discountLabel: w.discountLabel,
    currency: w.currency,
    fxRate: w.fxRate,
    unitPriceUsd: w.unitPriceUsd,
    sizeLabel: w.sizeLabel,
    shape: w.shape,
    diameterCm: w.diameterCm,
    lengthCm: w.lengthCm,
    widthCm: w.widthCm,
    sliceFraction: w.sliceFraction,
    areaCm2: area,
    style: w.style,
    sizeSource: w.sizeSource,
    sizeConfidence: w.sizeConfidence,
    presetId: w.presetId,
    verifiedAt: w.verifiedAt,
    verifiedBy: w.verifiedBy,
    excluded: w.excluded,
    excludedReason: w.excludedReason,
    isBundle: w.isBundle,
    outlierFlag: w.outlierFlag,
    notes: w.notes,
    updatedAt: new Date(),
  };
}

/**
 * Doc currency + rate. Prefer the document's own rate (rate at OCR time);
 * fall back to the parent payout's rate ONLY when it is for the same currency.
 * Returns null when no trustworthy USD rate exists (line is skipped).
 */
export function resolveDocFx(d: {
  originalCurrency: string | null;
  exchangeRate: number | null;
  ocrCurrency: string | null;
  payoutCurrency: string | null;
  payoutRate: number | null;
}): { currency: string; fxRate: number } | null {
  const currency = (d.originalCurrency || d.ocrCurrency || d.payoutCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'UNKNOWN') return null;
  if (d.exchangeRate && d.exchangeRate > 0) return { currency, fxRate: d.exchangeRate };
  if (d.payoutRate && d.payoutRate > 0 && (d.payoutCurrency ?? '').toUpperCase() === currency) {
    return { currency, fxRate: d.payoutRate };
  }
  if (currency === 'USD') return { currency, fxRate: 1 };
  return null;
}

interface CandidateRow {
  id: string;
  party_id: string;
  country: string | null;
  ocr_line_items: unknown;
  raw_items: unknown;
  merchant: string | null;
  original_currency: string | null;
  exchange_rate: number | null;
  ocr_currency: string | null;
  payout_currency: string | null;
  payout_rate: number | null;
  hash: string;
  prev_hash: string | null;
  prev_discounts: unknown;
  // sfincione-40417 (pizza count)
  count_hash: string | null;
  pizza_count: number | null;
  pizza_count_source: string | null;
  pizza_size_cm: number | null;
  pizza_size_label: string | null;
  pizza_size_source: string | null;
  original_amount: number | null;
  ocr_amount: number | null;
}

/** SQL fragment: docs whose items/FX/merchant changed since the last sync. */
export const HASH_SQL = Prisma.sql`md5(
  d.ocr_line_items::text || '|' || coalesce(d.original_currency,'') || '|' || coalesce(d.exchange_rate::text,'')
  || '|' || coalesce(d.ocr_currency,'') || '|' || coalesce(po.original_currency,'') || '|' || coalesce(po.exchange_rate::text,'')
  || '|' || coalesce(d.ocr_raw->'ocr'->>'merchant', d.ocr_raw->>'merchant','')
  || '|' || coalesce(jsonb_path_query_array(d.ocr_raw->'ocr'->'lineItems', '$[*] ? (@.subtotal < 0 || @.unitPrice < 0)')::text,''))`;

/**
 * sfincione-40417 (pizza count): hash of the receipt's count/size/amount, kept
 * SEPARATE from HASH_SQL on purpose. HASH_SQL must stay byte-identical (changing
 * it would make every doc a candidate and reset llm_pass_at/vision_pass_at,
 * re-spending OpenAI quota). NULL when the doc has no count and no size, so
 * untouched docs keep count_hash NULL (IS DISTINCT FROM -> not a candidate).
 */
export const COUNT_HASH_SQL = Prisma.sql`CASE WHEN d.pizza_count IS NULL AND d.pizza_size_cm IS NULL AND d.pizza_size_label IS NULL THEN NULL
  ELSE md5(coalesce(d.pizza_count::text,'') || '|' || coalesce(d.pizza_count_source,'') || '|' ||
           coalesce(d.pizza_size_cm::text,'') || '|' || coalesce(d.pizza_size_label,'') || '|' ||
           coalesce(d.pizza_size_source,'') || '|' || coalesce(d.original_amount::text,'') || '|' ||
           coalesce(d.ocr_amount::text,'') || '|' || coalesce(d.original_currency,'') || '|' ||
           coalesce(d.exchange_rate::text,'')) END`;

/** Pure decision for the pizza_line_sync row (testable without a DB). */
export function planSyncRow(a: {
  prevHash: string | null;
  newHash: string;
  prevDiscounts: unknown;
  rawDiscounts: DiscountLine[];
}): { resetMarkers: boolean; discounts: DiscountLine[]; writeDiscounts: boolean } {
  const prev: DiscountLine[] = Array.isArray(a.prevDiscounts)
    ? (a.prevDiscounts as DiscountLine[]).filter((d) => d && Number(d.amount) > 0)
    : [];
  const hasRaw = a.rawDiscounts.length > 0;
  return {
    resetMarkers: a.prevHash !== a.newHash,
    discounts: hasRaw ? a.rawDiscounts : prev,
    writeDiscounts: hasRaw,
  };
}

/** The DocContext.count for a candidate row (receipt total in the FX currency, else USD at rate 1). */
export function docCountFromRow(
  c: Pick<CandidateRow, 'pizza_count' | 'pizza_count_source' | 'pizza_size_cm' | 'pizza_size_label' | 'pizza_size_source' | 'original_amount' | 'ocr_amount' | 'original_currency'>,
  fx: { currency: string; fxRate: number },
): DocCount | null {
  if (!c.pizza_count || c.pizza_count <= 0) return null;
  let receiptTotal: number | null = null;
  let totalCurrency: string | null = null;
  let totalFxRate: number | null = null;
  if (c.original_amount && c.original_amount > 0 && c.original_currency && c.original_currency.trim().toUpperCase() === fx.currency) {
    receiptTotal = c.original_amount;
    totalCurrency = fx.currency;
    totalFxRate = fx.fxRate;
  } else if (c.ocr_amount && c.ocr_amount > 0) {
    receiptTotal = c.ocr_amount;
    totalCurrency = 'USD';
    totalFxRate = 1;
  }
  return {
    pizzaCount: c.pizza_count,
    countSource: c.pizza_count_source,
    sizeCm: c.pizza_size_cm,
    sizeLabel: c.pizza_size_label,
    sizeSource: c.pizza_size_source,
    receiptTotal,
    totalCurrency,
    totalFxRate,
  };
}

export interface SyncStats {
  docsScanned: number;
  docsSynced: number;
  docsSkippedNoFx: number;
  linesWritten: number;
  linesDeleted: number;
  remaining: number;
  /** force mode: pass this back as `forceBefore` on follow-up calls. */
  forceBefore: string | null;
  duplicatesMarked: number;
  orphansRemoved: number;
}

/**
 * Sync pizza lines for changed docs. Processes at most `limit` docs per call
 * (serverless time budget); `remaining` tells the caller whether to loop.
 */
export async function syncPizzaLineItems(opts: {
  docIds?: string[];
  limit?: number;
  force?: boolean;
  /**
   * force mode only: re-process docs whose sync row is older than this instant.
   * Each processed doc gets synced_at = now (> forceBefore), so repeated calls
   * with the SAME forceBefore advance and `remaining` reaches 0.
   */
  forceBefore?: Date;
} = {}): Promise<SyncStats> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const docFilter = opts.docIds?.length
    ? Prisma.sql`AND d.id = ANY(${opts.docIds}::uuid[])`
    : Prisma.empty;
  const forceBefore = opts.forceBefore ?? new Date();
  const changedFilter = opts.force
    ? Prisma.sql`AND (s.synced_at IS NULL OR s.synced_at < ${forceBefore})`
    : Prisma.sql`AND (s.items_hash IS NULL OR s.items_hash <> ${HASH_SQL} OR s.count_hash IS DISTINCT FROM ${COUNT_HASH_SQL})`;

  const fromWhere = Prisma.sql`
    FROM payout_documents d
    JOIN parties p ON p.id = d.party_id
    LEFT JOIN payouts po ON po.id = d.payout_id
    LEFT JOIN pizza_line_sync s ON s.document_id = d.id
    WHERE d.kind = 'receipt'
      AND ((d.ocr_line_items IS NOT NULL AND jsonb_typeof(d.ocr_line_items) = 'array') OR d.pizza_count IS NOT NULL)
      ${docFilter} ${changedFilter}`;

  const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT d.id, d.party_id, p.country, d.ocr_line_items, d.ocr_raw->'ocr'->'lineItems' AS raw_items,
           coalesce(d.ocr_raw->'ocr'->>'merchant', d.ocr_raw->>'merchant') AS merchant,
           d.original_currency, d.exchange_rate::float8 AS exchange_rate, d.ocr_currency,
           po.original_currency AS payout_currency, po.exchange_rate::float8 AS payout_rate,
           coalesce(${HASH_SQL}, 'no-items') AS hash, s.items_hash AS prev_hash, s.discounts AS prev_discounts,
           ${COUNT_HASH_SQL} AS count_hash,
           d.pizza_count, d.pizza_count_source, d.pizza_size_cm::float8 AS pizza_size_cm,
           d.pizza_size_label, d.pizza_size_source,
           d.original_amount::float8 AS original_amount, d.ocr_amount::float8 AS ocr_amount
    ${fromWhere}
    ORDER BY d.created_at
    LIMIT ${limit}`);

  const [{ n: totalChanged }] = await prisma.$queryRaw<{ n: number }[]>(
    Prisma.sql`SELECT count(*)::int AS n ${fromWhere}`);

  const stats: SyncStats = {
    docsScanned: candidates.length,
    docsSynced: 0,
    docsSkippedNoFx: 0,
    linesWritten: 0,
    linesDeleted: 0,
    remaining: Math.max(totalChanged - candidates.length, 0),
    forceBefore: opts.force ? forceBefore.toISOString() : null,
    duplicatesMarked: 0,
    orphansRemoved: 0,
  };

  if (candidates.length > 0) {
    const presets = await loadPresets();
    const existingAll = await prisma.pizzaLineItem.findMany({
      where: { documentId: { in: candidates.map((c) => c.id) } },
    });
    const existingByDoc = new Map<string, ExistingLine[]>();
    for (const r of existingAll) {
      if (!r.documentId) continue; // archive (history) lines have no document
      const arr = existingByDoc.get(r.documentId) ?? [];
      arr.push(dbLineToExisting(r));
      existingByDoc.set(r.documentId, arr);
    }

    for (const c of candidates) {
      const items = Array.isArray(c.ocr_line_items) ? (c.ocr_line_items as OcrItemLike[]) : [];
      const fx = resolveDocFx({
        originalCurrency: c.original_currency,
        exchangeRate: c.exchange_rate,
        ocrCurrency: c.ocr_currency,
        payoutCurrency: c.payout_currency,
        payoutRate: c.payout_rate,
      });
      const prevLines = existingByDoc.get(c.id) ?? [];
      const hasPizza = items.some((i) => i && typeof i === 'object' && String(i.category).toLowerCase() === 'pizza');
      if (!fx) {
        // No trustworthy USD rate: can't price this doc. Remember it (so we
        // don't rescan) and drop stale rows; a currency fix changes the hash.
        stats.docsSkippedNoFx += hasPizza ? 1 : 0;
      }
      const syncPlan = planSyncRow({
        prevHash: c.prev_hash, newHash: c.hash, prevDiscounts: c.prev_discounts, rawDiscounts: extractDiscounts(c.raw_items),
      });
      const discounts = syncPlan.discounts;
      const plan: DocPlan = fx
        ? planDocSync(items, prevLines, {
            documentId: c.id, partyId: c.party_id, country: c.country, merchant: c.merchant,
            currency: fx.currency, fxRate: fx.fxRate, discounts,
            count: docCountFromRow(c, fx),
          }, presets)
        : { writes: [], deleteLineIndexes: prevLines.map((l) => l.lineIndex) };

      const creates = plan.writes.filter((w) => !w.existingId).map(writeToData);
      const updates = plan.writes.filter((w) => w.existingId);
      const discountTotal = discounts.reduce((a, d) => a + d.amount, 0);

      await prisma.$transaction([
        ...(plan.deleteLineIndexes.length
          ? [prisma.pizzaLineItem.deleteMany({ where: { documentId: c.id, lineIndex: { in: plan.deleteLineIndexes } } })]
          : []),
        ...(creates.length ? [prisma.pizzaLineItem.createMany({ data: creates, skipDuplicates: true })] : []),
        ...updates.map((w) => {
          const { documentId: _d, partyId: _p, lineIndex: _l, ...data } = writeToData(w);
          return prisma.pizzaLineItem.update({
            where: { id: w.existingId! },
            data: w.clearPhotoEstimate ? { ...data, photoEstimate: Prisma.DbNull } : data,
          });
        }),
        prisma.pizzaLineSync.upsert({
          where: { documentId: c.id },
          create: {
            documentId: c.id, itemsHash: c.hash, countHash: c.count_hash,
            discounts: discounts.length ? (discounts as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            discountTotal: discountTotal || null,
          },
          update: {
            itemsHash: c.hash, countHash: c.count_hash, syncedAt: new Date(),
            // Pass markers reset ONLY when the hash really changed (not on force:true).
            ...(syncPlan.resetMarkers ? { llmPassAt: null, visionPassAt: null } : {}),
            // Discounts are rewritten only when the raw receipt has some; otherwise
            // keep what the vision pass captured.
            ...(syncPlan.writeDiscounts
              ? { discounts: discounts as unknown as Prisma.InputJsonValue, discountTotal: discountTotal || null }
              : {}),
          },
        }),
      ]);
      stats.docsSynced += 1;
      stats.linesWritten += plan.writes.length;
      stats.linesDeleted += plan.deleteLineIndexes.length;
    }
  }

  stats.duplicatesMarked = await markDuplicateLines();
  stats.orphansRemoved = await removeOrphans();
  return stats;
}

/**
 * Same (url, name, qty, unitPrice) on DIFFERENT docs sharing a url (multi-receipt
 * photos) is the same purchase read twice: exclude all but the first.
 */
export async function markDuplicateLines(): Promise<number> {
  // Only auto-set exclusions are touched: unverified and never edited by a human
  // (updated_by IS NULL). Manual exclusions always carry updated_by/verified_at.
  const dupCte = Prisma.sql`
    WITH dup AS (
      SELECT x.id FROM (
        SELECT li2.id, li2.document_id,
               first_value(li2.document_id) OVER w AS first_doc
        FROM pizza_line_items li2
        JOIN payout_documents d2 ON d2.id = li2.document_id
        WHERE d2.is_duplicate = false AND d2.ineligible = false
        WINDOW w AS (PARTITION BY d2.url, lower(trim(li2.raw_name)), li2.qty, li2.unit_price_list
                     ORDER BY d2.created_at, d2.id, li2.line_index)
      ) x WHERE x.document_id <> x.first_doc
    )`;
  const marked = await prisma.$executeRaw(Prisma.sql`${dupCte}
    UPDATE pizza_line_items li
    SET excluded = true, excluded_reason = 'duplicate_line', updated_at = now()
    FROM dup
    WHERE li.id = dup.id AND li.excluded = false AND li.verified_at IS NULL`);
  // Un-mark auto exclusions that no longer apply (e.g. the original doc was flagged duplicate).
  await prisma.$executeRaw(Prisma.sql`${dupCte}
    UPDATE pizza_line_items li
    SET excluded = false, excluded_reason = NULL, updated_at = now()
    WHERE li.excluded_reason = 'duplicate_line' AND li.verified_at IS NULL AND li.updated_by IS NULL
      AND li.id NOT IN (SELECT id FROM dup)`);
  return Number(marked);
}

/** Rows whose document lost its line items / stopped being a receipt. */
export async function removeOrphans(): Promise<number> {
  const n = await prisma.$executeRaw`
    DELETE FROM pizza_line_items li
    USING payout_documents d
    WHERE li.document_id = d.id AND (d.kind <> 'receipt'
          OR ((d.ocr_line_items IS NULL OR jsonb_typeof(d.ocr_line_items) <> 'array') AND d.pizza_count IS NULL))`;
  await prisma.$executeRaw`
    DELETE FROM pizza_line_sync s
    USING payout_documents d
    WHERE s.document_id = d.id AND (d.kind <> 'receipt' OR (d.ocr_line_items IS NULL AND d.pizza_count IS NULL))`;
  return Number(n);
}

/**
 * Re-run the preset step for unverified lines whose size came from a parse,
 * a preset, or nothing (e.g. after a preset was created/changed).
 */
export async function reresolveUnverified(filter: { merchantKey?: string; partyIds?: string[] } = {}): Promise<number> {
  const presets = await loadPresets();
  const rows = await prisma.pizzaLineItem.findMany({
    where: {
      verifiedAt: null,
      excluded: false,
      // sfincione-40417: the synthetic lump-sum line's size comes from doc fields
      // the rawName can't reproduce.
      sourceCategory: { not: 'lump_sum' },
      // 'parsed' rows are deterministic (and may come from OCR-printed dims that
      // we can't reconstruct from the name alone), so leave them alone here.
      OR: [{ sizeSource: null }, { sizeSource: 'preset' }],
      ...(filter.merchantKey ? { merchantKey: filter.merchantKey } : {}),
      ...(filter.partyIds ? { partyId: { in: filter.partyIds } } : {}),
    },
    include: { party: { select: { country: true } }, historyReceipt: { select: { country: true } } },
  });
  let changed = 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const r of rows) {
    const hint = labelHint(r.sizeLabel);
    const resolved = resolveForItem(hint ? { size: { label: hint } } : {}, r.rawName, presets, { merchantKey: r.merchantKey, country: r.party?.country ?? r.historyReceipt?.country ?? null });
    const same =
      resolved.sizeSource === r.sizeSource &&
      resolved.presetId === r.presetId &&
      dn(r.areaCm2) === resolved.areaCm2 &&
      r.sizeLabel === resolved.sizeLabel;
    if (same) continue;
    changed += 1;
    const f = resolvedToFields(resolved);
    ops.push(prisma.pizzaLineItem.update({
      where: { id: r.id },
      data: { ...f, updatedAt: new Date() },
    }));
    if (ops.length >= 200) {
      await prisma.$transaction(ops.splice(0, ops.length));
    }
  }
  if (ops.length) await prisma.$transaction(ops);
  return changed;
}
