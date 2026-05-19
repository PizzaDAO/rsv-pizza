// scripts/outreach/lib/normalize-city.cjs
// City-name normalization helpers shared by coverage-gap-2026.cjs and friends.
// Mirrors the normalize() helper used in
// frontend/src/components/underboss/CitiesTable.tsx lines 118-121 so the GPP
// city extraction logic agrees end-to-end.

/**
 * Strip diacritics, lowercase, trim, collapse internal whitespace.
 *   normalize('  São  Paulo ') === 'sao paulo'
 */
function normalize(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Composite key for "this city, in this country".
 * countryIso2 is uppercased; empty country falls back to '??' so callers can
 * still index without a country.
 */
function cityKey(city, countryIso2) {
  const c = (countryIso2 || '').toUpperCase() || '??';
  return `${normalize(city)}|${c}`;
}

/**
 * Pull the city slug out of a GPP party name. Matches the regex used in
 * CitiesTable.tsx line 127: /Global Pizza Party\s+(.+)/i
 * Returns null if the party name doesn't follow the convention.
 */
function extractGppCity(partyName) {
  if (!partyName) return null;
  const m = String(partyName).match(/Global Pizza Party\s+(.+)/i);
  if (!m) return null;
  return m[1].trim();
}

module.exports = { normalize, cityKey, extractGppCity };
