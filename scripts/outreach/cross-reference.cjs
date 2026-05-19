#!/usr/bin/env node
/**
 * stagioni-29104 — cross-reference.cjs
 *
 * Joins outreach_communities against supreme-43217's gap-analysis Google
 * Sheet (read via public CSV export URL — no auth needed) and assigns
 * priority buckets (high/medium/low) based on score:
 *   score = gapWeight * (1 + log10(1 + followerCount) + activityScore)
 *
 * Output:
 *   - stdout ASCII summary (top 50)
 *   - scripts/outreach/output/cross-reference-<ts>.csv (always)
 *   - DB UPDATEs to outreach_communities.priority (with --apply only;
 *     never overwrites manually-set priority).
 *
 * Stub-tolerant: if GPP_GAP_SHEET_ID is missing, prints a warning and
 * exits 0 so the script is safe to wire into a runbook before
 * supreme-43217's sheet is published.
 *
 * Required env:
 *   DATABASE_URL                (always)
 *   GPP_GAP_SHEET_ID           (optional — script no-ops if missing)
 *   GPP_GAP_SHEET_GID          (optional, defaults to 0)
 *
 * Usage:
 *   node scripts/outreach/cross-reference.cjs          # dry-run
 *   node scripts/outreach/cross-reference.cjs --apply  # write priority
 */
const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', 'backend', '.env') });
} catch { /* optional */ }

const { getPool, closePool } = require('./lib/db.cjs');
const { normalizeCity, jaccard, tokenSet } = require('./lib/normalize.cjs');

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');

const SHEET_ID = process.env.GPP_GAP_SHEET_ID || '';
const SHEET_GID = process.env.GPP_GAP_SHEET_GID || '0';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

/** Parse a CSV row, handling quoted fields with commas inside. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(l => {
    const cells = parseCsvLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

async function fetchGapSheet() {
  if (!SHEET_ID) {
    console.warn('GPP_GAP_SHEET_ID env var not set — skipping cross-reference.');
    console.warn('Once supreme-43217 publishes its sheet, set:');
    console.warn('  export GPP_GAP_SHEET_ID=<sheet_id>');
    console.warn('  export GPP_GAP_SHEET_GID=<tab_gid>  # default 0');
    return null;
  }
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
  console.log('Fetching gap sheet:', url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gap sheet fetch failed: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  return parseCsv(csv);
}

/**
 * Build a map<normalizedCity, { gapWeight, country, raw }>.
 * Heuristic for the weight column: prefer a column literally named one of
 * ['gap_weight','gapWeight','weight','priority_score','score']; fall back
 * to row index (top = highest weight).
 */
function buildGapMap(parsed) {
  const cityCol = parsed.headers.find(h => /^city$/i.test(h)) || 'city';
  const countryCol = parsed.headers.find(h => /^country$/i.test(h)) || 'country';
  const weightCol = parsed.headers.find(h => /^(gap_weight|gapweight|weight|priority_score|score)$/i.test(h));
  const map = new Map();
  parsed.rows.forEach((r, idx) => {
    const city = r[cityCol];
    if (!city) return;
    const key = normalizeCity(city);
    let weight;
    if (weightCol) {
      const n = Number(r[weightCol]);
      weight = Number.isFinite(n) ? n : 1;
    } else {
      // No explicit weight column — rank by row index, higher row = higher weight
      weight = 1 / (idx + 1);
    }
    map.set(key, { gapWeight: weight, country: r[countryCol] || null, raw: r });
  });
  return map;
}

async function loadCommunities(pool) {
  const r = await pool.query(`
    SELECT id, city, country, community_name, source, contact_handle, contact_url,
           contact_email, follower_count, activity_score, priority, notes
    FROM outreach_communities
    ORDER BY city, source
  `);
  return r.rows;
}

/** Dedupe within each city by token-set Jaccard > 0.75 on community_name. */
function dedupeWithinCity(rows) {
  const byCity = new Map();
  for (const r of rows) {
    const key = normalizeCity(r.city);
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(r);
  }
  const kept = [];
  for (const arr of byCity.values()) {
    const tokens = arr.map(r => ({ row: r, set: tokenSet(r.community_name) }));
    const dropped = new Set();
    for (let i = 0; i < tokens.length; i++) {
      if (dropped.has(i)) continue;
      for (let j = i + 1; j < tokens.length; j++) {
        if (dropped.has(j)) continue;
        if (jaccard(tokens[i].set, tokens[j].set) > 0.75) {
          // keep whichever has the higher follower_count (or activity_score)
          const a = tokens[i].row;
          const b = tokens[j].row;
          const aScore = (Number(a.follower_count) || 0) + (Number(a.activity_score) || 0);
          const bScore = (Number(b.follower_count) || 0) + (Number(b.activity_score) || 0);
          if (bScore > aScore) dropped.add(i); else dropped.add(j);
        }
      }
    }
    tokens.forEach((t, idx) => { if (!dropped.has(idx)) kept.push(t.row); });
  }
  return kept;
}

function scoreRow(row, gap) {
  const followers = Number(row.follower_count) || 0;
  const activity = Number(row.activity_score) || 0;
  return gap.gapWeight * (1 + Math.log10(1 + followers) + activity);
}

function bucketFor(rank, total) {
  if (rank < 50) return 'high';
  if (rank < 150) return 'medium';
  return 'low';
}

function asciiTable(rows) {
  const cols = ['rank', 'city', 'source', 'handle', 'score', 'bucket'];
  const widths = cols.map(c => c.length);
  const data = rows.map(r => [
    String(r.rank),
    r.city,
    r.source,
    r.handle || '',
    r.score.toFixed(3),
    r.bucket,
  ]);
  data.forEach(row => row.forEach((cell, i) => {
    widths[i] = Math.max(widths[i], String(cell).length);
  }));
  const pad = (s, w) => String(s).padEnd(w);
  const header = cols.map((c, i) => pad(c, widths[i])).join(' | ');
  const sep = widths.map(w => '-'.repeat(w)).join('-+-');
  const body = data.map(row => row.map((c, i) => pad(c, widths[i])).join(' | ')).join('\n');
  return [header, sep, body].join('\n');
}

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to write priority' : 'APPLYING priority updates...');

  const parsed = await fetchGapSheet();
  if (!parsed) {
    console.log('No gap sheet available. Exiting cleanly.');
    return;
  }
  console.log(`Loaded ${parsed.rows.length} gap rows`);

  const gapMap = buildGapMap(parsed);
  console.log(`Gap map: ${gapMap.size} unique cities`);

  const pool = getPool();
  const all = await loadCommunities(pool);
  console.log(`Loaded ${all.length} outreach rows`);

  // Filter to rows whose city is in the gap list
  const inScope = all.filter(r => gapMap.has(normalizeCity(r.city)));
  console.log(`In gap-city scope: ${inScope.length}`);

  // Dedupe within each city
  const deduped = dedupeWithinCity(inScope);
  console.log(`After in-city dedupe: ${deduped.length}`);

  // Score + rank
  const scored = deduped
    .map(r => {
      const gap = gapMap.get(normalizeCity(r.city));
      return {
        row: r,
        score: scoreRow(r, gap),
        city: r.city,
        source: r.source,
        handle: r.contact_handle || r.contact_url,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((r, idx) => ({ ...r, rank: idx + 1, bucket: bucketFor(idx, deduped.length) }));

  // Top-50 summary
  console.log('\nTop 50 by score:\n');
  console.log(asciiTable(scored.slice(0, 50)));

  // CSV output
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(OUTPUT_DIR, `cross-reference-${ts}.csv`);
  const csvHeader = 'rank,city,source,handle,score,bucket,id\n';
  const csvBody = scored.map(s => [
    s.rank, JSON.stringify(s.city), s.source, JSON.stringify(s.handle || ''),
    s.score.toFixed(4), s.bucket, s.row.id,
  ].join(',')).join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvBody + '\n');
  console.log(`\nWrote CSV: ${csvPath}`);

  // DB updates: only set priority where it differs and only if currently NULL
  // (defensive: never overwrite manually-set values).
  let updates = 0;
  for (const s of scored) {
    const current = s.row.priority;
    const target = s.bucket;
    if (current === target) continue;
    if (current !== null && current !== undefined) {
      // manually set — preserve
      continue;
    }
    if (dryRun) {
      updates++;
      continue;
    }
    await pool.query(
      `UPDATE outreach_communities
         SET priority = $1
       WHERE id = $2
         AND priority IS NULL`,
      [target, s.row.id],
    );
    updates++;
  }
  console.log(`${dryRun ? 'Would update' : 'Updated'} priority on ${updates} rows`);
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await closePool().catch(() => {}); });
