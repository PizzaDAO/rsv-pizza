#!/usr/bin/env node
/**
 * stagioni-29104 — scrape-x-handles.cjs
 *
 * For each city in curated-communities.json, generate candidate X (Twitter)
 * handles via pattern templates and look them up against the public
 * api.fxtwitter.com metadata endpoint. Writes any that resolve to a real
 * profile with source='twitter'.
 *
 * Patterns: <city>eth, web3<city>, <city>dao, eth<city>, <city>web3.
 *
 * NOTE: pattern-match is noisy by design — every output row is auto-flagged
 * for manual triage (priority NULL, notes='auto-flagged for manual triage').
 *
 * TOS WARNING: x.com Terms of Service prohibit automated scraping. This
 * script uses api.fxtwitter.com which is a community embed-unfurl service,
 * NOT x.com directly. If fxtwitter is unavailable, skip and log.
 *
 * Usage:
 *   node scripts/outreach/scrapers/scrape-x-handles.cjs              # dry-run
 *   node scripts/outreach/scrapers/scrape-x-handles.cjs --apply      # write
 *   node scripts/outreach/scrapers/scrape-x-handles.cjs --no-cache
 */
const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', 'backend', '.env') });
} catch { /* optional */ }

const { upsertCommunity, closePool } = require('../lib/db.cjs');
const { fetchCached, sleepJittered } = require('../lib/cache.cjs');
const { normalizeCity } = require('../lib/normalize.cjs');

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const noCache = args.includes('--no-cache');

const RATE_LIMIT_MS = 2000; // 0.5 req/sec
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const USER_AGENT = 'Mozilla/5.0 (compatible; PizzaDAO-OutreachBot/1.0; +https://rsv.pizza)';

const CURATED_PATH = path.resolve(__dirname, '..', 'curated-communities.json');

function citySlug(city) {
  return normalizeCity(city).replace(/\s+/g, '');
}

function candidates(city) {
  const s = citySlug(city);
  if (!s) return [];
  return [
    `${s}eth`,
    `web3${s}`,
    `${s}dao`,
    `eth${s}`,
    `${s}web3`,
  ];
}

async function lookup(handle) {
  const url = `https://api.fxtwitter.com/${encodeURIComponent(handle)}`;
  try {
    const res = await fetchCached(url, {
      noCache,
      ttlMs: CACHE_TTL_MS,
      fetchOpts: { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } },
    });
    if (res.status === 404) return { found: false };
    if (res.status < 200 || res.status >= 300) {
      return { found: false, status: res.status };
    }
    let j;
    try { j = JSON.parse(res.body); } catch { return { found: false }; }
    const user = j?.user || j?.tweet?.author;
    if (!user || !user.screen_name) return { found: false };
    return {
      found: true,
      screen_name: user.screen_name,
      name: user.name || user.screen_name,
      followers: user.followers ?? null,
    };
  } catch (e) {
    console.warn(`  ! fetch error on ${handle}: ${e.message}`);
    return { found: false };
  }
}

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to write' : 'APPLYING upserts...');

  const raw = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
  const cities = [...new Set(
    raw.filter(e => !e._comment_header && e.city).map(e => e.city)
  )];
  console.log(`Loaded ${cities.length} canonical cities`);

  const found = [];
  let attempted = 0;
  let hits = 0;
  let misses = 0;

  for (const city of cities) {
    const handles = candidates(city);
    console.log(`\nCity: ${city} — candidates: ${handles.join(', ')}`);
    for (const h of handles) {
      attempted++;
      const res = await lookup(h);
      if (res.found) {
        hits++;
        console.log(`  + ${h} -> ${res.name} (${res.followers} followers)`);
        found.push({
          city,
          handle: res.screen_name,
          name: res.name,
          followers: res.followers,
        });
      } else {
        misses++;
      }
      // sleep AFTER every request including cache hits — be a good citizen
      await sleepJittered(RATE_LIMIT_MS / 4);
    }
  }

  console.log(`\nAttempted: ${attempted} | Hits: ${hits} | Misses: ${misses}`);

  let inserted = 0;
  let updated = 0;
  const errors = [];

  for (const f of found) {
    const row = {
      city: f.city,
      country: null,
      communityName: f.name,
      source: 'twitter',
      contactHandle: '@' + f.handle,
      contactUrl: `https://x.com/${f.handle}`,
      contactEmail: null,
      followerCount: f.followers,
      activityScore: null,
    };
    if (dryRun) {
      console.log(`  WOULD upsert: ${row.city} | ${row.communityName} | ${row.contactUrl}`);
      continue;
    }
    try {
      const r = await upsertCommunity(row);
      if (r.inserted) inserted++; else updated++;
      // After insert, set notes='auto-flagged for manual triage' ONLY if notes is null
      // (preserve operator's manual edits). Use a separate small query for clarity.
      const { getPool } = require('../lib/db.cjs');
      await getPool().query(
        `UPDATE outreach_communities
           SET notes = 'auto-flagged for manual triage'
         WHERE source = 'twitter'
           AND contact_url = $1
           AND notes IS NULL`,
        [row.contactUrl],
      );
    } catch (err) {
      errors.push({ row, err: err.message });
      console.error(`  ! ERROR on ${row.contactUrl}: ${err.message}`);
    }
  }

  console.log('---');
  console.log(`Resolved handles: ${found.length}`);
  if (!dryRun) {
    console.log(`Inserted:         ${inserted}`);
    console.log(`Updated:          ${updated}`);
  }
  console.log(`Errors:           ${errors.length}`);
  if (errors.length) process.exitCode = 1;
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await closePool().catch(() => {}); });
