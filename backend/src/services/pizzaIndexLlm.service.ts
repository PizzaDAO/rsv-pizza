/**
 * sfincione-40417: LLM size passes for the Pizza Price Index.
 *
 *  - Text pass  (gpt-4o-mini, `getLlmModels().assistant`): per receipt, classify
 *    lines (re-classifies `other`/`beverage`) and infer size/shape/bundle.
 *  - Vision pass (gpt-4o, `getLlmModels().visionPrimary`): re-reads the receipt
 *    image for printed sizes on lines that are still unresolved; also captures
 *    merchant and receipt-level discounts.
 *
 * Uses the same OpenAI client + key as ocr.service. Never touches
 * payout_documents EXCEPT one narrow, guarded exception (sfincione-40417 pizza
 * count): the text pass may write the pizza_count_* / pizza_size_* columns of
 * a receipt (source 'llm'), never money columns and never over a host value
 * or a higher-confidence value (see writeLumpSumToDoc). Pure prompt/parse/apply
 * helpers are exported for tests; runLlmPass / runVisionPass are the thin DB +
 * network drivers.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { getOpenAI } from '../lib/openai.js';
import { getLlmModels } from '../lib/privateConfig.js';
import { imageUrlToBase64DataUrl } from './ocr.service.js';
import {
  CONFIDENCE,
  looksLikeBundle,
  normalizeMerchantKey,
  parseSize,
  resolveFromReportedDims,
  resolveSize,
  type ResolvedSize,
  type SizePreset,
} from './pizzaSize.service.js';
import {
  buildFreshWrite,
  dbLineToExisting,
  loadPresets,
  reresolveUnverified,
  syncPizzaLineItems,
  writeToData,
  type DocContext,
  type ExistingLine,
  type LineWrite,
  type OcrItemLike,
} from './pizzaLineSync.service.js';
import { loadDocRows, reallocateDocDiscounts, type DocRow } from './pizzaLineDocs.service.js';
import { MAX_PIZZA_COUNT } from './pizzaCountAutofill.js';

const MAX_LINES_PER_DOC = 60;
const SENT_CATEGORIES = new Set(['pizza', 'other', 'beverage', 'side']);

// ---------------------------------------------------------------------------
// Text pass: prompt + parse + apply (pure)
// ---------------------------------------------------------------------------

export interface LlmLine {
  i: number;
  isPizza: boolean;
  sizeLabel: string | null;
  shape: 'round' | 'rect' | 'slice' | null;
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  sliceFraction: number | null;
  isBundle: boolean;
  style: string | null;
  confidence: number;
  reasoning: string;
}

export const TEXT_PASS_SYSTEM = `You classify receipt lines for a global pizza price study and infer pizza sizes.
For EACH input line decide whether it is a PIZZA the customer bought (not drinks, sides, desserts, fees, tax, tips, delivery, boxes, or toppings-only add-ons) and what size it is.
Return ONLY JSON: { "lines": [ { "i": number, "isPizza": boolean, "sizeLabel": string|null, "shape": "round"|"rect"|"slice"|null, "diameterCm": number|null, "lengthCm": number|null, "widthCm": number|null, "sliceFraction": number|null, "isBundle": boolean, "style": "neapolitan"|"ny"|"pan"|"detroit"|"sicilian"|"thin"|"other"|null, "confidence": number, "reasoning": string } ], "lumpSum": { "pizzaCount": number|null, "sizeLabel": string|null, "diameterCm": number|null, "confidence": number } | null }
Rules:
- "i" is the input index; return one entry per input line.
- sizeLabel: one of personal, small, medium, regular, large, xl, family, mega, slice, half, or null. Use a size word only if the line (or its merchant/country context) says so.
- diameterCm / lengthCm / widthCm: ONLY if the line prints a dimension, or you KNOW the merchant's published size for that exact size name. Otherwise null. NEVER invent a diameter from a generic idea of "large".
- isBundle: DEFAULT FALSE. true ONLY when the per-pizza price CANNOT be recovered from the line:
  (a) a lump sum covering many/unspecified pizzas at qty 1 ("Global pizza party payment", "30 additional pizzas for attendees", "Pizzas varias" qty 1);
  (b) a package mixing pizza with other items or services ("Fabrication et installation des pizzas", "PIZZA COMBO" with drinks/sides);
  (c) all-you-can-eat / buffet / per-head pricing ("Rodizio", "Pizza libre x 50").
  A line with qty > 1 and a unit price is NOT a bundle, however large the qty: the unit price is the per-pizza price. A number in the name ("20 Margherita Pizza", "Margherita x 17") is a quantity, not a bundle.
  Examples isBundle=false: {"name":"Piggy Pizza","qty":3}, {"name":"Margherita x 17","qty":17}, {"name":"B & S Chicken (L)","qty":10}, {"name":"20 Margherita Pizza","qty":20}, {"name":"Capricciosa x 10","qty":10}, {"name":"Beef Salami x 8","qty":8}.
  Examples isBundle=true: {"name":"Global pizza party payment","qty":1}, {"name":"30 additional pizzas for attendees","qty":1}, {"name":"Pizzas varias","qty":1}, {"name":"Fabrication et installation des pizzas","qty":1}, {"name":"PIZZA COMBO + drinks","qty":1}, {"name":"All you can eat pizza","qty":1}.
- shape "slice" is for single slices (sliceFraction e.g. 0.125); "rect" for square/sheet/al taglio/Sicilian/Detroit with known dimensions.
- confidence: 0..1, your confidence in the size (not in isPizza). reasoning: at most 80 characters.
- lumpSum: when a line is a lump sum covering N STATED pizzas ("30 additional pizzas for attendees", "Pizzas x20"), return { "pizzaCount": N, "sizeLabel": ..., "diameterCm": ..., "confidence": 0..1 } for the whole receipt (size only if stated; otherwise null). Otherwise return null. NEVER infer N from the price.
The lines may be in any language.`;

export function buildTextPassUser(doc: {
  merchant: string | null; country: string | null; city: string | null; currency: string | null;
  lines: Array<{ i: number; name: string; qty: number; unitPrice: number; category: string }>;
}): string {
  return JSON.stringify({
    merchant: doc.merchant, country: doc.country, city: doc.city, currency: doc.currency,
    lines: doc.lines,
  });
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Tolerant parse of the model's JSON; drops entries with an unknown index. */
export function parseTextPassResponse(content: string | null | undefined, validIndexes: Set<number>): LlmLine[] {
  if (!content) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const arr: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.lines) ? parsed.lines : [];
  const out: LlmLine[] = [];
  const seen = new Set<number>();
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const i = Number(r.i);
    if (!Number.isInteger(i) || !validIndexes.has(i) || seen.has(i)) continue;
    seen.add(i);
    const shape = r.shape === 'round' || r.shape === 'rect' || r.shape === 'slice' ? r.shape : null;
    const conf = Number(r.confidence);
    out.push({
      i,
      isPizza: r.isPizza === true,
      sizeLabel: typeof r.sizeLabel === 'string' && r.sizeLabel.trim() ? r.sizeLabel.trim().toLowerCase().slice(0, 40) : null,
      shape,
      diameterCm: numOrNull(r.diameterCm),
      lengthCm: numOrNull(r.lengthCm),
      widthCm: numOrNull(r.widthCm),
      sliceFraction: numOrNull(r.sliceFraction),
      isBundle: r.isBundle === true,
      style: typeof r.style === 'string' && r.style.trim() ? r.style.trim().toLowerCase().slice(0, 20) : null,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
      reasoning: typeof r.reasoning === 'string' ? r.reasoning.slice(0, 80) : '',
    });
  }
  return out;
}

export interface LumpSumRead {
  pizzaCount: number;
  sizeLabel: string | null;
  diameterCm: number | null;
  /** 0..1, capped at 0.7 when stored. */
  confidence: number;
}

/**
 * sfincione-40417 (pizza count): tolerant parse of the optional top-level
 * `lumpSum` object. Old/absent/malformed responses give null.
 */
export function parseLumpSumResponse(content: string | null | undefined): LumpSumRead | null {
  if (!content) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const ls = parsed && typeof parsed === 'object' ? parsed.lumpSum : null;
  if (!ls || typeof ls !== 'object') return null;
  const n = Number(ls.pizzaCount);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PIZZA_COUNT) return null;
  const conf = Number(ls.confidence);
  const d = numOrNull(ls.diameterCm);
  return {
    pizzaCount: n,
    sizeLabel: typeof ls.sizeLabel === 'string' && ls.sizeLabel.trim() ? ls.sizeLabel.trim().toLowerCase().slice(0, 40) : null,
    diameterCm: d !== null && d >= 15 && d <= 80 ? d : null,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  };
}

/**
 * The ONLY write this module makes to payout_documents (see header): the
 * pizza_* columns, guarded so a host value (including host-cleared) or an
 * equal/higher-confidence auto value is never overwritten. Returns true when
 * the count was written.
 */
export async function writeLumpSumToDoc(documentId: string, ls: LumpSumRead): Promise<boolean> {
  const c = Math.round(Math.min(0.7, ls.confidence) * 100) / 100;
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE payout_documents
    SET pizza_count = ${ls.pizzaCount}, pizza_count_source = 'llm', pizza_count_confidence = ${c}
    WHERE id = ${documentId}::uuid
      AND (pizza_count_source IS NULL
           OR (pizza_count_source <> 'host' AND coalesce(pizza_count_confidence, 0) <= ${c}))`);
  if (ls.diameterCm !== null || ls.sizeLabel !== null) {
    const sc = ls.diameterCm !== null ? 0.6 : 0.45;
    await prisma.$executeRaw(Prisma.sql`
      UPDATE payout_documents
      SET pizza_size_cm = ${ls.diameterCm}, pizza_size_label = ${ls.diameterCm !== null ? null : ls.sizeLabel},
          pizza_size_source = 'llm', pizza_size_confidence = ${sc}
      WHERE id = ${documentId}::uuid
        AND (pizza_size_source IS NULL
             OR (pizza_size_source <> 'host' AND coalesce(pizza_size_confidence, 0) <= ${sc}))`);
  }
  return Number(n) > 0;
}

/** Size outcome from a model-reported record: dims first, else size-word preset. */
export function sizeFromModel(
  rep: {
    sizeLabel: string | null; shape: string | null; diameterCm: number | null; lengthCm: number | null;
    widthCm: number | null; sliceFraction: number | null; style: string | null; confidence: number;
  },
  cap: number,
  presets: SizePreset[],
  ctx: { merchantKey: string | null; country: string | null },
): ResolvedSize | null {
  const conf = Math.min(rep.confidence, cap);
  const dims = resolveFromReportedDims(
    {
      label: rep.sizeLabel, shape: rep.shape, diameterCm: rep.diameterCm, lengthCm: rep.lengthCm,
      widthCm: rep.widthCm, sliceFraction: rep.sliceFraction, style: rep.style,
    },
    conf,
    'llm',
  );
  if (dims) return dims;
  if (rep.sizeLabel) {
    const r = resolveSize(parseSize(rep.sizeLabel), presets, ctx);
    if (r.areaCm2 !== null) {
      // The LLM supplied the label, so provenance is 'llm' (keeps the preset link);
      // confidence can't exceed the preset's, the cap, or the model's own.
      return {
        ...r,
        sizeSource: 'llm',
        sizeConfidence: Math.round(Math.min(r.sizeConfidence ?? conf, conf) * 100) / 100,
        style: rep.style ?? r.style,
      };
    }
  }
  return null;
}

export type LlmApplyResult =
  | { kind: 'none' }
  | { kind: 'insert'; write: LineWrite }
  | { kind: 'update'; id: string; data: Prisma.PizzaLineItemUpdateInput };

function sizeData(r: ResolvedSize): Prisma.PizzaLineItemUpdateInput {
  return {
    sizeLabel: r.sizeLabel, shape: r.shape, diameterCm: r.diameterCm, lengthCm: r.lengthCm,
    widthCm: r.widthCm, sliceFraction: r.sliceFraction, areaCm2: r.areaCm2, style: r.style,
    sizeSource: r.sizeSource, sizeConfidence: r.sizeConfidence,
    preset: r.presetId ? { connect: { id: r.presetId } } : { disconnect: true },
  };
}

/**
 * Deterministic guard on the model's isBundle (plan 12.4): qty > 1 with a unit
 * price has a recoverable per-pizza price, so it is never a bundle unless the
 * name itself matches the all-you-can-eat / party-pack heuristic.
 */
export function llmBundleAccepted(llm: LlmLine, qty: number | null | undefined, rawName: string | null | undefined): boolean {
  if (!llm.isBundle) return false;
  if (Number(qty) > 1 && !looksLikeBundle(rawName)) return false;
  return true;
}

/**
 * Merge one LLM line into the existing row (or create a row for a promoted
 * `other`/`beverage` line). Never touches verified rows, never lowers a
 * higher-confidence size (parsed 0.95 / merchant preset 0.85 beat the LLM cap).
 */
export function applyLlmLine(
  llm: LlmLine,
  item: OcrItemLike | undefined,
  prev: ExistingLine | null,
  doc: DocContext,
  presets: SizePreset[],
): LlmApplyResult {
  if (prev?.verifiedAt) return { kind: 'none' };
  const merchantKey = normalizeMerchantKey(doc.merchant);
  const ctx = { merchantKey: prev ? normalizeMerchantKey(prev.merchant ?? doc.merchant) : merchantKey, country: doc.country };

  if (!llm.isPizza) {
    // Model says a line we hold is not a pizza -> exclude (reviewable), never delete.
    if (prev && !prev.excluded) {
      return { kind: 'update', id: prev.id, data: { excluded: true, excludedReason: 'not_pizza', updatedAt: new Date() } };
    }
    return { kind: 'none' };
  }

  const sized = sizeFromModel(llm, CONFIDENCE.llmCap, presets, ctx);

  if (!prev) {
    if (!item) return { kind: 'none' };
    const category = typeof item.category === 'string' ? item.category.toLowerCase() : 'other';
    const write = buildFreshWrite(item, llm.i, null, doc, presets, category === 'pizza' ? 'pizza' : category, doc.merchant, merchantKey);
    if (sized && (write.sizeConfidence ?? 0) < (sized.sizeConfidence ?? 0)) {
      Object.assign(write, {
        sizeLabel: sized.sizeLabel, shape: sized.shape, diameterCm: sized.diameterCm, lengthCm: sized.lengthCm,
        widthCm: sized.widthCm, sliceFraction: sized.sliceFraction, areaCm2: sized.areaCm2, style: sized.style,
        sizeSource: sized.sizeSource, sizeConfidence: sized.sizeConfidence, presetId: sized.presetId,
      });
    }
    if (llmBundleAccepted(llm, write.qty, write.rawName)) write.isBundle = true;
    if (!write.style && llm.style) write.style = llm.style;
    return { kind: 'insert', write };
  }

  const data: Prisma.PizzaLineItemUpdateInput = {};
  if (sized && (prev.sizeConfidence ?? 0) < (sized.sizeConfidence ?? 0)) Object.assign(data, sizeData(sized));
  if (llmBundleAccepted(llm, prev.qty, prev.rawName) && !prev.isBundle) data.isBundle = true;
  if (!prev.style && llm.style) data.style = llm.style;
  if (Object.keys(data).length === 0) return { kind: 'none' };
  data.updatedAt = new Date();
  return { kind: 'update', id: prev.id, data };
}

// ---------------------------------------------------------------------------
// Vision pass: prompt + parse + apply (pure)
// ---------------------------------------------------------------------------

export const VISION_PASS_SYSTEM = `You read a restaurant receipt image to find the PRINTED SIZE of pizza lines, for a pizza price study.
You are given the pizza lines already extracted (index, name, qty, unit price). For each, report ONLY sizes that are actually visible on the receipt (on the line, in a size column, a menu legend, or a note like '12" large'): a size word, a diameter/dimensions, or slice info. If nothing is printed for a line, return nulls. NEVER guess a size from a generic idea of "large".
Also report: the merchant/restaurant name if visible, and any DISCOUNT / promo / coupon lines as positive amounts in the receipt's currency.
Return ONLY JSON: { "merchant": string|null, "discounts": [ { "label": string, "amount": number } ], "lines": [ { "i": number, "printedSize": string|null, "sizeLabel": string|null, "shape": "round"|"rect"|"slice"|null, "diameterCm": number|null, "lengthCm": number|null, "widthCm": number|null, "sliceFraction": number|null, "confidence": number } ] }
sizeLabel is one of personal, small, medium, regular, large, xl, family, mega, slice, half, or null. Convert inches to cm (1 inch = 2.54 cm).`;

export interface VisionResult {
  merchant: string | null;
  discounts: Array<{ label: string; amount: number }>;
  lines: LlmLine[];
}

export function parseVisionResponse(content: string | null | undefined, validIndexes: Set<number>): VisionResult {
  const empty: VisionResult = { merchant: null, discounts: [], lines: [] };
  if (!content) return empty;
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return empty;
  }
  const lines = parseTextPassResponse(
    JSON.stringify({ lines: (Array.isArray(parsed?.lines) ? parsed.lines : []).map((l: any) => ({ ...l, isPizza: true })) }),
    validIndexes,
  );
  const discounts = (Array.isArray(parsed?.discounts) ? parsed.discounts : [])
    .map((d: any) => ({
      label: typeof d?.label === 'string' ? d.label.trim().slice(0, 120) : 'discount',
      amount: Math.abs(Number(d?.amount)),
    }))
    .filter((d: { amount: number }) => Number.isFinite(d.amount) && d.amount > 0);
  const merchant = typeof parsed?.merchant === 'string' && parsed.merchant.trim() ? parsed.merchant.trim().slice(0, 120) : null;
  return { merchant, discounts, lines };
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export interface PassResult {
  dryRun: boolean;
  model: string;
  candidates: number;
  processed: number;
  remaining: number;
  linesInserted: number;
  linesUpdated: number;
  errors: Array<{ documentId: string; error: string }>;
  docIds: string[];
  /** Candidates skipped because of >= 3 failed attempts or a failure within the last hour. */
  skippedBackoff: number;
}

function docContext(row: DocRow): DocContext | null {
  if (!row.fx) return null;
  return {
    documentId: row.id, partyId: row.partyId, country: row.country, merchant: row.merchant,
    currency: row.fx.currency, fxRate: row.fx.fxRate, discounts: [],
  };
}

/** Docs that failed this many times, or failed within the last hour, are skipped. */
export const MAX_PASS_ATTEMPTS = 3;
export const PASS_ERROR_BACKOFF_MS = 60 * 60 * 1000;

/** SQL: the sync row (alias s) is NOT in back-off for this pass. */
function notBackedOff(which: 'llm' | 'vision'): Prisma.Sql {
  const attempts = Prisma.raw(`s.${which}_attempts`);
  const lastErr = Prisma.raw(`s.${which}_last_error_at`);
  return Prisma.sql`(${attempts} < ${MAX_PASS_ATTEMPTS}
    AND (${lastErr} IS NULL OR ${lastErr} < now() - interval '1 hour'))`;
}

/** Count one failed attempt and stamp the time (called from the per-doc catch). */
export async function recordPassError(documentId: string, which: 'llm' | 'vision'): Promise<void> {
  try {
    await prisma.pizzaLineSync.update({
      where: { documentId },
      data: which === 'llm'
        ? { llmAttempts: { increment: 1 }, llmLastErrorAt: new Date() }
        : { visionAttempts: { increment: 1 }, visionLastErrorAt: new Date() },
    });
  } catch (e) {
    console.error('[pizza-index] could not record pass error', documentId, e);
  }
}

const ELIGIBLE_SQL = Prisma.sql`d.kind = 'receipt' AND d.source = 'upload' AND d.is_duplicate = false AND d.ineligible = false
  AND d.ocr_line_items IS NOT NULL AND jsonb_typeof(d.ocr_line_items) = 'array'`;

export async function runLlmPass(opts: {
  limit?: number; docIds?: string[]; dryRun?: boolean;
  /**
   * sfincione-40417 (pizza count), one-time backfill only: with explicit docIds,
   * re-run docs the pass already handled (ignore llm_pass_at) and ONLY extract
   * the lump-sum pizza count: no line classification is applied, no markers change.
   */
  countOnly?: boolean;
} = {}): Promise<PassResult> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);
  const idFilter = opts.docIds?.length ? Prisma.sql`AND d.id = ANY(${opts.docIds}::uuid[])` : Prisma.empty;
  const countOnly = !!opts.countOnly && !!opts.docIds?.length;
  const markerFilter = countOnly ? Prisma.sql`TRUE` : Prisma.sql`s.llm_pass_at IS NULL`;
  const base = Prisma.sql`
    FROM pizza_line_sync s JOIN payout_documents d ON d.id = s.document_id
    WHERE ${markerFilter} AND ${ELIGIBLE_SQL} ${idFilter}
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.ocr_line_items) e
                  WHERE lower(e->>'category') IN ('pizza','other','beverage','side'))`;
  const where = Prisma.sql`${base} AND ${notBackedOff('llm')}`;
  const [{ n: baseN }] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n ${base}`);
  const picked = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT d.id ${where} ORDER BY d.created_at LIMIT ${limit}`);
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n ${where}`);
  const models = await getLlmModels();
  const result: PassResult = {
    dryRun: !!opts.dryRun, model: models.assistant, candidates: n, processed: 0,
    remaining: Math.max(n - picked.length, 0), linesInserted: 0, linesUpdated: 0, errors: [],
    docIds: picked.map((p) => p.id), skippedBackoff: Math.max(baseN - n, 0),
  };
  if (opts.dryRun || picked.length === 0) return result;

  const presets = await loadPresets();
  const docs = await loadDocRows(picked.map((p) => p.id));
  const touched: string[] = [];
  for (const row of docs) {
    try {
      const ctx = docContext(row);
      if (!ctx) {
        // No trustworthy FX: nothing to price; mark done so we don't retry forever.
        await markPass(row.id, 'llm');
        result.processed += 1;
        continue;
      }
      const sent = row.items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => it && SENT_CATEGORIES.has(String(it.category).toLowerCase()))
        .slice(0, MAX_LINES_PER_DOC);
      if (sent.length === 0) {
        await markPass(row.id, 'llm');
        result.processed += 1;
        continue;
      }
      const resp = await getOpenAI().chat.completions.create({
        model: models.assistant,
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: TEXT_PASS_SYSTEM },
          {
            role: 'user',
            content: buildTextPassUser({
              merchant: row.merchant, country: row.country, city: row.city, currency: ctx.currency,
              lines: sent.map(({ it, i }) => ({
                i, name: String(it.name ?? ''), qty: Number(it.qty ?? 1), unitPrice: Number(it.unitPrice ?? 0),
                category: String(it.category ?? 'other'),
              })),
            }),
          },
        ],
      });
      const content = resp.choices[0]?.message?.content;
      const lumpSum = parseLumpSumResponse(content);
      if (countOnly) {
        // One-time backfill: count only. No lines applied, no pass markers touched.
        if (lumpSum && (await writeLumpSumToDoc(row.id, lumpSum))) {
          touched.push(row.id);
          result.linesUpdated += 1;
        }
        result.processed += 1;
        continue;
      }
      const llmLines = parseTextPassResponse(content, new Set(sent.map((s) => s.i)));
      const existing = (await prisma.pizzaLineItem.findMany({ where: { documentId: row.id } })).map(dbLineToExisting);
      const byIndex = new Map(existing.map((e) => [e.lineIndex, e]));

      const inserts: LineWrite[] = [];
      const updates: Array<{ id: string; data: Prisma.PizzaLineItemUpdateInput }> = [];
      for (const l of llmLines) {
        const r = applyLlmLine(l, row.items[l.i], byIndex.get(l.i) ?? null, ctx, presets);
        if (r.kind === 'insert') inserts.push(r.write);
        else if (r.kind === 'update') updates.push({ id: r.id, data: r.data });
      }
      await prisma.$transaction([
        ...(inserts.length ? [prisma.pizzaLineItem.createMany({ data: inserts.map(writeToData), skipDuplicates: true })] : []),
        ...updates.map((u) => prisma.pizzaLineItem.update({ where: { id: u.id }, data: u.data })),
        prisma.pizzaLineSync.update({ where: { documentId: row.id }, data: { llmPassAt: new Date() } }),
      ]);
      if (inserts.length) await reallocateDocDiscounts(row.id);
      // sfincione-40417 (pizza count): store a stated lump-sum count, then re-sync
      // this doc so the synthetic per-pizza line appears/disappears. force doesn't
      // reset the pass markers, so there is no loop.
      const wroteCount = lumpSum ? await writeLumpSumToDoc(row.id, lumpSum) : false;
      if (wroteCount || inserts.length || updates.length) touched.push(row.id);
      result.processed += 1;
      result.linesInserted += inserts.length;
      result.linesUpdated += updates.length;
    } catch (err) {
      result.errors.push({ documentId: row.id, error: err instanceof Error ? err.message : String(err) });
      await recordPassError(row.id, 'llm');
    }
  }
  // ONE re-sync for every touched doc (after the loop, so a sync failure never
  // counts as a pass error / backoff attempt). force doesn't reset pass markers.
  if (touched.length) {
    try {
      await syncPizzaLineItems({ docIds: touched, force: true, limit: 300 });
    } catch (err) {
      console.error('[pizzaIndexLlm] post-pass resync failed (will self-heal on next sync):', err instanceof Error ? err.message : err);
    }
  }
  return result;
}

async function markPass(documentId: string, which: 'llm' | 'vision') {
  await prisma.pizzaLineSync.update({
    where: { documentId },
    data: which === 'llm' ? { llmPassAt: new Date() } : { visionPassAt: new Date() },
  });
}

export async function runVisionPass(opts: {
  limit?: number; docIds?: string[]; dryRun?: boolean; requireLlmPass?: boolean; includeLowConfidence?: boolean;
} = {}): Promise<PassResult & { skippedNonImage: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const idFilter = opts.docIds?.length ? Prisma.sql`AND d.id = ANY(${opts.docIds}::uuid[])` : Prisma.empty;
  const llmGate = opts.requireLlmPass === false ? Prisma.empty : Prisma.sql`AND s.llm_pass_at IS NOT NULL`;
  const needs = opts.includeLowConfidence
    ? Prisma.sql`(li.area_cm2 IS NULL OR li.size_confidence < 0.7)`
    : Prisma.sql`li.area_cm2 IS NULL`;
  const base = Prisma.sql`
    FROM pizza_line_sync s JOIN payout_documents d ON d.id = s.document_id
    WHERE s.vision_pass_at IS NULL AND ${ELIGIBLE_SQL} ${llmGate} ${idFilter}
      AND d.mime_type LIKE 'image/%'
      AND EXISTS (SELECT 1 FROM pizza_line_items li WHERE li.document_id = d.id
                  AND li.excluded = false AND li.is_bundle = false AND li.verified_at IS NULL
                  AND li.source_category <> 'lump_sum' AND ${needs})`;
  const where = Prisma.sql`${base} AND ${notBackedOff('vision')}`;
  const [{ n: baseN }] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n ${base}`);
  const picked = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT d.id ${where} ORDER BY d.created_at LIMIT ${limit}`);
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n ${where}`);
  const models = await getLlmModels();
  const result = {
    dryRun: !!opts.dryRun, model: models.visionPrimary, candidates: n, processed: 0,
    remaining: Math.max(n - picked.length, 0), linesInserted: 0, linesUpdated: 0,
    errors: [] as Array<{ documentId: string; error: string }>, docIds: picked.map((p) => p.id),
    skippedNonImage: 0, skippedBackoff: Math.max(baseN - n, 0),
  };
  if (opts.dryRun || picked.length === 0) return result;

  const presets = await loadPresets();
  const docs = await loadDocRows(picked.map((p) => p.id));
  for (const row of docs) {
    try {
      const ctx = docContext(row);
      const lines = await prisma.pizzaLineItem.findMany({
        // sfincione-40417: the synthetic lump-sum line isn't on the image.
        where: { documentId: row.id, excluded: false, isBundle: false, sourceCategory: { not: 'lump_sum' } },
        orderBy: { lineIndex: 'asc' },
      });
      if (!ctx || lines.length === 0) {
        await markPass(row.id, 'vision');
        result.processed += 1;
        continue;
      }
      const dataUrl = await imageUrlToBase64DataUrl(row.url);
      const idx = new Set(lines.map((l) => l.lineIndex));
      const resp = await getOpenAI().chat.completions.create({
        model: models.visionPrimary,
        temperature: 0,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: VISION_PASS_SYSTEM },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  country: row.country, currency: ctx.currency,
                  pizzaLines: lines.map((l) => ({ i: l.lineIndex, name: l.rawName, qty: Number(l.qty), unitPrice: Number(l.unitPriceList) })),
                }),
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      });
      const vision = parseVisionResponse(resp.choices[0]?.message?.content, idx);
      const byIndex = new Map(lines.map((l) => [l.lineIndex, dbLineToExisting(l)]));
      const updates: Array<{ id: string; data: Prisma.PizzaLineItemUpdateInput }> = [];
      for (const v of vision.lines) {
        const prev = byIndex.get(v.i);
        if (!prev || prev.verifiedAt) continue;
        const sized = sizeFromModel(v, CONFIDENCE.visionCap, presets, {
          merchantKey: normalizeMerchantKey(prev.merchant ?? row.merchant), country: row.country,
        });
        if (sized && (prev.sizeConfidence ?? 0) < (sized.sizeConfidence ?? 0)) {
          updates.push({ id: prev.id, data: { ...sizeData(sized), updatedAt: new Date() } });
        }
      }
      // Merchant: only fill gaps (the OCR merchant on payout_documents is untouched).
      let merchantUpdate: Prisma.PrismaPromise<unknown> | null = null;
      if (vision.merchant && !row.merchant) {
        merchantUpdate = prisma.pizzaLineItem.updateMany({
          where: { documentId: row.id, merchant: null },
          data: { merchant: vision.merchant, merchantKey: normalizeMerchantKey(vision.merchant) },
        });
      }
      const syncData: Prisma.PizzaLineSyncUpdateInput = { visionPassAt: new Date() };
      if (vision.discounts.length) {
        const existingSync = await prisma.pizzaLineSync.findUnique({ where: { documentId: row.id } });
        const hasDiscounts = Array.isArray(existingSync?.discounts) && (existingSync!.discounts as unknown[]).length > 0;
        if (!hasDiscounts) {
          syncData.discounts = vision.discounts as unknown as Prisma.InputJsonValue;
          syncData.discountTotal = vision.discounts.reduce((a, d) => a + d.amount, 0);
        }
      }
      await prisma.$transaction([
        ...updates.map((u) => prisma.pizzaLineItem.update({ where: { id: u.id }, data: u.data })),
        ...(merchantUpdate ? [merchantUpdate] : []),
        prisma.pizzaLineSync.update({ where: { documentId: row.id }, data: syncData }),
      ]);
      if (syncData.discounts) await reallocateDocDiscounts(row.id);
      if (merchantUpdate) await reresolveUnverified({ partyIds: [row.partyId] });
      result.processed += 1;
      result.linesUpdated += updates.length;
    } catch (err) {
      result.errors.push({ documentId: row.id, error: err instanceof Error ? err.message : String(err) });
      await recordPassError(row.id, 'vision');
    }
  }
  return result;
}
