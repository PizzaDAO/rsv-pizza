import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize, PizzaHalf } from '../types';
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
  'Vegetarian': ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'anchovies'],
  'Vegan': ['pepperoni', 'sausage', 'bacon', 'ham', 'chicken', 'anchovies', 'extra-cheese'],
  'Dairy-Free': ['extra-cheese'],
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

  return sortedToppings;
}

// Calculate satisfaction score for a group with given toppings
// Score = sum of (liked toppings present) - (disliked toppings present * 2)
function calculateGroupSatisfaction(guests: Guest[], toppings: Topping[]): number {
  const toppingIds = new Set(toppings.map(t => t.id));
  let score = 0;

  for (const guest of guests) {
    // +1 for each liked topping present
    for (const liked of guest.toppings) {
      if (toppingIds.has(liked)) {
        score += 1;
      }
    }
    // -2 for each disliked topping present (heavier penalty)
    for (const disliked of guest.dislikedToppings) {
      if (toppingIds.has(disliked)) {
        score -= 2;
      }
    }
  }

  return score;
}

// Check if a group has significant topping conflicts that would benefit from half-and-half
function hasSignificantConflicts(guests: Guest[]): boolean {
  if (guests.length < 2) return false;

  // Count how many guests like vs dislike each topping
  const toppingStats: Record<string, { likes: number; dislikes: number }> = {};

  for (const guest of guests) {
    for (const liked of guest.toppings) {
      if (!toppingStats[liked]) toppingStats[liked] = { likes: 0, dislikes: 0 };
      toppingStats[liked].likes++;
    }
    for (const disliked of guest.dislikedToppings) {
      if (!toppingStats[disliked]) toppingStats[disliked] = { likes: 0, dislikes: 0 };
      toppingStats[disliked].dislikes++;
    }
  }

  // Check for significant conflicts: toppings that some guests like but others dislike
  let conflictScore = 0;
  for (const topping of Object.keys(toppingStats)) {
    const { likes, dislikes } = toppingStats[topping];
    if (likes > 0 && dislikes > 0) {
      // Conflict exists - weight by how many people are affected
      conflictScore += Math.min(likes, dislikes);
    }
  }

  // If conflict score is significant relative to group size, half-and-half may help
  return conflictScore >= Math.ceil(guests.length / 2);
}

// Split guests into two groups that minimize internal conflicts
function splitIntoTwoGroups(guests: Guest[]): [Guest[], Guest[]] {
  if (guests.length <= 1) return [guests, []];
  if (guests.length === 2) return [[guests[0]], [guests[1]]];

  // Calculate compatibility between all pairs
  const n = guests.length;
  const compatibility: number[][] = [];

  for (let i = 0; i < n; i++) {
    compatibility[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        compatibility[i][j] = 0;
        continue;
      }
      const guestA = guests[i];
      const guestB = guests[j];

      // Shared likes
      const sharedLikes = guestA.toppings.filter(t => guestB.toppings.includes(t)).length;
      // Conflicts (A likes what B dislikes or vice versa)
      const conflictsAB = guestA.toppings.filter(t => guestB.dislikedToppings.includes(t)).length;
      const conflictsBA = guestB.toppings.filter(t => guestA.dislikedToppings.includes(t)).length;

      compatibility[i][j] = (sharedLikes * 2) - conflictsAB - conflictsBA;
    }
  }

  // Greedy: start with the two least compatible guests in separate groups
  let minCompat = Infinity;
  let minI = 0, minJ = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (compatibility[i][j] < minCompat) {
        minCompat = compatibility[i][j];
        minI = i;
        minJ = j;
      }
    }
  }

  const group1: Guest[] = [guests[minI]];
  const group2: Guest[] = [guests[minJ]];
  const assigned = new Set([minI, minJ]);

  // Assign remaining guests to the group they're most compatible with
  for (let k = 0; k < n; k++) {
    if (assigned.has(k)) continue;

    // Calculate average compatibility with each group
    const avgCompat1 = group1.reduce((sum, g) => sum + compatibility[k][guests.indexOf(g)], 0) / group1.length;
    const avgCompat2 = group2.reduce((sum, g) => sum + compatibility[k][guests.indexOf(g)], 0) / group2.length;

    if (avgCompat1 >= avgCompat2) {
      group1.push(guests[k]);
    } else {
      group2.push(guests[k]);
    }
    assigned.add(k);
  }

  return [group1, group2];
}

// Determine if half-and-half would improve satisfaction for a group
function shouldUseHalfAndHalf(guests: Guest[], style: PizzaStyle): boolean {
  // Don't use half-and-half for very small groups or non-respondent pizzas
  if (guests.length < 2) return false;

  // Check if there are significant conflicts
  if (!hasSignificantConflicts(guests)) return false;

  // Calculate current satisfaction with optimal single-pizza toppings
  const singlePizzaToppings = generateOptimalToppings(guests);
  const singleSatisfaction = calculateGroupSatisfaction(guests, singlePizzaToppings);

  // Calculate satisfaction with half-and-half
  const [group1, group2] = splitIntoTwoGroups(guests);
  if (group1.length === 0 || group2.length === 0) return false;

  const toppings1 = generateOptimalToppings(group1);
  const toppings2 = generateOptimalToppings(group2);

  const halfSatisfaction = calculateGroupSatisfaction(group1, toppings1) +
                           calculateGroupSatisfaction(group2, toppings2);

  // Use half-and-half if it provides at least 20% improvement
  // or if single pizza has negative satisfaction (people actively dislike it)
  return halfSatisfaction > singleSatisfaction * 1.2 || singleSatisfaction < 0;
}

// Create a half-and-half pizza recommendation
function createHalfAndHalfPizza(
  guests: Guest[],
  style: PizzaStyle,
  id: string
): PizzaRecommendation {
  const [group1, group2] = splitIntoTwoGroups(guests);

  const toppings1 = generateOptimalToppings(group1);
  const toppings2 = generateOptimalToppings(group2);

  const dietary1 = Array.from(new Set(group1.flatMap(g => g.dietaryRestrictions))).filter(r => r !== 'None');
  const dietary2 = Array.from(new Set(group2.flatMap(g => g.dietaryRestrictions))).filter(r => r !== 'None');
  const allDietary = Array.from(new Set([...dietary1, ...dietary2]));

  const leftHalf: PizzaHalf = {
    toppings: toppings1,
    guests: group1,
    dietaryRestrictions: dietary1,
  };

  const rightHalf: PizzaHalf = {
    toppings: toppings2,
    guests: group2,
    dietaryRestrictions: dietary2,
  };

  // Combine toppings for backward compatibility (unique toppings from both halves)
  const allToppings = [...toppings1];
  for (const t of toppings2) {
    if (!allToppings.find(existing => existing.id === t.id)) {
      allToppings.push(t);
    }
  }

  return {
    id,
    toppings: allToppings,
    guestCount: guests.length,
    guests: guests,
    dietaryRestrictions: allDietary,
    size: getOptimalSize(guests.length, style),
    style: style,
    isHalfAndHalf: true,
    leftHalf,
    rightHalf,
  };
}

// Default pizza types for non-respondents
interface DefaultPizzaType {
  label: string;
  toppingIds: string[];
  dietaryRestrictions: string[];
}

const DEFAULT_PIZZA_TYPES: DefaultPizzaType[] = [
  { label: 'Cheese', toppingIds: [], dietaryRestrictions: ['Vegetarian'] },
  { label: 'Pepperoni', toppingIds: ['pepperoni'], dietaryRestrictions: [] },
  { label: 'Mushroom', toppingIds: ['mushrooms'], dietaryRestrictions: ['Vegetarian'] },
  { label: 'Veggie', toppingIds: ['mushrooms', 'bell-peppers', 'onions'], dietaryRestrictions: ['Vegetarian'] },
  { label: 'Vegan', toppingIds: ['mushrooms', 'bell-peppers', 'onions'], dietaryRestrictions: ['Vegan'] },
  { label: 'Gluten-Free Cheese', toppingIds: [], dietaryRestrictions: ['Gluten-Free'] },
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
    // Skip already-grouped default pizzas and half-and-half pizzas
    if ((pizza.isForNonRespondents && pizza.quantity) || pizza.isHalfAndHalf) {
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

// Filter guest topping preferences to only include allowed toppings
function filterGuestToppings(guests: Guest[], allowedToppingIds: string[] | null): Guest[] {
  if (!allowedToppingIds || allowedToppingIds.length === 0) {
    return guests; // No filtering if no allowed toppings specified
  }

  const allowedSet = new Set(allowedToppingIds);

  return guests.map(guest => ({
    ...guest,
    toppings: guest.toppings.filter(t => allowedSet.has(t)),
    dislikedToppings: guest.dislikedToppings.filter(t => allowedSet.has(t)),
  }));
}

// Main function to generate pizza recommendations
export function generatePizzaRecommendations(
  guests: Guest[],
  style: PizzaStyle,
  expectedGuestCount?: number | null,
  allowedToppingIds?: string[] | null
): PizzaRecommendation[] {
  // Filter guest preferences to only include allowed toppings
  const filteredGuests = filterGuestToppings(guests, allowedToppingIds || null);

  const guestGroups = findCompatibleGuests(filteredGuests, style);

  const recommendations = guestGroups.map((groupGuests, index) => {
    // Check if this group would benefit from half-and-half
    if (shouldUseHalfAndHalf(groupGuests, style)) {
      return createHalfAndHalfPizza(groupGuests, style, `pizza-${index + 1}`);
    }

    // Get all dietary restrictions from the group
    const allDietaryRestrictions = Array.from(
      new Set(groupGuests.flatMap(guest => guest.dietaryRestrictions))
    ).filter(r => r !== 'None');

    const optimalToppings = generateOptimalToppings(groupGuests);
    const optimalSize = getOptimalSize(groupGuests.length, style);

    return {
      id: `pizza-${index + 1}`,
      toppings: optimalToppings,
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
