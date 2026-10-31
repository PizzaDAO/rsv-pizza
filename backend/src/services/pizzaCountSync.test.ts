import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));
vi.mock('../lib/openai.js', () => ({ getOpenAI: () => { throw new Error('OpenAI must not be called in tests'); } }));
vi.mock('../lib/privateConfig.js', () => ({ getLlmModels: async () => ({ assistant: 'x', visionPrimary: 'y' }) }));
vi.mock('./ocr.service.js', () => ({ imageUrlToBase64DataUrl: async () => '' }));

import {
  planDocSync,
  docCountFromRow,
  LUMP_SUM_LINE_INDEX,
  type DocContext,
  type DocCount,
  type ExistingLine,
  type LineWrite,
} from './pizzaLineSync.service.js';
import { parseLumpSumResponse, parseTextPassResponse, TEXT_PASS_SYSTEM } from './pizzaIndexLlm.service.js';
import { buildPublicIndexFromRows, selectRows, type IndexRow } from './pizzaIndex.service.js';
import type { SizePreset } from './pizzaSize.service.js';

const presets: SizePreset[] = [
  { id: 'g-large', scope: 'global', merchantKey: null, country: null, sizeLabel: 'large', shape: 'round', diameterCm: 35, lengthCm: null, widthCm: null, sliceFraction: null },
];

const count = (p: Partial<DocCount> = {}): DocCount => ({
  pizzaCount: 12, countSource: 'host', sizeCm: null, sizeLabel: null, sizeSource: null,
  receiptTotal: 300, totalCurrency: 'MXN', totalFxRate: 0.05, ...p,
});
const doc = (c: DocCount | null): DocContext => ({
  documentId: 'doc1', partyId: 'party1', country: 'Mexico', merchant: 'Pizzeria Uno',
  currency: 'MXN', fxRate: 0.05, discounts: [], count: c,
});
const item = (name: string, qty: number, unitPrice: number, category = 'pizza') =>
  ({ name, qty, unitPrice, subtotal: qty * unitPrice, category });

function existingFrom(w: LineWrite, extra: Partial<ExistingLine> = {}): ExistingLine {
  return {
    id: `row${w.lineIndex}`, lineIndex: w.lineIndex, lineFingerprint: w.lineFingerprint,
    sourceCategory: w.sourceCategory, merchant: w.merchant, qty: w.qty, unitPriceList: w.unitPriceList,
    sizeLabel: w.sizeLabel, shape: w.shape, diameterCm: w.diameterCm, lengthCm: w.lengthCm,
    widthCm: w.widthCm, sliceFraction: w.sliceFraction, areaCm2: w.areaCm2, style: w.style,
    sizeSource: w.sizeSource, sizeConfidence: w.sizeConfidence, presetId: w.presetId,
    verifiedAt: w.verifiedAt, verifiedBy: w.verifiedBy, excluded: w.excluded,
    excludedReason: w.excludedReason, isBundle: w.isBundle, outlierFlag: w.outlierFlag, notes: w.notes,
    ...extra,
  };
}

describe('planDocSync: synthetic lump-sum line from a pizza count', () => {
  it('no items, count 12, total 300 MXN @0.05 -> one -1 line, unit 25 / USD 1.25', () => {
    const plan = planDocSync([], [], doc(count()), presets);
    expect(plan.writes).toHaveLength(1);
    const w = plan.writes[0];
    expect(w.lineIndex).toBe(LUMP_SUM_LINE_INDEX);
    expect(w.sourceCategory).toBe('lump_sum');
    expect(w.qty).toBe(12);
    expect(w.unitPriceList).toBe(25);
    expect(w.unitPriceUsd).toBe(1.25);
    expect(w.currency).toBe('MXN');
    expect(w.notes).toBe('lump_sum:host:receipt_total');
    expect(w.rawName).toBe('Lump sum: 12 pizzas');
    expect(w.excluded).toBe(false);
    expect(w.unitPriceNet).toBeNull();
  });
  it('uses USD at rate 1 when only the USD total is known', () => {
    const plan = planDocSync([], [], doc(count({ receiptTotal: 120, totalCurrency: 'USD', totalFxRate: 1 })), presets);
    expect(plan.writes[0].currency).toBe('USD');
    expect(plan.writes[0].unitPriceUsd).toBe(10);
  });
  it('no count -> no line; total 0 / missing -> no line', () => {
    expect(planDocSync([], [], doc(count({ pizzaCount: null })), presets).writes).toHaveLength(0);
    expect(planDocSync([], [], doc(null), presets).writes).toHaveLength(0);
    expect(planDocSync([], [], doc(count({ receiptTotal: 0 })), presets).writes).toHaveLength(0);
    expect(planDocSync([], [], doc(count({ receiptTotal: null })), presets).writes).toHaveLength(0);
  });
  it('a priceable itemized pizza line wins: no synthetic line, and a stale -1 line is deleted', () => {
    const first = planDocSync([], [], doc(count()), presets).writes[0];
    const plan = planDocSync([item('Margherita', 2, 100)], [existingFrom(first)], doc(count()), presets);
    expect(plan.writes.map((w) => w.lineIndex)).toEqual([0]);
    expect(plan.deleteLineIndexes).toEqual([LUMP_SUM_LINE_INDEX]);
  });
  it('clearing the count deletes the stale -1 line', () => {
    const first = planDocSync([], [], doc(count()), presets).writes[0];
    const plan = planDocSync([], [existingFrom(first)], doc(count({ pizzaCount: null })), presets);
    expect(plan.writes).toHaveLength(0);
    expect(plan.deleteLineIndexes).toEqual([LUMP_SUM_LINE_INDEX]);
  });
  it('a lump_sum-excluded "Pizzas" line (300) plus tax: base 300 from pizza lines, tax trimmed', () => {
    const pizzasLine: ExistingLine = {
      id: 'r0', lineIndex: 0, lineFingerprint: 'fp', sourceCategory: 'pizza', merchant: null, qty: 1, unitPriceList: 300,
      sizeLabel: null, shape: null, diameterCm: null, lengthCm: null, widthCm: null, sliceFraction: null, areaCm2: null,
      style: null, sizeSource: null, sizeConfidence: null, presetId: null, verifiedAt: null, verifiedBy: null,
      excluded: true, excludedReason: 'lump_sum', isBundle: false, outlierFlag: false, notes: null,
    };
    // fingerprint must match for the kept-line path; compute through a first plan
    const items = [item('Pizzas', 1, 300), item('Tax', 1, 48, 'tax')];
    const first = planDocSync(items, [], doc(count({ receiptTotal: 348 })), presets).writes.find((w) => w.lineIndex === 0)!;
    const plan = planDocSync(
      items,
      [existingFrom(first, { excluded: true, excludedReason: 'lump_sum' }), { ...pizzasLine, lineFingerprint: first.lineFingerprint }],
      doc(count({ receiptTotal: 348 })), presets,
    );
    const lump = plan.writes.find((w) => w.lineIndex === LUMP_SUM_LINE_INDEX)!;
    expect(lump).toBeTruthy();
    expect(lump.unitPriceList).toBe(25); // 300 / 12, not 348 / 12
    expect(lump.notes).toBe('lump_sum:host:pizza_lines');
  });
  it('size: host 35 cm -> manual, ocr cm -> parsed, llm cm -> llm; confidence <= 0.5', () => {
    const host = planDocSync([], [], doc(count({ sizeCm: 35, sizeSource: 'host' })), presets).writes[0];
    expect(host.sizeSource).toBe('manual');
    expect(host.diameterCm).toBe(35);
    expect(host.sizeConfidence).toBeLessThanOrEqual(0.5);
    expect(host.rawName).toBe('Lump sum: 12 pizzas (35 cm)');
    const ocr = planDocSync([], [], doc(count({ sizeCm: 30, sizeSource: 'ocr', countSource: 'ocr' })), presets).writes[0];
    expect(ocr.sizeSource).toBe('parsed');
    expect(ocr.notes).toBe('lump_sum:ocr:receipt_total');
    const llm = planDocSync([], [], doc(count({ sizeCm: 30, sizeSource: 'llm' })), presets).writes[0];
    expect(llm.sizeSource).toBe('llm');
    expect(llm.sizeConfidence).toBeLessThanOrEqual(0.5);
  });
  it('size word -> preset; mixed / none -> preset-or-null; confidence <= 0.5', () => {
    const word = planDocSync([], [], doc(count({ sizeLabel: 'large', sizeSource: 'ocr' })), presets).writes[0];
    expect(word.sizeSource).toBe('preset');
    expect(word.diameterCm).toBe(35);
    expect(word.sizeConfidence ?? 0).toBeLessThanOrEqual(0.5);
    const mixed = planDocSync([], [], doc(count({ sizeLabel: 'mixed', sizeSource: 'host' })), presets).writes[0];
    expect(mixed.areaCm2 === null || (mixed.sizeConfidence ?? 0) <= 0.5).toBe(true);
    const none = planDocSync([], [], doc(count()), presets).writes[0];
    expect(none.areaCm2 === null || (none.sizeConfidence ?? 0) <= 0.5).toBe(true);
  });
  it('discounts are not allocated to the -1 line', () => {
    const d = { ...doc(count()), discounts: [{ label: 'promo', amount: 20 }] };
    const w = planDocSync([], [], d, presets).writes[0];
    expect(w.unitPriceNet).toBeNull();
    expect(w.discountAmount).toBeNull();
  });
  it('a verified -1 line with the same fingerprint is sticky (size, verification, exclusion)', () => {
    const first = planDocSync([], [], doc(count({ sizeCm: 35, sizeSource: 'host' })), presets).writes[0];
    const when = new Date('2026-06-01');
    const prev = existingFrom(first, { verifiedAt: when, verifiedBy: 'u1', excluded: true, excludedReason: 'manual', sizeLabel: 'custom', diameterCm: 33, areaCm2: 855 });
    const again = planDocSync([], [prev], doc(count({ sizeCm: 35, sizeSource: 'host' })), presets).writes[0];
    expect(again.existingId).toBe('row-1');
    expect(again.verifiedAt).toEqual(when);
    expect(again.excluded).toBe(true);
    expect(again.diameterCm).toBe(33);
  });
  it('a changed fingerprint (new count) resets verification but reuses the id', () => {
    const first = planDocSync([], [], doc(count()), presets).writes[0];
    const prev = existingFrom(first, { verifiedAt: new Date(), verifiedBy: 'u1' });
    const next = planDocSync([], [prev], doc(count({ pizzaCount: 20 })), presets).writes[0];
    expect(next.existingId).toBe('row-1');
    expect(next.verifiedAt).toBeNull();
    expect(next.qty).toBe(20);
  });
});

describe('planDocSync: LLM-bundle lump sums (B2)', () => {
  const bundleExisting = (w: LineWrite): ExistingLine => existingFrom(w, { isBundle: true });
  it('an isBundle "Pizzas x20" qty1 $300 line + count 20 produces the -1 line from pizza_lines', () => {
    const items = [item('Pizzas x20', 1, 300), item('Tax', 1, 48, 'tax')];
    const first = planDocSync(items, [], doc(count({ pizzaCount: 20, receiptTotal: 348 })), presets).writes.find((w) => w.lineIndex === 0)!;
    const plan = planDocSync(items, [bundleExisting(first)], doc(count({ pizzaCount: 20, receiptTotal: 348 })), presets);
    const lump = plan.writes.find((w) => w.lineIndex === LUMP_SUM_LINE_INDEX)!;
    expect(lump).toBeTruthy();
    expect(lump.qty).toBe(20);
    expect(lump.unitPriceList).toBe(15); // 300 / 20, tax trimmed
    expect(lump.notes).toBe('lump_sum:host:pizza_lines');
  });
  it('an excluded non-lump_sum line does not contribute to the pizza_lines base', () => {
    const items = [item('Pizzas x20', 1, 300), item('Pizza refund', 1, 50)];
    const first = planDocSync(items, [], doc(count({ pizzaCount: 20 })), presets).writes;
    const prev = [
      existingFrom(first[0], { isBundle: true }),
      existingFrom(first[1], { excluded: true, excludedReason: 'duplicate_line' }),
    ];
    const lump = planDocSync(items, prev, doc(count({ pizzaCount: 20 })), presets).writes.find((w) => w.lineIndex === LUMP_SUM_LINE_INDEX)!;
    expect(lump.unitPriceList).toBe(15);
  });
  it('pizza lines summing past the receipt total fall back to the total', () => {
    const items = [item('Pizzas x6', 1, 1074)];
    const c = count({ pizzaCount: 6, receiptTotal: 216 });
    const first = planDocSync(items, [], doc(c), presets).writes[0];
    const lump = planDocSync(items, [bundleExisting(first)], doc(c), presets).writes.find((w) => w.lineIndex === LUMP_SUM_LINE_INDEX)!;
    expect(lump.unitPriceList).toBe(36); // 216 / 6, not 1074 / 6
    expect(lump.notes).toBe('lump_sum:host:receipt_total');
  });
});

describe('docCountFromRow', () => {
  const row = {
    pizza_count: 12, pizza_count_source: 'host', pizza_size_cm: null, pizza_size_label: null, pizza_size_source: null,
    original_amount: 300, ocr_amount: 15, original_currency: 'mxn',
  };
  it('prefers the original-currency total in the FX currency', () => {
    expect(docCountFromRow(row, { currency: 'MXN', fxRate: 0.05 })).toMatchObject({ receiptTotal: 300, totalCurrency: 'MXN', totalFxRate: 0.05 });
  });
  it('falls back to the USD total at rate 1', () => {
    expect(docCountFromRow({ ...row, original_currency: null }, { currency: 'MXN', fxRate: 0.05 }))
      .toMatchObject({ receiptTotal: 15, totalCurrency: 'USD', totalFxRate: 1 });
  });
  it('null without a count', () => {
    expect(docCountFromRow({ ...row, pizza_count: null }, { currency: 'MXN', fxRate: 0.05 })).toBeNull();
  });
});

describe('parseLumpSumResponse', () => {
  it('reads a lumpSum object', () => {
    const r = parseLumpSumResponse(JSON.stringify({ lines: [], lumpSum: { pizzaCount: 30, sizeLabel: 'Large', diameterCm: null, confidence: 0.9 } }));
    expect(r).toEqual({ pizzaCount: 30, sizeLabel: 'large', diameterCm: null, confidence: 0.9 });
  });
  it('old responses / null / junk give null', () => {
    expect(parseLumpSumResponse(JSON.stringify({ lines: [] }))).toBeNull();
    expect(parseLumpSumResponse(JSON.stringify({ lines: [], lumpSum: null }))).toBeNull();
    expect(parseLumpSumResponse(JSON.stringify({ lumpSum: { pizzaCount: 0 } }))).toBeNull();
    expect(parseLumpSumResponse(JSON.stringify({ lumpSum: { pizzaCount: 2.5 } }))).toBeNull();
    expect(parseLumpSumResponse('not json')).toBeNull();
    expect(parseLumpSumResponse(null)).toBeNull();
  });
  it('parseTextPassResponse is unaffected by the extra key', () => {
    const body = { lines: [{ i: 0, isPizza: true, sizeLabel: 'large', confidence: 0.8 }], lumpSum: { pizzaCount: 5, confidence: 1 } };
    expect(parseTextPassResponse(JSON.stringify(body), new Set([0]))).toHaveLength(1);
  });
  it('prompt asks for lumpSum', () => {
    expect(TEXT_PASS_SYSTEM).toContain('"lumpSum"');
  });
});

describe('index: live-receipt lump sums (origin event)', () => {
  let seq = 0;
  function row(p: Partial<IndexRow> & { partyId: string; usdPerCm2: number }): IndexRow {
    const area = 706.9;
    return {
      lineId: `l${++seq}`, documentId: `d${seq}`, partyName: `P ${p.partyId}`, country: 'Mexico', city: 'CDMX',
      region: 'latam', eventYear: 2026, eventSeriesSlug: 'gpp2026', documentUrl: 'https://x/r.jpg', documentMimeType: 'image/jpeg',
      sourceReceiptIndex: null, sourceReceiptCount: null, merchant: 'M', merchantKey: 'm', rawName: 'Pizza',
      qty: 1, currency: 'MXN', fxRate: 0.05, unitPriceList: 100, unitPriceNet: null,
      unitPriceUsd: p.usdPerCm2 * area, unitPriceNetUsd: null, sizeLabel: 'large', shape: 'round', diameterCm: 30,
      areaCm2: area, style: null, sizeSource: 'parsed', sizeConfidence: 0.95, verifiedAt: null, verifiedBy: null,
      isVerified: false, outlierFlag: false, isBundle: false, localPerCm2: p.usdPerCm2 / 0.05, netUsdPerCm2: null,
      eventKey: p.partyId, origin: 'event', fxSource: null, isLumpSum: false, ...p,
    };
  }
  it('excluded from confirmed; included in estimated when the country has no confirmed rows', () => {
    const lump = row({ partyId: 'a', usdPerCm2: 0.01, isLumpSum: true, sizeConfidence: 0.5 });
    expect(selectRows([lump], {})).toHaveLength(0);
    const pub = buildPublicIndexFromRows([lump], 2026);
    expect(pub.countries).toHaveLength(1);
    expect(pub.countries[0].estimated).toBe(true);
  });
  it('dropped once the country has confirmed rows', () => {
    const lump = row({ partyId: 'a', usdPerCm2: 0.05, isLumpSum: true, sizeConfidence: 0.5 });
    const ok = row({ partyId: 'b', usdPerCm2: 0.01 });
    const pub = buildPublicIndexFromRows([lump, ok], 2026);
    expect(pub.countries[0].estimated).toBe(false);
    expect(pub.countries[0].usdPerCm2).toBeCloseTo(0.01);
  });
});
