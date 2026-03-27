import { describe, it, expect } from 'vitest';
import { generateBeverageRecommendations } from './beverageAlgorithm';
import { Guest, Beverage } from '../types';
import { DRINK_CATEGORIES } from '../constants/options';

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: `guest-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Guest',
    dietaryRestrictions: [],
    toppings: [],
    dislikedToppings: [],
    likedBeverages: [],
    dislikedBeverages: [],
    ...overrides,
  };
}

const ALL_BEVERAGE_IDS = DRINK_CATEGORIES.map(b => b.id);
const WATER_BEVERAGE = DRINK_CATEGORIES.find(b => b.id === 'water')!;
const SODA_BEVERAGE = DRINK_CATEGORIES.find(b => b.id === 'soda')!;
const BEER_BEVERAGE = DRINK_CATEGORIES.find(b => b.id === 'beer')!;

describe('generateBeverageRecommendations', () => {
  it('returns empty array when no beverages are selected by host', () => {
    const guests = [makeGuest({ likedBeverages: ['water'] })];
    const result = generateBeverageRecommendations(guests, [], DRINK_CATEGORIES);
    expect(result).toEqual([]);
  });

  it('calculates quantity as 2x liked count with minimum 4', () => {
    const guests = [
      makeGuest({ likedBeverages: ['soda'] }),
    ];
    const result = generateBeverageRecommendations(guests, ['soda'], DRINK_CATEGORIES);

    const sodaRec = result.find(r => r.beverage.id === 'soda');
    expect(sodaRec).toBeDefined();
    // 1 like * 2 = 2, but minimum is 4
    expect(sodaRec!.quantity).toBe(4);
  });

  it('scales quantity with number of likes', () => {
    const guests = [
      makeGuest({ likedBeverages: ['soda'] }),
      makeGuest({ likedBeverages: ['soda'] }),
      makeGuest({ likedBeverages: ['soda'] }),
      makeGuest({ likedBeverages: ['soda'] }),
      makeGuest({ likedBeverages: ['soda'] }),
    ];
    const result = generateBeverageRecommendations(guests, ['soda'], DRINK_CATEGORIES);

    const sodaRec = result.find(r => r.beverage.id === 'soda');
    expect(sodaRec).toBeDefined();
    // 5 likes * 2 = 10
    expect(sodaRec!.quantity).toBe(10);
  });

  it('skips beverages with no likes (net preference <= 0)', () => {
    const guests = [
      makeGuest({ dislikedBeverages: ['soda'] }),
    ];
    const result = generateBeverageRecommendations(guests, ['soda'], DRINK_CATEGORIES);

    const sodaRec = result.find(r => r.beverage.id === 'soda');
    expect(sodaRec).toBeUndefined();
  });

  it('provides water minimum based on total guests', () => {
    const guests = [
      makeGuest({ likedBeverages: [] }),
      makeGuest({ likedBeverages: [] }),
      makeGuest({ likedBeverages: [] }),
      makeGuest({ likedBeverages: [] }),
    ];
    const result = generateBeverageRecommendations(guests, ['water'], DRINK_CATEGORIES);

    const waterRec = result.find(r => r.beverage.id === 'water');
    expect(waterRec).toBeDefined();
    // Water: 1 per 2 people = ceil(4/2) = 2, plus 0 likes
    expect(waterRec!.quantity).toBeGreaterThanOrEqual(2);
  });

  it('water quantity increases with likes', () => {
    const guests = [
      makeGuest({ likedBeverages: ['water'] }),
      makeGuest({ likedBeverages: ['water'] }),
      makeGuest({ likedBeverages: [] }),
      makeGuest({ likedBeverages: [] }),
    ];
    const result = generateBeverageRecommendations(guests, ['water'], DRINK_CATEGORIES);

    const waterRec = result.find(r => r.beverage.id === 'water');
    expect(waterRec).toBeDefined();
    // Water: ceil(4/2) + 2*2 = 2 + 4 = 6
    expect(waterRec!.quantity).toBe(6);
  });

  it('generates default beverages for non-respondents', () => {
    const guests = [
      makeGuest({ likedBeverages: ['soda'] }),
    ];
    const result = generateBeverageRecommendations(
      guests, ['soda', 'water'], DRINK_CATEGORIES, 20
    );

    // Should have extra quantities for the 19 non-respondents
    const totalQuantity = result.reduce((sum, r) => sum + r.quantity, 0);
    expect(totalQuantity).toBeGreaterThan(4); // More than just the 1 liked soda's minimum
  });

  it('sorts results by quantity descending', () => {
    const guests = [
      makeGuest({ likedBeverages: ['water', 'soda'] }),
      makeGuest({ likedBeverages: ['water'] }),
      makeGuest({ likedBeverages: ['water'] }),
    ];
    const result = generateBeverageRecommendations(
      guests, ['water', 'soda'], DRINK_CATEGORIES
    );

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].quantity).toBeGreaterThanOrEqual(result[i].quantity);
    }
  });

  it('handles guests with both likes and dislikes for same beverage category', () => {
    const guests = [
      makeGuest({ likedBeverages: ['beer'] }),
      makeGuest({ likedBeverages: ['beer'] }),
      makeGuest({ dislikedBeverages: ['beer'] }),
    ];
    const result = generateBeverageRecommendations(
      guests, ['beer'], DRINK_CATEGORIES
    );

    const beerRec = result.find(r => r.beverage.id === 'beer');
    // 2 likes - 1 dislike = 1 net, but we use likes * 2 = 4 (minimum)
    // Actually the algorithm uses likes * BEVERAGES_PER_PERSON if > 0
    expect(beerRec).toBeDefined();
    expect(beerRec!.quantity).toBeGreaterThanOrEqual(4);
  });

  it('all recommendations have required fields', () => {
    const guests = [
      makeGuest({ likedBeverages: ['water', 'soda'] }),
    ];
    const result = generateBeverageRecommendations(
      guests, ALL_BEVERAGE_IDS, DRINK_CATEGORIES
    );

    result.forEach(rec => {
      expect(rec.id).toBeDefined();
      expect(rec.beverage).toBeDefined();
      expect(rec.beverage.id).toBeDefined();
      expect(rec.beverage.name).toBeDefined();
      expect(rec.quantity).toBeGreaterThan(0);
      expect(rec.guestCount).toBeDefined();
    });
  });
});
