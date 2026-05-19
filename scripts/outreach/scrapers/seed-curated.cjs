#!/usr/bin/env node
/**
 * stagioni-29104 — seed-curated.cjs
 *
 * Reads scripts/outreach/curated-communities.json and upserts every entry
 * into outreach_communities with source='curated'. NO HTTP — pure DB writes.
 *
 * Run this FIRST. It validates the upsert pipeline end-to-end and seeds the
 * canonical city list that scrape-x-handles.cjs uses for pattern generation.
 *
 * Usage:
 *   # source backend/.env first, or pass DATABASE_URL inline:
 *   node scripts/outreach/scrapers/seed-curated.cjs              # dry-run
 *   node scripts/outreach/scrapers/seed-curated.cjs --apply      # write
 *
 * Idempotent: re-running yields the same row count. Manual edits to
 * priority and notes are preserved across runs.
 */
const path = require('path');
const fs = require('fs');

// dotenv lookup: prefer backend/.env, fall back to repo-root .env
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', 'backend', '.env') });
} catch {
  /* dotenv optional if env already set */
}

const { upsertCommunity, closePool } = require('../lib/db.cjs');

const CURATED_PATH = path.resolve(__dirname, '..', 'curated-communities.json');
const dryRun = !process.argv.includes('--apply');

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to write' : 'APPLYING upserts...');

  const raw = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
  // Skip the comment-header entry (first object with _comment_header key)
  const entries = raw.filter(e => !e._comment_header);
  console.log(`Loaded ${entries.length} curated entries`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const e of entries) {
    if (!e.city || !e.communityName || !e.contactUrl) {
      console.warn(`  SKIP malformed entry: ${JSON.stringify(e)}`);
      skipped++;
      continue;
    }
    const row = {
      city: e.city,
      country: e.country || null,
      communityName: e.communityName,
      source: 'curated',
      contactHandle: e.contactHandle || null,
      contactUrl: e.contactUrl,
      contactEmail: e.contactEmail || null,
      followerCount: null,
      activityScore: null,
    };
    if (dryRun) {
      console.log(`  WOULD upsert: ${row.source} | ${row.city} | ${row.communityName} | ${row.contactUrl}`);
      continue;
    }
    try {
      const res = await upsertCommunity(row);
      if (res.inserted) {
        inserted++;
        console.log(`  + INSERTED: ${row.city} | ${row.communityName}`);
      } else {
        updated++;
        console.log(`  ~ UPDATED:  ${row.city} | ${row.communityName}`);
      }
    } catch (err) {
      errors.push({ row, err: err.message });
      console.error(`  ! ERROR on ${row.contactUrl}: ${err.message}`);
    }
  }

  console.log('---');
  console.log(`Total entries:   ${entries.length}`);
  if (!dryRun) {
    console.log(`Inserted:        ${inserted}`);
    console.log(`Updated:         ${updated}`);
  }
  console.log(`Skipped:         ${skipped}`);
  console.log(`Errors:          ${errors.length}`);
  if (errors.length) process.exitCode = 1;
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await closePool().catch(() => {}); });
