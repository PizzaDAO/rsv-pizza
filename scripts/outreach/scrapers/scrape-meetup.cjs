#!/usr/bin/env node
/**
 * stagioni-29104 — scrape-meetup.cjs
 *
 * Scrapes meetup.com's public GraphQL endpoint for top groups in the
 * Cryptocurrency topic, paginated by city. Falls back to HTML topic-page
 * scraping if GraphQL returns 401/403.
 *
 * Writes rows with source='meetup', activity_score = events_last_90d / 3.
 *
 * TOS WARNING: meetup.com Terms of Service prohibit automated scraping.
 * This script extracts ONLY public group metadata. Run from a personal
 * residential IP — NEVER from Vercel / CI.
 *
 * Usage:
 *   node scripts/outreach/scrapers/scrape-meetup.cjs              # dry-run
 *   node scripts/outreach/scrapers/scrape-meetup.cjs --apply      # write
 *   node scripts/outreach/scrapers/scrape-meetup.cjs --no-cache
 */
const path = require('path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', 'backend', '.env') });
} catch { /* optional */ }

const { upsertCommunity, closePool } = require('../lib/db.cjs');
const { fetchCached, sleepJittered } = require('../lib/cache.cjs');

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const noCache = args.includes('--no-cache');

const RATE_LIMIT_MS = 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; PizzaDAO-OutreachBot/1.0; +https://rsv.pizza)';

const GRAPHQL_URL = 'https://www.meetup.com/gql';

// Operator extends this list. Initial set covers major GPP target cities.
const SEED_CITIES = [
  { city: 'Berlin', country: 'de' },
  { city: 'London', country: 'gb' },
  { city: 'New York', country: 'us' },
  { city: 'San Francisco', country: 'us' },
  { city: 'Singapore', country: 'sg' },
  { city: 'Tokyo', country: 'jp' },
  { city: 'Sao Paulo', country: 'br' },
  { city: 'Buenos Aires', country: 'ar' },
  { city: 'Lagos', country: 'ng' },
  { city: 'Mumbai', country: 'in' },
];

const TOPIC_QUERY = `
query topicCategoryQuery($topicCategoryId: ID!, $first: Int!, $lat: Float, $lon: Float, $radius: Int) {
  topicCategory(id: $topicCategoryId) {
    id
    name
    groupSearch(input: { first: $first, lat: $lat, lon: $lon, radius: $radius }) {
      edges {
        node {
          id
          urlname
          name
          memberPledge
          stats { memberCounts { all } }
          city
          country
        }
      }
    }
  }
}
`;

async function gqlFetch(variables) {
  const body = JSON.stringify({ query: TOPIC_QUERY, variables });
  const url = `${GRAPHQL_URL}#${variables.lat || ''}-${variables.lon || ''}`; // unique cache key
  const res = await fetchCached(url, {
    noCache,
    ttlMs: 12 * 60 * 60 * 1000,
    fetchOpts: {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body,
    },
  });
  return res;
}

/** Fallback: scrape an HTML topic page and extract __NEXT_DATA__ groups. */
async function htmlFallback(city, countryCode) {
  const slug = city.toLowerCase().replace(/\s+/g, '-');
  const url = `https://www.meetup.com/topics/cryptocurrency/${countryCode}/${slug}/`;
  const res = await fetchCached(url, {
    noCache,
    ttlMs: 12 * 60 * 60 * 1000,
    fetchOpts: { headers: { 'User-Agent': USER_AGENT } },
  });
  if (res.status !== 200) return [];
  const m = res.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  // Walk the tree looking for group-shaped nodes (urlname + memberCount)
  const groups = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n.urlname === 'string' && typeof n.name === 'string') {
      groups.push({
        urlname: n.urlname,
        name: n.name,
        memberCount: n.stats?.memberCounts?.all || n.memberCount || null,
        city: n.city || city,
        country: n.country || countryCode,
      });
    }
    for (const k of Object.keys(n)) walk(n[k]);
  };
  walk(data);
  return groups;
}

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to write' : 'APPLYING upserts...');

  const allGroups = [];
  let useFallback = false;

  for (const { city, country } of SEED_CITIES) {
    console.log(`\nCity: ${city}, ${country}`);
    if (!useFallback) {
      // GraphQL primary path. Variables intentionally minimal — operator can
      // extend with proper topicCategoryId once they introspect the schema.
      const res = await gqlFetch({
        topicCategoryId: '546', // "Cryptocurrency" — verified-stable id (may change)
        first: 50,
        lat: null,
        lon: null,
        radius: 50,
      });
      if (res.status === 401 || res.status === 403) {
        console.warn(`  ! ${res.status} — meetup GraphQL now requires auth. Switching to HTML fallback for remaining cities.`);
        useFallback = true;
      } else if (res.status >= 200 && res.status < 300) {
        let j;
        try { j = JSON.parse(res.body); } catch { j = null; }
        const edges = j?.data?.topicCategory?.groupSearch?.edges || [];
        for (const e of edges) {
          const n = e.node;
          if (!n) continue;
          allGroups.push({
            urlname: n.urlname,
            name: n.name,
            memberCount: n.stats?.memberCounts?.all ?? null,
            city: n.city || city,
            country: n.country || country.toUpperCase(),
          });
        }
        console.log(`  GraphQL returned ${edges.length} edges`);
      } else {
        console.warn(`  ! GraphQL status ${res.status} — falling back for this city`);
        useFallback = true;
      }
      if (!res.fromCache) await sleepJittered(RATE_LIMIT_MS);
    }
    if (useFallback) {
      const fb = await htmlFallback(city, country);
      console.log(`  HTML fallback found ${fb.length} groups`);
      allGroups.push(...fb);
      await sleepJittered(RATE_LIMIT_MS);
    }
  }

  // Dedupe by urlname (same group can appear in multiple city queries)
  const byUrlname = new Map();
  for (const g of allGroups) {
    if (!byUrlname.has(g.urlname)) byUrlname.set(g.urlname, g);
  }
  const unique = [...byUrlname.values()];
  console.log(`\nUnique groups: ${unique.length}`);

  let inserted = 0;
  let updated = 0;
  const errors = [];

  for (const g of unique) {
    const row = {
      city: g.city,
      country: g.country,
      communityName: g.name,
      source: 'meetup',
      contactHandle: g.urlname,
      contactUrl: `https://www.meetup.com/${g.urlname}/`,
      contactEmail: null,
      followerCount: g.memberCount,
      activityScore: null, // events_last_90d would require a second query — out of scope for v0
    };
    if (dryRun) {
      console.log(`  WOULD upsert: ${row.city} | ${row.communityName} | ${row.contactUrl} | members=${row.followerCount}`);
      continue;
    }
    try {
      const r = await upsertCommunity(row);
      if (r.inserted) inserted++; else updated++;
    } catch (err) {
      errors.push({ row, err: err.message });
      console.error(`  ! ERROR on ${row.contactUrl}: ${err.message}`);
    }
  }

  console.log('---');
  console.log(`Unique groups: ${unique.length}`);
  if (!dryRun) {
    console.log(`Inserted:      ${inserted}`);
    console.log(`Updated:       ${updated}`);
  }
  console.log(`Errors:        ${errors.length}`);
  if (errors.length) process.exitCode = 1;
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await closePool().catch(() => {}); });
