#!/usr/bin/env node
/**
 * guests-anon-exposure D5: rotate `guests.survey_token` ONLY for guests whose survey is still
 * unanswered (no survey_responses row) AND whose event ended more than 30 days ago.
 * These tokens were readable by anyone holding the public key (GET/POST /api/survey/:token reads
 * and overwrites survey answers). Rotating invalidates already-emailed links for stale surveys
 * only; answered surveys and recent events are untouched.
 *
 * Event end = COALESCE(parties.end_time, parties.date). Parties with neither are skipped.
 *
 * Modes:
 *   (none)    dry run: read-only, prints COUNTS only (never tokens, emails or ids). It also walks
 *             the exact keyset pagination --apply uses and asserts every eligible row is visited
 *             exactly once.
 *   --apply   rotates in keyset-paged batches (ORDER BY id, id > last seen id; a rotated row
 *             still matches the predicate, so offset-less "re-select the first N" would loop
 *             forever). Every row is updated with an optimistic WHERE that re-checks the old
 *             token value, "no survey_responses row" and "event still ended > threshold", so a
 *             guest who answers (or whose token was rotated) mid-run is skipped. New token =
 *             gen_random_uuid(). Hard pass cap as a safety net. Prints counts only.
 *   --days N  override the 30-day threshold (default 30, minimum 30).
 *
 *   node backend/scripts/rotate-stale-survey-tokens.cjs [--apply] [--days 30]
 *
 * No session-level SET (DATABASE_URL is the 6543 transaction pooler).
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const di = process.argv.indexOf('--days');
const DAYS = di > -1 ? Number(process.argv[di + 1]) : 30;
if (!Number.isInteger(DAYS) || DAYS < 30) { console.error('--days must be an integer >= 30'); process.exit(2); }
const BATCH = 500;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const prisma = new PrismaClient();

// Shared eligibility predicate (alias g = guests, p = parties). $1 = days.
const ELIGIBLE = `
  g.survey_token IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM survey_responses sr WHERE sr.guest_id = g.id)
  AND COALESCE(p.end_time, p.date) < now() - make_interval(days => $1::int)`;

async function counts() {
  const r = await prisma.$queryRawUnsafe(`
    SELECT
      count(*) FILTER (WHERE g.survey_token IS NOT NULL)::int AS with_token,
      count(*) FILTER (WHERE g.survey_token IS NOT NULL
        AND EXISTS (SELECT 1 FROM survey_responses sr WHERE sr.guest_id = g.id))::int AS answered,
      count(*) FILTER (WHERE g.survey_token IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM survey_responses sr WHERE sr.guest_id = g.id))::int AS unanswered,
      count(*) FILTER (WHERE ${ELIGIBLE})::int AS would_rotate,
      count(*) FILTER (WHERE g.survey_token IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM survey_responses sr WHERE sr.guest_id = g.id)
        AND COALESCE(p.end_time, p.date) IS NULL)::int AS unanswered_no_event_date,
      count(DISTINCT p.id) FILTER (WHERE ${ELIGIBLE})::int AS parties_affected
    FROM guests g JOIN parties p ON p.id = g.party_id`, DAYS);
  return r[0];
}

/** One keyset page of eligible rows strictly after lastId, in id order. */
function page(lastId) {
  return prisma.$queryRawUnsafe(`
    SELECT g.id::text AS id, g.survey_token::text AS tok
    FROM guests g JOIN parties p ON p.id = g.party_id
    WHERE ${ELIGIBLE} AND g.id > $2::uuid
    ORDER BY g.id LIMIT ${BATCH}`, DAYS, lastId);
}

/**
 * Walk every eligible row exactly once with a keyset cursor, calling visit(row) for each.
 * Pass cap = ceil(expected / BATCH) + 5, a safety net against any future cursor bug.
 */
async function walk(expected, visit) {
  const maxPasses = Math.ceil(expected / BATCH) + 5;
  const seen = new Set();
  let lastId = NIL_UUID;
  let passes = 0;
  for (;;) {
    if (++passes > maxPasses) throw new Error(`pass cap (${maxPasses}) exceeded - aborting (cursor not advancing?)`);
    const rows = await page(lastId);
    if (!rows.length) break;
    for (const row of rows) {
      if (seen.has(row.id)) throw new Error('row visited twice - cursor bug, aborting');
      seen.add(row.id);
      await visit(row);
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return { visited: seen.size, passes };
}

async function main() {
  console.log(`\n=== rotate stale survey tokens (${APPLY ? 'APPLY' : 'DRY RUN'}, threshold ${DAYS} days) ===\n`);
  const c = await counts();
  console.log(`guests with a survey_token:                 ${c.with_token}`);
  console.log(`  answered (kept):                          ${c.answered}`);
  console.log(`  unanswered:                               ${c.unanswered}`);
  console.log(`    ...of which event date unknown (kept):  ${c.unanswered_no_event_date}`);
  console.log(`  WOULD ROTATE (unanswered + ended >${DAYS}d):  ${c.would_rotate}  across ${c.parties_affected} parties`);

  if (!APPLY) {
    const w = await walk(c.would_rotate, async () => {});
    const ok = w.visited === c.would_rotate;
    console.log(`\nkeyset walk (read-only): visited ${w.visited} rows in ${w.passes} page(s); ${ok ? 'OK each eligible row visited exactly once' : `MISMATCH vs ${c.would_rotate} (data changed during the run?)`}`);
    console.log('Dry run only (read-only). Re-run with --apply.');
    if (!ok) process.exit(1);
    return;
  }

  let rotated = 0, skipped = 0;
  const w = await walk(c.would_rotate, async (row) => {
    // Optimistic per-row update: re-check everything in the WHERE, so concurrent changes win.
    const n = await prisma.$executeRawUnsafe(`
      UPDATE guests g SET survey_token = gen_random_uuid()
      FROM parties p
      WHERE p.id = g.party_id AND g.id = $2::uuid AND g.survey_token = $3::uuid
        AND ${ELIGIBLE}`, DAYS, row.id, row.tok);
    if (n === 1) rotated++; else skipped++;
    if ((rotated + skipped) % BATCH === 0) console.log(`  processed ${rotated + skipped} (rotated ${rotated}, skipped ${skipped})`);
  });
  console.log(`\nvisited ${w.visited} in ${w.passes} page(s); rotated ${rotated}; skipped by optimistic check ${skipped}`);
  console.log(w.visited === c.would_rotate ? 'OK   every eligible row visited exactly once' : `NOTE: visited ${w.visited} vs ${c.would_rotate} counted at start (data changed during the run)`);
  console.log('Note: rotated rows still match the predicate (fresh token, still unanswered), so a re-run rotates them again; run --apply once.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
