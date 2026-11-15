import { Party } from '../../types';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { BRAND } from '../../config/brand';

/**
 * Extract city and state/country from an address string.
 * Address format is typically: "123 Main St, City, State ZIP, Country"
 */
export function extractCityAndState(address: string): { city: string; stateOrCountry: string } {
  if (!address) return { city: '', stateOrCountry: '' };

  const parts = address.split(',').map(p => p.trim());

  if (parts.length >= 3) {
    // "Street, City, State ZIP" or "Street, City, State, Country"
    const city = parts[parts.length - 2].trim();
    const stateOrCountry = parts[parts.length - 1].trim();
    return { city, stateOrCountry };
  }

  if (parts.length === 2) {
    return { city: parts[0].trim(), stateOrCountry: parts[1].trim() };
  }

  return { city: address, stateOrCountry: '' };
}

/**
 * Strip a trailing US zip / zip+4 from a city string.
 */
export function cleanCity(city: string): string {
  return city.replace(/\s*\d{5}(-\d{4})?$/, '').trim();
}

/**
 * Format the event date as "Month Day, Year" (e.g., "May 10, 2026") in the
 * event's timezone, using the given locale (defaults to en-US).
 */
export function formatPressReleaseDate(party: Party, locale = 'en-US', tbd = 'TBD'): string {
  if (!party.date) return tbd;

  try {
    const tz = party.timezone || 'UTC';
    const { dateStr } = getDateTimeInTimezone(new Date(party.date), tz);

    // dateStr is the event's local calendar date (YYYY-MM-DD). Build it at noon UTC and
    // format in UTC so the viewer's own timezone can never shift the day.
    const dateObj = new Date(dateStr + 'T12:00:00Z');
    if (Number.isNaN(dateObj.getTime())) return tbd;
    return dateObj.toLocaleDateString(locale, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return tbd;
  }
}

/**
 * Get the RSVP URL for the press release. Uses the brand domain.
 */
export function getPressReleaseRsvpUrl(party: Party): string {
  if (party.customUrl) {
    return `${BRAND.domain}/${party.customUrl}`;
  }
  return `${BRAND.domain}/rsvp/${party.inviteCode}`;
}

/**
 * All available placeholder variable names (without braces).
 */
export const PLACEHOLDER_KEYS = [
  'host_name',
  'host_phone',
  'pizzeria',
  'city',
  'venue',
  'sponsors',
  'date',
  'event_name',
  'rsvp_url',
] as const;

/**
 * Replace all {placeholder} tokens in the template with field values.
 * Empty values are left visible as [key] so the host notices what to fill in.
 */
export function generatePressRelease(template: string, fields: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(fields)) {
    result = result.split(`{${key}}`).join(value || `[${key}]`);
  }

  return result;
}
