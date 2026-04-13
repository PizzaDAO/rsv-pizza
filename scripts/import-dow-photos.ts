/**
 * One-time import script: DOW Pizza Party photos → RSVPizza
 *
 * Reads photos.json from the DOW project, optimizes images with sharp,
 * uploads to Supabase Storage (dow-photos bucket), and inserts rows
 * into the dow_photos table.
 *
 * Usage:
 *   npx tsx scripts/import-dow-photos.ts
 *
 * Requires:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (project root)
 *   - `dow-photos` Storage bucket created in Supabase Dashboard (public)
 *   - sharp, @supabase/supabase-js, dotenv installed
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import * as fs from 'fs';
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

// Paths
const DOW_PROJECT_ROOT = 'C:/Users/samgo/OneDrive/Documents/PizzaDAO/Code/dow-pizza-party';
const PHOTOS_JSON_PATH = path.join(DOW_PROJECT_ROOT, 'src', 'data', 'photos.json');
const DOW_PUBLIC_DIR = path.join(DOW_PROJECT_ROOT, 'public');

const STORAGE_BUCKET = 'dow-photos';
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 80;

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

  // 1. Load manifest
  const manifest: DowManifest = JSON.parse(fs.readFileSync(PHOTOS_JSON_PATH, 'utf-8'));
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

  // 3. Check existing uploads to skip duplicates
  const { data: existingPhotos, error: existingError } = await supabase
    .from('dow_photos')
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

  // Stats tracking
  let totalPhotos = 0;
  let uploadedPhotos = 0;
  let skippedPhotos = 0;
  let failedPhotos = 0;
  let totalBytes = 0;
  const matchedCities: string[] = [];
  const unmatchedCities: string[] = [];

  // 4. Process each city
  for (const city of manifest.cities) {
    // Compute expected customUrl: city name → lowercase, no spaces
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

        try {
          // Build source path (photo.src starts with /photos/...)
          const srcRelative = photo.src.startsWith('/') ? photo.src.slice(1) : photo.src;
          const srcPath = path.join(DOW_PUBLIC_DIR, srcRelative);

          if (!fs.existsSync(srcPath)) {
            console.warn(`  SKIP (missing): ${srcPath}`);
            failedPhotos++;
            continue;
          }

          // Read and optimize with sharp
          const inputBuffer = fs.readFileSync(srcPath);
          const image = sharp(inputBuffer);
          const metadata = await image.metadata();

          const optimized = await image
            .resize({
              width: MAX_DIMENSION,
              height: MAX_DIMENSION,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: JPEG_QUALITY })
            .toBuffer();

          const optimizedMeta = await sharp(optimized).metadata();

          // Storage path: {city-slug}/{year}/{nn}.jpg
          const paddedIndex = String(photoIndex).padStart(2, '0');
          const storagePath = `${city.slug}/${yearData.year}/${paddedIndex}.jpg`;

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, optimized, {
              contentType: 'image/jpeg',
              cacheControl: '31536000', // 1 year
              upsert: false,
            });

          if (uploadError) {
            // If file already exists, get the URL anyway
            if (uploadError.message?.includes('already exists') || uploadError.message?.includes('Duplicate')) {
              console.log(`  EXISTS: ${storagePath}`);
            } else {
              console.warn(`  UPLOAD FAIL: ${storagePath} — ${uploadError.message}`);
              failedPhotos++;
              continue;
            }
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(storagePath);

          const storageUrl = urlData.publicUrl;

          // Original filename from source path
          const originalFilename = path.basename(photo.src);

          // Insert DB row
          const { error: insertError } = await supabase
            .from('dow_photos')
            .insert({
              party_id: partyId,
              city_slug: city.slug,
              city_name: city.name,
              country_code: city.countryCode || null,
              year: yearData.year,
              photo_index: photoIndex,
              storage_url: storageUrl,
              original_filename: originalFilename,
              file_size: optimized.length,
              width: optimizedMeta.width || null,
              height: optimizedMeta.height || null,
            });

          if (insertError) {
            console.warn(`  DB FAIL: ${storagePath} — ${insertError.message}`);
            failedPhotos++;
            continue;
          }

          uploadedPhotos++;
          totalBytes += optimized.length;

          // Progress log every 50 photos
          if (uploadedPhotos % 50 === 0) {
            console.log(`  Progress: ${uploadedPhotos} uploaded, ${totalPhotos} total processed`);
          }
        } catch (err: any) {
          console.warn(`  ERROR: ${city.slug}/${yearData.year}/${i + 1} — ${err.message}`);
          failedPhotos++;
        }
      }
    }
  }

  // 5. Print summary
  console.log('\n=== Import Summary ===');
  console.log(`Total photos in manifest: ${totalPhotos}`);
  console.log(`Uploaded:  ${uploadedPhotos}`);
  console.log(`Skipped (already imported): ${skippedPhotos}`);
  console.log(`Failed:    ${failedPhotos}`);
  console.log(`Storage used: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`\nCities matched to GPP events: ${matchedCities.length}`);
  console.log(`Cities with no match: ${unmatchedCities.length}`);

  if (unmatchedCities.length > 0 && unmatchedCities.length <= 30) {
    console.log('\nUnmatched cities:');
    unmatchedCities.forEach((c) => console.log(`  - ${c}`));
  } else if (unmatchedCities.length > 30) {
    console.log(`\nFirst 30 unmatched cities:`);
    unmatchedCities.slice(0, 30).forEach((c) => console.log(`  - ${c}`));
    console.log(`  ... and ${unmatchedCities.length - 30} more`);
  }

  // List GPP events that have NO photos
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
