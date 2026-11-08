/**
 * sfincione-40417 (history): pure helpers for scripts/import-pizza-history.ts
 * (record validation, country normalisation, line building). No DB access, so
 * they are unit tested (historyImport.test.ts).
 */
import crypto from 'node:crypto';
import { getCountryCode } from '../../src/lib/countryCode.js';
import { canonicalizeCountryName } from '../../src/lib/canonicalCountryName.js';
import { countryCodeToRegion, countryNameToRegion } from '../../src/lib/countryRegion.js';
import {
  HISTORY_FIRST_YEAR,
  HISTORY_LAST_YEAR,
  buildHistoryLines,
  type HistoryKind,
  type HistoryLine,
  type HistoryLineIn,
  type HistoryRecord,
} from '../../src/services/pizzaManualLines.js';

// The builder lives in src/services so runtime code (public submissions) can use it too.
export { buildHistoryLines, HISTORY_FIRST_YEAR, HISTORY_LAST_YEAR };
export type { HistoryKind, HistoryLine, HistoryLineIn, HistoryRecord };

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

/** Median helper for the report. */
export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Dedupe key = Drive file id. A multi-receipt document (one Drive sheet holding
 * many receipts) shares ONE file id across distinct receipts, so when the same id
 * appears with different content every occurrence gets `#<hash of city|date|merchant|total|currency>`
 * and is kept (stable across re-imports). Identical repeats, or two records that
 * still collide after that, keep the first and are reported.
 */
export function keyReceipts(records: HistoryRecord[]): { records: HistoryRecord[]; notes: Array<{ id: string; reason: string }> } {
  const byId = new Map<string, HistoryRecord[]>();
  for (const r of records) (byId.get(r.sourceFileId) ?? byId.set(r.sourceFileId, []).get(r.sourceFileId)!).push(r);
  const out: HistoryRecord[] = [];
  const notes: Array<{ id: string; reason: string }> = [];
  for (const [id, group] of byId) {
    const distinct: HistoryRecord[] = [];
    for (const r of group) {
      if (distinct.some((d) => JSON.stringify(d) === JSON.stringify(r))) notes.push({ id, reason: 'duplicate sourceFileId (identical)' });
      else distinct.push(r);
    }
    if (distinct.length === 1) { out.push(distinct[0]); continue; }
    const seen = new Set<string>();
    for (const r of distinct) {
      const h = crypto.createHash('md5').update([r.city, r.receiptDate, r.merchant, r.total, r.currency].join('|')).digest('hex').slice(0, 8);
      const key = `${id}#${h}`;
      if (seen.has(key)) { notes.push({ id: key, reason: 'two different records collide on city/date/merchant/total (kept the first)' }); continue; }
      seen.add(key);
      out.push({ ...r, sourceFileId: key });
    }
    notes.push({ id, reason: `shared by ${distinct.length} different receipts; keyed as ${id}#<hash>` });
  }
  return { records: out, notes };
}
