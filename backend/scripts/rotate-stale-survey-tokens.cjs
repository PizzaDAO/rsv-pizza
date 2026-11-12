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
 *   (none)    dry run: read-only, prints COUNTS only (never tokens, emails or ids).
 *   --apply   rotates in batches. Every row is updated with an optimistic WHERE that re-checks
 *             the old token value, "no survey_responses row" and "event still ended > 30 days ago",
 *             so a guest who answers (or whose token was rotated) mid-run is skipped. New token =
 *             gen_random_uuid(). Prints counts only.
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

async function main() {
  console.log(`\n=== rotate stale survey tokens (${APPLY ? 'APPLY' : 'DRY RUN'}, threshold ${DAYS} days) ===\n`);
  const c = await counts();
  console.log(`guests with a survey_token:                 ${c.with_token}`);
  console.log(`  answered (kept):                          ${c.answered}`);
  console.log(`  unanswered:                               ${c.unanswered}`);
  console.log(`    ...of which event date unknown (kept):  ${c.unanswered_no_event_date}`);
  console.log(`  WOULD ROTATE (unanswered + ended >${DAYS}d):  ${c.would_rotate}  across ${c.parties_affected} parties`);
  if (!APPLY) { console.log('\nDry run only (read-only). Re-run with --apply.'); return; }

  let rotated = 0, skipped = 0;
  for (;;) {
    const batch = await prisma.$queryRawUnsafe(`
      SELECT g.id::text AS id, g.survey_token::text AS tok
      FROM guests g JOIN parties p ON p.id = g.party_id
      WHERE ${ELIGIBLE}
      ORDER BY g.id LIMIT ${BATCH}`, DAYS);
    if (!batch.length) break;
    let progressed = 0;
    for (const row of batch) {
      // Optimistic per-row update: re-check everything in the WHERE, so concurrent changes win.
      const n = await prisma.$executeRawUnsafe(`
        UPDATE guests g SET survey_token = gen_random_uuid()
        FROM parties p
        WHERE p.id = g.party_id AND g.id = $2::uuid AND g.survey_token = $3::uuid
          AND ${ELIGIBLE}`, DAYS, row.id, row.tok);
      if (n === 1) { rotated++; progressed++; } else skipped++;
    }
    console.log(`  rotated so far: ${rotated} (skipped by optimistic check: ${skipped})`);
    if (!progressed) break; // nothing moved: avoid an infinite loop
  }
  const after = await counts();
  console.log(`\nrotated ${rotated}, skipped ${skipped}; remaining eligible: ${after.would_rotate}`);
  console.log(after.would_rotate === 0 ? 'OK' : 'NOTE: some rows remain (changed concurrently?) - re-run');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
