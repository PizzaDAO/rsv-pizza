import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { isAdmin } from '../middleware/auth.js';

/**
 * The set of regions and cities an underboss (or admin) is scoped to.
 * - `isAdmin === true` means full unrestricted access (skips all filters).
 * - `regions` is an array of GPP region IDs (e.g. ['usa', 'west-africa']).
 * - `cities` is an array of city names exactly as they appear in the GPP
 *   cities sheet (preserves original casing — see `buildScopedWhereClause`).
 *
 * Cities and regions are ADDITIVE: an event is in scope if its region matches
 * OR a city extracted from its name matches.
 */
export type UnderbossScope = {
  isAdmin: boolean;
  regions: string[];
  cities: string[];
};

/**
 * Extract a normalized city key from a GPP event name.
 *
 * GPP events follow the canonical naming pattern "Global Pizza Party {City}".
 * This regex matches that pattern (case-insensitive) and returns the city
 * portion as `lower(trim(...))` — the same format used by the
 * `city_statuses.city_key` column and by the frontend `CitiesTable` filter
 * (`frontend/src/components/underboss/CitiesTable.tsx`).
 *
 * Returns null if the name does not match the GPP pattern.
 */
export function cityKeyFromPartyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(/Global Pizza Party\s+(.+)/i);
  if (!match) return null;
  return match[1].trim().toLowerCase();
}

/**
 * Look up the scope for a given user email.
 * - Admins → { isAdmin: true, regions: [], cities: [] }
 * - Graphics admins → also treated as admins for scope purposes
 *   (mirrors existing behavior in `underboss.routes.ts` and `telegram.routes.ts`).
 * - Active underbosses → their explicit regions + cities
 * - Anyone else → { isAdmin: false, regions: [], cities: [] } (no access)
 *
 * Returns scope only — does NOT throw. Callers decide whether to 403.
 */
export async function getUnderbossScope(userEmail: string | undefined | null): Promise<UnderbossScope> {
  if (!userEmail) return { isAdmin: false, regions: [], cities: [] };

  if (await isAdmin(userEmail)) {
    return { isAdmin: true, regions: [], cities: [] };
  }

  const underboss = await prisma.underboss.findFirst({
    where: { email: userEmail.toLowerCase(), isActive: true },
    select: { region: true, regions: true, cities: true },
  });

  if (underboss) {
    // Legacy fallback: if regions[] is empty, fall back to the deprecated single region field
    const regions = underboss.regions.length > 0 ? underboss.regions : (underboss.region ? [underboss.region] : []);
    // Treat the legacy "__admin__" marker as full admin access
    if (regions.includes('__admin__')) {
      return { isAdmin: true, regions: [], cities: [] };
    }
    return { isAdmin: false, regions, cities: underboss.cities || [] };
  }

  // Graphics admins get full access (matches graphics-admin branch in underboss.routes.ts:79-92)
  const gfx = await prisma.graphicsAdmin.findUnique({
    where: { email: userEmail.toLowerCase() },
    select: { id: true },
  });
  if (gfx) {
    return { isAdmin: true, regions: [], cities: [] };
  }

  return { isAdmin: false, regions: [], cities: [] };
}

/**
 * Test whether a party falls within the given scope.
 * Returns true if any of:
 *   1. `scope.isAdmin === true`
 *   2. The party's region is in `scope.regions`
 *   3. The city extracted from the party name (via `cityKeyFromPartyName`)
 *      matches a city in `scope.cities` (case-insensitive on the sheet value).
 *
 * Note: city scope is GPP-specific (relies on the canonical "Global Pizza
 * Party {City}" naming). Non-GPP parties will only match via region.
 */
export function partyMatchesScope(
  party: { region?: string | null; name?: string | null; eventType?: string | null },
  scope: UnderbossScope
): boolean {
  if (scope.isAdmin) return true;

  if (party.region && scope.regions.includes(party.region)) return true;

  if (scope.cities.length > 0) {
    const partyCityKey = cityKeyFromPartyName(party.name);
    if (partyCityKey) {
      const normalizedCities = scope.cities.map((c) => c.toLowerCase().trim());
      // Prefix match (with trailing space) to mirror the `contains: "Global Pizza Party {City}"`
      // substring match in buildScopedWhereClause. The `startsWith(c + ' ')` (with the space)
      // prevents `"Lago"` from matching `"Lagos"`.
      if (normalizedCities.some((c) => partyCityKey === c || partyCityKey.startsWith(c + ' '))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Build a Prisma `where` clause that constrains a `Party` query to the scope.
 *
 * Returns:
 *   - `null` when `scope.isAdmin` is true — callers should skip the filter.
 *   - `{ id: { equals: '__no_match__' } }` when both regions and cities are
 *     empty — guarantees no rows are returned.
 *   - Otherwise an `OR` clause combining the region filter and one
 *     "name contains 'Global Pizza Party <City>'" branch per city.
 *
 * Casing note: we use the city value as stored on the underboss row (which
 * comes from the sheet, e.g. "Lagos") so the contains-match against the
 * "Global Pizza Party Lagos" event name works without needing a separate
 * lookup. `mode: 'insensitive'` makes this robust to capitalization drift.
 */
export function buildScopedWhereClause(scope: UnderbossScope): Prisma.PartyWhereInput | null {
  if (scope.isAdmin) return null;

  if (scope.regions.length === 0 && scope.cities.length === 0) {
    return { id: { equals: '__no_match__' } };
  }

  const or: Prisma.PartyWhereInput[] = [];

  if (scope.regions.length > 0) {
    or.push({ region: { in: scope.regions } });
  }

  for (const city of scope.cities) {
    if (!city || !city.trim()) continue;
    or.push({ name: { contains: `Global Pizza Party ${city.trim()}`, mode: 'insensitive' } });
  }

  if (or.length === 0) {
    return { id: { equals: '__no_match__' } };
  }

  if (or.length === 1) return or[0];
  return { OR: or };
}
