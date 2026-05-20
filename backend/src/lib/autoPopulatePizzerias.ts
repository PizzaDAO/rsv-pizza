import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

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
 * Supabase `search-pizzerias` edge function.
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

    // Call edge function (server-side, uses service-role key so no CORS/anon issues)
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      console.warn('[autoPopulatePizzerias] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${supabaseUrl}/functions/v1/search-pizzerias`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
        },
        body: JSON.stringify({ lat: effectiveLat, lng: effectiveLng, radius: 5000 }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn('[autoPopulatePizzerias] edge function returned', res.status);
      return;
    }
    const data = await res.json();
    const pizzerias = Array.isArray(data?.pizzerias) ? data.pizzerias.slice(0, 20) : [];
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
