import { describe, it, expect } from 'vitest';
import { menuFacts, fitLine, matchTopping } from './menuFit.js';
import { recommendationToLine } from './recommendationToLines.js';

const menu = {
  categories: [
    {
      items: [
        {
          kind: 'pizza',
          sizes: [
            { diameter_in: 10, available: true },
            { diameter_in: 12, available: true },
            { diameter_in: 14, available: true },
            { diameter_in: 16, available: true },
          ],
          option_groups: [
            { role: 'crust', name: 'Crust', options: [{ name: 'Thin' }] },
            { role: 'topping', name: 'Toppings', options: [{ name: 'Pepperoni' }, { name: 'Mushrooms' }, { name: 'Green peppers' }, { name: 'Black olives' }, { name: 'Extra cheese' }] },
          ],
        },
      ],
    },
  ],
};
const rec = (over: Record<string, unknown>) =>
  recommendationToLine({ id: 'r', quantity: 2, size: { diameter: 16 }, style: { name: 'Detroit' }, toppings: [], ...over } as never);

describe('menuFit', () => {
  const facts = menuFacts(menu);
  it('reads sizes and topping names from the menu, not crust options', () => {
    expect(facts.diameters).toEqual([10, 12, 14, 16]);
    expect(facts.toppings).toEqual(['Pepperoni', 'Mushrooms', 'Green peppers', 'Black olives', 'Extra cheese']);
  });

  it('matches common spellings to the shop\'s own names', () => {
    expect(matchTopping('Bell Peppers', facts.toppings)).toBe('Green peppers');
    expect(matchTopping('olives', facts.toppings)).toBe('Black olives');
    expect(matchTopping('mushroom', facts.toppings)).toBe('Mushrooms');
    expect(matchTopping('Jalapeños', facts.toppings)).toBeNull();
    expect(matchTopping('pep', facts.toppings)).toBeNull();
  });

  it('maps 18in and 20in to the nearest offered size and says so', () => {
    const f = fitLine(rec({ size: { diameter: 18 }, toppings: [{ name: 'Pepperoni' }] }), facts);
    expect(f.spec.diameter).toBe(16);
    expect(f.spec.text).toBe('2 16in pizza with Pepperoni');
    expect(f.notices[0]).toMatch(/no 18" pizza.*16"/);
    expect(fitLine(rec({ size: { diameter: 13 } }), facts).spec.diameter).toBe(14); // tie -> larger
  });

  it('reports toppings the shop does not list, and drops them only when asked', () => {
    const r = rec({ toppings: [{ name: 'Pepperoni' }, { name: 'Jalapeños' }] });
    const asked = fitLine(r, facts);
    expect(asked.unmatched).toEqual(['Jalapeños']);
    const omitted = fitLine(r, facts, { omit: true });
    expect(omitted.spec.toppings).toEqual(['Pepperoni']);
    expect(omitted.spec.text).toBe('2 16in pizza with Pepperoni');
  });

  it('passes toppings through when the menu lists none (resolver decides)', () => {
    const f = fitLine(rec({ toppings: [{ name: 'Jalapeños' }] }), { diameters: [], toppings: [] });
    expect(f.unmatched).toEqual([]);
    expect(f.spec.text).toBe('2 16in pizza with Jalapeños');
  });

  it('fits both halves of a half-and-half', () => {
    const f = fitLine(rec({ isHalfAndHalf: true, leftHalf: { toppings: [{ name: 'Pepperoni' }] }, rightHalf: { toppings: [{ name: 'Bell Peppers' }] } }), facts);
    expect(f.spec.text).toBe('2 16in pizza half Pepperoni half Green peppers');
  });
});
