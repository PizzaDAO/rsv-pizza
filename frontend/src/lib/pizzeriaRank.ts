import { Pizzeria } from '../types';
import { calculateDistanceMiles } from './ordering';

// ---- Ranking helpers (vesuvio-58492) ----

// Cap the RSVP "Favorite Pizzerias" list to the top N entries ranked by a
// weighted score combining rating and distance from the venue. Istanbul GPP
// had ~15+ host-selected pizzerias which overwhelmed the form.
export const TOP_PIZZERIA_LIMIT = 3;
export const DISTANCE_WEIGHT_PER_MILE = 0.3;

export function rankPizzerias(
  list: Pizzeria[],
  venue: { lat: number; lng: number } | null,
): Pizzeria[] {
  return [...list]
    .map(p => {
      const rating = p.rating ?? 3.5;
      const hasDistance =
        !!venue &&
        !!p.location &&
        p.location.lat !== 0 &&
        p.location.lng !== 0;
      const distance = hasDistance
        ? calculateDistanceMiles(venue.lat, venue.lng, p.location.lat, p.location.lng)
        : 0;
      return { p, score: rating - distance * DISTANCE_WEIGHT_PER_MILE };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_PIZZERIA_LIMIT)
    .map(x => x.p);
}
