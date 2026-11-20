import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { searchPizzerias } from './pizzeriaSearch.js';

interface Args {
  partyId: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
}

/**
 * Geocode a free-form address to lat/lng using Nominatim. Returns null on any
 * error or no result — never throws. (`lib/geocode.ts#geocodeCity` is the
 * city-name variant; this targets the more specific `address` string and uses
 * a shorter User-Agent.)
 */
async function nominatimGeocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      {
        headers: { 'User-Agent': 'rsv.pizza-backend/1.0 (samgold24@gmail.com)' },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Auto-populate `parties.selected_pizzerias` for a party by calling the
 * shared `lib/pizzeriaSearch` (formerly the `search-pizzerias` edge function).
 *
 * HARD CONSTRAINTS (prosciutto-58472):
 * - Idempotent: never overwrite a host's preselected list.
 * - Fire-and-forget: callers must `void` this and `.catch()` on the outside.
 * - Never throws: wraps everything in try/catch and logs warnings only.
 * - Race-safe: final write uses conditional Prisma `where` so two simultaneous
 *   fires can't clobber each other.
 */
export async function autoPopulatePizzerias({ partyId, lat, lng, address }: Args): Promise<void> {
  try {
    // Idempotent guard — re-read to check current state (caller may have
    // passed stale party.selectedPizzerias from a create response).
    const current = await prisma.party.findUnique({
      where: { id: partyId },
      select: { selectedPizzerias: true, latitude: true, longitude: true, address: true },
    });
    if (!current) return;

    const existing = current.selectedPizzerias as unknown;
    if (Array.isArray(existing) && existing.length > 0) return;

    // Resolve coords
    let effectiveLat: number | null = lat ?? current.latitude;
    let effectiveLng: number | null = lng ?? current.longitude;
    if ((effectiveLat == null || effectiveLng == null) && address) {
      const geo = await nominatimGeocode(address);
      if (geo) {
        effectiveLat = geo.lat;
        effectiveLng = geo.lng;
        // Persist resolved coords back so other features benefit.
        await prisma.party
          .update({
            where: { id: partyId },
            data: { latitude: geo.lat, longitude: geo.lng },
          })
          .catch(() => {});
      }
    }
    if (effectiveLat == null || effectiveLng == null) return;

    // Direct call into the shared search lib (no HTTP hop). 8s ceiling, like before.
    const found = await Promise.race([
      searchPizzerias(effectiveLat, effectiveLng, 5000),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('search timed out')), 8000)),
    ]);
    const pizzerias = found.slice(0, 20) as unknown as Prisma.InputJsonArray;
    if (pizzerias.length === 0) return;

    // Conditional update — only write if still empty (race-safe).
    // Uses updateMany() (not update()) because `where` on update() only accepts
    // unique fields; we need an extra `selectedPizzerias is null` filter.
    // If another concurrent invocation already wrote, count comes back 0 — fine.
    await prisma.party
      .updateMany({
        where: { id: partyId, selectedPizzerias: { equals: Prisma.DbNull } },
        data: { selectedPizzerias: pizzerias },
      })
      .catch(() => {
        // Race-lost or some other non-fatal reason — desired outcome (empty stays empty,
        // or another fire already filled it). Non-fatal.
      });
  } catch (err) {
    console.warn('[autoPopulatePizzerias]', err instanceof Error ? err.message : err);
  }
}
