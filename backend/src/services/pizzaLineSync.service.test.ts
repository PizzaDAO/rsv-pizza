import { describe, it, expect, vi } from 'vitest';

// The planner is pure, but the module imports the DB singleton. Stub it.
vi.mock('../config/database.js', () => ({ prisma: {} }));

import {
  planDocSync,
  lineFingerprint,
  extractDiscounts,
  allocateDiscounts,
  resolveDocFx,
  planSyncRow,
  labelHint,
  type ExistingLine,
  type DocContext,
  type LineWrite,
} from './pizzaLineSync.service.js';
import type { SizePreset } from './pizzaSize.service.js';

const presets: SizePreset[] = [
  { id: 'g-large', scope: 'global', merchantKey: null, country: null, sizeLabel: 'large', shape: 'round', diameterCm: 35, lengthCm: null, widthCm: null, sliceFraction: null },
  { id: 'g-medium', scope: 'global', merchantKey: null, country: null, sizeLabel: 'medium', shape: 'round', diameterCm: 30, lengthCm: null, widthCm: null, sliceFraction: null },
];

const doc: DocContext = {
  documentId: 'doc1', partyId: 'party1', country: 'India', merchant: 'La Pinoz',
  currency: 'INR', fxRate: 0.0105, discounts: [],
};

const item = (name: string, qty: number, unitPrice: number, category = 'pizza', size?: any) =>
  ({ name, qty, unitPrice, subtotal: qty * unitPrice, category, ...(size ? { size } : {}) });

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

describe('planDocSync: new lines', () => {
  it('creates only pizza lines, resolving sizes and USD', () => {
    const plan = planDocSync(
      [
        item('Pesto Veg Pizza (Large Serves 4, 33 cm)', 2, 500),
        item('Coke', 1, 60, 'drink'),
        item('Farm Fresh (Medium)', 1, 300),
      ],
      [], doc, presets,
    );
    expect(plan.writes).toHaveLength(2);
    const [a, b] = plan.writes;
    expect(a.lineIndex).toBe(0);
    expect(a.sizeSource).toBe('parsed');
    expect(a.diameterCm).toBe(33);
    expect(a.unitPriceUsd).toBeCloseTo(5.25, 4);
    expect(a.merchantKey).toBe('la pinoz');
    expect(b.lineIndex).toBe(2);
    expect(b.sizeSource).toBe('preset');
    expect(b.sizeConfidence).toBe(0.5);
    expect(b.verifiedAt).toBeNull();
    expect(plan.deleteLineIndexes).toEqual([]);
  });

  it('excludes zero-price lines and flags bundles', () => {
    const plan = planDocSync([item('Free pizza', 1, 0), item('Pizza Party', 47, 20)], [], doc, presets);
    expect(plan.writes[0].excluded).toBe(true);
    expect(plan.writes[0].excludedReason).toBe('zero_price');
    expect(plan.writes[1].isBundle).toBe(true);
    expect(plan.writes[1].excluded).toBe(false);
  });

  it('uses the OCR-reported size when the name has none', () => {
    const plan = planDocSync(
      [item('Margherita', 1, 400, 'pizza', { label: null, diameterCm: 28, lengthCm: null, widthCm: null })],
      [], doc, presets,
    );
    expect(plan.writes[0].diameterCm).toBe(28);
    expect(plan.writes[0].sizeSource).toBe('parsed');
    expect(plan.writes[0].sizeConfidence).toBe(0.9);
  });
});

describe('planDocSync: re-sync semantics', () => {
  const items = [item('Farm Fresh (Medium)', 1, 300)];
  const first = planDocSync(items, [], doc, presets).writes[0];

  it('unchanged fingerprint keeps verification and manual size', () => {
    const verified = existingFrom(first, {
      sizeSource: 'manual', sizeConfidence: 1, diameterCm: 27, areaCm2: 572.6,
      verifiedAt: new Date('2026-10-01'), verifiedBy: 'a@b.c',
    });
    const plan = planDocSync(items, [verified], doc, presets);
    const w = plan.writes[0];
    expect(w.existingId).toBe(verified.id);
    expect(w.verifiedBy).toBe('a@b.c');
    expect(w.verifiedAt).toEqual(new Date('2026-10-01'));
    expect(w.diameterCm).toBe(27);
    expect(w.sizeSource).toBe('manual');
    expect(w.clearPhotoEstimate).toBeUndefined();
  });

  it('keeps qty/price overrides made by a reviewer when the OCR line is unchanged', () => {
    const edited = existingFrom(first, { qty: 3, unitPriceList: 350, verifiedAt: new Date(), verifiedBy: 'x' });
    const w = planDocSync(items, [edited], doc, presets).writes[0];
    expect(w.qty).toBe(3);
    expect(w.unitPriceList).toBe(350);
    expect(w.unitPriceUsd).toBeCloseTo(3.675, 3);
  });

  it('unverified preset rows are re-resolved when presets change', () => {
    const e = existingFrom(first);
    const better: SizePreset[] = [
      ...presets,
      { id: 'c-medium', scope: 'country', merchantKey: null, country: 'India', sizeLabel: 'medium', shape: 'round', diameterCm: 25, lengthCm: null, widthCm: null, sliceFraction: null },
    ];
    const w = planDocSync(items, [e], doc, better).writes[0];
    expect(w.diameterCm).toBe(25);
    expect(w.presetId).toBe('c-medium');
  });

  it('keeps LLM-sourced sizes on unverified rows', () => {
    const e = existingFrom(first, { sizeSource: 'llm', sizeConfidence: 0.7, diameterCm: 31, areaCm2: 754.8 });
    const w = planDocSync(items, [e], doc, presets).writes[0];
    expect(w.sizeSource).toBe('llm');
    expect(w.diameterCm).toBe(31);
  });

  it('changed fingerprint resets verification and re-resolves', () => {
    const verified = existingFrom(first, {
      sizeSource: 'manual', diameterCm: 27, verifiedAt: new Date(), verifiedBy: 'a@b.c',
    });
    const changed = [item('Farm Fresh (Large)', 1, 300)];
    const plan = planDocSync(changed, [verified], doc, presets);
    const w = plan.writes[0];
    expect(w.existingId).toBe(verified.id); // same row slot is updated in place
    expect(w.clearPhotoEstimate).toBe(true); // a photo suggestion for the old text no longer applies
    expect(w.verifiedAt).toBeNull();
    expect(w.verifiedBy).toBeNull();
    expect(w.sizeSource).toBe('preset');
    expect(w.diameterCm).toBe(35);
  });

  it('deletes rows for lines that disappeared or are no longer pizza', () => {
    const e0 = existingFrom(first);
    const e1 = existingFrom({ ...first, lineIndex: 1, lineFingerprint: lineFingerprint('gone', 1, 1) });
    const e2 = existingFrom({ ...first, lineIndex: 2, lineFingerprint: lineFingerprint('Soda', 1, 5) });
    const plan = planDocSync(
      [item('Farm Fresh (Medium)', 1, 300), /* idx1 removed? no: replace by shorter list */],
      [e0, e1, e2], doc, presets,
    );
    expect(plan.deleteLineIndexes.sort()).toEqual([1, 2]);

    // line now categorized as drink -> its row goes away
    const plan2 = planDocSync([item('Farm Fresh (Medium)', 1, 300, 'drink')], [e0], doc, presets);
    expect(plan2.writes).toHaveLength(0);
    expect(plan2.deleteLineIndexes).toEqual([0]);
  });

  it('keeps LLM-promoted (non-pizza category) lines while unchanged, drops them when changed', () => {
    const promoted = existingFrom({ ...first, lineIndex: 0, sourceCategory: 'other', lineFingerprint: lineFingerprint('5 X Regina', 5, 10) });
    const same = planDocSync([item('5 X Regina', 5, 10, 'other')], [promoted], doc, presets);
    expect(same.writes).toHaveLength(1);
    expect(same.writes[0].sourceCategory).toBe('other');
    const changed = planDocSync([item('5 X Regina', 5, 11, 'other')], [promoted], doc, presets);
    expect(changed.writes).toHaveLength(0);
    expect(changed.deleteLineIndexes).toEqual([0]);
  });
});

describe('discounts', () => {
  it('extracts negative lines from raw model output', () => {
    const d = extractDiscounts([
      { name: 'Pizza', qty: 1, unitPrice: 10, subtotal: 10 },
      { name: 'Promo 20% off', qty: 1, unitPrice: -4, subtotal: -4 },
      { name: 'Coupon', qty: 2, unitPrice: -1, subtotal: 0 },
    ]);
    expect(d).toEqual([
      { label: 'Promo 20% off', amount: 4 },
      { label: 'Coupon', amount: 2 },
    ]);
    expect(extractDiscounts(null)).toEqual([]);
  });

  it('allocates pro rata, keeps list price, never goes negative', () => {
    const base = planDocSync([item('A Large', 1, 10), item('B Large', 3, 10)], [], doc, presets);
    const lines = base.writes;
    allocateDiscounts(lines, [{ label: 'promo', amount: 4 }]);
    // base subtotal 40, discount 4 => 10% off each unit
    expect(lines[0].unitPriceList).toBe(10);
    expect(lines[0].unitPriceNet).toBeCloseTo(9, 4);
    expect(lines[1].unitPriceNet).toBeCloseTo(9, 4);
    expect(lines[0].discountLabel).toBe('promo');
    allocateDiscounts(lines, [{ label: 'huge', amount: 1000 }]);
    expect(lines[0].unitPriceNet).toBe(0);
  });

  it('planDocSync applies doc discounts', () => {
    const plan = planDocSync([item('A Large', 2, 10)], [], { ...doc, discounts: [{ label: 'promo', amount: 5 }] }, presets);
    expect(plan.writes[0].unitPriceNet).toBeCloseTo(7.5, 4);
    expect(plan.writes[0].unitPriceUsd).toBeCloseTo(0.105, 4);
  });
});

describe('resolveDocFx', () => {
  it("prefers the document's own rate over the payout's", () => {
    expect(resolveDocFx({ originalCurrency: 'INR', exchangeRate: 0.0106, ocrCurrency: 'INR', payoutCurrency: 'INR', payoutRate: 0.0104 }))
      .toEqual({ currency: 'INR', fxRate: 0.0106 });
  });
  it('falls back to the payout rate only for the same currency', () => {
    expect(resolveDocFx({ originalCurrency: null, exchangeRate: null, ocrCurrency: 'PHP', payoutCurrency: 'PHP', payoutRate: 0.0162 }))
      .toEqual({ currency: 'PHP', fxRate: 0.0162 });
    expect(resolveDocFx({ originalCurrency: null, exchangeRate: null, ocrCurrency: 'PHP', payoutCurrency: 'EUR', payoutRate: 1.15 }))
      .toBeNull();
  });
  it('USD is 1 and unknown currency is unresolved (never a silent 1:1)', () => {
    expect(resolveDocFx({ originalCurrency: 'USD', exchangeRate: null, ocrCurrency: 'USD', payoutCurrency: null, payoutRate: null }))
      .toEqual({ currency: 'USD', fxRate: 1 });
    expect(resolveDocFx({ originalCurrency: null, exchangeRate: null, ocrCurrency: null, payoutCurrency: null, payoutRate: null })).toBeNull();
    expect(resolveDocFx({ originalCurrency: 'UNKNOWN', exchangeRate: 1, ocrCurrency: null, payoutCurrency: null, payoutRate: null })).toBeNull();
  });
});

describe('planSyncRow (force:true must not wipe passes / discounts)', () => {
  const raw = [{ label: 'promo', amount: 4 }];
  const vision = [{ label: 'vision promo', amount: 9 }];
  it('keeps pass markers when the hash is unchanged (force resync)', () => {
    const r = planSyncRow({ prevHash: 'h', newHash: 'h', prevDiscounts: vision, rawDiscounts: [] });
    expect(r.resetMarkers).toBe(false);
    expect(r.writeDiscounts).toBe(false);
    expect(r.discounts).toEqual(vision);
  });
  it('resets markers only when the hash changed', () => {
    expect(planSyncRow({ prevHash: 'a', newHash: 'b', prevDiscounts: null, rawDiscounts: [] }).resetMarkers).toBe(true);
    expect(planSyncRow({ prevHash: null, newHash: 'b', prevDiscounts: null, rawDiscounts: [] }).resetMarkers).toBe(true);
  });
  it('raw discounts win when present', () => {
    const r = planSyncRow({ prevHash: 'a', newHash: 'b', prevDiscounts: vision, rawDiscounts: raw });
    expect(r.discounts).toEqual(raw);
    expect(r.writeDiscounts).toBe(true);
  });
});

describe('size label hints survive re-resolve', () => {
  it('labelHint only passes size words', () => {
    expect(labelHint('Large')).toBe('large');
    expect(labelHint('33cm')).toBeNull();
    expect(labelHint('default')).toBeNull();
  });
  it('an unverified preset row keeps its OCR/LLM word label when the name has no cue', () => {
    const items = [item('Margherita', 1, 300, 'pizza', { label: 'Large' })];
    const first = planDocSync(items, [], doc, presets).writes[0];
    expect(first.sizeLabel).toBe('large');
    const prev = existingFrom(first); // sizeSource 'preset'
    // a later sync where the OCR item no longer carries size, but the stored label does
    const again = planDocSync([item('Margherita', 1, 300)], [prev], doc, presets).writes[0];
    expect(again.sizeLabel).toBe('large');
    expect(again.diameterCm).toBe(35);
  });
});
