/**
 * sfincione-40417: pure line builder shared by the archive importer
 * (scripts/lib/historyImport.ts) and public receipt submissions
 * (services/pizzaSubmission.service.ts). A record is a transcribed receipt
 * (kind, total, pizzaCount, lines); the builder turns it into pizza_line_items
 * rows. No DB access.
 */
import {
  CONFIDENCE,
  looksLikeBundle,
  normalizeMerchantKey,
  parseAndResolve,
  resolveFromReportedDims,
  type ResolvedSize,
  type SizePreset,
} from './pizzaSize.service.js';
import { lineFingerprint } from './pizzaLineSync.service.js';

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

