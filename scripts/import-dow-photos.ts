/**
 * One-time import script: DOW Pizza Party photos → RSVPizza
 *
 * Fetches photos.json from app.gpp.day/api/photos.json, maps cities
 * to GPP events, and inserts rows into the gpp_photos table using
 * app.gpp.day URLs (photos are already hosted there — no upload needed).
 *
 * Usage:
 *   npx tsx scripts/import-dow-photos.ts
 *
 * Requires:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (project root)
 *   - @supabase/supabase-js, dotenv installed
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import dotenv from 'dotenv';

// Load env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Photos manifest and images are hosted on app.gpp.day
const PHOTO_BASE_URL = 'https://app.gpp.day';
const PHOTOS_JSON_URL = 'https://app.gpp.day/api/photos.json';

interface DowPhoto {
  src: string;
}

interface DowYear {
  year: number;
  photos: DowPhoto[];
}

interface DowCity {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  countryCode?: string;
  years: DowYear[];
}

interface DowManifest {
  cities: DowCity[];
  uncategorized?: any[];
}

async function main() {
  console.log('=== DOW Photos Import ===\n');

  // 1. Fetch manifest from app.gpp.day
  console.log(`Fetching manifest from ${PHOTOS_JSON_URL}...`);
  const res = await fetch(PHOTOS_JSON_URL);
  if (!res.ok) {
    console.error(`Failed to fetch photos.json: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const manifest: DowManifest = await res.json();
  console.log(`Loaded manifest: ${manifest.cities.length} cities`);

  // 2. Query all GPP parties to build customUrl → partyId map
  const { data: gppParties, error: gppError } = await supabase
    .from('parties')
    .select('id, custom_url')
    .eq('event_type', 'gpp');

  if (gppError) {
    console.error('Failed to query GPP parties:', gppError);
    process.exit(1);
  }

  const urlToPartyId = new Map<string, string>();
  for (const party of gppParties || []) {
    if (party.custom_url) {
      urlToPartyId.set(party.custom_url.toLowerCase(), party.id);
    }
  }
  console.log(`Found ${urlToPartyId.size} GPP parties with custom URLs\n`);

  // 3. Check existing imports to skip duplicates
  const { data: existingPhotos, error: existingError } = await supabase
    .from('gpp_photos')
    .select('city_slug, photo_index, year');

  if (existingError) {
    console.error('Failed to query existing photos:', existingError);
    process.exit(1);
  }

  const existingSet = new Set<string>();
  for (const p of existingPhotos || []) {
    existingSet.add(`${p.city_slug}:${p.year}:${p.photo_index}`);
  }
  console.log(`Found ${existingSet.size} already-imported photos (will skip)\n`);

  // Stats
  let totalPhotos = 0;
  let insertedPhotos = 0;
  let skippedPhotos = 0;
  let failedPhotos = 0;
  const matchedCities: string[] = [];
  const unmatchedCities: string[] = [];

  // 4. Build batch of rows to insert
  const rows: any[] = [];

  for (const city of manifest.cities) {
    const expectedUrl = city.name.toLowerCase().replace(/\s+/g, '');
    const partyId = urlToPartyId.get(expectedUrl) || null;

    if (partyId) {
      matchedCities.push(`${city.name} → ${expectedUrl}`);
    } else {
      unmatchedCities.push(`${city.name} (expected: ${expectedUrl})`);
    }

    for (const yearData of city.years) {
      for (let i = 0; i < yearData.photos.length; i++) {
        totalPhotos++;
        const photo = yearData.photos[i];
        const photoIndex = i + 1;

        // Skip if already imported
        const key = `${city.slug}:${yearData.year}:${photoIndex}`;
        if (existingSet.has(key)) {
          skippedPhotos++;
          continue;
        }

        // photo.src is like "/photos/austin/2025/01.jpg"
        const storageUrl = `${PHOTO_BASE_URL}${photo.src}`;
        const originalFilename = path.basename(photo.src);

        rows.push({
          party_id: partyId,
          city_slug: city.slug,
          city_name: city.name,
          country_code: city.countryCode || null,
          year: yearData.year,
          photo_index: photoIndex,
          storage_url: storageUrl,
          original_filename: originalFilename,
          file_size: null,
          width: null,
          height: null,
        });
      }
    }
  }

  // 5. Insert in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from('gpp_photos')
      .insert(batch);

    if (insertError) {
      console.warn(`  BATCH FAIL (rows ${i}-${i + batch.length}): ${insertError.message}`);
      failedPhotos += batch.length;
    } else {
      insertedPhotos += batch.length;
      console.log(`  Inserted ${insertedPhotos}/${rows.length} rows`);
    }
  }

  // 6. Print summary
  console.log('\n=== Import Summary ===');
  console.log(`Total photos in manifest: ${totalPhotos}`);
  console.log(`Inserted:  ${insertedPhotos}`);
  console.log(`Skipped (already imported): ${skippedPhotos}`);
  console.log(`Failed:    ${failedPhotos}`);
  console.log(`\nCities matched to GPP events: ${matchedCities.length}`);
  console.log(`Cities with no match: ${unmatchedCities.length}`);
  console.log(`\nPhoto URLs use: ${PHOTO_BASE_URL}/photos/{city}/{year}/{nn}.jpg`);

  if (unmatchedCities.length > 0 && unmatchedCities.length <= 30) {
    console.log('\nUnmatched cities:');
    unmatchedCities.forEach((c) => console.log(`  - ${c}`));
  } else if (unmatchedCities.length > 30) {
    console.log(`\nFirst 30 unmatched cities:`);
    unmatchedCities.slice(0, 30).forEach((c) => console.log(`  - ${c}`));
    console.log(`  ... and ${unmatchedCities.length - 30} more`);
  }

  // List GPP events with no photos
  const matchedPartyIds = new Set(matchedCities.map((c) => {
    const url = c.split(' → ')[1];
    return urlToPartyId.get(url);
  }));

  const gppEventsNoPhotos = (gppParties || []).filter(
    (p) => !matchedPartyIds.has(p.id)
  );

  if (gppEventsNoPhotos.length > 0) {
    console.log(`\nGPP events with no DOW photos: ${gppEventsNoPhotos.length}`);
    gppEventsNoPhotos.slice(0, 20).forEach((p) =>
      console.log(`  - ${p.custom_url || '(no custom URL)'}`)
    );
    if (gppEventsNoPhotos.length > 20) {
      console.log(`  ... and ${gppEventsNoPhotos.length - 20} more`);
    }
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
