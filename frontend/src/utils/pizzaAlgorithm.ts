import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize } from '../types';
import { availableToppings, pizzaSizes } from '../contexts/PizzaContext';

// Style-specific serving adjustments
// - Neapolitan: 1 pizza per 1.5 people (personal-sized, wood-fired)
// - Detroit: 2 slices per person (similar to NY-style serving)
// - NY/default: based on surface area (18" feeds 4)

function getServingsForStyle(size: PizzaSize, style: PizzaStyle): number {
  if (style.id === 'neapolitan') {
    // Neapolitan pizzas are personal-sized, 1 pizza per 1.5 people regardless of size
    return 1.5;
  }
  // Detroit and NY use surface-area based servings
  return size.servings;
}

function getMaxGuestsPerPizza(style: PizzaStyle): number {
  if (style.id === 'neapolitan') {
    // Neapolitan is personal-sized, max ~2 people sharing one
    return 2;
  }
  // For Detroit/NY, largest pizza serves ~5 people
  return 5;
}

// Find the optimal pizza size for a given number of guests and style
function getOptimalSize(guestCount: number, style?: PizzaStyle): PizzaSize {
  if (style?.id === 'neapolitan') {
    // Neapolitan typically comes in one size (personal), use smallest
    return pizzaSizes[0];
  }

  // Find the smallest pizza that can serve this many guests
  const size = pizzaSizes.find(s => s.servings >= guestCount);
  // If no size is big enough, use the largest
  return size || pizzaSizes[pizzaSizes.length - 1];
}

// Helper function to find compatible guests based on toppings and dietary restrictions
function findCompatibleGuests(guests: Guest[], style: PizzaStyle): Guest[][] {
  if (guests.length === 0) return [];
  if (guests.length === 1) return [guests];

  const maxPerPizza = getMaxGuestsPerPizza(style);

  // Group guests with similar dietary restrictions first
  const dietaryGroups: Record<string, Guest[]> = {};

  guests.forEach(guest => {
    // Create a key based on dietary restrictions (sorted for consistency)
    const key = [...guest.dietaryRestrictions].sort().join(',') || 'none';
    if (!dietaryGroups[key]) {
      dietaryGroups[key] = [];
    }
    dietaryGroups[key].push(guest);
  });

  // For each dietary group, split by topping preferences if needed
  const result: Guest[][] = [];

  Object.values(dietaryGroups).forEach(groupGuests => {
    if (groupGuests.length <= maxPerPizza) {
      result.push(groupGuests);
    } else {
      // Split larger groups based on topping preferences
      const subgroups = splitByToppingPreferences(groupGuests, maxPerPizza);
      result.push(...subgroups);
    }
  });

  return result;
}

// Helper function to split guests based on topping preferences
function splitByToppingPreferences(guests: Guest[], maxPerPizza: number): Guest[][] {
  if (guests.length <= maxPerPizza) return [guests];

  // Create compatibility matrix
  const compatibilityMatrix: number[][] = [];

  for (let i = 0; i < guests.length; i++) {
    compatibilityMatrix[i] = [];
    for (let j = 0; j < guests.length; j++) {
      if (i === j) {
        compatibilityMatrix[i][j] = 1;
        continue;
      }

      const guestA = guests[i];
      const guestB = guests[j];

      // Calculate compatibility score
      let score = 0;

      // Shared liked toppings (+2 each)
      const sharedLiked = guestA.toppings.filter(topping =>
        guestB.toppings.includes(topping)
      ).length;

      // Conflicts between likes and dislikes (-1 each)
      const conflicts = guestA.toppings.filter(topping =>
        guestB.dislikedToppings.includes(topping)
      ).length + guestB.toppings.filter(topping =>
        guestA.dislikedToppings.includes(topping)
      ).length;

      score = (sharedLiked * 2) - conflicts;
      compatibilityMatrix[i][j] = score;
    }
  }

  // Greedy algorithm to form optimal groups
  const groups: Guest[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < guests.length; i++) {
    if (assigned.has(i)) continue;

    const group: Guest[] = [guests[i]];
    assigned.add(i);

    // Find most compatible guests for this group
    const compatibilityScores: [number, number][] = [];

    for (let j = 0; j < guests.length; j++) {
      if (assigned.has(j)) continue;

      // Calculate total compatibility with all current group members
      const totalScore = group.reduce((sum, _, groupIdx) => {
        const memberIndex = guests.indexOf(group[groupIdx]);
        return sum + compatibilityMatrix[memberIndex][j];
      }, 0);

      compatibilityScores.push([j, totalScore]);
    }

    // Sort by compatibility score (highest first)
    compatibilityScores.sort((a, b) => b[1] - a[1]);

    // Add compatible guests up to max pizza size
    for (const [idx] of compatibilityScores) {
      if (group.length >= maxPerPizza) break;
      group.push(guests[idx]);
      assigned.add(idx);
    }

    groups.push(group);
  }

  return groups;
}

// Dietary restriction topping exclusions
const DIETARY_EXCLUSIONS: Record<string, string[]> = {
  'Vegetarian': ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken'],
  'Vegan': ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'extra-cheese', 'feta'],
  'Dairy-Free': ['extra-cheese', 'feta'],
  'Gluten-Free': [], // Handled at crust level, not toppings
};

// Generate optimal toppings for a group of guests
function generateOptimalToppings(guests: Guest[]): Topping[] {
  // Collect all dietary restrictions from the group
  const allRestrictions = new Set<string>();
  guests.forEach(guest => {
    guest.dietaryRestrictions.forEach(r => allRestrictions.add(r));
  });

  // Get all excluded toppings based on dietary restrictions
  const excludedToppings = new Set<string>();
  allRestrictions.forEach(restriction => {
    const exclusions = DIETARY_EXCLUSIONS[restriction] || [];
    exclusions.forEach(t => excludedToppings.add(t));
  });

  // Collect liked toppings with counts
  const toppingCounts: Record<string, number> = {};

  guests.forEach(guest => {
    guest.toppings.forEach(topping => {
      toppingCounts[topping] = (toppingCounts[topping] || 0) + 1;
    });
  });

  // Remove disliked toppings (if anyone dislikes it, remove it)
  guests.forEach(guest => {
    guest.dislikedToppings.forEach(topping => {
      delete toppingCounts[topping];
    });
  });

  // Remove toppings excluded by dietary restrictions
  excludedToppings.forEach(toppingId => {
    delete toppingCounts[toppingId];
  });

  // Sort toppings by popularity and take top 3
  const sortedToppings = Object.entries(toppingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => availableToppings.find(t => t.id === id))
    .filter((t): t is Topping => t !== undefined);

  // Add cheese if not excluded, no cheese already selected, and we have room (max 3 toppings)
  const cheeseExcluded = excludedToppings.has('extra-cheese');
  if (sortedToppings.length < 3 && !cheeseExcluded && !sortedToppings.some(t => t.category === 'cheese')) {
    const cheeseTopping = availableToppings.find(t => t.id === 'extra-cheese');
    if (cheeseTopping && !guests.every(g => g.dislikedToppings.includes('extra-cheese'))) {
      sortedToppings.push(cheeseTopping);
    }
  }

  return sortedToppings.slice(0, 3);
}

// Default pizza types for non-respondents
interface DefaultPizzaType {
  label: string;
  toppingIds: string[];
  dietaryRestrictions: string[];
}

const DEFAULT_PIZZA_TYPES: DefaultPizzaType[] = [
  { label: 'Cheese', toppingIds: ['extra-cheese'], dietaryRestrictions: [] },
  { label: 'Pepperoni', toppingIds: ['pepperoni', 'extra-cheese'], dietaryRestrictions: [] },
  { label: 'Mushroom', toppingIds: ['mushrooms', 'extra-cheese'], dietaryRestrictions: ['Vegetarian'] },
  { label: 'Veggie', toppingIds: ['mushrooms', 'bell-peppers', 'onions'], dietaryRestrictions: ['Vegetarian'] },
  { label: 'Vegan', toppingIds: ['mushrooms', 'bell-peppers', 'onions'], dietaryRestrictions: ['Vegan'] },
  { label: 'Gluten-Free Cheese', toppingIds: ['extra-cheese'], dietaryRestrictions: ['Gluten-Free'] },
];

// Generate default pizza distribution for non-respondents
function generateDefaultPizzas(nonRespondents: number, style: PizzaStyle): PizzaRecommendation[] {
  if (nonRespondents <= 0) return [];

  const maxPerPizza = getMaxGuestsPerPizza(style);

  // For Neapolitan, each pizza serves 1.5 people
  // For others, use the largest size servings (~4-5 people)
  const servingsPerPizza = style.id === 'neapolitan' ? 1.5 : maxPerPizza;
  const pizzasNeeded = Math.ceil(nonRespondents / servingsPerPizza);
  const defaultPizzas: PizzaRecommendation[] = [];

  // Calculate special dietary needs: 1 SERVING per 10 guests (not 1 pizza)
  // A serving is roughly 1 person's worth, so divide by servingsPerPizza to get pizzas
  const veganServings = Math.ceil(nonRespondents / 10); // 1 serving per 10 guests
  const glutenFreeServings = Math.ceil(nonRespondents / 10);
  const veganPizzas = Math.max(0, Math.ceil(veganServings / servingsPerPizza));
  const glutenFreePizzas = Math.max(0, Math.ceil(glutenFreeServings / servingsPerPizza));

  // Remaining pizzas split between cheese, pepperoni, mushroom, veggie
  const specialPizzas = veganPizzas + glutenFreePizzas;
  const regularPizzas = Math.max(0, pizzasNeeded - specialPizzas);

  // Distribution: ~40% cheese, ~40% pepperoni, ~10% mushroom, ~10% veggie
  const cheesePizzas = Math.ceil(regularPizzas * 0.4);
  const pepperoniPizzas = Math.ceil(regularPizzas * 0.4);
  const mushroomPizzas = Math.ceil(regularPizzas * 0.1);
  const veggiePizzas = Math.max(0, regularPizzas - cheesePizzas - pepperoniPizzas - mushroomPizzas);

  const distribution = [
    { type: DEFAULT_PIZZA_TYPES[0], count: cheesePizzas },      // Cheese
    { type: DEFAULT_PIZZA_TYPES[1], count: pepperoniPizzas },   // Pepperoni
    { type: DEFAULT_PIZZA_TYPES[2], count: mushroomPizzas },    // Mushroom
    { type: DEFAULT_PIZZA_TYPES[3], count: veggiePizzas },      // Veggie
    { type: DEFAULT_PIZZA_TYPES[4], count: veganPizzas },       // Vegan
    { type: DEFAULT_PIZZA_TYPES[5], count: glutenFreePizzas },  // Gluten-Free
  ];

  let guestsAssigned = 0;

  for (const { type, count } of distribution) {
    if (count <= 0) continue;

    const toppings = type.toppingIds
      .map(id => availableToppings.find(t => t.id === id))
      .filter((t): t is typeof availableToppings[0] => t !== undefined);

    // Calculate guests per pizza for this type
    const guestsForType = Math.min(
      count * servingsPerPizza,
      nonRespondents - guestsAssigned
    );
    const guestsPerPizza = Math.ceil(guestsForType / count);

    defaultPizzas.push({
      id: `default-${type.label.toLowerCase().replace(/\s+/g, '-')}`,
      toppings,
      guestCount: Math.round(guestsPerPizza * count),
      guests: [],
      dietaryRestrictions: type.dietaryRestrictions,
      size: getOptimalSize(guestsPerPizza, style),
      style,
      isForNonRespondents: true,
      quantity: count,
      label: type.label,
    });

    guestsAssigned += guestsForType;
  }

  return defaultPizzas.filter(p => p.quantity && p.quantity > 0);
}

// Group identical pizzas together
function groupIdenticalPizzas(pizzas: PizzaRecommendation[]): PizzaRecommendation[] {
  const grouped: PizzaRecommendation[] = [];
  const seen = new Map<string, number>(); // key -> index in grouped

  for (const pizza of pizzas) {
    // Skip already-grouped default pizzas
    if (pizza.isForNonRespondents && pizza.quantity) {
      grouped.push(pizza);
      continue;
    }

    // Create a key based on toppings and dietary restrictions
    const toppingKey = pizza.toppings.map(t => t.id).sort().join(',');
    const dietaryKey = pizza.dietaryRestrictions.sort().join(',');
    const sizeKey = pizza.size.diameter;
    const key = `${toppingKey}|${dietaryKey}|${sizeKey}`;

    if (seen.has(key)) {
      // Merge with existing
      const existingIdx = seen.get(key)!;
      const existing = grouped[existingIdx];
      existing.quantity = (existing.quantity || 1) + 1;
      existing.guestCount += pizza.guestCount;
      existing.guests = [...existing.guests, ...pizza.guests];
    } else {
      // Add new
      seen.set(key, grouped.length);
      grouped.push({ ...pizza, quantity: 1 });
    }
  }

  return grouped;
}

// Main function to generate pizza recommendations
export function generatePizzaRecommendations(guests: Guest[], style: PizzaStyle, expectedGuestCount?: number | null): PizzaRecommendation[] {
  const guestGroups = findCompatibleGuests(guests, style);

  const recommendations = guestGroups.map((groupGuests, index) => {
    // Get all dietary restrictions from the group
    const allDietaryRestrictions = Array.from(
      new Set(groupGuests.flatMap(guest => guest.dietaryRestrictions))
    ).filter(r => r !== 'None');

    const optimalToppings = generateOptimalToppings(groupGuests).slice(0, 3);
    const optimalSize = getOptimalSize(groupGuests.length, style);

    return {
      id: `pizza-${index + 1}`,
      toppings: optimalToppings.slice(0, 3), // Enforce max 3 toppings
      guestCount: groupGuests.length,
      guests: groupGuests,
      dietaryRestrictions: allDietaryRestrictions,
      size: optimalSize,
      style: style,
    };
  });

  // Group identical custom pizzas
  const groupedRecommendations = groupIdenticalPizzas(recommendations);

  // Add default pizzas for guests who didn't RSVP
  if (expectedGuestCount && expectedGuestCount > guests.length) {
    const nonRespondents = expectedGuestCount - guests.length;
    const defaultPizzas = generateDefaultPizzas(nonRespondents, style);
    groupedRecommendations.push(...defaultPizzas);
  }

  // Reassign IDs
  return groupedRecommendations.map((pizza, index) => ({
    ...pizza,
    id: `pizza-${index + 1}`,
  }));
}
