import { describe, it, expect } from 'vitest';
import {
  RECEIPTS_JSON_SCHEMA,
  parseSingleReceipt,
  sanitizePizzaCount,
  sanitizePizzaSize,
  buildSystemPrompt,
  buildMultiSystemPrompt,
} from './ocr.service.js';

// sfincione-40417 (pizza count): the two extra output fields are required-but-nullable
// and appended, and the amount-reading path is untouched.
describe('RECEIPTS_JSON_SCHEMA pizza count fields', () => {
  const item: any = (RECEIPTS_JSON_SCHEMA.schema as any).properties.receipts.items;
  it('pizzaCount/pizzaSize are required, nullable, and appended after items', () => {
    expect(item.required.slice(-3)).toEqual(['items', 'pizzaCount', 'pizzaSize']);
    expect(item.properties.pizzaCount.type).toEqual(['integer', 'null']);
    expect(item.properties.pizzaSize.anyOf.map((n: any) => n.type)).toEqual(['object', 'null']);
  });
  it('the amount-reading part of the schema is unchanged', () => {
    expect(item.required.slice(0, 10)).toEqual([
      'amount', 'currency', 'confidence', 'merchant', 'receiptDate', 'boundingHint', 'language', 'summary', 'lineItems', 'items',
    ]);
    expect(item.properties.amount).toEqual({ type: 'number' });
    expect(item.properties.currency).toEqual({ type: ['string', 'null'] });
    expect(item.properties.confidence).toEqual({ type: 'number' });
  });
});

describe('parseSingleReceipt amount path is unaffected by pizza fields', () => {
  const base = {
    amount: 300, currency: 'MXN', confidence: 0.92, merchant: 'Pizzeria', receiptDate: '2026-05-22',
    language: 'es', summary: 'Pizzas', items: ['Pizzas'],
    lineItems: [{ name: 'Pizzas', qty: 1, unitPrice: 300, subtotal: 300, category: 'pizza' }],
  };
  const pick = (r: ReturnType<typeof parseSingleReceipt>) => ({
    amount: r.amount, currency: r.currency, confidence: r.confidence, lineItems: r.lineItems,
    merchant: r.merchant, receiptDate: r.receiptDate, language: r.language, summary: r.summary, items: r.items,
  });
  it('same amount/currency/confidence/lineItems with or without the new fields', () => {
    const without = parseSingleReceipt(base);
    const withFields = parseSingleReceipt({ ...base, pizzaCount: 20, pizzaSize: { label: 'large', diameterCm: 33 } });
    expect(pick(withFields)).toEqual(pick(without));
    expect(without.amount).toBe(300);
    expect(without.currency).toBe('MXN');
    expect(without.confidence).toBe(0.92);
    expect(without.pizzaCount).toBeNull();
    expect(without.pizzaSize).toBeNull();
    expect(withFields.pizzaCount).toBe(20);
    expect(withFields.pizzaSize).toEqual({ label: 'large', diameterCm: 33 });
  });
  it('garbage pizza fields never throw or change the amount, and are sanitized in raw', () => {
    const r = parseSingleReceipt({ ...base, pizzaCount: 'lots', pizzaSize: 'big' });
    expect(r.amount).toBe(300);
    expect(r.pizzaCount).toBeNull();
    expect((r.raw as any).pizzaCount).toBeNull();
    expect((r.raw as any).amount).toBe(300);
  });
  it('sanitizers clamp', () => {
    expect(sanitizePizzaCount(12)).toBe(12);
    expect(sanitizePizzaCount(0)).toBeNull();
    expect(sanitizePizzaCount(5001)).toBeNull();
    expect(sanitizePizzaCount(2.5)).toBeNull();
    expect(sanitizePizzaCount(null)).toBeNull();
    expect(sanitizePizzaSize({ label: 'x'.repeat(100), diameterCm: 500 })).toEqual({ label: 'x'.repeat(40), diameterCm: null });
    expect(sanitizePizzaSize({ label: null, diameterCm: null })).toBeNull();
    expect(sanitizePizzaSize({ label: null, diameterCm: 35 })).toEqual({ label: null, diameterCm: 35 });
  });
  it('prompts mention the new fields; amount instructions retained', () => {
    expect(buildSystemPrompt()).toContain('pizzaCount');
    expect(buildSystemPrompt()).toContain('- amount: number (the total amount paid');
    expect(buildMultiSystemPrompt()).toContain('items, pizzaCount, pizzaSize');
  });
});
