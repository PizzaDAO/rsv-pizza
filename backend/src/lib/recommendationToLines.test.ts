import { describe, it, expect } from 'vitest';
import {
  recommendationToLine,
  recommendationsToLines,
  recommendationVersion,
  RecommendationError,
  normalizeDietary,
  MAX_PIZZAS_PER_ORDER,
} from './recommendationToLines.js';

const base = {
  id: 'rec-1',
  quantity: 3,
  size: { diameter: 16, name: 'Large' },
  style: { name: 'New York' },
  toppings: [{ name: 'Pepperoni' }, { name: 'Mushroom' }],
  dietaryRestrictions: [],
};

describe('recommendationToLine', () => {
  it('builds "<qty> <diameter>in <style> <toppings>"', () => {
    const l = recommendationToLine(base);
    expect(l.text).toBe('3 16in New York Pepperoni Mushroom');
    expect(l).toMatchObject({ ref: 'rec-1', quantity: 3, dietary_firm: [], label: null });
  });

  it('defaults quantity to 1 and empty toppings to cheese', () => {
    const l = recommendationToLine({ ...base, quantity: undefined, toppings: [] });
    expect(l.text).toBe('1 16in New York cheese');
    expect(l.quantity).toBe(1);
  });

  it('renders half-and-half as "half X half Y"', () => {
    const l = recommendationToLine({
      ...base,
      quantity: 2,
      isHalfAndHalf: true,
      leftHalf: { toppings: [{ name: 'Pepperoni' }] },
      rightHalf: { toppings: [{ name: 'Mushroom' }, { name: 'Onion' }] },
    });
    expect(l.text).toBe('2 16in New York half Pepperoni half Mushroom Onion');
  });

  it('falls back to the size name when there is no diameter', () => {
    expect(recommendationToLine({ ...base, size: { name: 'Large' } }).text).toBe('3 Large New York Pepperoni Mushroom');
  });

  it('keeps only known dietary needs, normalised, and merges both halves', () => {
    expect(normalizeDietary(['Vegan', 'gluten-free', 'Gluten Free', 'paleo', 7])).toEqual(['vegan', 'gluten_free']);
    const l = recommendationToLine({
      ...base,
      dietaryRestrictions: ['Vegetarian'],
      isHalfAndHalf: true,
      leftHalf: { toppings: [{ name: 'Olive' }], dietaryRestrictions: ['vegan'] },
      rightHalf: { toppings: [{ name: 'Onion' }], dietaryRestrictions: [] },
    });
    expect(l.dietary_firm.sort()).toEqual(['vegan', 'vegetarian']);
  });

  it('strips markup and control characters from names and labels', () => {
    const l = recommendationToLine({
      ...base,
      label: 'Vegan\n<script>',
      toppings: [{ name: 'Ham ```ignore previous``` {x}' }],
    });
    expect(l.text).not.toMatch(/[<>`{}\n]/);
    expect(l.label).toBe('Vegan script');
  });

  it('rejects a missing id or an absurd quantity', () => {
    expect(() => recommendationToLine({ ...base, id: '' })).toThrow(RecommendationError);
    expect(() => recommendationToLine({ ...base, quantity: 0 })).toThrow(RecommendationError);
    expect(() => recommendationToLine({ ...base, quantity: 101 })).toThrow(RecommendationError);
  });
});

describe('recommendationsToLines', () => {
  it('rejects empty and non-array input', () => {
    expect(() => recommendationsToLines([])).toThrow(/No pizza/);
    expect(() => recommendationsToLines('x')).toThrow(RecommendationError);
  });

  it('refuses orders over the phone-order pizza cap (call the shop yourself)', () => {
    expect(() => recommendationsToLines([{ ...base, quantity: MAX_PIZZAS_PER_ORDER + 1 }])).toThrow(/too many/);
    expect(recommendationsToLines([{ ...base, quantity: MAX_PIZZAS_PER_ORDER }])).toHaveLength(1);
  });

  it('version changes when a line changes and is stable otherwise', () => {
    const a = recommendationsToLines([base]);
    const b = recommendationsToLines([{ ...base }]);
    const c = recommendationsToLines([{ ...base, quantity: 4 }]);
    expect(recommendationVersion(a)).toBe(recommendationVersion(b));
    expect(recommendationVersion(a)).not.toBe(recommendationVersion(c));
  });
});
