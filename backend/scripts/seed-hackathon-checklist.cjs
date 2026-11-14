#!/usr/bin/env node
/**
 * Hackathon platform PR 2 (plans/hackathon-platform.md §9): point the hackathon checklist items
 * of a hackathon-flow series (default: monad) at the new Hackathon host app, and turn on the
 * auto rules this PR computes (GET /:partyId/checklist):
 *
 *   Publish tracks, prizes and rules  -> hackathon  [auto: hackathon_published]
 *   Set up the submission platform    -> hackathon  [auto: hackathon_submissions_ready]
 *   Line up judges and mentors        -> hackathon  [auto: hackathon_judges_added] (mentors stay manual)
 *   Run demos and judging             -> hackathon  [auto: hackathon_judging_closed] (PR 4)
 *   Post winners and photos           -> hackathon  (auto rule comes with PR 5)
 *   Send prizes to winners            -> hackathon  (auto rule comes with PR 5)
 *
 * Applied to the series' checklist_defaults rows AND every party's default checklist_items copy
 * (is_default = true, same name), so existing events pick it up.
 *
 * Never clobbers an admin edit: a link is only changed when it is empty or still the value the
 * brand seed set (seed-brand-checklists.cjs: 'details' / 'photos' / none); an auto rule is only
 * set when the row has no auto rule, and never on a party item the host already completed (it
 * keeps its manual tick; it still gets the link). Names and sort order are never touched. Idempotent: a
 * second run changes nothing.
 *
 * DRY RUN by default (read-only transaction). --apply to write. --series <slug> (default monad).
 * 6543 transaction pooler: plain statements only, no session SETs.
 *
 * Usage: node backend/scripts/seed-hackathon-checklist.cjs [--series monad] [--apply]
 */
const path = require('path');

// [name, autoRule|null, previousLinks the seed may have set]
const HACKATHON_ITEMS = [
  ['Publish tracks, prizes and rules', 'hackathon_published', ['details']],
  ['Set up the submission platform', 'hackathon_submissions_ready', []],
  ['Line up judges and mentors', 'hackathon_judges_added', []],
  ['Run demos and judging', 'hackathon_judging_closed', []],
  ['Post winners and photos', null, ['photos']],
  ['Send prizes to winners', null, []],
];
const LINK_TAB = 'hackathon';

/**
 * Pure plan for one row ({ name, link_tab, is_auto, auto_rule }). Returns the changes
 * ({ linkTab?, autoRule? }) or null when nothing changes / the row isn't a hackathon item.
 */
function planRow(row) {
  const item = HACKATHON_ITEMS.find(([name]) => name === row.name);
  if (!item) return null;
  const [, autoRule, previousLinks] = item;
  const change = {};
  if (row.link_tab !== LINK_TAB && (!row.link_tab || previousLinks.includes(row.link_tab))) change.linkTab = LINK_TAB;
  // A party item the host already ticked keeps its manual completion: making it auto would
  // recompute it from hackathon state and could un-tick it. (Template rows have no `completed`.)
  if (autoRule && !row.auto_rule && row.completed !== true) change.autoRule = autoRule;
  return Object.keys(change).length ? change : null;
}

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function applyChange(client, table, whereSql, params, change) {
  const sets = [];
  const vals = [...params];
  if (change.linkTab) { vals.push(change.linkTab); sets.push(`link_tab = $${vals.length}`); }
  if (change.autoRule) { vals.push(change.autoRule); sets.push(`is_auto = true, auto_rule = $${vals.length}`); }
  const res = await client.query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = now() WHERE ${whereSql}`, vals);
  return res.rowCount;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { Client } = require('pg');
  const APPLY = process.argv.includes('--apply');
  const slug = argValue('--series', 'monad');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found (looked in backend/.env). Aborting.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n=== seed hackathon checklist links/auto rules for '${slug}' (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  try {
    await client.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
    const s = await client.query('SELECT id, create_flow FROM event_series WHERE slug = $1', [slug]);
    if (!s.rows.length) {
      console.log(`Series '${slug}' does not exist. Nothing to do.`);
      await client.query('ROLLBACK');
      return;
    }
    const seriesId = s.rows[0].id;
    if (s.rows[0].create_flow !== 'hackathon') console.log(`WARN: series create_flow is '${s.rows[0].create_flow}', not 'hackathon'.`);
    const names = HACKATHON_ITEMS.map(([n]) => n);

    const defaults = await client.query(
      'SELECT id, name, link_tab, is_auto, auto_rule FROM checklist_defaults WHERE series_id = $1 AND name = ANY($2::text[])',
      [seriesId, names],
    );
    const items = await client.query(
      `SELECT ci.id, ci.name, ci.link_tab, ci.is_auto, ci.auto_rule, ci.completed
         FROM checklist_items ci JOIN parties p ON p.id = ci.party_id
        WHERE p.event_series_id = $1 AND ci.is_default = true AND ci.name = ANY($2::text[])`,
      [seriesId, names],
    );
    const missing = names.filter((n) => !defaults.rows.some((r) => r.name === n));
    if (missing.length) console.log(`Not in the series template (skipped): ${missing.map((n) => `'${n}'`).join(', ')}`);

    let dChanged = 0;
    console.log('\nchecklist_defaults:');
    for (const r of defaults.rows) {
      const c = planRow(r);
      const desc = c ? [c.linkTab && `link ${r.link_tab ?? '(none)'} -> ${c.linkTab}`, c.autoRule && `auto -> ${c.autoRule}`].filter(Boolean).join(', ') : 'no change';
      console.log(`  ${r.name}: ${desc}`);
      if (c && APPLY) dChanged += await applyChange(client, 'checklist_defaults', 'id = $1', [r.id], c);
      else if (c) dChanged++;
    }

    const perName = {};
    let iChanged = 0;
    for (const r of items.rows) {
      const c = planRow(r);
      if (!c) continue;
      perName[r.name] = (perName[r.name] || 0) + 1;
      if (APPLY) iChanged += await applyChange(client, 'checklist_items', 'id = $1', [r.id], c);
      else iChanged++;
    }
    const partyCount = await client.query('SELECT COUNT(*)::int AS n FROM parties WHERE event_series_id = $1', [seriesId]);
    console.log(`\nchecklist_items (party copies): ${items.rows.length} matching row(s) across ${partyCount.rows[0].n} party(ies); ${APPLY ? 'updated' : 'would update'} ${iChanged}`);
    for (const [n, k] of Object.entries(perName)) console.log(`  ${n}: ${k}`);

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\nOK: ${dChanged} default(s), ${iChanged} party item(s) updated.`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\nDry run: would update ${dChanged} default(s) and ${iChanged} party item(s). Re-run with --apply to write.`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { HACKATHON_ITEMS, LINK_TAB, planRow };

if (require.main === module) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
