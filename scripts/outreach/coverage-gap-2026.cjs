#!/usr/bin/env node
/**
 * scripts/outreach/coverage-gap-2026.cjs
 *
 * supreme-43217: GPP 2026 blockchain-city coverage gap analysis.
 *
 * Ranks world cities (>15k population, GeoNames cities15000 dataset) by
 *     log10(population) * web3_score * (1 - has_gpp_party_for_2026)
 * and writes the top N to a new Google Sheet. Cities with an existing GPP 2026
 * event are zeroed out so they never appear in the top list — they're still
 * logged on a separate "Covered Cities" tab for QA.
 *
 * Web3 scoring is a 30-entry curated seed (data/web3-cities-seed.json) in v1.
 * Task stagioni-29104 (Task B) will replace this with scraper-derived per-city
 * event counts queried out of an `outreach_communities` table.
 *
 * Inputs:
 *   - PG via DATABASE_URL (loaded from backend/.env). Mirrors the pattern in
 *     scripts/check-schema-drift.js and backend/scripts/restore-mc-deletions.cjs.
 *   - GeoNames cities15000.txt (data/cities15000.txt) — CC-BY GeoNames.
 *   - Seed scores (data/web3-cities-seed.json) — editable.
 *   - Manual aliases (data/city-aliases.json) — editable when the matcher
 *     produces unmatched-GPP-event warnings.
 *
 * Output:
 *   - New Google Sheet, or overwrite existing via --sheet-id=<id>.
 *   - Print final sheet URL to stdout.
 *
 * Usage:
 *   node scripts/outreach/coverage-gap-2026.cjs [flags]
 *
 * Flags:
 *   --dry-run                  Print top 20 to stdout, don't write any sheet.
 *   --coverage-mode=<mode>     'any' (default) treats any 2026 GPP party as
 *                              coverage. 'approved-only' restricts to
 *                              underboss_status='approved'.
 *   --limit=<N>                Top N rows to emit (default 200).
 *   --sheet-id=<id>            Overwrite an existing sheet instead of creating
 *                              one. The script will add any missing tabs.
 *   --calendar-link=<url>      Override the hard-coded host-onboarding link.
 *                              Default: https://cal.com/pizzadao/gpp-host
 *
 * Plan: plans/supreme-43217-blockchain-city-gap-analysis.md
 */

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────────────────
// Env: load backend/.env (DATABASE_URL) AND scripts/outreach/.env (OAuth).
// ──────────────────────────────────────────────────────────────────────────
(function loadEnv() {
  const candidates = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '..', 'backend', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        require('dotenv').config({ path: p });
      } catch (_) {
        // dotenv is in root deps, but be defensive
      }
    }
  }
})();

const { Client } = require('pg');
const {
  normalize,
  cityKey,
  extractGppCity,
} = require('./lib/normalize-city.cjs');
const { loadGeoNames } = require('./lib/load-geonames.cjs');

// Sheets writer is loaded lazily so --dry-run works without googleapis being
// fully wired up (and without an OAuth env).
function lazyLoadSheets() {
  return require('./lib/sheets-writer.cjs');
}

const DATA_DIR = path.join(__dirname, 'data');
const GEONAMES_PATH = path.join(DATA_DIR, 'cities15000.txt');
const SEED_PATH = path.join(DATA_DIR, 'web3-cities-seed.json');
const ALIASES_PATH = path.join(DATA_DIR, 'city-aliases.json');
const ISO2_COUNTRY_PATH = path.join(DATA_DIR, 'iso2-to-country.json');

const DEFAULT_CALENDAR_LINK = 'https://cal.com/pizzadao/gpp-host';

// ──────────────────────────────────────────────────────────────────────────
// CLI flags
// ──────────────────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const flags = {
    dryRun: false,
    coverageMode: 'any',
    limit: 200,
    sheetId: null,
    calendarLink: DEFAULT_CALENDAR_LINK,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--coverage-mode=')) {
      flags.coverageMode = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      flags.limit = parseInt(arg.split('=')[1], 10) || 200;
    } else if (arg.startsWith('--sheet-id=')) {
      flags.sheetId = arg.split('=')[1];
    } else if (arg.startsWith('--calendar-link=')) {
      flags.calendarLink = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/outreach/coverage-gap-2026.cjs [--dry-run]\n' +
          '   [--coverage-mode=any|approved-only] [--limit=N] [--sheet-id=<id>]\n' +
          '   [--calendar-link=<url>]'
      );
      process.exit(0);
    }
  }
  if (!['any', 'approved-only'].includes(flags.coverageMode)) {
    console.error(`Invalid --coverage-mode=${flags.coverageMode}`);
    process.exit(2);
  }
  return flags;
}

// ──────────────────────────────────────────────────────────────────────────
// Parties query
// ──────────────────────────────────────────────────────────────────────────
async function fetchParties(coverageMode) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL not set. Either populate backend/.env or export it. ' +
        'See README.md for the exact format.'
    );
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Supabase requires SSL but accepts self-signed in pg client.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    // Select city directly (column exists per migration
    // supabase/migrations/20260518_add_parties_city.sql). Use COALESCE so
    // rows where city is still NULL fall back to regex extraction by the
    // caller.
    const sql = `
      SELECT id, name, country, region, address, city, date,
             underboss_status, custom_url
        FROM parties
       WHERE event_type = 'gpp'
         AND date >= '2026-01-01'
         AND date < '2027-01-01'
    `;
    const res = await client.query(sql);
    const rows = res.rows;
    if (coverageMode === 'approved-only') {
      return rows.filter((r) => r.underboss_status === 'approved');
    }
    return rows;
  } finally {
    await client.end();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Build coverage map
// ──────────────────────────────────────────────────────────────────────────

/**
 * Resolve a (cityName, countryCode) pair to a GeoNames row.
 * countryCode may be an ISO2 (e.g. 'US'), an ISO3, or a country full name from
 * `parties.country`. We try each form in turn.
 */
function resolveCity(rawCity, countryHint, geo, aliases, iso2ByCountryName) {
  if (!rawCity) return { row: null, ambiguous: false };
  const norm = normalize(rawCity);
  if (!norm) return { row: null, ambiguous: false };

  // Manual alias takes priority. Format: "<norm raw>": "City Name|IS"
  if (aliases[norm]) {
    const [aliasCity, aliasIso] = aliases[norm].split('|');
    const aliasNorm = normalize(aliasCity);
    const key = `${aliasNorm}|${(aliasIso || '').toUpperCase()}`;
    if (geo.byKey.has(key)) {
      return { row: geo.byKey.get(key), ambiguous: false };
    }
    // Fall back to normName lookup if ISO is wrong/missing.
    const list = geo.byNormName.get(aliasNorm);
    if (list && list.length > 0) return { row: list[0], ambiguous: false };
  }

  // Derive a best-guess ISO2 from the country hint.
  let iso2 = null;
  if (countryHint) {
    const trimmed = String(countryHint).trim();
    if (trimmed.length === 2) {
      iso2 = trimmed.toUpperCase();
    } else {
      // Try matching against full country names from iso2-to-country.json.
      iso2 = iso2ByCountryName[normalize(trimmed)] || null;
    }
  }

  // 1) exact normalized + ISO2.
  if (iso2) {
    const k = `${norm}|${iso2}`;
    if (geo.byKey.has(k)) return { row: geo.byKey.get(k), ambiguous: false };
  }

  // 2) normalized name only — pick largest population if ambiguous, but flag.
  const list = geo.byNormName.get(norm);
  if (list && list.length > 0) {
    if (list.length === 1) return { row: list[0], ambiguous: false };
    // Multiple matches: prefer one in the hinted country; otherwise pick the
    // highest-pop one and warn.
    if (iso2) {
      const inCountry = list.filter((r) => r.iso2 === iso2);
      if (inCountry.length === 1) return { row: inCountry[0], ambiguous: false };
      if (inCountry.length > 1) {
        const sorted = inCountry.slice().sort((a, b) => b.population - a.population);
        return { row: sorted[0], ambiguous: true };
      }
    }
    const sorted = list.slice().sort((a, b) => b.population - a.population);
    return { row: sorted[0], ambiguous: true };
  }

  // 3) substring containment — only allowed inside the hinted country and only
  // when one normalized name is contained in the other AND the shorter one is
  // at least 6 chars (keeps "Wayanad" from matching "Ayana, ET"). Picks the
  // largest-population candidate.
  if (iso2 && norm.length >= 6) {
    let best = null;
    for (const candList of geo.byNormName.values()) {
      for (const cand of candList) {
        if (cand.iso2 !== iso2) continue;
        const candNorm = normalize(cand.asciiname || cand.name);
        if (candNorm.length < 6) continue;
        const shorter = candNorm.length < norm.length ? candNorm : norm;
        const longer = candNorm.length < norm.length ? norm : candNorm;
        if (longer.includes(shorter)) {
          if (!best || best.population < cand.population) best = cand;
        }
      }
    }
    if (best) return { row: best, ambiguous: true };
  }

  return { row: null, ambiguous: false };
}

// ──────────────────────────────────────────────────────────────────────────
// Web3 scoring
//
// v1: lookup against the curated seed in data/web3-cities-seed.json by
// (normalized-city, ISO2). v2 (stagioni-29104) will replace this with a Postgres
// query that sums `outreach_communities.event_count_30d` per (city, country).
// Keep the function signature stable so the migration is a one-file change.
// ──────────────────────────────────────────────────────────────────────────
function buildWeb3Scorer(seedJson) {
  const map = new Map();
  for (const entry of seedJson) {
    const k = cityKey(entry.city, entry.country);
    map.set(k, entry.web3_score);
  }
  return function getWeb3Score(geoRow) {
    const candidates = [geoRow.asciiname, geoRow.name];
    for (const variant of candidates) {
      const k = cityKey(variant, geoRow.iso2);
      if (map.has(k)) return map.get(k);
    }
    // also try a country-less match — useful for unique names ("Lagos|NG"
    // doesn't help if the GeoNames row's iso2 is missing)
    return 0;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const runStartedAt = new Date().toISOString();

  console.error('Loading GeoNames…');
  const geo = await loadGeoNames(GEONAMES_PATH);
  console.error(
    `  loaded ${geo.rows.length} cities, ${geo.byKey.size} key entries`
  );

  const seedJson = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const aliasesRaw = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8'));
  // Strip _comment / _example metadata keys before using as a lookup map.
  const aliases = {};
  for (const [k, v] of Object.entries(aliasesRaw)) {
    if (k.startsWith('_')) continue;
    aliases[normalize(k)] = v;
  }
  const iso2ToCountry = JSON.parse(
    fs.readFileSync(ISO2_COUNTRY_PATH, 'utf8')
  );
  // Reverse map: normalized country name -> ISO2 for resolveCity().
  const iso2ByCountryName = {};
  for (const [iso2, name] of Object.entries(iso2ToCountry)) {
    iso2ByCountryName[normalize(name)] = iso2;
  }

  const getWeb3Score = buildWeb3Scorer(seedJson);

  console.error('Querying parties…');
  const parties = await fetchParties(flags.coverageMode);
  console.error(`  fetched ${parties.length} GPP 2026 parties`);

  // Resolve each party's city to a GeoNames row.
  const coveredKeys = new Set();
  const coveredByKey = new Map(); // key -> list of party objects
  const unmatched = [];

  for (const p of parties) {
    // parties.city is the authoritative source; fall back to extracting from
    // name (e.g. "Global Pizza Party Buenos Aires" -> "Buenos Aires").
    const cityRaw = (p.city && String(p.city).trim()) || extractGppCity(p.name);
    if (!cityRaw) {
      unmatched.push({
        party: p,
        reason: 'no city column + regex did not match name',
      });
      continue;
    }
    const { row, ambiguous } = resolveCity(
      cityRaw,
      p.country,
      geo,
      aliases,
      iso2ByCountryName
    );
    if (!row) {
      unmatched.push({
        party: p,
        rawCity: cityRaw,
        reason: 'no GeoNames match',
      });
      continue;
    }
    if (ambiguous) {
      console.error(
        `  [warn] ambiguous city match: party=${p.id} raw="${cityRaw}" -> ${row.asciiname}|${row.iso2}`
      );
    }
    const k = cityKey(row.asciiname || row.name, row.iso2);
    coveredKeys.add(k);
    const list = coveredByKey.get(k) || [];
    list.push({ party: p, geoRow: row });
    coveredByKey.set(k, list);
  }

  console.error(
    `  resolved ${coveredKeys.size} unique covered cities, ${unmatched.length} unmatched`
  );

  // Score every GeoNames row. Dedupe by cityKey first — multiple alt-name
  // entries inside byKey can hit the same physical city.
  const seenKeys = new Set();
  const scored = [];
  for (const row of geo.rows) {
    const k = cityKey(row.asciiname || row.name, row.iso2);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    const pop = row.population || 0;
    if (pop <= 0) continue;
    const w3 = getWeb3Score(row);
    const covered = coveredKeys.has(k);
    const weighted = covered ? 0 : Math.log10(pop) * w3;
    scored.push({
      row,
      key: k,
      population: pop,
      web3_score: w3,
      has_gpp: covered,
      weighted,
    });
  }
  // Sort: highest weighted first; tiebreak by population desc.
  scored.sort(
    (a, b) => b.weighted - a.weighted || b.population - a.population
  );

  // Filter out covered cities entirely from the top-N "gap" list. Per the
  // plan: covered cities "never appear in the top 200" — but in v1 the seed
  // is small enough that almost every web3-score>0 city is already covered,
  // so weighted=0 covered cities would otherwise dominate the tail of the
  // list by population. The Covered Cities tab still lists them for QA.
  const topN = scored.filter((r) => !r.has_gpp).slice(0, flags.limit);

  // ────────────────────────────────────────────────────────────────────────
  // Dry-run path: print top 20 and exit. No sheet created.
  // ────────────────────────────────────────────────────────────────────────
  if (flags.dryRun) {
    console.log('\n=== DRY RUN: top 20 ranked gap cities ===\n');
    console.log(
      'rank | city                          | iso2 | pop        | w3 | weighted'
    );
    console.log(
      '-----+-------------------------------+------+------------+----+---------'
    );
    for (let i = 0; i < Math.min(20, topN.length); i++) {
      const r = topN[i];
      const city = (r.row.asciiname || r.row.name).padEnd(30).slice(0, 30);
      const pop = String(r.population).padStart(10);
      const w3 = String(r.web3_score).padStart(2);
      const w = r.weighted.toFixed(2).padStart(7);
      console.log(
        `${String(i + 1).padStart(4)} | ${city} | ${r.row.iso2.padEnd(4)} | ${pop} | ${w3} | ${w}`
      );
    }
    console.log(
      `\n(${parties.length} parties, ${coveredKeys.size} covered cities, ` +
        `${unmatched.length} unmatched, ${scored.length} scored)`
    );
    console.log('\nNo sheet was created (--dry-run).');
    return;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Build sheet payloads
  // ────────────────────────────────────────────────────────────────────────
  const isoToCountryName = iso2ToCountry;

  const tab1Header = [
    'rank',
    'city',
    'country',
    'iso2',
    'population',
    'web3_score',
    'has_gpp_party',
    'coverage_status',
    'weighted_score',
    'host_onboarding_link',
    'notes',
  ];
  const tab1Rows = [tab1Header];
  for (let i = 0; i < topN.length; i++) {
    const r = topN[i];
    const cityName = r.row.asciiname || r.row.name;
    const country = isoToCountryName[r.row.iso2] || r.row.iso2;
    tab1Rows.push([
      String(i + 1),
      cityName,
      country,
      r.row.iso2,
      String(r.population),
      String(r.web3_score),
      r.has_gpp ? 'TRUE' : 'FALSE',
      r.has_gpp ? 'covered' : 'none',
      r.weighted.toFixed(3),
      flags.calendarLink,
      '',
    ]);
  }

  const tab2Header = [
    'city',
    'country',
    'iso2',
    'gpp_party_slug',
    'gpp_party_id',
    'gpp_party_date',
    'underboss_status',
    'web3_score',
  ];
  const tab2Rows = [tab2Header];
  for (const [k, list] of coveredByKey.entries()) {
    for (const { party, geoRow } of list) {
      tab2Rows.push([
        geoRow.asciiname || geoRow.name,
        isoToCountryName[geoRow.iso2] || geoRow.iso2,
        geoRow.iso2,
        party.custom_url || '',
        party.id || '',
        party.date ? new Date(party.date).toISOString().slice(0, 10) : '',
        party.underboss_status || '',
        String(getWeb3Score(geoRow)),
      ]);
    }
  }

  const tab3Header = [
    'party_id',
    'party_name',
    'raw_city',
    'country',
    'underboss_status',
    'date',
    'reason',
  ];
  const tab3Rows = [tab3Header];
  for (const u of unmatched) {
    tab3Rows.push([
      u.party.id || '',
      u.party.name || '',
      u.rawCity || '',
      u.party.country || '',
      u.party.underboss_status || '',
      u.party.date
        ? new Date(u.party.date).toISOString().slice(0, 10)
        : '',
      u.reason || '',
    ]);
  }

  const tab4Rows = [
    ['key', 'value'],
    ['run_started_at', runStartedAt],
    ['coverage_mode', flags.coverageMode],
    ['limit', String(flags.limit)],
    ['parties_query_count', String(parties.length)],
    ['geonames_row_count', String(geo.rows.length)],
    ['covered_cities_count', String(coveredKeys.size)],
    ['unmatched_count', String(unmatched.length)],
    ['scored_cities_count', String(scored.length)],
    ['calendar_link', flags.calendarLink],
    [
      'attribution',
      'City population data: GeoNames (https://www.geonames.org/), licensed under CC-BY 4.0.',
    ],
    [
      'web3_score_source',
      'Curated v1 seed (scripts/outreach/data/web3-cities-seed.json). v2 will replace with scraped community activity counts (task stagioni-29104).',
    ],
  ];

  const tabs = [
    { name: 'Top Gap Cities', rows: tab1Rows },
    { name: 'Covered Cities', rows: tab2Rows },
    { name: 'Unmatched GPP Events', rows: tab3Rows },
    { name: 'Run Metadata', rows: tab4Rows },
  ];

  // ────────────────────────────────────────────────────────────────────────
  // Write the sheet
  // ────────────────────────────────────────────────────────────────────────
  const sheets = lazyLoadSheets();
  const title = `GPP 2026 Coverage Gap — ${runStartedAt.slice(0, 10)}`;
  let result;
  if (flags.sheetId) {
    console.error(`Writing to existing sheet ${flags.sheetId}…`);
    result = await sheets.writeExistingSpreadsheet(flags.sheetId, tabs);
  } else {
    console.error('Creating new spreadsheet…');
    result = await sheets.createSpreadsheet(title, tabs);
  }
  console.log(result.url);
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err.message || err);
  process.exit(1);
});
