import { gppCities, GppCity } from '../data/gppCityManifest';

const BY_SLUG = new Map<string, GppCity>(gppCities.map(c => [c.slug, c]));

/** Look up a GPP city by party customUrl (slug). Returns null if no match. */
export function gppCityBySlug(slug: string | null | undefined): GppCity | null {
  if (!slug) return null;
  return BY_SLUG.get(slug.toLowerCase().trim()) || null;
}
