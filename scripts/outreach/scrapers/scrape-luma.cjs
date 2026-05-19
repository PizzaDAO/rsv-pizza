#!/usr/bin/env node
/**
 * stagioni-29104 — scrape-luma.cjs
 *
 * Scrapes lu.ma/discover for crypto/web3 events and extracts host handles,
 * deriving an `activity_score` from the host's event count over the trailing
 * 12 months. Writes one row per unique (host, city) to outreach_communities
 * with source='luma'.
 *
 * TOS WARNING: lu.ma Terms of Service prohibit automated scraping. This
 * script extracts ONLY public organizer handles from publicly listed events.
 * Run from a personal residential IP — NEVER from Vercel / CI. If lu.ma
 * serves a CAPTCHA or 403, stop and fall back to the curated seed.
 *
 * Usage:
 *   node scripts/outreach/scrapers/scrape-luma.cjs              # dry-run
 *   node scripts/outreach/scrapers/scrape-luma.cjs --apply      # write
 *   node scripts/outreach/scrapers/scrape-luma.cjs --no-cache   # bypass cache
 *   node scripts/outreach/scrapers/scrape-luma.cjs --category=crypto-web3
 */
const path = require('path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', 'backend', '.env') });
} catch { /* optional */ }

const { upsertCommunity, closePool } = require('../lib/db.cjs');
const { fetchCached, sleepJittered } = require('../lib/cache.cjs');
const { normalizeCity } = require('../lib/normalize.cjs');

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const noCache = args.includes('--no-cache');
const categoryArg = args.find(a => a.startsWith('--category='));
const category = categoryArg ? categoryArg.split('=')[1] : 'crypto-web3';

const RATE_LIMIT_MS = 1500;
const BACKOFF_MAX_MS = 60_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; PizzaDAO-OutreachBot/1.0; +https://rsv.pizza)';

const DISCOVER_URLS = [
  `https://lu.ma/discover?category=${encodeURIComponent(category)}`,
  // Optional: per-city facets — lu.ma routes city via geo query string
  // Operator can edit this list to bias the crawl toward GPP target cities.
];

/** Extract the __NEXT_DATA__ JSON blob from a lu.ma HTML page. */
function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    console.warn('  ! __NEXT_DATA__ JSON parse failed:', e.message);
    return null;
  }
}

/** Walk the __NEXT_DATA__ tree and return any objects that look like event listings. */
function findEvents(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const x of node) findEvents(x, out);
    return out;
  }
  // Heuristic: a lu.ma event object has either `api_id` + `name` + `start_at`,
  // or nested under `event` with the same shape.
  if (
    typeof node.api_id === 'string' &&
    typeof node.name === 'string' &&
    typeof node.start_at === 'string'
  ) {
    out.push(node);
  } else if (node.event && typeof node.event === 'object') {
    findEvents(node.event, out);
  }
  for (const k of Object.keys(node)) {
    if (k === 'event') continue;
    findEvents(node[k], out);
  }
  return out;
}

async function fetchDiscover(url) {
  let attempt = 0;
  let backoff = 2000;
  while (attempt < 5) {
    const res = await fetchCached(url, {
      noCache,
      ttlMs: 6 * 60 * 60 * 1000,
      fetchOpts: { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' } },
    });
    if (res.status === 429 || res.status === 503) {
      console.warn(`  ! ${res.status} on ${url} — backoff ${backoff}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
      attempt++;
      continue;
    }
    if (res.status === 403 || res.status === 401) {
      console.error(`  ! ${res.status} CAPTCHA / login-wall on ${url} — STOP and fall back to curated`);
      return null;
    }
    if (res.status < 200 || res.status >= 300) {
      console.warn(`  ! ${res.status} on ${url} — skipping`);
      return null;
    }
    return res;
  }
  console.error(`  ! Giving up on ${url} after ${attempt} retries`);
  return null;
}

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to write' : 'APPLYING upserts...');
  console.log(`Category: ${category}`);

  const hosts = new Map(); // key: `${username}|${normalizedCity}` -> { ... }

  for (const url of DISCOVER_URLS) {
    console.log(`\nFetching ${url}`);
    const res = await fetchDiscover(url);
    if (!res) continue;
    if (!res.fromCache) await sleepJittered(RATE_LIMIT_MS);

    const data = extractNextData(res.body);
    if (!data) {
      console.warn('  ! No __NEXT_DATA__ blob found — page structure may have changed');
      continue;
    }
    const events = findEvents(data);
    console.log(`  Found ${events.length} event-shaped objects`);

    for (const ev of events) {
      const host = ev.calendar || ev.host || ev.organizer;
      if (!host || !host.api_id) continue;
      const username = host.url_path || host.username || host.slug;
      const hostName = host.name || host.display_name;
      const city = ev.geo_address_info?.city || ev.geo_city || ev.city || '';
      if (!username || !hostName || !city) continue;

      const key = `${username}|${normalizeCity(city)}`;
      const existing = hosts.get(key) || {
        username,
        hostName,
        city,
        country: ev.geo_address_info?.country || null,
        eventCount: 0,
      };
      existing.eventCount += 1;
      hosts.set(key, existing);
    }
  }

  console.log(`\nUnique (host, city) pairs: ${hosts.size}`);
  let inserted = 0;
  let updated = 0;
  const errors = [];

  for (const h of hosts.values()) {
    const row = {
      city: h.city,
      country: h.country,
      communityName: h.hostName,
      source: 'luma',
      contactHandle: '@' + h.username,
      contactUrl: `https://lu.ma/u/${h.username}`,
      contactEmail: null,
      followerCount: null,
      activityScore: h.eventCount / 12, // events per month assuming 12-month window
    };
    if (dryRun) {
      console.log(`  WOULD upsert: ${row.city} | ${row.communityName} | ${row.contactUrl} | activity=${row.activityScore.toFixed(2)}`);
      continue;
    }
    try {
      const res = await upsertCommunity(row);
      if (res.inserted) inserted++; else updated++;
    } catch (err) {
      errors.push({ row, err: err.message });
      console.error(`  ! ERROR on ${row.contactUrl}: ${err.message}`);
    }
  }

  console.log('---');
  console.log(`Hosts collected: ${hosts.size}`);
  if (!dryRun) {
    console.log(`Inserted:        ${inserted}`);
    console.log(`Updated:         ${updated}`);
  }
  console.log(`Errors:          ${errors.length}`);
  if (errors.length) process.exitCode = 1;
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await closePool().catch(() => {}); });
