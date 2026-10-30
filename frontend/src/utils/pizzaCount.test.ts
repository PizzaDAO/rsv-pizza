import { describe, it, expect } from 'vitest';
import {
  pickPizzaCountView,
  lowConfidenceHint,
  parseCountInput,
  digitsOnly,
  summarizeSize,
  sizeSelectValue,
  sizeSelectToBody,
  formatPizzaChip,
  lumpSumPill,
} from './pizzaCount';

describe('pickPizzaCountView', () => {
  it('auto >= 0.7 is shown as a read', () => {
    expect(pickPizzaCountView({ pizzaCount: 20, pizzaCountSource: 'ocr', pizzaCountConfidence: 0.7 })).toBe('auto');
    expect(pickPizzaCountView({ pizzaCount: 20, pizzaCountSource: 'llm', pizzaCountConfidence: 0.9 })).toBe('auto');
  });
  it('host value is host (even with no confidence)', () => {
    expect(pickPizzaCountView({ pizzaCount: 5, pizzaCountSource: 'host', pizzaCountConfidence: null })).toBe('host');
  });
  it('low-confidence auto, nothing, or host-cleared fall to the prompt', () => {
    expect(pickPizzaCountView({ pizzaCount: 20, pizzaCountSource: 'ocr', pizzaCountConfidence: 0.69 })).toBe('prompt');
    expect(pickPizzaCountView({})).toBe('prompt');
    expect(pickPizzaCountView({ pizzaCount: null, pizzaCountSource: 'host' })).toBe('prompt');
  });
  it('low-confidence auto counts are only a hint', () => {
    expect(lowConfidenceHint({ pizzaCount: 20, pizzaCountSource: 'ocr', pizzaCountConfidence: 0.5 })).toBe(20);
    expect(lowConfidenceHint({ pizzaCount: 20, pizzaCountSource: 'ocr', pizzaCountConfidence: 0.9 })).toBeNull();
    expect(lowConfidenceHint({ pizzaCount: 3, pizzaCountSource: 'host' })).toBeNull();
  });
});

describe('parseCountInput', () => {
  it('parses digits, clears on empty/0, rejects junk and huge values', () => {
    expect(parseCountInput('20')).toBe(20);
    expect(parseCountInput(' 7 ')).toBe(7);
    expect(parseCountInput('')).toBeNull();
    expect(parseCountInput('0')).toBeNull();
    expect(parseCountInput('5000')).toBe(5000);
    expect(parseCountInput('5001')).toBe('invalid');
    expect(parseCountInput('12a')).toBe('invalid');
    expect(parseCountInput('-3')).toBe('invalid');
    expect(parseCountInput('2.5')).toBe('invalid');
  });
  it('digitsOnly strips non-digits while typing', () => {
    expect(digitsOnly('1a2-3')).toBe('123');
    expect(digitsOnly('123456')).toBe('1234');
  });
});

describe('size helpers', () => {
  it('summarizes and maps to/from the select', () => {
    expect(summarizeSize({ pizzaSizeCm: 35 })).toEqual({ kind: 'cm', cm: 35 });
    expect(summarizeSize({ pizzaSizeLabel: 'mixed' })).toEqual({ kind: 'mixed' });
    expect(summarizeSize({ pizzaSizeLabel: 'large' })).toEqual({ kind: 'word', word: 'large' });
    expect(summarizeSize({})).toBeNull();
    expect(sizeSelectValue({ pizzaSizeCm: 30 })).toBe('30');
    expect(sizeSelectValue({ pizzaSizeLabel: 'mixed' })).toBe('mixed');
    expect(sizeSelectValue({ pizzaSizeLabel: 'large' })).toBe('');
    expect(sizeSelectToBody('mixed')).toEqual({ pizzaSizeMixed: true });
    expect(sizeSelectToBody('')).toEqual({ pizzaSizeCm: null });
    expect(sizeSelectToBody('40')).toEqual({ pizzaSizeCm: 40 });
  });
  it('chip text', () => {
    expect(formatPizzaChip({ pizzaCount: 20, pizzaSizeCm: 35 })).toBe('20 pizzas · 35 cm');
    expect(formatPizzaChip({ pizzaCount: 1 })).toBe('1 pizza');
    expect(formatPizzaChip({ pizzaCount: 4, pizzaSizeLabel: 'mixed' })).toBe('4 pizzas · mixed sizes');
    expect(formatPizzaChip({})).toBeNull();
  });
  it('lump-sum pill parses the source from notes', () => {
    expect(lumpSumPill({ sourceCategory: 'lump_sum', notes: 'lump_sum:host:receipt_total' })).toBe('Lump sum (count from host)');
    expect(lumpSumPill({ sourceCategory: 'lump_sum', notes: 'lump_sum:llm:pizza_lines' })).toBe('Lump sum (count from AI)');
    expect(lumpSumPill({ sourceCategory: 'lump_sum', notes: null })).toBe('Lump sum');
    expect(lumpSumPill({ sourceCategory: 'pizza', notes: 'lump_sum:host:x' })).toBeNull();
  });
});
