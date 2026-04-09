import { Party } from '../../types';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { getRsvpUrl } from '../promo/promoUtils';

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
 * Format the event date as "Month Day, Year" (e.g., "May 10, 2026").
 */
export function formatPressReleaseDate(party: Party): string {
  if (!party.date) return 'TBD';

  const d = new Date(party.date);
  const tz = party.timezone || 'UTC';
  const { dateStr } = getDateTimeInTimezone(d, tz);

  const dateObj = new Date(dateStr + 'T12:00:00');
  return dateObj.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });
}

/**
 * Get the RSVP URL for the press release. Uses rsv.pizza domain.
 */
export function getPressReleaseRsvpUrl(party: Party): string {
  if (party.customUrl) {
    return `rsv.pizza/${party.customUrl}`;
  }
  return `rsv.pizza/rsvp/${party.inviteCode}`;
}

/**
 * Default press release template with placeholders.
 */
export const DEFAULT_TEMPLATE = `FOR IMMEDIATE RELEASE

GLOBAL PIZZA PARTY COMES TO {city} ON {date}

{city} — {host_name} is proud to announce that {city} will participate in the Global Pizza Party, a worldwide celebration of pizza and community, on {date}. The event will be held at {venue}.

The Global Pizza Party is an annual event organized by PizzaDAO, bringing together pizza lovers in cities around the world for a day of free pizza, community building, and fun.

{city}'s event will feature pizza from {pizzeria}, bringing the best local flavors to the celebration.

The event is made possible by the generous support of local sponsors including {sponsors}.

The event is free and open to the public. Attendees are encouraged to RSVP at {rsvp_url}.

For more information or media inquiries, contact:
{host_name}
Phone: {host_phone}

###`;

/**
 * All available placeholder variables and their descriptions.
 */
export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: '{host_name}', label: 'Host Name' },
  { key: '{host_phone}', label: 'Phone' },
  { key: '{pizzeria}', label: 'Pizzeria' },
  { key: '{city}', label: 'City' },
  { key: '{venue}', label: 'Venue' },
  { key: '{sponsors}', label: 'Sponsors' },
  { key: '{date}', label: 'Date' },
  { key: '{event_name}', label: 'Event Name' },
  { key: '{rsvp_url}', label: 'RSVP URL' },
];

/**
 * Replace all {placeholder} tokens in the template with field values.
 */
export function generatePressRelease(template: string, fields: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(fields)) {
    const placeholder = `{${key}}`;
    result = result.replaceAll(placeholder, value || `[${key}]`);
  }

  return result;
}
