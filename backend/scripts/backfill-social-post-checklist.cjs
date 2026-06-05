#!/usr/bin/env node
/**
 * diavola-58479: backfill the "Post about the party on socials" checklist item.
 *
 * Adds a new non-auto default checklist row (link_tab 'social-post' sentinel,
 * sort_order 11, due 2026-06-08) and the matching checklist_defaults template row.
 *
 * ORDERING IS LOAD-BEARING — do not reorder the two steps:
 *
 *   (a) FIRST insert the new row into checklist_items for every party that is
 *       ALREADY fully seeded (its is_default count >= the CURRENT checklist_defaults
 *       count) and does NOT already have a row named 'Post about the party on socials'.
 *   (b) THEN insert the checklist_defaults template row.
 *
 * Why this order: the seed endpoint (POST /:partyId/checklist/seed) reconciles by
 * counting a party's is_default items against the checklist_defaults count. If that
 * count drops below the template count it DELETES all default items and re-creates
 * them — which wipes any manual completion the host ticked on the non-auto default
 * rows (Find Partners, Select Pizzeria, etc.). By backfilling the parties FIRST,
 * every already-seeded party reaches the new count at the same moment the template
 * grows, so defaultCount is never < the template count and the destructive
 * reconcile never fires.
 *
 * Parties not yet fully seeded are intentionally skipped: the seed endpoint will
 * create all default rows (including this one) fresh on next load.
 *
 * Idempotent: re-running inserts nothing new (guarded by NOT EXISTS / ON CONFLICT
 * DO NOTHING).
 *
 * Dry-run by default. Pass --apply to mutate.
 *
 * Usage:
 *   node backend/scripts/backfill-social-post-checklist.cjs [--apply]
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

const ITEM = {
  name: 'Post about the party on socials',
  due_date: '2026-06-08',
  is_auto: false,
  auto_rule: null,
  link_tab: 'social-post',
  sort_order: 11,
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found (looked in backend/.env). Aborting.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(`\ndiavola-58479 social-post backfill — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  try {
    // Current template size — the per-party "fully seeded" threshold. Evaluated
    // BEFORE step (b) inserts the new template row, so it reflects the old count.
    const cntRes = await client.query(`SELECT COUNT(*)::int AS n FROM checklist_defaults`);
    const threshold = cntRes.rows[0].n;
    console.log(`Current checklist_defaults count (seeded-party threshold): ${threshold}`);

    // ---- Preview: which parties qualify for step (a)? ----
    const previewSql = `
      SELECT p.id
      FROM parties p
      WHERE (
        SELECT COUNT(*) FROM checklist_items ci
        WHERE ci.party_id = p.id AND ci.is_default = true
      ) >= $2
      AND NOT EXISTS (
        SELECT 1 FROM checklist_items ci2
        WHERE ci2.party_id = p.id AND ci2.name = $1
      )
    `;
    const preview = await client.query(previewSql, [ITEM.name, threshold]);
    console.log(`Step (a): ${preview.rows.length} party(ies) need the new checklist row inserted.`);

    const tmplPreview = await client.query(
      `SELECT 1 FROM checklist_defaults WHERE name = $1`,
      [ITEM.name],
    );
    const templateExists = tmplPreview.rows.length > 0;
    console.log(`Step (b): checklist_defaults template row ${templateExists ? 'already exists (will skip)' : 'will be inserted'}.`);

    if (!APPLY) {
      console.log('\nDry-run only. Re-run with --apply to perform the inserts.\n');
      return;
    }

    // ---- Step (a): insert per-party rows FIRST ----
    const insertItemsSql = `
      INSERT INTO checklist_items
        (id, party_id, name, due_date, is_auto, auto_rule, link_tab, sort_order, is_default, completed, created_at, updated_at)
      SELECT
        gen_random_uuid(), p.id, $1, $2::date, $3, $4, $5, $6, true, false, now(), now()
      FROM parties p
      WHERE (
        SELECT COUNT(*) FROM checklist_items ci
        WHERE ci.party_id = p.id AND ci.is_default = true
      ) >= $7
      AND NOT EXISTS (
        SELECT 1 FROM checklist_items ci2
        WHERE ci2.party_id = p.id AND ci2.name = $1
      )
    `;
    const itemsRes = await client.query(insertItemsSql, [
      ITEM.name, ITEM.due_date, ITEM.is_auto, ITEM.auto_rule, ITEM.link_tab, ITEM.sort_order, threshold,
    ]);
    console.log(`Step (a) done: inserted ${itemsRes.rowCount} checklist_items row(s).`);

    // ---- Step (b): insert checklist_defaults template AFTER the per-party rows ----
    const insertTemplateSql = `
      INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order)
      VALUES ($1, $2::date, $3, $4, $5, $6)
      ON CONFLICT (name) DO NOTHING
    `;
    const tmplRes = await client.query(insertTemplateSql, [
      ITEM.name, ITEM.due_date, ITEM.is_auto, ITEM.auto_rule, ITEM.link_tab, ITEM.sort_order,
    ]);
    console.log(`Step (b) done: inserted ${tmplRes.rowCount} checklist_defaults row(s).`);

    console.log('\nBackfill complete.\n');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
