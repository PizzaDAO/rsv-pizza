/**
 * scripts/backfill-place-ids.js
 *
 * DRY-RUN ONLY backfill of `parties.place_id` for rows that have an address but
 * no place_id yet. Hits Google's New Places Text Search and writes a CSV that
 * Snax reviews by hand before any DB writes happen.
 *
 * This script never writes to the database. The APPLY constant is hardcoded to
 * false and there is no --apply CLI flag. The apply step is a SEPARATE manual
 * script (scripts/apply-place-id-backfill.js, not yet implemented) that:
 *   1. Reads the reviewed CSV (annotated with an `approved` column).
 *   2. For each row where approved == 'true', runs:
 *        UPDATE parties SET place_id = $1 WHERE id = $2 AND place_id IS NULL
 *      (the AND place_id IS NULL guard prevents overwriting any place_id
 *      captured via forward capture during the review window.)
 *   3. Verifies post-apply: count(parties WHERE place_id IS NOT NULL).
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase service-role key (Dashboard -> API).
 *   GOOGLE_PLACES_API_KEY      Google Cloud key with "Places API (New)" enabled.
 *                              The existing VITE_GOOGLE_MAPS_API_KEY is browser-
 *                              referrer-restricted and will not work from a Node
 *                              script — use a separate server-side / IP-restricted
 *                              key, or pull the value already used by the
 *                              search-pizzerias edge function from Supabase secrets.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-place-ids.js
 *
 * Output:
 *   - Console: per-row [i/N] <slug> — <flag> — <distance>km lines, plus a
 *     summary at the end with counts per confidence_flag bucket.
 *   - CSV file: scripts/backfill-place-ids-YYYYMMDD-HHMMSS.csv (timestamped to
 *     avoid clobbering prior runs).
 *
 * The New Places Text Search endpoint is used (NOT the legacy
 * maps/api/place/textsearch/json). The available key is restricted to
 * Places API (New); the legacy endpoint returns REQUEST_DENIED.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Hard guard — this script never writes to the DB.
const APPLY = false;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

if (!GOOGLE_PLACES_API_KEY) {
  console.error('Set GOOGLE_PLACES_API_KEY env var');
  console.error('NOTE: VITE_GOOGLE_MAPS_API_KEY is browser-referrer-restricted and will not work here.');
  console.error('Use a separate server-side / IP-restricted key with Places API (New) enabled.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Confidence thresholds (km). See plan section 4c.
const AUTO_THRESHOLD_KM = 0.5;
const REVIEW_THRESHOLD_KM = 1.0;

// Sleep between requests to stay well under Google's QPS quota.
const DELAY_MS = 100;

// Haversine distance in km between two lat/lng points.
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371; // Earth radius (km)
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function timestampString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function searchPlace(query) {
  // New Places API: POST https://places.googleapis.com/v1/places:searchText
  // Headers: X-Goog-Api-Key, X-Goog-FieldMask
  // Body: { textQuery: "..." }
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({ textQuery: query }),
    });

    const httpStatus = res.status;
    let body = null;
    try {
      body = await res.json();
    } catch {
      // Body may be empty on some errors; leave as null.
    }

    if (!res.ok) {
      const errMsg = body?.error?.message || `HTTP ${httpStatus}`;
      return { httpStatus, error: errMsg, places: [] };
    }

    const places = body?.places || [];
    return { httpStatus, error: null, places };
  } catch (err) {
    return { httpStatus: 0, error: err?.message || String(err), places: [] };
  }
}

async function main() {
  if (APPLY) {
    // Defense-in-depth — the constant is hardcoded false above; this branch
    // should never execute, but if someone toggles it by mistake, halt.
    console.error('APPLY is true but this script does not implement the apply path.');
    console.error('Use a separate scripts/apply-place-id-backfill.js after CSV review.');
    process.exit(1);
  }

  console.log('DRY RUN — no DB writes. CSV will be written for Snax review.');

  // Load all parties that need a place_id.
  // Pagination defensively in case there are >1000 rows.
  const PAGE_SIZE = 1000;
  let allParties = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('parties')
      .select('id, custom_url, invite_code, address, venue_name, latitude, longitude')
      .not('address', 'is', null)
      .is('place_id', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Error loading parties:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allParties = allParties.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`Found ${allParties.length} parties needing place_id backfill.`);

  if (allParties.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const csvHeader = [
    'id',
    'slug',
    'current_address',
    'current_venue_name',
    'current_lat',
    'current_lng',
    'candidate_place_id',
    'candidate_name',
    'candidate_address',
    'candidate_lat',
    'candidate_lng',
    'distance_km',
    'confidence_flag',
    'api_http_status',
    'api_error',
  ].join(',');

  const csvRows = [csvHeader];
  const counts = { OK_AUTO: 0, OK_REVIEW: 0, MANUAL: 0 };
  let totalApiCalls = 0;
  let noResultCount = 0;

  for (let i = 0; i < allParties.length; i++) {
    const party = allParties[i];
    const slug = party.custom_url || party.invite_code;
    const query = party.venue_name
      ? `${party.venue_name} ${party.address}`
      : party.address;

    const { httpStatus, error, places } = await searchPlace(query);
    totalApiCalls++;

    let candidate = null;
    let distanceKm = null;
    let flag = 'MANUAL';

    if (error) {
      flag = 'MANUAL';
    } else if (!places || places.length === 0) {
      flag = 'MANUAL';
      noResultCount++;
    } else {
      candidate = places[0];
      const candLat = candidate.location?.latitude ?? null;
      const candLng = candidate.location?.longitude ?? null;
      const hasStoredCoords =
        party.latitude !== null && party.longitude !== null;

      if (hasStoredCoords && candLat !== null && candLng !== null) {
        distanceKm = haversineKm(
          party.latitude,
          party.longitude,
          candLat,
          candLng
        );
        if (distanceKm !== null && distanceKm < AUTO_THRESHOLD_KM) {
          flag = 'OK_AUTO';
        } else if (distanceKm !== null && distanceKm <= REVIEW_THRESHOLD_KM) {
          flag = 'OK_REVIEW';
        } else {
          flag = 'MANUAL';
        }
      } else if (places.length === 1) {
        flag = 'OK_REVIEW';
      } else {
        flag = 'MANUAL';
      }
    }

    counts[flag] = (counts[flag] || 0) + 1;

    const distanceStr =
      distanceKm !== null ? distanceKm.toFixed(3) : '';
    console.log(
      `[${i + 1}/${allParties.length}] ${slug} — ${flag}` +
        (distanceKm !== null ? ` — ${distanceStr}km` : '')
    );

    csvRows.push(
      [
        party.id,
        slug,
        party.address,
        party.venue_name,
        party.latitude,
        party.longitude,
        candidate?.id || '',
        candidate?.displayName?.text || '',
        candidate?.formattedAddress || '',
        candidate?.location?.latitude ?? '',
        candidate?.location?.longitude ?? '',
        distanceStr,
        flag,
        httpStatus,
        error || '',
      ]
        .map(csvEscape)
        .join(',')
    );

    // Throttle to stay well under Google's QPS quota.
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const outName = `backfill-place-ids-${timestampString()}.csv`;
  const outPath = path.join(__dirname, outName);
  fs.writeFileSync(outPath, csvRows.join('\n') + '\n', 'utf8');

  console.log('');
  console.log('=== Summary ===');
  console.log(`Total candidates : ${allParties.length}`);
  console.log(`API calls made   : ${totalApiCalls}`);
  console.log(`No-result count  : ${noResultCount}`);
  console.log(`OK_AUTO          : ${counts.OK_AUTO}`);
  console.log(`OK_REVIEW        : ${counts.OK_REVIEW}`);
  console.log(`MANUAL           : ${counts.MANUAL}`);
  console.log('');
  console.log(`CSV written to   : ${outPath}`);
  console.log('Review the CSV and annotate an `approved` column (true/false/skip)');
  console.log('before running the apply step (separate script).');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
