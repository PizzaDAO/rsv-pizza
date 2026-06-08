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
 * provola-58507: normalize a free-text city label (a moltobene captured-group
 * TITLE, a moltobene `/city/groups` cityName, OR an rsvpizza-derived cityKey)
 * down to a comparable "core" city name, so the same city expressed two
 * different ways collapses to ONE string for exact-equality matching.
 *
 * This is the heart of the missing-chat_id backfill. It is deliberately
 * CONSERVATIVE: it only strips well-known boilerplate / decoration. It never
 * does fuzzy/substring matching — callers compare the RESULT with `===`. A
 * wrong match routes Telegram reminders to the wrong group, so we prefer to
 * miss a match (leave the city without a chat_id) over guessing.
 *
 * Pipeline (order matters):
 *   1. lowercase + strip diacritics/accents (NFD + combining-mark removal)
 *   2. remove parentheticals `(...)` and bracketed `[...]` (qualifiers like
 *      "(dadiangas)" or "(+18)").
 *   3. split on `|` / `:` qualifier separators into segments. We do NOT blindly
 *      keep the first segment, because the city can be on EITHER side
 *      ("madrid | no kids allowed" has the city first; "gpp: tokyo" has it
 *      second). Instead we clean EACH segment (noise + year strip) and keep the
 *      one whose cleaned core is LONGEST — the noise-only segment ("no kids
 *      allowed", "gpp") cleans to '' and loses, so the real city survives
 *      regardless of side. Hyphens are NOT segment separators: "raleigh -
 *      durham" stays "raleigh durham" (a real two-name metro) — splitting it
 *      would silently truncate a legitimate hyphenated city.
 *   4. (per segment) remove noise phrases: "global pizza party", "bitcoin
 *      pizza", "pizza party", "pizza dao", "pizzadao", "gpp", "telegram",
 *      "group", "official", "no kids allowed"; remove 4-digit years; strip
 *      non-alphanumeric/space (emoji, symbols, leftover punctuation/separators);
 *      collapse whitespace.
 *
 * Returns '' when nothing recognizable remains — callers MUST treat '' as a
 * non-match (never index the missing-cities map by an empty key).
 */
function cleanCityCore(segment: string): string {
  let s = segment;
  // Hyphen-joined metros -> space-joined ("raleigh - durham").
  s = s.replace(/[–—-]+/g, ' ');
  // Noise phrases. Longest first so "global pizza party" is removed before the
  // shorter "pizza party". Word-bounded to avoid eating real substrings.
  const noisePhrases = [
    'global pizza party',
    'bitcoin pizza',
    'pizza party',
    'pizza dao',
    'no kids allowed',
    'official',
    'telegram',
    'group',
    'gpp',
    'pizzadao',
  ];
  for (const phrase of noisePhrases) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'g');
    s = s.replace(re, ' ');
  }
  // Remove 4-digit years (2019–2099 era).
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ');
  // Strip everything that isn't a letter, digit, or space (emoji, symbols,
  // leftover punctuation/separators). \p{L}/\p{N} keep non-latin scripts.
  s = s.replace(/[^\p{L}\p{N} ]+/gu, ' ');
  // Collapse whitespace.
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeCityName(input: string | null | undefined): string {
  if (!input) return '';

  // 1. lowercase + strip diacritics/accents.
  let s = String(input).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // 2. remove parentheticals / brackets entirely.
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');

  // 3. split on |/: qualifier separators; clean each segment; keep the longest
  //    cleaned core. (No split = single segment = the whole string.)
  const segments = s.split(/[|:]/);
  let best = '';
  for (const seg of segments) {
    const cleaned = cleanCityCore(seg);
    if (cleaned.length > best.length) best = cleaned;
  }

  return best;
}

/**
 * provola-58509: curated city EXONYM alias map for the moltobene matcher.
 *
 * The bot's captured-group titles use LOCAL city names ("Göteborg",
 * "München"), but approved GPP cities are stored with ENGLISH names
 * ("Gothenburg", "Munich"). After `normalizeCityName` lowercases and strips
 * accents, the two forms still differ (`goteborg` ≠ `gothenburg`), so the
 * exact-equality matcher misses. This map collapses each well-established 1:1
 * exonym↔English pair to ONE canonical normalized form.
 *
 * CONTRACT (must be upheld so `canonicalCityName` stays correct):
 *   - Both KEYS and VALUES are in the SAME normalized form `normalizeCityName`
 *     produces: lowercased + de-accented + de-noised. (e.g. "goteborg", never
 *     "Göteborg".) Verify any new entry by running it through
 *     `normalizeCityName` first.
 *   - Every entry maps the NON-canonical form → the canonical form. The
 *     canonical form itself is NOT a key (it already canonicalizes to itself
 *     via the `?? normalizeCityName(input)` fallback in `canonicalCityName`),
 *     EXCEPT when we deliberately collapse a pair where BOTH names are still in
 *     active use (e.g. bengaluru↔bangalore) — then we add BOTH directions
 *     pointing at the chosen canonical so the comparison is symmetric no matter
 *     which side the data uses.
 *
 * CONSERVATIVE by design: ONLY true same-city aliases of long standing. Never
 * add near-homonyms of DIFFERENT cities — a wrong entry would silently route a
 * Telegram group to the wrong city. When in doubt, leave it out.
 *
 * Notes on the curated set below:
 *   - German: München→Munich, Köln→Cologne, Nürnberg→Nuremberg.
 *   - Iberian: Lisboa→Lisbon, Sevilla→Seville. (Porto, Madrid, Barcelona
 *     unchanged — same in both languages.)
 *   - Italian: Napoli→Naples, Roma→Rome, Milano→Milan, Torino→Turin,
 *     Venezia→Venice, Firenze→Florence, Genova→Genoa.
 *   - Central/Eastern Europe: Praha→Prague, Warszawa→Warsaw, Wien→Vienna.
 *     (Kraków normalizes to "krakow" and is the same in English — no entry.)
 *   - Low Countries: Bruxelles→Brussels, Antwerpen→Antwerp, Gent→Ghent,
 *     Den Haag→The Hague.
 *   - Swiss/Nordic: Genève→Geneva, Göteborg→Gothenburg. (Zürich normalizes to
 *     "zurich" and is the same in English — no entry.)
 *   - Russian (Latin transliteration): Moskva→Moscow,
 *     Sankt Peterburg→Saint Petersburg.
 *   - Indian renamings (BOTH directions → single canonical, since the GPP data
 *     may use either): Bengaluru/Bangalore → "bangalore"; Mumbai/Bombay →
 *     "mumbai"; Kolkata/Calcutta → "kolkata"; Chennai/Madras → "chennai".
 *     Canonical chosen as the form most likely present in current GPP city
 *     data (modern official name, except Bangalore where the English-common
 *     form is retained).
 */
export const CITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  // German
  munchen: 'munich',
  koln: 'cologne',
  nurnberg: 'nuremberg',
  // Iberian
  lisboa: 'lisbon',
  sevilla: 'seville',
  // Italian
  napoli: 'naples',
  roma: 'rome',
  milano: 'milan',
  torino: 'turin',
  venezia: 'venice',
  firenze: 'florence',
  genova: 'genoa',
  // Central/Eastern Europe
  praha: 'prague',
  warszawa: 'warsaw',
  wien: 'vienna',
  // Low Countries
  bruxelles: 'brussels',
  antwerpen: 'antwerp',
  gent: 'ghent',
  'den haag': 'the hague',
  // Swiss / Nordic
  geneve: 'geneva',
  goteborg: 'gothenburg',
  // Russian (Latin transliteration)
  moskva: 'moscow',
  'sankt peterburg': 'saint petersburg',
  // Indian renamings — BOTH directions collapse to one canonical.
  bengaluru: 'bangalore',
  bombay: 'mumbai',
  calcutta: 'kolkata',
  madras: 'chennai',
});

/**
 * provola-58509: normalize an input, then map it through `CITY_ALIASES` to its
 * canonical city form. This is the function the moltobene matcher should use on
 * BOTH sides of an equality comparison (the approved-city index keys AND the
 * captured-title/cityName lookups) so local↔English exonyms resolve to one
 * canonical string.
 *
 * Returns '' for empty/unrecognizable input (same as `normalizeCityName`) —
 * callers MUST treat '' as a non-match.
 */
export function canonicalCityName(input: string | null | undefined): string {
  const normalized = normalizeCityName(input);
  return CITY_ALIASES[normalized] ?? normalized;
}

/**
 * tonda-58293 FIX #1: build a map of GPP cityKey → region (GPP slug).
 *
 * `city_telegram_groups.region`, `parties.region`, and `underbosses.regions`
 * must all hold the SAME value (a GPP region slug like `western-europe`) so
 * region-scoped underbosses match. Party names follow "Global Pizza Party
 * {City}"; we derive the cityKey in code (no city_key column on parties) and
 * map it to the party's `region` column.
 *
 * Single batched pass over non-cancelled GPP parties — callers should call
 * this ONCE and reuse the map (do NOT call `getGppRegionByCityKey` in a loop).
 * When two parties share a cityKey, the first non-null region wins.
 */
export async function buildGppCityKeyToRegionMap(): Promise<Map<string, string>> {
  const parties = await prisma.party.findMany({
    where: { eventType: 'gpp', cancelledAt: null },
    select: { name: true, region: true },
  });
  const map = new Map<string, string>();
  for (const p of parties) {
    const key = cityKeyFromPartyName(p.name);
    if (!key) continue;
    const region = (p.region ?? '').trim();
    if (!region) continue;
    if (!map.has(key)) map.set(key, region);
  }
  return map;
}

/**
 * tonda-58293 FIX #1: resolve the GPP region (slug) for a single cityKey by
 * finding a non-cancelled GPP party whose name yields that cityKey.
 *
 * Returns the party's `region` slug, or null if no matching party (or the
 * matching party has no region). Used by the capture write-through,
 * /groups/assign, and migration-persist so new `city_telegram_groups` rows
 * carry the slug instead of NULL.
 *
 * NOTE: this scans GPP parties per call. For bulk work (import / backfill),
 * use `buildGppCityKeyToRegionMap()` once instead of calling this in a loop.
 */
export async function getGppRegionByCityKey(cityKey: string): Promise<string | null> {
  const key = (cityKey || '').toLowerCase().trim();
  if (!key) return null;
  const map = await buildGppCityKeyToRegionMap();
  return map.get(key) ?? null;
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
 *   3. The party's `city` column matches a city in `scope.cities`
 *      (case-insensitive, trim-normalized).
 *
 * Strict mode: relies on the first-class `parties.city` column populated by
 * the create handlers and the 2026-05-18 backfill. Older parties that lack
 * a city value will only match via region.
 */
export function partyMatchesScope(
  party: { region?: string | null; name?: string | null; city?: string | null; eventType?: string | null },
  scope: UnderbossScope
): boolean {
  if (scope.isAdmin) return true;

  if (party.region && scope.regions.includes(party.region)) return true;

  if (scope.cities.length > 0) {
    const cityKeys = scope.cities.map((c) => c.toLowerCase().trim());
    const partyCityKey = (party.city ?? '').toLowerCase().trim();
    if (partyCityKey && cityKeys.includes(partyCityKey)) return true;
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
 *     `city` equals branch per scope city.
 *
 * Strict mode: matches against the first-class `parties.city` column only.
 * The 2026-05-18 backfill populated this column for ~760 existing GPP events;
 * future creates write it directly. Case-insensitive on the column value.
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

  if (scope.cities.length > 0) {
    const cityKeys = scope.cities.map((c) => c.trim()).filter(Boolean);
    if (cityKeys.length > 0) {
      or.push({
        OR: cityKeys.map((c) => ({
          city: { equals: c, mode: 'insensitive' as const },
        })),
      });
    }
  }

  if (or.length === 0) {
    return { id: { equals: '__no_match__' } };
  }

  if (or.length === 1) return or[0];
  return { OR: or };
}
