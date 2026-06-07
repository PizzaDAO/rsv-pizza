/**
 * Canonicalize a free-text country name (English, localized, or with any
 * Google-Places spelling quirk) to canonical American English.
 *
 * Uses `getCountryCode` (see ./countryCode.ts) to map the input to an
 * ISO-3166-1 alpha-2, then `Intl.DisplayNames(['en'])` to render that code
 * back to an English name. An OVERRIDES map handles the codes whose Intl
 * output is non-American or has a formatting quirk Snax wants normalized.
 *
 * Used by:
 *   - POST /api/parties + PATCH /api/parties/:id (defense-in-depth on create).
 *   - scripts/backfill-canonical-country-names.cjs (one-shot DB cleanup).
 *
 * Returns null for null/empty input and for unrecognized strings. Callers
 * that want "preserve raw" semantics should fall back to the input themselves
 * (see `canonicalizeCountryName(country) ?? country ?? null` pattern in
 * party.routes.ts).
 */

import { getCountryCode } from './countryCode.js';

const ENGLISH_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Codes where Intl's English name disagrees with Snax-preferred American
 * English. Confirmed against Node 22 output 2026-06-05.
 *
 *   HK -> Intl says "Hong Kong SAR China" -> "Hong Kong"
 *   MO -> Intl says "Macao SAR China"     -> "Macao"
 *   MM -> Intl says "Myanmar (Burma)"     -> "Myanmar"
 *   CD -> Intl says "Congo - Kinshasa"    -> "DR Congo"
 *   CG -> Intl says "Congo - Brazzaville" -> "Congo"
 *   PS -> Intl says "Palestinian Territories" -> "Palestine"
 *   ST -> Intl says "São Tomé & Príncipe" -> "São Tomé and Príncipe"
 *   TR -> Intl says "Türkiye" (modern CLDR) -> "Turkey" (American English)
 *
 * CI is NOT in this map: Intl returns "Côte d’Ivoire" (curly apostrophe);
 * we normalize the apostrophe to ASCII below.
 */
const OVERRIDES: Record<string, string> = {
  HK: 'Hong Kong',
  MO: 'Macao',
  MM: 'Myanmar',
  CD: 'DR Congo',
  CG: 'Congo',
  PS: 'Palestine',
  ST: 'São Tomé and Príncipe',
  TR: 'Turkey',
};

export function canonicalizeCountryName(
  input: string | null | undefined,
): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Normalize the curly RIGHT SINGLE QUOTATION MARK (U+2019) — which both
  // Intl.DisplayNames AND some Google-Places localized labels emit — to a
  // straight ASCII apostrophe so getCountryCode's alias table ("côte
  // d'ivoire") still matches.
  const normalizedInput = trimmed.replace(/’/g, "'");

  const code = getCountryCode(normalizedInput);
  if (!code) return null;

  if (code in OVERRIDES) return OVERRIDES[code];

  const name = ENGLISH_NAMES.of(code);
  if (!name) return null;
  // Apply the same curly->straight normalization on the Intl output so
  // "Côte d'Ivoire" is always stored with an ASCII apostrophe.
  return name.replace(/’/g, "'");
}
