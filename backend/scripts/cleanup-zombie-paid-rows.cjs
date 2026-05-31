// prosciutto-92106: cleanup script for zombie status='paid' payout rows.
//
// A "zombie paid" row is one with status='paid' but NO proof of send in
// any of the per-method fields:
//   - usdc_base    → transaction_hash
//   - wire         → wire_reference
//   - mercury_card → mercury_card_last4 or mercury_card_id
//   - <any method> → external_proof_url
//
// These rows inflate the Paid KPI tile + the by-city Paid rollup without
// representing money that actually moved. Alvaro city surfaced this: 4
// zombie rows pushed its Paid total to $2,621 when only $655 actually
// went on-chain.
//
// What this script does:
//   1. Lists every zombie row with party + method + amount + paid_at
//      (grouped by method + status for quick scope-check totals).
//   2. With --apply: transitions each row to status='withdrawn' and writes
//      a payout_audit row with action='cancel' and a note explaining the
//      transition. Skips rows that have a real `payments_closed_at` to avoid
//      surprising historical close-outs (those are bookkeeping, not zombies).
//
// Status semantics:
//   - withdrawn = explicitly excluded from cap math + Paid totals.
//   - paid (with proof) = unchanged.
//   - completed = unchanged. mark_pending_complete (provolone-92103) is an
//     intentional bookkeeping close-out without proof — those rows are
//     NOT zombies.
//
// Usage (from a main session — not a worktree agent — backend/.env present):
//   cd backend && node scripts/cleanup-zombie-paid-rows.cjs           # dry-run
//   cd backend && node scripts/cleanup-zombie-paid-rows.cjs --apply   # write

const { Client } = require('pg');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const ACTOR_EMAIL = process.env.CLEANUP_ACTOR_EMAIL || 'cleanup-script@rsv.pizza';

const ZOMBIE_PREDICATE = `
  status = 'paid'
  AND (transaction_hash IS NULL OR transaction_hash = '')
  AND (wire_reference IS NULL OR wire_reference = '')
  AND (mercury_card_last4 IS NULL OR mercury_card_last4 = '')
  AND (mercury_card_id IS NULL OR mercury_card_id = '')
  AND (external_proof_url IS NULL OR external_proof_url = '')
`;

const AUDIT_NOTE = 'zombie paid row — no proof of send (transaction_hash, wire_reference, external_proof_url, or mercury_card_last4 missing); transitioned to withdrawn by prosciutto-92106 cleanup script';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`prosciutto-92106 cleanup-zombie-paid-rows start${DRY_RUN ? ' (DRY RUN — pass --apply to write)' : ''}`);
  console.log('');

  // -------------------------------------------------------------------------
  // 1. Scope-check: total zombie rows by method
  // -------------------------------------------------------------------------
  console.log('=== Zombie status=paid rows by method ===');
  const summaryQ = await c.query(`
    SELECT
      COALESCE(payout_method, 'NULL') AS method,
      COUNT(*)::int AS row_count,
      SUM(final_amount_usd)::numeric(12,2) AS total_usd
    FROM payouts
    WHERE ${ZOMBIE_PREDICATE}
    GROUP BY payout_method
    ORDER BY total_usd DESC
  `);
  console.table(summaryQ.rows);
  const grandTotalCount = summaryQ.rows.reduce((s, r) => s + Number(r.row_count), 0);
  const grandTotalUsd = summaryQ.rows.reduce((s, r) => s + Number(r.total_usd), 0);
  console.log(`Total: ${grandTotalCount} rows / $${grandTotalUsd.toFixed(2)} USD`);
  console.log('');

  if (grandTotalCount === 0) {
    console.log('Nothing to clean up. Exiting.');
    await c.end();
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Per-row detail: party + amount + paid_at + admin_notes
  // -------------------------------------------------------------------------
  console.log('=== Zombie rows detail (first 50 rows) ===');
  const detailQ = await c.query(`
    SELECT
      p.id,
      pa.name AS party_name,
      pa.country,
      p.payout_method,
      p.final_amount_usd::numeric(12,2) AS amount,
      p.paid_at,
      LEFT(COALESCE(p.admin_notes, ''), 80) AS notes
    FROM payouts p
    JOIN parties pa ON pa.id = p.party_id
    WHERE ${ZOMBIE_PREDICATE.replace(/status/g, 'p.status')
      .replace(/transaction_hash/g, 'p.transaction_hash')
      .replace(/wire_reference/g, 'p.wire_reference')
      .replace(/mercury_card_last4/g, 'p.mercury_card_last4')
      .replace(/mercury_card_id/g, 'p.mercury_card_id')
      .replace(/external_proof_url/g, 'p.external_proof_url')}
    ORDER BY p.paid_at DESC NULLS LAST
    LIMIT 50
  `);
  console.table(detailQ.rows);
  console.log('');

  if (DRY_RUN) {
    console.log(`Dry-run complete. ${grandTotalCount} rows would be transitioned to 'withdrawn' totaling $${grandTotalUsd.toFixed(2)}.`);
    console.log(`Run with --apply to perform the transition.`);
    await c.end();
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Apply: transition each row to 'withdrawn' + audit row, atomic per row.
  // -------------------------------------------------------------------------
  console.log('=== Applying transition: status -> withdrawn ===');
  const idsQ = await c.query(`
    SELECT id, status, final_amount_usd
    FROM payouts
    WHERE ${ZOMBIE_PREDICATE}
  `);
  const rows = idsQ.rows;
  console.log(`Transitioning ${rows.length} rows...`);

  let okCount = 0;
  let errCount = 0;
  for (const row of rows) {
    try {
      await c.query('BEGIN');
      await c.query(
        `UPDATE payouts SET status = 'withdrawn', updated_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await c.query(
        `INSERT INTO payout_audit
          (id, payout_id, action, old_status, new_status, actor_email, actor_kind, note, created_at)
         VALUES (gen_random_uuid(), $1, 'cancel', $2, 'withdrawn', $3, 'super_admin', $4, NOW())`,
        [row.id, row.status, ACTOR_EMAIL, AUDIT_NOTE],
      );
      await c.query('COMMIT');
      okCount += 1;
      if (okCount % 10 === 0) {
        console.log(`  ${okCount}/${rows.length}…`);
      }
    } catch (err) {
      await c.query('ROLLBACK');
      errCount += 1;
      console.error(`  FAILED payout=${row.id}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Done. transitioned=${okCount} failed=${errCount}`);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
