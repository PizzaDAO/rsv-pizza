#!/usr/bin/env node
/**
 * Hackathon platform PR 2 (plans/hackathon-platform.md §9): create the hackathons row for
 * existing events in hackathon-flow series (event_series.create_flow = 'hackathon'), the same
 * default-on that brandCreate.ts now does for new events, and pin the Hackathon app.
 *
 * Defaults match backend/src/lib/hackathon/defaults.ts: deadline = event end (end_time, else
 * date + duration hours), team 1-5, 1 track per project, 'registered', blind off,
 * gallery 'after_reveal', unpublished. Cancelled events are skipped.
 *
 * Idempotent: INSERT ... ON CONFLICT (party_id) DO NOTHING; the pin is only appended when absent.
 * DRY RUN by default (read-only transaction). --apply to write. --series <slug> limits it to one
 * series. 6543 transaction pooler: plain statements only, no session SETs.
 *
 * Usage: node backend/scripts/backfill-hackathons.cjs [--series monad] [--apply]
 */
const path = require('path');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { Client } = require('pg');
  const APPLY = process.argv.includes('--apply');
  const series = argValue('--series');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found (looked in backend/.env). Aborting.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n=== backfill hackathons${series ? ` for '${series}'` : ''} (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  try {
    await client.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
    const params = series ? [series] : [];
    const cands = await client.query(
      `SELECT p.id, p.name, s.slug,
              COALESCE(p.end_time, CASE WHEN p.date IS NOT NULL AND p.duration > 0
                                        THEN p.date + make_interval(secs => p.duration * 3600) END) AS deadline,
              COALESCE(p.pinned_apps, '[]'::jsonb) ? 'hackathon' AS pinned
         FROM parties p JOIN event_series s ON s.id = p.event_series_id
        WHERE s.create_flow = 'hackathon' AND p.cancelled_at IS NULL
          ${series ? 'AND s.slug = $1' : ''}
          AND NOT EXISTS (SELECT 1 FROM hackathons h WHERE h.party_id = p.id)
        ORDER BY p.created_at`,
      params,
    );
    const existing = await client.query(
      `SELECT COUNT(*)::int AS n FROM hackathons h JOIN parties p ON p.id = h.party_id
         JOIN event_series s ON s.id = p.event_series_id
        WHERE s.create_flow = 'hackathon' ${series ? 'AND s.slug = $1' : ''}`,
      params,
    );
    console.log(`Hackathon-flow events already enabled: ${existing.rows[0].n}`);
    console.log(`Events to enable: ${cands.rows.length}`);
    for (const r of cands.rows) {
      console.log(`  [${r.slug}] ${r.name} (${r.id}) deadline=${r.deadline ? new Date(r.deadline).toISOString() : 'none'}${r.pinned ? '' : ' +pin'}`);
    }
    if (!APPLY) {
      await client.query('ROLLBACK');
      console.log('\nDry run only. Re-run with --apply to write.\n');
      return;
    }
    let created = 0;
    let pinned = 0;
    for (const r of cands.rows) {
      const ins = await client.query(
        `INSERT INTO hackathons (id, party_id, submission_deadline, team_min_size, team_max_size,
                                 max_tracks_per_submission, eligibility, blind_judging, gallery_visibility,
                                 created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 1, 5, 1, 'registered', false, 'after_reveal', now(), now())
         ON CONFLICT (party_id) DO NOTHING`,
        [r.id, r.deadline],
      );
      created += ins.rowCount;
      const pin = await client.query(
        `UPDATE parties SET pinned_apps = COALESCE(pinned_apps, '[]'::jsonb) || '["hackathon"]'::jsonb
          WHERE id = $1 AND NOT (COALESCE(pinned_apps, '[]'::jsonb) ? 'hackathon')`,
        [r.id],
      );
      pinned += pin.rowCount;
    }
    await client.query('COMMIT');
    console.log(`\nOK: created ${created} hackathon row(s), pinned the app on ${pinned} event(s).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
