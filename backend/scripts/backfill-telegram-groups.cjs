#!/usr/bin/env node
/**
 * calzone-58481: one-time backfill of city Telegram groups from the GPP Google
 * Sheet into the new `city_telegram_groups` DB table (DB becomes the source of
 * truth). Each sheet row is matched (best-effort) to a gpp-tagged Party by
 * normalized city name; on a match the row's party_id FK is set. Unmatched rows
 * are still inserted with party_id = NULL and reported (NO silent drops).
 *
 * RUN FROM MAIN SESSION ONLY (needs Google Sheet OAuth + DATABASE_URL).
 *
 * The sheet (gid 811297100) is the public GViz JSON endpoint — no OAuth is
 * required for read because it is published; OAuth is only the documented
 * fallback if Google ever locks it down. If the GViz fetch 401/403s, swap in
 * the OAuth credentials from CLAUDE.md (spreadsheets scope) and use the Sheets
 * v4 values.get API for the same range.
 *
 * Sheet column indices (0-based, matching frontend/src/lib/telegram.ts):
 *   4 = country, 5 = city, 6 = underboss, 7 = region, 8 = chatUrl, 10 = chatId
 *
 * Idempotent: ON CONFLICT (chat_id) DO UPDATE refreshes the denormalized
 * city/country/region/underboss/chat_url + re-resolves party_id. Re-running is
 * safe.
 *
 * Dry-run by default. Pass --apply to mutate.
 *
 * Usage:
 *   node backend/scripts/backfill-telegram-groups.cjs [--apply]
 */

const path = require('path');
const fs = require('fs');

const envCandidates = [
  path.join(__dirname, '..', '.env'),
  'C:/Users/samgo/OneDrive/Documents/PizzaDAO/Code/rsvpizza/backend/.env',
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    if (process.env.DATABASE_URL) break;
  }
}

const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const SHEET_ID = '16T3_iXywToXQqxTyDIniWIA4SUI8Wj0a5LKHSAJL_9Q';
const GID = '811297100';

// ===== Port of the alias/normalization logic from TelegramBroadcast.tsx =====

/** Normalize a city name for fuzzy matching (strip accents, suffixes, etc.) */
function normalizeCity(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents/diacritics
    .replace(/[İ]/g, 'I') // Turkish İ
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '') // remove parentheticals like "(Queensland)"
    .replace(/^[-–—]\s*/, '') // strip leading dashes "- La Paz, Bolivia"
    .replace(/\s*[-–—]\s+.*$/, '') // strip trailing " - Pizza Touk" but NOT hyphens within words
    .replace(/\s*,\s+.*$/, '') // strip ", Bolivia"
    .replace(/\s+\d{4}$/, '') // strip trailing year "2026"
    .replace(/\s+city$/i, '') // strip trailing "City"
    .replace(/\s+at\s+.*$/i, '') // strip "at Papa Toms"
    .replace(/\s+in\s+.*$/i, '') // strip "in Hangzhou"
    .trim();
}

// Aliases for cities known by different names in different languages/romanizations
const CITY_ALIASES = {
  bangalore: ['bengaluru'],
  johannesberg: ['johannesburg'],
  'koh phangan': ['ko phangan'],
  mysore: ['mysuru'],
  vienna: ['wien'],
  warsaw: ['warszawa'],
  rome: ['roma'],
  naples: ['napoli'],
  'portland me': ['portland maine'],
  'san pedro de sula': ['san pedro sula'],
  tirana: ['tirane'],
  goteborg: ['gothenburg'],
  'new york city': ['new york', 'nyc', 'newyork'],
  'sao paulo': ['sao paulo/ brazil'],
  denver: ['ethdenver'],
  tokyo: ['ethtokyo'],
  prague: ['pizzadayprague'],
  // CJK / Cyrillic city names
  ningbo: ['ning bo shi', '宁波市'],
  hangzhou: ['hang zhou shi', '杭州市'],
  gotemba: ['yu dian chang shi', '御殿場市'],
  // Additional language variants
  luxembourg: ['lussemburgo'],
  goa: ['madgaon'],
  durham: ['raleigh'],
};

// Build reverse alias lookup: alternate name -> canonical names
const ALIAS_LOOKUP = {};
for (const [canonical, alts] of Object.entries(CITY_ALIASES)) {
  for (const alt of alts) {
    if (!ALIAS_LOOKUP[alt]) ALIAS_LOOKUP[alt] = [];
    ALIAS_LOOKUP[alt].push(canonical);
  }
  if (!ALIAS_LOOKUP[canonical]) ALIAS_LOOKUP[canonical] = [];
  for (const alt of alts) {
    ALIAS_LOOKUP[canonical].push(alt);
  }
}

/** Check whether two city names refer to the same city after normalization */
function citiesMatch(eventCity, sheetCity) {
  const a = normalizeCity(eventCity);
  const b = normalizeCity(sheetCity);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3) {
    if (a.includes(b) || b.includes(a)) return true;
  }
  const aAliases = ALIAS_LOOKUP[a] || [];
  const bAliases = ALIAS_LOOKUP[b] || [];
  for (const alias of aAliases) {
    if (alias === b) return true;
    if (alias.length >= 3 && b.length >= 3 && (alias.includes(b) || b.includes(alias))) return true;
  }
  for (const alias of bAliases) {
    if (alias === a) return true;
    if (alias.length >= 3 && a.length >= 3 && (alias.includes(a) || a.includes(alias))) return true;
  }
  return false;
}

/** Extract a city name from a GPP event's name ("Global Pizza Party <city>"). */
function extractCityFromEvent(name) {
  const match = String(name || '').match(/Global Pizza Party\s+(.+)/i);
  return match ? match[1].trim() : String(name || '');
}

// ===== Sheet fetch (GViz JSON — same endpoint as the frontend) =====

async function fetchSheetGroups() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}&headers=11`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `GViz fetch failed (${response.status}). The sheet may no longer be public — ` +
        `fall back to the Sheets v4 API with the OAuth creds from CLAUDE.md.`
    );
  }
  const text = await response.text();
  const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?$/, ''));

  return json.table.rows
    .map((row) => ({
      country: row.c?.[4]?.v || '',
      city: row.c?.[5]?.v || '',
      underboss: row.c?.[6]?.v || '',
      region: row.c?.[7]?.v || '',
      chatUrl: row.c?.[8]?.v || '',
      chatId: String(row.c?.[10]?.v || '').replace('#', '').trim(),
    }))
    .filter((g) => g.chatId && g.city && /^-?\d+$/.test(g.chatId));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found (looked in backend/.env). Aborting.');
    process.exit(1);
  }

  console.log(`\ncalzone-58481 telegram-groups backfill — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const groups = await fetchSheetGroups();
  console.log(`Fetched ${groups.length} valid group rows from the sheet.`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Load gpp-tagged, not-cancelled parties for city matching.
    const partyRes = await client.query(
      `SELECT id, name, city FROM parties
       WHERE event_type = 'gpp' AND cancelled_at IS NULL`
    );
    const parties = partyRes.rows.map((p) => ({
      id: p.id,
      // Prefer the canonical `city` column; fall back to the event-name suffix.
      city: p.city || extractCityFromEvent(p.name),
    }));
    console.log(`Loaded ${parties.length} gpp parties for matching.\n`);

    let matched = 0;
    const unlinked = [];
    const ambiguous = [];

    for (const g of groups) {
      const hits = parties.filter((p) => citiesMatch(p.city, g.city));
      let partyId = null;
      if (hits.length === 1) {
        partyId = hits[0].id;
        matched++;
      } else if (hits.length > 1) {
        // More than one candidate — do NOT guess. Leave unlinked + report.
        ambiguous.push({ city: g.city, count: hits.length });
        unlinked.push(g.city);
      } else {
        unlinked.push(g.city);
      }

      if (APPLY) {
        await client.query(
          `INSERT INTO city_telegram_groups
             (id, party_id, chat_id, chat_url, city, country, region, underboss, created_by, created_at, updated_at)
           VALUES
             (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, 'backfill:calzone-58481', now(), now())
           ON CONFLICT (chat_id) DO UPDATE SET
             party_id   = EXCLUDED.party_id,
             chat_url   = EXCLUDED.chat_url,
             city       = EXCLUDED.city,
             country    = EXCLUDED.country,
             region     = EXCLUDED.region,
             underboss  = EXCLUDED.underboss,
             updated_by = 'backfill:calzone-58481',
             updated_at = now()`,
          [partyId, g.chatId, g.chatUrl || null, g.city, g.country, g.region || null, g.underboss || null]
        );
      }
    }

    console.log(`\nMatched to a party: ${matched}`);
    console.log(`Unlinked (party_id = NULL): ${unlinked.length}`);
    if (ambiguous.length > 0) {
      console.log(`\n⚠️  Ambiguous (multiple party candidates — left unlinked, resolve manually):`);
      for (const a of ambiguous) console.log(`   - ${a.city} (${a.count} candidates)`);
    }
    if (unlinked.length > 0) {
      console.log(`\nUnlinked cities (insert with party_id = NULL):`);
      for (const c of unlinked) console.log(`   - ${c}`);
    }

    if (!APPLY) {
      console.log(`\nDRY-RUN: no rows written. Re-run with --apply to insert.`);
    } else {
      const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM city_telegram_groups`);
      console.log(`\nDone. city_telegram_groups now has ${cnt.rows[0].n} rows.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nBackfill failed:', err);
  process.exit(1);
});
