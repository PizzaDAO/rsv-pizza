/**
 * scripts/outreach/lib/normalize.cjs
 * stagioni-29104 — string normalization helpers used for joins + dedupe.
 */

/**
 * Lowercase + strip diacritics + collapse whitespace.
 * Used for the (source, contact_url) upsert key and cross-reference city joins.
 */
function normalizeCity(raw) {
  if (!raw) return '';
  return String(raw)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lowercase + strip non-alphanumeric + collapse — used for fuzzy community-name dedupe.
 */
function normalizeName(raw) {
  if (!raw) return '';
  return String(raw)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenize a string into a Set of words for Jaccard similarity. */
function tokenSet(raw) {
  return new Set(normalizeName(raw).split(' ').filter(Boolean));
}

/** Jaccard similarity (|A ∩ B| / |A ∪ B|) between two token sets. */
function jaccard(aSet, bSet) {
  if (!aSet.size && !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 0 : inter / union;
}

module.exports = { normalizeCity, normalizeName, tokenSet, jaccard };
