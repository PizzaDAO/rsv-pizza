import { Guest, BeverageRecommendation, Beverage } from '../types';

// Constants
const BEVERAGES_PER_PERSON = 2; // Average beverages per guest

/**
 * Generate beverage recommendations based on guest preferences
 *
 * Algorithm:
 * 1. Count guest preferences for each available beverage
 * 2. Calculate quantity based on: (likes - dislikes) * BEVERAGES_PER_PERSON
 * 3. Ensure minimum quantity if any guests like it
 * 4. Add default beverages for non-respondents
 */
export function generateBeverageRecommendations(
  guests: Guest[],
  availableBeverageIds: string[],
  allBeverages: Beverage[],
  expectedGuestCount?: number | null
): BeverageRecommendation[] {
  if (availableBeverageIds.length === 0) {
    return []; // No beverages selected by host
  }

  const recommendations: BeverageRecommendation[] = [];
  const respondedGuestCount = guests.length;
  const totalGuestCount = expectedGuestCount || respondedGuestCount;

  // Phase 1: Calculate beverages for responded guests
  const beverageStats: Record<string, { likes: number; dislikes: number }> = {};

  // Initialize stats for available beverages
  availableBeverageIds.forEach(id => {
    beverageStats[id] = { likes: 0, dislikes: 0 };
  });

  // Count likes and dislikes
  guests.forEach(guest => {
    guest.likedBeverages?.forEach(bevId => {
      if (beverageStats[bevId]) {
        beverageStats[bevId].likes++;
      }
    });
    guest.dislikedBeverages?.forEach(bevId => {
      if (beverageStats[bevId]) {
        beverageStats[bevId].dislikes++;
      }
    });
  });

  // Generate recommendations for each available beverage
  availableBeverageIds.forEach(bevId => {
    const beverage = allBeverages.find(b => b.id === bevId);
    if (!beverage) return;

    const stats = beverageStats[bevId];
    const netPreference = stats.likes - stats.dislikes;

    // Calculate quantity:
    // - Base: netPreference * BEVERAGES_PER_PERSON
    // - Minimum: If anyone likes it, provide at least 4 units (one 6-pack minus buffer)
    // - Water exception: Always provide minimum based on total guests
    let quantity = 0;

    if (beverage.type === 'water') {
      // Water: 1 per 2 people minimum, plus extra if people like it
      quantity = Math.ceil(totalGuestCount / 2) + (stats.likes * BEVERAGES_PER_PERSON);
    } else if (stats.likes > 0) {
      // Regular beverages: 2 per person who likes it, minimum 4
      quantity = Math.max(4, stats.likes * BEVERAGES_PER_PERSON);
    } else if (netPreference <= 0) {
      // More dislikes than likes, or neutral - skip
      return;
    }

    if (quantity > 0) {
      recommendations.push({
        id: `bev-${bevId}`,
        beverage,
        quantity,
        guestCount: stats.likes,
        label: beverage.name,
      });
    }
  });

  // Phase 2: Add beverages for non-respondents
  if (expectedGuestCount && expectedGuestCount > respondedGuestCount) {
    const nonRespondents = expectedGuestCount - respondedGuestCount;
    const nonRespondentBeverages = generateDefaultBeverages(
      nonRespondents,
      availableBeverageIds,
      allBeverages
    );

    // Merge with existing recommendations
    nonRespondentBeverages.forEach(defaultRec => {
      const existing = recommendations.find(r => r.beverage.id === defaultRec.beverage.id);
      if (existing) {
        existing.quantity += defaultRec.quantity;
        existing.guestCount += defaultRec.guestCount;
      } else {
        recommendations.push(defaultRec);
      }
    });
  }

  // Sort by quantity descending
  return recommendations.sort((a, b) => b.quantity - a.quantity);
}

/**
 * Generate default beverage distribution for non-respondents
 */
function generateDefaultBeverages(
  nonRespondents: number,
  availableBeverageIds: string[],
  allBeverages: Beverage[]
): BeverageRecommendation[] {
  const recommendations: BeverageRecommendation[] = [];
  const totalBeveragesNeeded = nonRespondents * BEVERAGES_PER_PERSON;

  // Use equal distribution among available beverages
  // Exception: Water gets 1.5x weight
  const beverageWeights: Record<string, number> = {};
  let totalWeight = 0;

  availableBeverageIds.forEach(bevId => {
    const beverage = allBeverages.find(b => b.id === bevId);
    if (!beverage) return;

    const weight = beverage.type === 'water' ? 1.5 : 1.0;
    beverageWeights[bevId] = weight;
    totalWeight += weight;
  });

  // Calculate quantity for each beverage
  availableBeverageIds.forEach(bevId => {
    const beverage = allBeverages.find(b => b.id === bevId);
    if (!beverage) return;

    const weight = beverageWeights[bevId];
    const quantity = Math.ceil((weight / totalWeight) * totalBeveragesNeeded);

    if (quantity > 0) {
      recommendations.push({
        id: `bev-default-${bevId}`,
        beverage,
        quantity,
        guestCount: nonRespondents,
        isForNonRespondents: true,
        label: beverage.name,
      });
    }
  });

  return recommendations;
}
