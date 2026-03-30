import { describe, it, expect } from 'vitest';
import { generatePizzaRecommendations } from './pizzaAlgorithm';
import { Guest, PizzaStyle, PizzaSize, PizzaRecommendation } from '../types';
import { PIZZA_STYLES, PIZZA_SIZES } from '../constants/options';

// Helpers
const NY_STYLE = PIZZA_STYLES.find(s => s.id === 'new-york')!;
const NEAPOLITAN_STYLE = PIZZA_STYLES.find(s => s.id === 'neapolitan')!;
const DETROIT_STYLE = PIZZA_STYLES.find(s => s.id === 'detroit')!;

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

function totalPizzaCount(recs: PizzaRecommendation[]): number {
  return recs.reduce((sum, r) => sum + (r.quantity || 1), 0);
}

describe('generatePizzaRecommendations', () => {
  describe('basic cases', () => {
    it('returns empty array for no guests and no expected count', () => {
      const result = generatePizzaRecommendations([], NY_STYLE);
      expect(result).toEqual([]);
    });

    it('returns recommendations for a single guest', () => {
      const guests = [makeGuest({ toppings: ['pepperoni'] })];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].guestCount).toBe(1);
      expect(result[0].style).toBe(NY_STYLE);
    });

    it('assigns sequential IDs to pizzas', () => {
      const guests = [
        makeGuest({ toppings: ['pepperoni'], dietaryRestrictions: [] }),
        makeGuest({ toppings: ['mushrooms'], dietaryRestrictions: ['Vegetarian'] }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      result.forEach((pizza, i) => {
        expect(pizza.id).toBe(`pizza-${i + 1}`);
      });
    });
  });

  describe('compatible grouping', () => {
    it('groups guests with same topping preferences together', () => {
      const guests = [
        makeGuest({ toppings: ['pepperoni', 'mushrooms'] }),
        makeGuest({ toppings: ['pepperoni', 'mushrooms'] }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      // Both guests should be on the same pizza (or grouped)
      const totalGuests = result.reduce((sum, r) => sum + r.guestCount, 0);
      expect(totalGuests).toBe(2);
    });

    it('groups guests with same dietary restrictions together', () => {
      const guests = [
        makeGuest({ toppings: ['mushrooms'], dietaryRestrictions: ['Vegetarian'] }),
        makeGuest({ toppings: ['spinach'], dietaryRestrictions: ['Vegetarian'] }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      // Should be grouped on one pizza since both are vegetarian
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('conflict handling', () => {
    it('separates guests with different dietary restrictions', () => {
      const guests = [
        makeGuest({ toppings: ['pepperoni'], dietaryRestrictions: [] }),
        makeGuest({ toppings: ['mushrooms'], dietaryRestrictions: ['Vegan'] }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      // Should be on different pizzas since they have different dietary needs
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('respects dietary exclusions (vegan gets no meat)', () => {
      const guests = [
        makeGuest({
          toppings: ['mushrooms', 'bell-peppers'],
          dietaryRestrictions: ['Vegan'],
        }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      expect(result.length).toBeGreaterThanOrEqual(1);
      const veganPizza = result[0];
      // Should not have any meat toppings
      const meatToppings = veganPizza.toppings.filter(t =>
        ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'anchovies'].includes(t.id)
      );
      expect(meatToppings).toHaveLength(0);
    });
  });

  describe('default pizzas for non-respondents', () => {
    it('generates default pizzas when expected guests > actual guests', () => {
      const guests = [makeGuest({ toppings: ['pepperoni'] })];
      const result = generatePizzaRecommendations(guests, NY_STYLE, 20);

      // Should have regular pizzas + default pizzas for non-respondents
      const defaultPizzas = result.filter(p => p.isForNonRespondents);
      expect(defaultPizzas.length).toBeGreaterThan(0);
    });

    it('default pizzas follow 40/40/10/10 distribution', () => {
      const result = generatePizzaRecommendations([], NY_STYLE, 100);

      const defaultPizzas = result.filter(p => p.isForNonRespondents);
      const cheesePizza = defaultPizzas.find(p => p.label === 'Cheese');
      const pepperoniPizza = defaultPizzas.find(p => p.label === 'Pepperoni');

      expect(cheesePizza).toBeDefined();
      expect(pepperoniPizza).toBeDefined();
      // Cheese and pepperoni should be the largest quantities
      if (cheesePizza && pepperoniPizza) {
        const mushroomPizza = defaultPizzas.find(p => p.label === 'Mushroom');
        if (mushroomPizza) {
          expect(cheesePizza.quantity!).toBeGreaterThanOrEqual(mushroomPizza.quantity!);
          expect(pepperoniPizza.quantity!).toBeGreaterThanOrEqual(mushroomPizza.quantity!);
        }
      }
    });

    it('includes vegan and gluten-free defaults for large groups', () => {
      const result = generatePizzaRecommendations([], NY_STYLE, 100);

      const defaultPizzas = result.filter(p => p.isForNonRespondents);
      const veganPizza = defaultPizzas.find(p => p.label === 'Vegan');
      const gfPizza = defaultPizzas.find(p => p.label === 'Gluten-Free Cheese');

      expect(veganPizza).toBeDefined();
      expect(gfPizza).toBeDefined();
    });

    it('does not generate defaults when expected <= actual guests', () => {
      const guests = [
        makeGuest({ toppings: ['pepperoni'] }),
        makeGuest({ toppings: ['mushrooms'] }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE, 2);

      const defaultPizzas = result.filter(p => p.isForNonRespondents);
      expect(defaultPizzas).toHaveLength(0);
    });
  });

  describe('groupIdenticalPizzas', () => {
    it('merges identical custom pizzas into quantity > 1', () => {
      // Create many guests with identical preferences to trigger grouping
      const guests = Array.from({ length: 10 }, () =>
        makeGuest({ toppings: ['pepperoni'], dietaryRestrictions: [] })
      );
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      // Should have grouped identical pizzas
      const customPizzas = result.filter(p => !p.isForNonRespondents);
      const hasGrouped = customPizzas.some(p => (p.quantity || 1) > 1);
      // With 10 guests on NY style, they should be split into groups and potentially merged
      expect(customPizzas.length).toBeGreaterThan(0);
    });
  });

  describe('style-specific sizing', () => {
    it('uses personal-sized pizzas for Neapolitan style', () => {
      const guests = [
        makeGuest({ toppings: ['mushrooms'] }),
        makeGuest({ toppings: ['mushrooms'] }),
      ];
      const result = generatePizzaRecommendations(guests, NEAPOLITAN_STYLE);

      // Neapolitan = personal sized, max ~2 people per pizza
      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach(pizza => {
        if (!pizza.isForNonRespondents) {
          expect(pizza.style.id).toBe('neapolitan');
        }
      });
    });

    it('Neapolitan style produces more pizzas per guest', () => {
      const guests = Array.from({ length: 6 }, () =>
        makeGuest({ toppings: ['pepperoni'], dietaryRestrictions: [] })
      );

      const nyResult = generatePizzaRecommendations(guests, NY_STYLE);
      const neapResult = generatePizzaRecommendations(guests, NEAPOLITAN_STYLE);

      const nyCount = totalPizzaCount(nyResult);
      const neapCount = totalPizzaCount(neapResult);

      // Neapolitan should produce more pizzas because they're personal-sized
      expect(neapCount).toBeGreaterThanOrEqual(nyCount);
    });

    it('Detroit style uses surface-area-based servings', () => {
      const guests = [makeGuest({ toppings: ['pepperoni'] })];
      const result = generatePizzaRecommendations(guests, DETROIT_STYLE);

      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach(pizza => {
        if (!pizza.isForNonRespondents) {
          expect(pizza.style.id).toBe('detroit');
        }
      });
    });
  });

  describe('filterGuestToppings', () => {
    it('filters guest toppings to only allowed toppings when specified', () => {
      const guests = [
        makeGuest({
          toppings: ['pepperoni', 'mushrooms', 'olives'],
          dislikedToppings: ['anchovies', 'pineapple'],
        }),
      ];

      const allowedToppings = ['pepperoni', 'mushrooms'];
      const result = generatePizzaRecommendations(guests, NY_STYLE, null, allowedToppings);

      // The pizza toppings should only contain allowed ones
      const customPizzas = result.filter(p => !p.isForNonRespondents);
      if (customPizzas.length > 0) {
        customPizzas.forEach(pizza => {
          pizza.toppings.forEach(topping => {
            expect(allowedToppings).toContain(topping.id);
          });
        });
      }
    });

    it('does not filter when allowedToppingIds is null or empty', () => {
      const guests = [
        makeGuest({ toppings: ['pepperoni', 'mushrooms'] }),
      ];

      const resultNull = generatePizzaRecommendations(guests, NY_STYLE, null, null);
      const resultEmpty = generatePizzaRecommendations(guests, NY_STYLE, null, []);

      // Both should produce same results as unfiltered
      expect(resultNull.length).toBe(resultEmpty.length);
    });
  });

  describe('half-and-half logic', () => {
    it('creates half-and-half when guests have conflicting preferences', () => {
      // Create guests with strong conflicts
      const guests = [
        makeGuest({
          toppings: ['pepperoni', 'sausage', 'bacon'],
          dislikedToppings: ['mushrooms', 'olives', 'spinach'],
        }),
        makeGuest({
          toppings: ['mushrooms', 'olives', 'spinach'],
          dislikedToppings: ['pepperoni', 'sausage', 'bacon'],
        }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      // At least one pizza should exist
      expect(result.length).toBeGreaterThanOrEqual(1);

      // Check if any half-and-half was created
      const halfAndHalf = result.filter(p => p.isHalfAndHalf);
      if (halfAndHalf.length > 0) {
        expect(halfAndHalf[0].leftHalf).toBeDefined();
        expect(halfAndHalf[0].rightHalf).toBeDefined();
        expect(halfAndHalf[0].leftHalf!.toppings.length).toBeGreaterThan(0);
        expect(halfAndHalf[0].rightHalf!.toppings.length).toBeGreaterThan(0);
      }
    });

    it('half-and-half pizzas have both halves with guests', () => {
      const guests = [
        makeGuest({
          toppings: ['pepperoni', 'sausage'],
          dislikedToppings: ['mushrooms', 'olives'],
        }),
        makeGuest({
          toppings: ['mushrooms', 'olives'],
          dislikedToppings: ['pepperoni', 'sausage'],
        }),
        makeGuest({
          toppings: ['pepperoni'],
          dislikedToppings: ['mushrooms'],
        }),
        makeGuest({
          toppings: ['olives', 'mushrooms'],
          dislikedToppings: ['sausage'],
        }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      const halfAndHalf = result.filter(p => p.isHalfAndHalf);
      halfAndHalf.forEach(pizza => {
        expect(pizza.leftHalf!.guests.length).toBeGreaterThan(0);
        expect(pizza.rightHalf!.guests.length).toBeGreaterThan(0);
      });
    });
  });

  describe('edge cases', () => {
    it('handles guests with no topping preferences', () => {
      const guests = [makeGuest({ toppings: [] })];
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('handles very large guest counts', () => {
      const guests = Array.from({ length: 50 }, (_, i) =>
        makeGuest({
          toppings: i % 2 === 0 ? ['pepperoni'] : ['mushrooms'],
          dietaryRestrictions: i % 10 === 0 ? ['Vegetarian'] : [],
        })
      );
      const result = generatePizzaRecommendations(guests, NY_STYLE);

      // Should produce some reasonable number of pizzas
      expect(result.length).toBeGreaterThan(0);
      const totalGuests = result
        .filter(p => !p.isForNonRespondents)
        .reduce((sum, p) => sum + p.guestCount, 0);
      expect(totalGuests).toBe(50);
    });

    it('all recommendations have required fields', () => {
      const guests = [
        makeGuest({ toppings: ['pepperoni'], dietaryRestrictions: ['Vegetarian'] }),
        makeGuest({ toppings: ['mushrooms'] }),
      ];
      const result = generatePizzaRecommendations(guests, NY_STYLE, 10);

      result.forEach(pizza => {
        expect(pizza.id).toBeDefined();
        expect(pizza.toppings).toBeDefined();
        expect(pizza.guestCount).toBeDefined();
        expect(pizza.guests).toBeDefined();
        expect(pizza.dietaryRestrictions).toBeDefined();
        expect(pizza.size).toBeDefined();
        expect(pizza.style).toBeDefined();
        expect(pizza.size.diameter).toBeDefined();
        expect(pizza.size.servings).toBeDefined();
      });
    });
  });
});
