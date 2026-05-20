/**
 * Countries where Mercury (our virtual debit card issuer) cannot issue cards
 * due to sanctions / regulatory restrictions. Block list verified 2026-05-20.
 *
 * Keep in sync with `frontend/src/lib/mercuryBlockedCountries.ts`.
 *
 * Matching is case-insensitive on the normalized country string. Normalization:
 *   1. lowercase
 *   2. strip parenthetical clarifications (e.g. "Iran (Islamic Republic of Iran)" → "iran")
 *   3. trim whitespace
 *
 * Ukraine is fully blocked even though only Kherson/Zaporizhzhia/Donetsk/
 * Luhansk/Crimea are sanctioned — we don't currently store region/oblast on
 * `parties`, so over-blocking is the safe default. When the schema adds a
 * `region` column, this can be tightened.
 */
const RAW = [
  'Afghanistan', 'Angola', 'Bangladesh', 'Belarus', 'Bhutan', 'Burkina Faso',
  'Central African Republic', 'Congo', 'Democratic Republic of the Congo',
  'DRC', 'Cuba', 'Eritrea', 'Gambia', 'Haiti', 'Indonesia', 'Iran', 'Iraq',
  'Kyrgyzstan', 'Latvia', 'Lesotho', 'Liberia', 'Maldives', 'Mali',
  'Mozambique', 'Myanmar', 'Burma', 'Nepal', 'North Korea', 'DPRK',
  'Palestine', 'Russia', 'South Sudan', 'Sudan', 'Syria', 'Ukraine',
  'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen',
];

export function normalizeCountry(input: string | null | undefined): string {
  if (!input) return '';
  return input.toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

const BLOCKED_SET = new Set(RAW.map(normalizeCountry));

export function isMercuryBlocked(country: string | null | undefined): boolean {
  const norm = normalizeCountry(country);
  if (!norm) return false; // unknown country: don't block by default
  return BLOCKED_SET.has(norm);
}
