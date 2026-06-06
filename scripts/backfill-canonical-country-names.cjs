#!/usr/bin/env node
/**
 * scripts/backfill-canonical-country-names.cjs
 *
 * One-shot backfill of `parties.country` to canonical American English.
 *
 * Dry-run by default: prints a histogram of (before -> after) changes plus a
 * list of unrecognized country strings (so Snax can decide whether to extend
 * the override map / countryCode table before applying).
 *
 * Pass `--apply` to write to the DB. Each UPDATE includes a race-guard
 * `WHERE country = $before` so concurrent writes from the API can't be
 * silently overwritten.
 *
 * Loads backend/.env via DOTENV_PATH or the conventional path so this works
 * from a worktree (no .env copy in the worktree dir).
 *
 * Notes:
 *   - The override map and the name->ISO2 table are INLINED here because this
 *     is a one-shot CJS script and TS sources can't be `require`'d. Keep this
 *     in sync with backend/src/lib/canonicalCountryName.ts +
 *     backend/src/lib/countryCode.ts. The trade-off is intentional.
 *   - This script is read-only against `parties.country IS NOT NULL`. Rows
 *     with country IS NULL are skipped entirely.
 *   - The script never deletes rows; `--apply` only issues UPDATEs.
 *
 * Usage:
 *   node scripts/backfill-canonical-country-names.cjs          # dry run
 *   node scripts/backfill-canonical-country-names.cjs --apply  # write to DB
 *
 * Plan: plans/guanciale-43592.md
 */

const path = require('path');

// Load backend/.env (worktrees don't have their own .env copy).
const envPath =
  process.env.DOTENV_PATH || path.resolve(__dirname, '..', 'backend', '.env');
require('dotenv').config({ path: envPath });

const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

// ---------------------------------------------------------------------------
// INLINE COPY of backend/src/lib/countryCode.ts (name -> ISO2 alpha-2).
// Keep in sync. Source of truth is the TS file; this is the script's snapshot.
// ---------------------------------------------------------------------------

const COUNTRY_NAME_TO_CODE = {
  // A
  afghanistan: 'AF', albania: 'AL', algeria: 'DZ', andorra: 'AD',
  angola: 'AO', 'antigua and barbuda': 'AG', argentina: 'AR',
  armenia: 'AM', australia: 'AU', austria: 'AT', azerbaijan: 'AZ',
  // B
  bahamas: 'BS', bahrain: 'BH', bangladesh: 'BD', barbados: 'BB',
  belarus: 'BY', belgium: 'BE', belize: 'BZ', benin: 'BJ',
  bhutan: 'BT', bolivia: 'BO', 'bosnia and herzegovina': 'BA',
  botswana: 'BW', brazil: 'BR', brunei: 'BN', bulgaria: 'BG',
  'burkina faso': 'BF', burundi: 'BI',
  // C
  cambodia: 'KH', cameroon: 'CM', canada: 'CA', 'cape verde': 'CV',
  'central african republic': 'CF', chad: 'TD', chile: 'CL',
  china: 'CN', colombia: 'CO', comoros: 'KM',
  congo: 'CG',
  'democratic republic of the congo': 'CD', 'dr congo': 'CD',
  'costa rica': 'CR', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
  croatia: 'HR', cuba: 'CU', cyprus: 'CY', czechia: 'CZ',
  'czech republic': 'CZ',
  // D
  denmark: 'DK', djibouti: 'DJ', dominica: 'DM',
  'dominican republic': 'DO',
  // E
  ecuador: 'EC', egypt: 'EG', 'el salvador': 'SV',
  'equatorial guinea': 'GQ', eritrea: 'ER', estonia: 'EE',
  eswatini: 'SZ', ethiopia: 'ET',
  // F
  'faroe islands': 'FO', fiji: 'FJ', finland: 'FI', france: 'FR',
  'french polynesia': 'PF',
  // G
  gabon: 'GA', gambia: 'GM', georgia: 'GE', germany: 'DE',
  ghana: 'GH', greece: 'GR', grenada: 'GD', guadeloupe: 'GP',
  guatemala: 'GT', guernsey: 'GG', guinea: 'GN', 'guinea-bissau': 'GW',
  guyana: 'GY',
  // H
  haiti: 'HT', honduras: 'HN', 'hong kong': 'HK', hungary: 'HU',
  // I
  iceland: 'IS', india: 'IN', indonesia: 'ID', iran: 'IR',
  iraq: 'IQ', ireland: 'IE', 'isle of man': 'IM', israel: 'IL',
  italy: 'IT',
  // J
  jamaica: 'JM', japan: 'JP', jersey: 'JE', jordan: 'JO',
  // K
  kazakhstan: 'KZ', kenya: 'KE', kiribati: 'KI', kosovo: 'XK',
  kuwait: 'KW', kyrgyzstan: 'KG',
  // L
  laos: 'LA', latvia: 'LV', lebanon: 'LB', lesotho: 'LS',
  liberia: 'LR', libya: 'LY', liechtenstein: 'LI', lithuania: 'LT',
  luxembourg: 'LU',
  // M
  macau: 'MO', madagascar: 'MG', malawi: 'MW', malaysia: 'MY',
  maldives: 'MV', mali: 'ML', malta: 'MT', 'marshall islands': 'MH',
  mauritania: 'MR', mauritius: 'MU', mexico: 'MX',
  moldova: 'MD', monaco: 'MC', mongolia: 'MN', montenegro: 'ME',
  morocco: 'MA', mozambique: 'MZ', myanmar: 'MM',
  // N
  namibia: 'NA', nauru: 'NR', nepal: 'NP', netherlands: 'NL',
  'new zealand': 'NZ', nicaragua: 'NI', niger: 'NE', nigeria: 'NG',
  'north korea': 'KP', 'north macedonia': 'MK', norway: 'NO',
  // O
  oman: 'OM',
  // P
  pakistan: 'PK', palau: 'PW',
  palestine: 'PS', 'palestinian territories': 'PS',
  panama: 'PA', 'papua new guinea': 'PG', paraguay: 'PY', peru: 'PE',
  philippines: 'PH', poland: 'PL', portugal: 'PT', 'puerto rico': 'PR',
  // Q
  qatar: 'QA',
  // R
  romania: 'RO', russia: 'RU', rwanda: 'RW',
  // S
  'saint kitts and nevis': 'KN', 'saint lucia': 'LC',
  'saint vincent and the grenadines': 'VC', samoa: 'WS',
  'san marino': 'SM', 'são tomé and príncipe': 'ST',
  'saudi arabia': 'SA', senegal: 'SN', serbia: 'RS',
  seychelles: 'SC', 'sierra leone': 'SL', singapore: 'SG',
  slovakia: 'SK', slovenia: 'SI', 'solomon islands': 'SB',
  somalia: 'SO', 'south africa': 'ZA', 'south korea': 'KR',
  'south sudan': 'SS', spain: 'ES', 'sri lanka': 'LK', sudan: 'SD',
  suriname: 'SR', sweden: 'SE', switzerland: 'CH', syria: 'SY',
  // T
  taiwan: 'TW', tajikistan: 'TJ', tanzania: 'TZ', thailand: 'TH',
  'timor-leste': 'TL', 'east timor': 'TL', togo: 'TG', tonga: 'TO',
  'trinidad and tobago': 'TT', tunisia: 'TN', turkey: 'TR',
  turkmenistan: 'TM', tuvalu: 'TV',
  // U
  uganda: 'UG', ukraine: 'UA', 'united arab emirates': 'AE',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB',
  'united states': 'US', usa: 'US', 'united states of america': 'US',
  'u.s. virgin islands': 'VI', 'us virgin islands': 'VI',
  uruguay: 'UY', uzbekistan: 'UZ',
  // V
  vanuatu: 'VU', 'vatican city': 'VA', venezuela: 'VE', vietnam: 'VN',
  // Y
  yemen: 'YE',
  // Z
  zambia: 'ZM', zimbabwe: 'ZW',
};

const COUNTRY_ALIASES = {
  // German
  deutschland: 'DE', österreich: 'AT', schweiz: 'CH',
  // Spanish
  españa: 'ES', méxico: 'MX', perú: 'PE', alemania: 'DE',
  francia: 'FR', suiza: 'CH', 'república dominicana': 'DO',
  // Portuguese
  brasil: 'BR',
  // Italian
  italia: 'IT',
  // French
  algérie: 'DZ', maroc: 'MA',
  'république démocratique du congo': 'CD',
  'république du congo': 'CG',
  // Dutch
  nederland: 'NL',
  // Danish
  danmark: 'DK',
  // Polish
  polska: 'PL', 'wielka brytania': 'GB',
  // Hungarian
  szlovákia: 'SK',
  // Romanian
  románia: 'RO',
  // Turkish
  türkiye: 'TR',
  // Vietnamese
  'việt nam': 'VN',
  // Bulgarian
  българия: 'BG',
  // Russian
  грузия: 'GE',
  // Arabic
  الجزائر: 'DZ',
  السعودية: 'SA',
  العراق: 'IQ',
  مصر: 'EG',
  // CJK
  中国: 'CN',
  日本: 'JP',
};

function getCountryCode(country) {
  if (!country || typeof country !== 'string') return null;
  const trimmed = country.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  return COUNTRY_NAME_TO_CODE[key] || COUNTRY_ALIASES[key] || null;
}

// ---------------------------------------------------------------------------
// INLINE COPY of backend/src/lib/canonicalCountryName.ts overrides.
// Keep in sync with the TS file.
// ---------------------------------------------------------------------------

const OVERRIDES = {
  HK: 'Hong Kong',
  MO: 'Macao',
  MM: 'Myanmar',
  CD: 'DR Congo',
  CG: 'Congo',
  PS: 'Palestine',
  ST: 'São Tomé and Príncipe',
};

const ENGLISH_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function canonicalizeCountryName(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Normalize curly RIGHT SINGLE QUOTATION MARK (U+2019) on input so the
  // straight-apostrophe alias ("côte d'ivoire") still matches.
  const normalizedInput = trimmed.replace(/’/g, "'");

  const code = getCountryCode(normalizedInput);
  if (!code) return null;

  if (OVERRIDES[code]) return OVERRIDES[code];

  const name = ENGLISH_NAMES.of(code);
  if (!name) return null;
  // Intl emits U+2019 in "Côte d'Ivoire"; normalize to ASCII on output too.
  return name.replace(/’/g, "'");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      `[backfill] DATABASE_URL not set. Tried loading from ${envPath}.`,
    );
    console.error(
      '[backfill] Set DOTENV_PATH to the correct backend/.env path, or set DATABASE_URL directly.',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(
    `[backfill] Mode: ${APPLY ? 'APPLY (writes!)' : 'DRY-RUN (no writes)'}`,
  );
  console.log('[backfill] Reading parties.country values...');

  const { rows } = await client.query(
    'SELECT id, country FROM parties WHERE country IS NOT NULL',
  );

  console.log(`[backfill] ${rows.length} rows with non-null country.\n`);

  // Bucket each row.
  // - noop: canonical == current
  // - change: canonical != current (recognized)
  // - unrecognized: canonicalize returned null
  const changes = []; // { id, before, after }
  const unrecognized = []; // { id, before }
  let noop = 0;

  // Histogram of before->after counts.
  const histogram = new Map(); // key = `${before} -> ${after}`, val = count

  for (const row of rows) {
    const before = row.country;
    const after = canonicalizeCountryName(before);

    if (after === null) {
      unrecognized.push({ id: row.id, before });
      continue;
    }

    if (after === before) {
      noop += 1;
      continue;
    }

    changes.push({ id: row.id, before, after });
    const key = `${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }

  // ---- Report ----
  console.log('=== Histogram (changes, sorted by count desc) ===');
  if (histogram.size === 0) {
    console.log('  (no changes)');
  } else {
    const sorted = Array.from(histogram.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    for (const [key, count] of sorted) {
      console.log(`  ${String(count).padStart(5)}  ${key}`);
    }
  }
  console.log('');

  console.log('=== Unrecognized country strings (preserved verbatim) ===');
  if (unrecognized.length === 0) {
    console.log('  (none)');
  } else {
    // Group by raw string so the operator sees the distinct unrecognized set.
    const grouped = new Map(); // string -> ids[]
    for (const r of unrecognized) {
      if (!grouped.has(r.before)) grouped.set(r.before, []);
      grouped.get(r.before).push(r.id);
    }
    const sorted = Array.from(grouped.entries()).sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [raw, ids] of sorted) {
      console.log(`  ${String(ids.length).padStart(5)}  ${JSON.stringify(raw)}`);
      for (const id of ids) {
        console.log(`         row id: ${id}`);
      }
    }
  }
  console.log('');

  console.log('=== Totals ===');
  console.log(`  Total rows with country     : ${rows.length}`);
  console.log(`  No-op (already canonical)   : ${noop}`);
  console.log(`  Will change                 : ${changes.length}`);
  console.log(`  Unrecognized (will skip)    : ${unrecognized.length}`);
  console.log('');

  if (!APPLY) {
    console.log('[backfill] DRY-RUN complete. No writes. Re-run with --apply to write.');
    await client.end();
    return;
  }

  if (changes.length === 0) {
    console.log('[backfill] Nothing to write.');
    await client.end();
    return;
  }

  console.log(`[backfill] APPLY: writing ${changes.length} updates...`);
  let updated = 0;
  let raceSkipped = 0;
  let failed = 0;

  for (const c of changes) {
    try {
      // Race guard: only update if the current value is still what we read.
      const res = await client.query(
        'UPDATE parties SET country = $1 WHERE id = $2 AND country = $3',
        [c.after, c.id, c.before],
      );
      if (res.rowCount === 1) {
        updated += 1;
        console.log(
          `  ok    ${c.id}  ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`,
        );
      } else {
        raceSkipped += 1;
        console.log(
          `  race  ${c.id}  ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)} (value changed between read and write)`,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(`  ERR   ${c.id}  ${err && err.message ? err.message : err}`);
    }
  }

  console.log('');
  console.log('=== Apply summary ===');
  console.log(`  updated    : ${updated}`);
  console.log(`  race-skipped: ${raceSkipped}`);
  console.log(`  failed     : ${failed}`);

  await client.end();
}

main().catch((err) => {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
});
