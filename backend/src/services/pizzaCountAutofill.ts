/**
 * sfincione-40417 (pizza count): pure auto-fill of "how many pizzas, what size"
 * for one receipt (payout_documents.pizza_*), from data we already have.
 *
 * No DB, no network. Sources, in order; the first that yields a value wins
 * PER FIELD (count and size are resolved independently):
 *   (a) itemized OCR pizza lines (sum of qty; a qty-1 line whose name states a
 *       count, "Pizzas x20", contributes that count instead)
 *   (b) a quantity stated in other receipt text (non-pizza-category item names,
 *       the legacy ocr.items[] strings, the English summary)
 *   (c) the optional model fields returned by the upload OCR call
 *       (ocr_raw.ocr.pizzaCount / pizzaSize)
 * Host values are sticky (see mergeAutofill).
 */
import { parseSize } from './pizzaSize.service.js';

export type PizzaAutoSource = 'ocr' | 'llm';
export type PizzaSource = PizzaAutoSource | 'host';

export interface PizzaAutofill {
  count: number | null;
  countConfidence: number | null;
  countSource: PizzaAutoSource | null;
  sizeCm: number | null;
  sizeLabel: string | null;
  sizeConfidence: number | null;
  sizeSource: PizzaAutoSource | null;
}

/** The seven payout_documents.pizza_* values (camelCase Prisma field names). */
export interface PizzaFields {
  pizzaCount: number | null;
  pizzaCountSource: PizzaSource | null;
  pizzaCountConfidence: number | null;
  pizzaSizeCm: number | null;
  pizzaSizeLabel: string | null;
  pizzaSizeSource: PizzaSource | null;
  pizzaSizeConfidence: number | null;
}

export const MAX_PIZZA_COUNT = 5000;
const MIN_SIZE_CM = 15;
const MAX_SIZE_CM = 80;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function emptyAutofill(): PizzaAutofill {
  return {
    count: null, countConfidence: null, countSource: null,
    sizeCm: null, sizeLabel: null, sizeConfidence: null, sizeSource: null,
  };
}

/** A low-confidence read lowers every auto value. */
export function ocrConfidenceFactor(ocrConfidence: number | null | undefined): number {
  return clamp(ocrConfidence ?? 0.7, 0.5, 1);
}

// ---------------------------------------------------------------------------
// (b) count-in-text
// ---------------------------------------------------------------------------

const PIZZA_WORD = '(?:pizzas?|pizze|pizzen|pies)';
// Number must not be part of a bigger or decimal number ("14.50 pizza").
const P_NUM_FIRST = new RegExp(`(?<![\\d.,])(\\d{1,4})(?![\\d.,]\\d)\\s*(?:x|×)?\\s*${PIZZA_WORD}\\b`, 'i');
const P_WORD_FIRST = new RegExp(
  `\\b(?:pizzas?|pizze|pizzen)\\s*(?:x|×|qty\\s*:?|cant\\.?|qt[ée]\\s*:?)\\s*(\\d{1,4})(?![\\d.,]\\d)(?!\\d)`, 'i');
const CJK_PIZZA = '(?:ピザ|披萨|比萨|피자)';
const CJK_COUNTER = '(?:枚|张|張|판|个|個|개)';
const P_CJK_A = new RegExp(`${CJK_PIZZA}\\s*(\\d{1,4})\\s*${CJK_COUNTER}`);
const P_CJK_B = new RegExp(`(\\d{1,4})\\s*${CJK_COUNTER}\\s*(?:の)?\\s*${CJK_PIZZA}`);
// A number directly followed by a unit is a size/percentage/weight, not a count.
const UNIT_AFTER = /^\s*(?:cm|mm|"|”|″|in\b|inch|inches|%|g\b|kg\b|ml\b)/i;
// Plural pizza word with no number: "Pizzas", "Pizze" (a lump-sum line of unknown count).
const PLURAL_ONLY = /\b(?:pizzas|pizze|pizzen)\b/i;

/**
 * A pizza count stated in a text, or null. `reject` holds numbers that are
 * really prices (unit price / subtotal of the same line).
 */
export function extractCountFromText(text: string, reject: number[] = []): number | null {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ');
  for (const re of [P_NUM_FIRST, P_WORD_FIRST, P_CJK_A, P_CJK_B]) {
    const m = re.exec(t);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const end = m.index + m[0].length;
    // These two end right after the number; check what follows it.
    if ((re === P_WORD_FIRST || re === P_CJK_A) && UNIT_AFTER.test(t.slice(end))) continue;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PIZZA_COUNT) continue;
    if (reject.some((r) => Number.isFinite(r) && r === n)) continue;
    return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Size helpers
// ---------------------------------------------------------------------------

interface SizeRead { cm: number | null; word: string | null }

function sizeFromText(text: string, reported?: { label?: unknown; diameterCm?: unknown } | null): SizeRead {
  const label = typeof reported?.label === 'string' ? reported.label : '';
  const parsed = parseSize(label ? `${text} ${label}` : text);
  let cm = parsed.shape === 'round' && parsed.diameterCm ? parsed.diameterCm : null;
  const rep = numOrNull(reported?.diameterCm);
  if (cm === null && rep !== null && rep >= MIN_SIZE_CM && rep <= MAX_SIZE_CM) cm = rep;
  const word = parsed.word && parsed.word !== 'default' ? String(parsed.word) : null;
  return { cm: cm === null ? null : Math.round(cm * 10) / 10, word };
}

// ---------------------------------------------------------------------------
// derive
// ---------------------------------------------------------------------------

/** `ocr_raw` is stored as { ocr: <model object>, fx }; accept that or the bare model object. */
function modelObject(ocrRaw: unknown): Record<string, unknown> {
  if (!isObj(ocrRaw)) return {};
  return isObj(ocrRaw.ocr) ? ocrRaw.ocr : ocrRaw;
}

interface Line { name: string; qty: number; unit: number; subtotal: number; category: string; size: SizeRead }

function readLines(lineItems: unknown): Line[] {
  if (!Array.isArray(lineItems)) return [];
  const out: Line[] = [];
  for (const it of lineItems) {
    if (!isObj(it)) continue;
    const name = typeof it.name === 'string' ? it.name : '';
    const category = typeof it.category === 'string' ? it.category.toLowerCase() : 'other';
    const size = isObj(it.size) ? (it.size as { label?: unknown; diameterCm?: unknown }) : null;
    out.push({
      name,
      qty: numOrNull(it.qty) ?? 1,
      unit: numOrNull(it.unitPrice) ?? 0,
      subtotal: numOrNull(it.subtotal) ?? 0,
      category,
      size: sizeFromText(name, size),
    });
  }
  return out;
}

function sizeFromReads(reads: SizeRead[], factor: number): Pick<PizzaAutofill, 'sizeCm' | 'sizeLabel' | 'sizeConfidence'> | null {
  const known = reads.filter((r) => r.cm !== null || r.word !== null);
  if (known.length === 0) return null;
  const keys = new Set(known.map((r) => (r.cm !== null ? `cm:${Math.round(r.cm)}` : `w:${r.word}`)));
  if (keys.size > 1) return { sizeCm: null, sizeLabel: 'mixed', sizeConfidence: round2(0.5 * factor) };
  const first = known[0];
  if (first.cm !== null) return { sizeCm: first.cm, sizeLabel: null, sizeConfidence: round2(0.8 * factor) };
  return { sizeCm: null, sizeLabel: first.word, sizeConfidence: round2(0.5 * factor) };
}

export function derivePizzaAutofill(lineItems: unknown, ocrRaw: unknown, ocrConfidence: number | null = null): PizzaAutofill {
  const out = emptyAutofill();
  const factor = ocrConfidenceFactor(ocrConfidence);
  const model = modelObject(ocrRaw);
  const lines = readLines(lineItems);

  // (a) itemized pizza lines ------------------------------------------------
  const pizzaLines = lines.filter(
    (l) => l.category === 'pizza' && l.qty > 0 && l.unit > 0 && parseSize(l.name).shape !== 'slice',
  );
  if (pizzaLines.length > 0) {
    let total = 0;
    let usedNameCount = false;
    let unknown = false;
    for (const l of pizzaLines) {
      if (l.qty <= 1) {
        const fromName = extractCountFromText(l.name, [l.unit, l.subtotal]);
        if (fromName !== null) { total += fromName; usedNameCount = true; continue; }
        // "Pizzas" at qty 1 is a lump sum of unknown count: don't claim 1.
        if (PLURAL_ONLY.test(l.name)) { unknown = true; break; }
      }
      total += l.qty;
    }
    const count = Math.round(total);
    if (!unknown && count >= 1 && count <= MAX_PIZZA_COUNT) {
      out.count = count;
      out.countSource = 'ocr';
      out.countConfidence = round2((usedNameCount ? 0.75 : 0.9) * factor);
    }
    const sz = sizeFromReads(pizzaLines.map((l) => l.size), factor);
    if (sz) { Object.assign(out, sz); out.sizeSource = 'ocr'; }
  }

  // (b) quantity stated elsewhere in the receipt text -------------------------
  if (out.count === null) {
    const candidates: Array<{ text: string; reject: number[]; conf: number; size: SizeRead }> = [];
    for (const l of lines) {
      if (l.category !== 'pizza' && l.category !== 'other') continue;
      if (l.qty > 1) continue;
      candidates.push({ text: l.name, reject: [l.unit, l.subtotal], conf: 0.75, size: l.size });
    }
    if (Array.isArray(model.items)) {
      for (const s of model.items) if (typeof s === 'string') candidates.push({ text: s, reject: [], conf: 0.7, size: sizeFromText(s) });
    }
    if (typeof model.summary === 'string') {
      candidates.push({ text: model.summary, reject: [], conf: 0.6, size: sizeFromText(model.summary) });
    }
    const amount = numOrNull(model.amount);
    for (const c of candidates) {
      const n = extractCountFromText(c.text, [...c.reject, ...(amount !== null ? [amount] : [])]);
      if (n === null) continue;
      out.count = n; out.countSource = 'ocr'; out.countConfidence = round2(c.conf * factor);
      if (out.sizeCm === null && out.sizeLabel === null) {
        if (c.size.cm !== null) { out.sizeCm = c.size.cm; out.sizeConfidence = round2(0.7 * factor); out.sizeSource = 'ocr'; }
        else if (c.size.word !== null) { out.sizeLabel = c.size.word; out.sizeConfidence = round2(0.45 * factor); out.sizeSource = 'ocr'; }
      }
      break;
    }
  }

  // (c) model fields returned at upload ---------------------------------------
  if (out.count === null) {
    const n = numOrNull(model.pizzaCount);
    if (n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_PIZZA_COUNT) {
      out.count = n;
      out.countSource = 'llm';
      out.countConfidence = round2(Math.min(0.7, ocrConfidence ?? 0.7));
    }
  }
  if (out.sizeCm === null && out.sizeLabel === null && isObj(model.pizzaSize)) {
    const cm = numOrNull(model.pizzaSize.diameterCm);
    const label = typeof model.pizzaSize.label === 'string' ? model.pizzaSize.label.trim().slice(0, 40) : '';
    if (cm !== null && cm >= MIN_SIZE_CM && cm <= MAX_SIZE_CM) {
      out.sizeCm = Math.round(cm * 10) / 10; out.sizeConfidence = round2(0.6 * factor); out.sizeSource = 'llm';
    } else if (label) {
      out.sizeLabel = label.toLowerCase(); out.sizeConfidence = round2(0.45 * factor); out.sizeSource = 'llm';
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// merge (host stickiness + confidence precedence)
// ---------------------------------------------------------------------------

export function emptyPizzaFields(): PizzaFields {
  return {
    pizzaCount: null, pizzaCountSource: null, pizzaCountConfidence: null,
    pizzaSizeCm: null, pizzaSizeLabel: null, pizzaSizeSource: null, pizzaSizeConfidence: null,
  };
}

/** Existing pizza_* values from a Prisma PayoutDocument-like row (Decimals -> numbers). */
export function pizzaFieldsFromDoc(d: Record<string, unknown> | null | undefined): PizzaFields {
  if (!d) return emptyPizzaFields();
  return {
    pizzaCount: numOrNull(d.pizzaCount),
    pizzaCountSource: (d.pizzaCountSource as PizzaSource | null | undefined) ?? null,
    pizzaCountConfidence: numOrNull(d.pizzaCountConfidence),
    pizzaSizeCm: numOrNull(d.pizzaSizeCm),
    pizzaSizeLabel: (d.pizzaSizeLabel as string | null | undefined) ?? null,
    pizzaSizeSource: (d.pizzaSizeSource as PizzaSource | null | undefined) ?? null,
    pizzaSizeConfidence: numOrNull(d.pizzaSizeConfidence),
  };
}

/**
 * Patch to write, honouring: host is sticky (a host value, including a host
 * "cleared" NULL, is never touched); an auto value replaces an existing auto
 * value only when its confidence is at least as high. Empty object = no change.
 */
export function mergeAutofill(existing: PizzaFields, auto: PizzaAutofill): Partial<PizzaFields> {
  const patch: Partial<PizzaFields> = {};
  if (existing.pizzaCountSource !== 'host' && auto.count !== null && auto.countSource) {
    const have = existing.pizzaCount !== null;
    if (!have || (auto.countConfidence ?? 0) >= (existing.pizzaCountConfidence ?? 0)) {
      patch.pizzaCount = auto.count;
      patch.pizzaCountSource = auto.countSource;
      patch.pizzaCountConfidence = auto.countConfidence;
    }
  }
  const autoHasSize = auto.sizeSource !== null && (auto.sizeCm !== null || auto.sizeLabel !== null);
  if (existing.pizzaSizeSource !== 'host' && autoHasSize) {
    const have = existing.pizzaSizeCm !== null || existing.pizzaSizeLabel !== null;
    if (!have || (auto.sizeConfidence ?? 0) >= (existing.pizzaSizeConfidence ?? 0)) {
      patch.pizzaSizeCm = auto.sizeCm;
      patch.pizzaSizeLabel = auto.sizeLabel;
      patch.pizzaSizeSource = auto.sizeSource;
      patch.pizzaSizeConfidence = auto.sizeConfidence;
    }
  }
  return patch;
}

/**
 * Create-time columns for a brand-new receipt doc (nothing to preserve).
 * NEVER throws: a failure here must not fail an upload.
 */
export function pizzaAutofillColumns(lineItems: unknown, ocrRaw: unknown, ocrConfidence: number | null = null): Partial<PizzaFields> {
  try {
    return mergeAutofill(emptyPizzaFields(), derivePizzaAutofill(lineItems, ocrRaw, ocrConfidence));
  } catch (err) {
    console.error('[pizzaCountAutofill] derive failed (ignored):', err instanceof Error ? err.message : err);
    return {};
  }
}

/**
 * Patch for an EXISTING doc whose line items / raw OCR were just replaced.
 * NEVER throws; empty object when nothing to change.
 */
export function pizzaAutofillPatch(
  existingDoc: Record<string, unknown> | null | undefined,
  lineItems: unknown,
  ocrRaw: unknown,
  ocrConfidence: number | null = null,
): Partial<PizzaFields> {
  try {
    return mergeAutofill(pizzaFieldsFromDoc(existingDoc), derivePizzaAutofill(lineItems, ocrRaw, ocrConfidence));
  } catch (err) {
    console.error('[pizzaCountAutofill] derive failed (ignored):', err instanceof Error ? err.message : err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// host / admin PATCH body
// ---------------------------------------------------------------------------

export const HOST_SIZES_CM = [25, 30, 35, 40, 45] as const;

export type PizzaCountPatchResult =
  | { ok: true; data: Partial<PizzaFields>; changed: boolean }
  | { ok: false; error: string };

/**
 * Validate a PATCH body { pizzaCount?, pizzaSizeCm?, pizzaSizeMixed? } and
 * turn it into the columns to write (source 'host', confidence null).
 * Hosts: size must be one of HOST_SIZES_CM. Admins (allowAnySize): 15..80.
 */
export function parsePizzaCountPatch(body: unknown, opts: { allowAnySize?: boolean } = {}): PizzaCountPatchResult {
  if (!isObj(body)) return { ok: false, error: 'Body must be an object' };
  const data: Partial<PizzaFields> = {};
  if ('pizzaCount' in body) {
    const v = body.pizzaCount;
    if (v === null || v === '' || v === 0 || v === '0') {
      data.pizzaCount = null;
    } else {
      const n = typeof v === 'string' ? Number(v.trim()) : v;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PIZZA_COUNT) {
        return { ok: false, error: `pizzaCount must be a whole number 1-${MAX_PIZZA_COUNT}` };
      }
      data.pizzaCount = n;
    }
    data.pizzaCountSource = 'host';
    data.pizzaCountConfidence = null;
  }
  if ('pizzaSizeMixed' in body && body.pizzaSizeMixed !== undefined && typeof body.pizzaSizeMixed !== 'boolean') {
    return { ok: false, error: 'pizzaSizeMixed must be a boolean' };
  }
  if (body.pizzaSizeMixed === true) {
    data.pizzaSizeCm = null;
    data.pizzaSizeLabel = 'mixed';
    data.pizzaSizeSource = 'host';
    data.pizzaSizeConfidence = null;
  } else if ('pizzaSizeCm' in body) {
    const v = body.pizzaSizeCm;
    if (v === null || v === '') {
      data.pizzaSizeCm = null;
    } else {
      const n = typeof v === 'string' ? Number(v.trim()) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: 'pizzaSizeCm must be a number' };
      const okSize = opts.allowAnySize
        ? n >= MIN_SIZE_CM && n <= MAX_SIZE_CM
        : (HOST_SIZES_CM as readonly number[]).includes(n);
      if (!okSize) {
        return {
          ok: false,
          error: opts.allowAnySize
            ? `pizzaSizeCm must be ${MIN_SIZE_CM}-${MAX_SIZE_CM}`
            : `pizzaSizeCm must be one of ${HOST_SIZES_CM.join(', ')}`,
        };
      }
      data.pizzaSizeCm = Math.round(n * 10) / 10;
    }
    data.pizzaSizeLabel = null;
    data.pizzaSizeSource = 'host';
    data.pizzaSizeConfidence = null;
  }
  return { ok: true, data, changed: Object.keys(data).length > 0 };
}
