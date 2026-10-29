import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/database.js', () => ({ prisma: {} }));

import { buildHistoryLines, keyReceipts, normalizeCountry, validateRecord, type HistoryRecord } from './historyImport.js';
import type { SizePreset } from '../../src/services/pizzaSize.service.js';

const presets: SizePreset[] = [
  { id: 'g-large', scope: 'global', merchantKey: null, country: null, sizeLabel: 'large', shape: 'round', diameterCm: 33, lengthCm: null, widthCm: null, sliceFraction: null },
  { id: 'g-default', scope: 'global', merchantKey: null, country: null, sizeLabel: 'default', shape: 'round', diameterCm: 30, lengthCm: null, widthCm: null, sliceFraction: null },
];

const rec = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  year: 2023, country: 'Qatar', city: 'Doha', merchant: 'Pizza Co', receiptDate: '2023-05-21', currency: 'QAR',
  sourceFileId: 'f1', sourceTitle: 't', sourceUrl: 'https://drive/f1', total: 3062, kind: 'itemized', pizzaCount: 29, lines: [], ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  name: 'Margherita 30cm', qty: 2, unitPrice: 50, sizeLabel: null, diameterCm: null, shape: null, category: 'pizza', isBundle: false, note: null, ...over,
});

describe('validateRecord', () => {
  const good = { ...rec(), lines: [line()] };
  it('accepts a well-formed record', () => {
    const v = validateRecord(good);
    expect(v.ok).toBe(true);
  });
  it('skips year >= 2026 (already in the DB as payout documents)', () => {
    const v = validateRecord({ ...good, year: 2026, receiptDate: '2026-05-01' });
    expect(v).toMatchObject({ ok: false, sourceFileId: 'f1' });
    expect((v as { reason: string }).reason).toMatch(/2026/);
  });
  it('rejects bad currency, kind, date, and non-numeric lines', () => {
    expect(validateRecord({ ...good, currency: 'usd$' }).ok).toBe(false);
    expect(validateRecord({ ...good, kind: 'weird' }).ok).toBe(false);
    expect(validateRecord({ ...good, receiptDate: '21/05/2023' }).ok).toBe(false);
    expect(validateRecord({ ...good, receiptDate: '2022-05-21' }).ok).toBe(false); // not in `year`
    expect(validateRecord({ ...good, lines: [line({ qty: 'two' })] }).ok).toBe(false);
    expect(validateRecord({ ...good, sourceFileId: '' }).ok).toBe(false);
    expect(validateRecord(null).ok).toBe(false);
  });
  it('uppercases currency and defaults a missing category to pizza', () => {
    const v = validateRecord({ ...good, currency: 'qar', lines: [{ name: 'x', qty: 1, unitPrice: 5 }] });
    expect(v.ok && v.record.currency).toBe('QAR');
    expect(v.ok && v.record.lines[0].category).toBe('pizza');
  });
});

describe('normalizeCountry', () => {
  it('resolves to the parties.country spelling + region; unknown countries are null', () => {
    expect(normalizeCountry('USA')).toMatchObject({ country: 'United States', region: 'usa' });
    expect(normalizeCountry('Turkey')).toMatchObject({ code: 'TR' });
    expect(normalizeCountry('Narnia')).toBeNull();
  });
});

describe('buildHistoryLines', () => {
  it('not_pizza stores no lines', () => {
    expect(buildHistoryLines(rec({ kind: 'not_pizza', lines: [line() as any] }), presets, 0.27)).toEqual([]);
  });

  it('itemized: drops non-pizza categories, prices in USD, parses printed sizes', () => {
    const lines = buildHistoryLines(rec({ lines: [line() as any, line({ name: 'Drinks', category: 'other' }) as any] }), presets, 0.25);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ rawName: 'Margherita 30cm', qty: 2, unitPriceList: 50, unitPriceUsd: 12.5, currency: 'QAR', fxRate: 0.25, sizeSource: 'parsed', diameterCm: 30, excluded: false });
    expect(lines[0].areaCm2).toBeGreaterThan(700);
  });

  it('keeps the line index of the source line even when others are skipped', () => {
    const lines = buildHistoryLines(rec({ lines: [line({ name: 'Drinks', category: 'other' }) as any, line() as any] }), presets, 1);
    expect(lines.map((l) => l.lineIndex)).toEqual([1]);
  });

  it('flags bundles from the transcription or the name', () => {
    const lines = buildHistoryLines(rec({
      lines: [line({ isBundle: true }) as any, line({ name: 'Pizza barra libre' }) as any, line() as any],
    }), presets, 1);
    expect(lines.map((l) => l.isBundle)).toEqual([true, true, false]);
  });

  it('excludes zero-price lines', () => {
    const [l] = buildHistoryLines(rec({ lines: [line({ unitPrice: 0 }) as any] }), presets, 1);
    expect(l).toMatchObject({ excluded: true, excludedReason: 'zero_price' });
  });

  it('uses reported dimensions at confidence <= 0.7 (source llm) when nothing is printed', () => {
    const [l] = buildHistoryLines(rec({ lines: [line({ name: 'Veggie', diameterCm: 32, shape: 'round' }) as any] }), presets, 1);
    expect(l.sizeSource).toBe('llm');
    expect(l.diameterCm).toBe(32);
    expect(l.sizeConfidence).toBeLessThanOrEqual(0.7);
  });

  it('lump sum: one synthetic line, price = total / pizzaCount, confidence <= 0.5, notes lump_sum', () => {
    const lines = buildHistoryLines(rec({ kind: 'lump_sum', total: 600, pizzaCount: 40, lines: [line({ name: 'ignored' }) as any] }), presets, 0.5);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ rawName: 'Lump sum: 40 pizzas', qty: 40, unitPriceList: 15, unitPriceUsd: 7.5, notes: 'lump_sum', isBundle: false });
    expect(lines[0].sizeConfidence ?? 0).toBeLessThanOrEqual(0.5);
  });

  it('lump sum with a reported diameter uses it (still <= 0.5)', () => {
    const [l] = buildHistoryLines(rec({ kind: 'lump_sum', total: 600, pizzaCount: 40, diameterCm: 35 }), presets, 1);
    expect(l.diameterCm).toBe(35);
    expect(l.sizeConfidence).toBeLessThanOrEqual(0.5);
  });

  it('lump sum without a pizza count or total stores the receipt only', () => {
    expect(buildHistoryLines(rec({ kind: 'lump_sum', total: 600, pizzaCount: null }), presets, 1)).toEqual([]);
    expect(buildHistoryLines(rec({ kind: 'lump_sum', total: null, pizzaCount: 10 }), presets, 1)).toEqual([]);
  });
});

describe('keyReceipts', () => {
  it('keeps unique ids as-is and drops identical repeats', () => {
    const a = rec({ sourceFileId: 'a' });
    const r = keyReceipts([a, { ...a }, rec({ sourceFileId: 'b' })]);
    expect(r.records.map((x) => x.sourceFileId)).toEqual(['a', 'b']);
    expect(r.notes.some((n) => /identical/.test(n.reason))).toBe(true);
  });
  it('a shared multi-receipt file id yields one stable keyed receipt per distinct receipt', () => {
    const mk = (city: string, total: number) => rec({ sourceFileId: 'sheet', city, total });
    const r1 = keyReceipts([mk('Quito', 10), mk('Cuenca', 20)]);
    expect(r1.records).toHaveLength(2);
    expect(r1.records.every((x) => x.sourceFileId.startsWith('sheet#'))).toBe(true);
    expect(new Set(r1.records.map((x) => x.sourceFileId)).size).toBe(2);
    // order-independent: the same receipt gets the same key on a re-import
    const r2 = keyReceipts([mk('Cuenca', 20), mk('Quito', 10)]);
    expect(r2.records.find((x) => x.city === 'Quito')!.sourceFileId).toBe(r1.records.find((x) => x.city === 'Quito')!.sourceFileId);
  });
});
