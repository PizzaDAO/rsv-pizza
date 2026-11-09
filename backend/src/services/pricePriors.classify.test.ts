import { describe, expect, it } from 'vitest';
import { classifyPizzaName, PLAIN, SPECIALTY } from './pricePriors.classify.js';

describe('classifyPizzaName (plain = 0, specialty = 2)', () => {
  const plain = [
    'Margherita 30cm',
    'Cheese Pizza',
    'Large Cheese',
    'Plain',
    'P. Muzzarella',
    'Pizza Marinara',
    'Mussarela',
    'Margherita (Large)',
    'Pizza de Queso Grande',
    'Pizza Margherita Napoletana',
    '14" Cheese',
    'Extra Large Cheese Pizza',
    'Formaggio',
    'MARGHERITA',
    'Margarita familiar',
  ];
  const specialty = [
    'Margherita con prosciutto',
    'Signature Pizza 11" - Margherita',
    '3 Cheese Pizza (12 Inch)',
    'Quattro Formaggi',
    'Large Pan Pizza - Deluxe Cheese',
    '5 Pepperoni LG',
    'Omnivore LG',
    'Queen Margherita (10" Inch)',
    '1/1 Calabresa com Mussarela',
    'Pesto & Basil Veg Pizza (Large Serves 4, 33 cm)',
    'Pizza Large',
    'X Large New York',
    'P. Fugazzeta',
    'Extra cheese',
    'Half mushroom / half plain',
    'Պիցցա',
    '',
  ];
  for (const n of plain) it(`plain: ${n}`, () => expect(classifyPizzaName(n)).toBe(PLAIN));
  for (const n of specialty) it(`specialty: ${JSON.stringify(n)}`, () => expect(classifyPizzaName(n)).toBe(SPECIALTY));
  it('null is specialty', () => expect(classifyPizzaName(null)).toBe(SPECIALTY));
});
