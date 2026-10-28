/**
 * sfincione-40417 (history): pure helpers for scripts/import-pizza-history.ts
 * (record validation, country normalisation, line building). No DB access, so
 * they are unit tested (historyImport.test.ts).
 */
import { getCountryCode } from '../../src/lib/countryCode.js';
import { canonicalizeCountryName } from '../../src/lib/canonicalCountryName.js';
import { countryCodeToRegion, countryNameToRegion } from '../../src/lib/countryRegion.js';
import {
  CONFIDENCE,
  looksLikeBundle,
  normalizeMerchantKey,
  parseAndResolve,
  resolveFromReportedDims,
  type ResolvedSize,
  type SizePreset,
} from '../../src/services/pizzaSize.service.js';
import { lineFingerprint } from '../../src/services/pizzaLineSync.service.js';

export type HistoryKind = 'itemized' | 'lump_sum' | 'not_pizza';
export const HISTORY_FIRST_YEAR = 2019;
/** Years >= this are already in the DB as payout documents (GPP 2026+). */
export const HISTORY_LAST_YEAR = 2025;
const MAX_QTY = 999_999;

export interface HistoryLineIn {
  name: string;
  qty: number;
  unitPrice: number;
  sizeLabel?: string | null;
  diameterCm?: number | null;
  shape?: string | null;
  category?: string | null;
  isBundle?: boolean;
  note?: string | null;
}

export interface HistoryRecord {
  year: number;
  country: string;
  city: string | null;
  merchant: string | null;
  receiptDate: string | null;
  currency: string;
  sourceFileId: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  total: number | null;
  kind: HistoryKind;
  pizzaCount: number | null;
  lines: HistoryLineIn[];
  /** Optional top-level size hints for lump sums. */
  diameterCm?: number | null;
  sizeLabel?: string | null;
  confidence?: string | null;
  notes?: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export type Validation =
  | { ok: true; record: HistoryRecord }
  | { ok: false; reason: string; sourceFileId?: string };

/** Hand validation of one transcribed record (shape, currency, year range). */
export function validateRecord(raw: unknown): Validation {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  const sourceFileId = strOrNull(raw.sourceFileId);
  if (!sourceFileId) return { ok: false, reason: 'missing sourceFileId' };
  const fail = (reason: string): Validation => ({ ok: false, reason, sourceFileId });
  const year = raw.year;
  if (typeof year !== 'number' || !Number.isInteger(year)) return fail('year must be an integer');
  if (year >= 2026) return fail('year >= 2026 (already in the DB as payout documents)');
  if (year < HISTORY_FIRST_YEAR) return fail(`year < ${HISTORY_FIRST_YEAR}`);
  const country = strOrNull(raw.country);
  if (!country) return fail('missing country');
  const currency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return fail(`bad currency "${String(raw.currency)}"`);
  const kind = raw.kind;
  if (kind !== 'itemized' && kind !== 'lump_sum' && kind !== 'not_pizza') return fail(`bad kind "${String(kind)}"`);
  const receiptDate = strOrNull(raw.receiptDate);
  if (receiptDate && !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) return fail(`bad receiptDate "${receiptDate}"`);
  if (receiptDate && Number(receiptDate.slice(0, 4)) !== year) return fail(`receiptDate ${receiptDate} is not in ${year}`);
  const linesRaw = raw.lines === undefined || raw.lines === null ? [] : raw.lines;
  if (!Array.isArray(linesRaw)) return fail('lines must be an array');
  const lines: HistoryLineIn[] = [];
  for (const l of linesRaw) {
    if (!isObj(l)) return fail('line is not an object');
    const qty = numOrNull(l.qty);
    const unitPrice = numOrNull(l.unitPrice);
    if (qty === null || unitPrice === null) return fail(`line "${String(l.name)}" has a non-numeric qty/unitPrice`);
    lines.push({
      name: strOrNull(l.name) ?? '[illegible]', qty, unitPrice,
      sizeLabel: strOrNull(l.sizeLabel), diameterCm: numOrNull(l.diameterCm), shape: strOrNull(l.shape),
      category: strOrNull(l.category)?.toLowerCase() ?? 'pizza', isBundle: l.isBundle === true, note: strOrNull(l.note),
    });
  }
  return {
    ok: true,
    record: {
      year, country, city: strOrNull(raw.city), merchant: strOrNull(raw.merchant), receiptDate, currency, sourceFileId,
      sourceTitle: strOrNull(raw.sourceTitle), sourceUrl: strOrNull(raw.sourceUrl),
      total: numOrNull(raw.total), kind, pizzaCount: numOrNull(raw.pizzaCount), lines,
      diameterCm: numOrNull(raw.diameterCm), sizeLabel: strOrNull(raw.sizeLabel),
      confidence: strOrNull(raw.confidence), notes: strOrNull(raw.notes),
    },
  };
}

/**
 * Normalise the country to the `parties.country` spelling. getCountryCode must
 * resolve it; returns null (report + skip) otherwise.
 */
export function normalizeCountry(country: string): { country: string; code: string; region: string | null } | null {
  const code = getCountryCode(country);
  if (!code) return null;
  const canonical = canonicalizeCountryName(country) ?? country.trim();
  return { country: canonical, code, region: countryCodeToRegion(code) ?? countryNameToRegion(canonical) };
}

export interface HistoryLine {
  lineIndex: number;
  lineFingerprint: string;
  sourceCategory: string;
  rawName: string;
  merchant: string | null;
  merchantKey: string | null;
  qty: number;
  unitPriceList: number;
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
  excluded: boolean;
  excludedReason: string | null;
  isBundle: boolean;
  notes: string | null;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function fields(r: ResolvedSize, cap?: number) {
  return {
    sizeLabel: r.sizeLabel, shape: r.shape, diameterCm: r.diameterCm, lengthCm: r.lengthCm, widthCm: r.widthCm,
    sliceFraction: r.sliceFraction, areaCm2: r.areaCm2, style: r.style, sizeSource: r.sizeSource,
    sizeConfidence: r.sizeConfidence === null || cap === undefined ? r.sizeConfidence : Math.min(r.sizeConfidence, cap),
    presetId: r.presetId,
  };
}

/**
 * Lines to store for one receipt.
 *  - not_pizza           -> none (receipt only, for coverage + dedupe)
 *  - lump_sum            -> one synthetic line when pizzaCount > 0 and total > 0, else none
 *  - itemized            -> one line per category 'pizza' item (others are not inserted)
 * The size comes from the printed/parsed name, else the transcription's reported
 * dimensions (source 'llm', confidence <= 0.7: never auto-trusted), else a preset.
 */
export function buildHistoryLines(record: HistoryRecord, presets: SizePreset[], fxRate: number, country: string = record.country): HistoryLine[] {
  if (record.kind === 'not_pizza') return [];
  const merchantKey = normalizeMerchantKey(record.merchant);
  const ctx = { merchantKey, country };
  const base = { merchant: record.merchant, merchantKey, currency: record.currency, fxRate, sourceCategory: 'pizza' };

  if (record.kind === 'lump_sum') {
    const count = record.pizzaCount;
    const total = record.total;
    if (!(count && count > 0) || !(total && total > 0)) return [];
    const unit = total / count;
    const hint = record.sizeLabel ?? '';
    let resolved = parseAndResolve(hint ? `pizza ${hint}` : 'pizza', presets, ctx).resolved;
    if (record.diameterCm) {
      const rep = resolveFromReportedDims({ label: hint || null, diameterCm: record.diameterCm }, 0.5, 'llm');
      if (rep) resolved = rep;
    }
    return [{
      ...base, lineIndex: 0, lineFingerprint: lineFingerprint(`Lump sum: ${count} pizzas`, count, unit),
      rawName: `Lump sum: ${count} pizzas`, qty: Math.min(count, MAX_QTY), unitPriceList: unit, unitPriceUsd: round4(unit * fxRate),
      ...fields(resolved, 0.5), excluded: false, excludedReason: null, isBundle: false, notes: 'lump_sum',
    }];
  }

  const out: HistoryLine[] = [];
  record.lines.forEach((item, idx) => {
    if ((item.category ?? 'pizza') !== 'pizza') return;
    const name = item.name.trim() || '[illegible]';
    const qty = Math.min(Math.max(item.qty, 0), MAX_QTY);
    const unit = Math.max(item.unitPrice, 0);
    const label = item.sizeLabel ?? '';
    let resolved = parseAndResolve(label ? `${name} ${label}` : name, presets, ctx).resolved;
    // Nothing parsed/printed (or only a weak preset): fall back to the transcription's reported dims.
    if (resolved.sizeSource !== 'parsed' && (resolved.sizeConfidence ?? 0) < 0.8 && (item.diameterCm || item.shape)) {
      const rep = resolveFromReportedDims(
        { label: label || null, shape: item.shape, diameterCm: item.diameterCm }, CONFIDENCE.llmCap, 'llm',
      );
      if (rep) resolved = rep;
    }
    const zero = unit <= 0 || qty <= 0;
    out.push({
      ...base, lineIndex: idx, lineFingerprint: lineFingerprint(name, item.qty, unit),
      rawName: name, qty, unitPriceList: unit, unitPriceUsd: round4(unit * fxRate),
      ...fields(resolved), excluded: zero, excludedReason: zero ? 'zero_price' : null,
      isBundle: item.isBundle === true || looksLikeBundle(name), notes: item.note ?? null,
    });
  });
  return out;
}

/** Median helper for the report. */
export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
