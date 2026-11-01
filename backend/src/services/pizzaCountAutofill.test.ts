import { describe, it, expect } from 'vitest';
import {
  derivePizzaAutofill,
  extractCountFromText,
  mergeAutofill,
  emptyPizzaFields,
  emptyAutofill,
  parsePizzaCountPatch,
  pizzaAutofillColumns,
  pizzaAutofillPatch,
  guardAutofillCount,
  isPlausiblePizzaCount,
  receiptUsdTotal,
  MAX_USD_PER_PIZZA,
} from './pizzaCountAutofill.js';

const pz = (name: string, qty: number, unitPrice: number, size?: object) => ({
  name, qty, unitPrice, subtotal: qty * unitPrice, category: 'pizza', ...(size ? { size } : {}),
});

describe('extractCountFromText', () => {
  it('reads common count forms', () => {
    expect(extractCountFromText('Pizzas x20')).toBe(20);
    expect(extractCountFromText('20 pizzas')).toBe(20);
    expect(extractCountFromText('Pizze qty: 12')).toBe(12);
    expect(extractCountFromText('ピザ 8枚')).toBe(8);
  });
  it('rejects sizes, prices and bare words', () => {
    expect(extractCountFromText('Pizza 16"')).toBeNull();
    expect(extractCountFromText('Pizza x 16"')).toBeNull();
    expect(extractCountFromText('2 x 14.50')).toBeNull();
    expect(extractCountFromText('14.50 pizza')).toBeNull();
    expect(extractCountFromText('Margherita 30cm')).toBeNull();
    expect(extractCountFromText('Pizza')).toBeNull();
  });
  it('rejects numbers equal to the line price', () => {
    expect(extractCountFromText('Pizzas x300', [300])).toBeNull();
  });
});

describe('derivePizzaAutofill (a) itemized lines', () => {
  it('sums qty with one printed size', () => {
    const r = derivePizzaAutofill([pz('Margherita 35cm', 12, 10), pz('Pepperoni 35 cm', 8, 11)], null, 0.95);
    expect(r.count).toBe(20);
    expect(r.countSource).toBe('ocr');
    expect(r.countConfidence).toBe(0.86); // 0.9 * 0.95
    expect(r.sizeCm).toBe(35);
    expect(r.sizeSource).toBe('ocr');
  });
  it('flags mixed sizes', () => {
    const r = derivePizzaAutofill([pz('Margherita 30cm', 2, 10), pz('Pepperoni 40cm', 2, 12)], null, 1);
    expect(r.count).toBe(4);
    expect(r.sizeCm).toBeNull();
    expect(r.sizeLabel).toBe('mixed');
  });
  it('uses a shared size word when no cm is known', () => {
    const r = derivePizzaAutofill([pz('Large Margherita', 3, 10), pz('Large Pepperoni', 1, 10)], null, 1);
    expect(r.sizeCm).toBeNull();
    expect(r.sizeLabel).toBe('large');
  });
  it('uses OCR-reported diameter', () => {
    const r = derivePizzaAutofill([pz('Margherita', 5, 10, { label: null, diameterCm: 33 })], null, 1);
    expect(r.sizeCm).toBe(33);
  });
  it('a qty-1 line stating a count uses it, at lower confidence', () => {
    const r = derivePizzaAutofill([pz('Pizzas x20', 1, 300)], null, 1);
    expect(r.count).toBe(20);
    expect(r.countConfidence).toBe(0.75);
  });
  it('does not claim 1 for a plural lump-sum line of unknown count', () => {
    const r = derivePizzaAutofill([pz('Pizzas', 1, 300)], null, 1);
    expect(r.count).toBeNull();
  });
  it('ignores slices and unpriced lines', () => {
    expect(derivePizzaAutofill([pz('Pepperoni slice', 6, 3)], null, 1).count).toBeNull();
    expect(derivePizzaAutofill([pz('Margherita', 6, 0)], null, 1).count).toBeNull();
  });
});

describe('derivePizzaAutofill (b)/(c) text and model fields', () => {
  it('reads the summary', () => {
    const r = derivePizzaAutofill([], { ocr: { summary: 'Order of 24 pizzas for the party' } }, 1);
    expect(r.count).toBe(24);
    expect(r.countConfidence).toBe(0.6);
    expect(r.countSource).toBe('ocr');
  });
  it('reads a non-pizza-category item name and its size', () => {
    const r = derivePizzaAutofill(
      [{ name: '16 pizzas 35cm', qty: 1, unitPrice: 200, subtotal: 200, category: 'other' }], null, 1);
    expect(r.count).toBe(16);
    expect(r.sizeCm).toBe(35);
  });
  it('rejects a number equal to the receipt amount', () => {
    const r = derivePizzaAutofill([], { ocr: { amount: 300, summary: 'Pizzas x300' } }, 1);
    expect(r.count).toBeNull();
  });
  it('uses model fields only when (a) and (b) found nothing', () => {
    const raw = { ocr: { pizzaCount: 15, pizzaSize: { label: null, diameterCm: 30 } } };
    const r = derivePizzaAutofill([], raw, 0.9);
    expect(r.count).toBe(15);
    expect(r.countSource).toBe('llm');
    expect(r.countConfidence).toBe(0.7);
    expect(r.sizeCm).toBe(30);
    expect(r.sizeSource).toBe('llm');
    const withLines = derivePizzaAutofill([pz('Margherita', 4, 10)], raw, 0.9);
    expect(withLines.count).toBe(4);
    expect(withLines.countSource).toBe('ocr');
  });
  it('model count confidence is capped by a low receipt confidence', () => {
    expect(derivePizzaAutofill([], { ocr: { pizzaCount: 9 } }, 0.4).countConfidence).toBe(0.4);
  });
  it('low OCR confidence lowers auto values (factor floor 0.5)', () => {
    const r = derivePizzaAutofill([pz('Margherita', 4, 10)], null, 0.1);
    expect(r.countConfidence).toBe(0.45);
  });
  it('tolerates junk', () => {
    expect(derivePizzaAutofill('x', 5, null)).toEqual(emptyAutofill());
    expect(derivePizzaAutofill(null, null, null)).toEqual(emptyAutofill());
  });
});

describe('mergeAutofill', () => {
  const auto = { ...emptyAutofill(), count: 20, countConfidence: 0.8, countSource: 'ocr' as const };
  it('writes into an empty doc', () => {
    expect(mergeAutofill(emptyPizzaFields(), auto)).toEqual({
      pizzaCount: 20, pizzaCountSource: 'ocr', pizzaCountConfidence: 0.8,
    });
  });
  it('host is sticky, including a host-cleared null', () => {
    expect(mergeAutofill({ ...emptyPizzaFields(), pizzaCount: 5, pizzaCountSource: 'host' }, auto)).toEqual({});
    expect(mergeAutofill({ ...emptyPizzaFields(), pizzaCount: null, pizzaCountSource: 'host' }, auto)).toEqual({});
  });
  it('llm does not overwrite a higher-confidence ocr value, and the reverse', () => {
    const ocrHigh = { ...emptyPizzaFields(), pizzaCount: 10, pizzaCountSource: 'ocr' as const, pizzaCountConfidence: 0.9 };
    const llm = { ...emptyAutofill(), count: 12, countConfidence: 0.6, countSource: 'llm' as const };
    expect(mergeAutofill(ocrHigh, llm)).toEqual({});
    const llmLow = { ...emptyPizzaFields(), pizzaCount: 12, pizzaCountSource: 'llm' as const, pizzaCountConfidence: 0.6 };
    const ocr = { ...emptyAutofill(), count: 10, countConfidence: 0.9, countSource: 'ocr' as const };
    expect(mergeAutofill(llmLow, ocr)).toMatchObject({ pizzaCount: 10, pizzaCountSource: 'ocr' });
  });
  it('size is merged independently and replaces cm/label together', () => {
    const a = { ...emptyAutofill(), sizeLabel: 'large', sizeConfidence: 0.5, sizeSource: 'ocr' as const };
    const ex = { ...emptyPizzaFields(), pizzaSizeCm: 30, pizzaSizeSource: 'llm' as const, pizzaSizeConfidence: 0.4 };
    expect(mergeAutofill(ex, a)).toEqual({
      pizzaSizeCm: null, pizzaSizeLabel: 'large', pizzaSizeSource: 'ocr', pizzaSizeConfidence: 0.5,
    });
  });
});

describe('pizzaAutofillColumns', () => {
  it('never throws on garbage', () => {
    expect(pizzaAutofillColumns({ weird: true }, 42, NaN)).toEqual({});
  });
});

describe('parsePizzaCountPatch', () => {
  it('accepts a count and marks it host', () => {
    expect(parsePizzaCountPatch({ pizzaCount: 20 })).toEqual({
      ok: true, changed: true,
      data: { pizzaCount: 20, pizzaCountSource: 'host', pizzaCountConfidence: null },
    });
  });
  it('0 / empty / null clear the count but keep source host', () => {
    for (const v of [0, '', null, '0']) {
      const r = parsePizzaCountPatch({ pizzaCount: v });
      expect(r).toMatchObject({ ok: true, data: { pizzaCount: null, pizzaCountSource: 'host' } });
    }
  });
  it('rejects bad counts', () => {
    for (const v of [-1, 1.5, 5001, 'abc', {}]) expect(parsePizzaCountPatch({ pizzaCount: v }).ok).toBe(false);
  });
  it('size: host list vs admin range, mixed', () => {
    expect(parsePizzaCountPatch({ pizzaSizeCm: 35 })).toMatchObject({ ok: true, data: { pizzaSizeCm: 35, pizzaSizeLabel: null, pizzaSizeSource: 'host' } });
    expect(parsePizzaCountPatch({ pizzaSizeCm: 33 }).ok).toBe(false);
    expect(parsePizzaCountPatch({ pizzaSizeCm: 33 }, { allowAnySize: true }).ok).toBe(true);
    expect(parsePizzaCountPatch({ pizzaSizeCm: 90 }, { allowAnySize: true }).ok).toBe(false);
    expect(parsePizzaCountPatch({ pizzaSizeMixed: true })).toMatchObject({
      ok: true, data: { pizzaSizeCm: null, pizzaSizeLabel: 'mixed', pizzaSizeSource: 'host' },
    });
    expect(parsePizzaCountPatch({ pizzaSizeMixed: 'yes' }).ok).toBe(false);
  });
  it('empty body is a no-op and non-objects fail', () => {
    expect(parsePizzaCountPatch({})).toEqual({ ok: true, data: {}, changed: false });
    expect(parsePizzaCountPatch(null).ok).toBe(false);
  });
});

describe('USD-per-pizza guard', () => {
  const giro = [{ name: 'Giro Pizza', qty: 1, unitPrice: 520, subtotal: 520, category: 'pizza' }];
  const eur = { originalAmount: 520, originalCurrency: 'EUR', exchangeRate: 1.16, ocrAmount: 603.2, ocrCurrency: 'EUR' };

  it('receiptUsdTotal converts, trusts ocr_amount only for USD, else unknown', () => {
    expect(receiptUsdTotal(eur)).toBe(603.2);
    expect(receiptUsdTotal({ originalAmount: 625, originalCurrency: 'USD', exchangeRate: 1, ocrAmount: 625, ocrCurrency: 'USD' })).toBe(625);
    // legacy local-currency ocr_amount with no rate: can't tell
    expect(receiptUsdTotal({ ocrAmount: 754000, ocrCurrency: 'NGN' })).toBeNull();
    expect(receiptUsdTotal({ ocrAmount: 754000, originalAmount: 754000, originalCurrency: 'NGN', exchangeRate: 0.00065 })).toBe(490.1);
    // Nigerian receipt stamped USD (usd-passthrough) with a local-currency figure
    expect(receiptUsdTotal({ ocrAmount: 754000, ocrCurrency: 'USD', originalCurrency: null })).toBeNull();
    expect(receiptUsdTotal({ ocrAmount: 50 })).toBeNull();
    expect(receiptUsdTotal(null)).toBeNull();
  });
  it('isPlausiblePizzaCount: <= $100/pizza, unknown total keeps', () => {
    expect(MAX_USD_PER_PIZZA).toBe(100);
    expect(isPlausiblePizzaCount(1, 603.2)).toBe(false);
    expect(isPlausiblePizzaCount(35, 625)).toBe(true);
    expect(isPlausiblePizzaCount(1, 100)).toBe(true);
    expect(isPlausiblePizzaCount(1, null)).toBe(true);
    expect(isPlausiblePizzaCount(1, undefined)).toBe(true);
  });
  it('drops a lump-sum count of 1 on a 520 EUR receipt (size handling unchanged)', () => {
    expect(pizzaAutofillColumns(giro, null, null)).toMatchObject({ pizzaCount: 1, pizzaCountSource: 'ocr' });
    expect(pizzaAutofillColumns(giro, null, null, receiptUsdTotal(eur))).toEqual({});
    const sized = [{ ...giro[0], name: 'Giro Pizza 30cm' }];
    const cols = pizzaAutofillColumns(sized, null, null, receiptUsdTotal(eur));
    expect(cols.pizzaCount).toBeUndefined();
    expect(cols.pizzaCountSource).toBeUndefined();
    expect(cols.pizzaSizeCm).toBe(30);
  });
  it('keeps 35 pizzas on a 625 USD receipt and keeps when the total is unknown', () => {
    const lines = [pz('Pizza', 35, 17.86)];
    expect(pizzaAutofillColumns(lines, null, null, 625).pizzaCount).toBe(35);
    expect(pizzaAutofillColumns(giro, null, null, null).pizzaCount).toBe(1);
  });
  it('never touches a host value', () => {
    const host = { ...emptyPizzaFields(), pizzaCount: 1, pizzaCountSource: 'host' as const };
    const guarded = guardAutofillCount(derivePizzaAutofill(giro, null), 603.2);
    expect(guarded.count).toBeNull();
    expect(mergeAutofill(host, guarded)).toEqual({});
    expect(pizzaAutofillPatch(host, giro, null, null, 603.2)).toEqual({});
  });
});
