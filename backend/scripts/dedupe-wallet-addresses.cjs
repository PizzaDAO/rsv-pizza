// pancetta-58472: backfill script to normalize `guests.ethereum_address` and
// collapse within-party duplicates.
//
// Pass 1 — Lowercase backfill (safety net):
//   UPDATE guests SET ethereum_address = LOWER(TRIM(ethereum_address))
//   WHERE ethereum_address IS NOT NULL
//     AND ethereum_address <> LOWER(TRIM(ethereum_address))
//
//   Redundant after PR 1's migration + PR 2's write-site normalization land,
//   but useful as a catch-all for any rows written between PR 1 and PR 2.
//
// Pass 2 — Within-party row collapse:
//   For each (party_id, ethereum_address) group with COUNT(*) > 1:
//     - Keep the row with earliest submitted_at (tie-break: id ASC).
//     - For all other rows in the group, set ethereum_address = NULL and
//       wallet_source = NULL.
//     - Do NOT delete the guest row — they may have NFTs, check-ins, or
//       other state. We only un-link them from the wallet.
//
// Per-group transactions so a single group failing doesn't roll back the
// whole batch. Per-group log lines (party_id, address, kept-id, dropped-ids).
//
// Usage (from a main session — not a worktree agent):
//   cd backend && node scripts/dedupe-wallet-addresses.cjs           # dry-run
//   cd backend && node scripts/dedupe-wallet-addresses.cjs --apply   # write

const { Client } = require('pg');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`pancetta-58472 dedupe-wallet-addresses start${DRY_RUN ? ' (DRY RUN — pass --apply to write)' : ''}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Pass 1: lowercase backfill
  // -------------------------------------------------------------------------
  console.log('Pass 1: lowercase + trim non-canonical wallet addresses');

  const previewQ = await c.query(`
    SELECT COUNT(*)::int AS cnt
    FROM guests
    WHERE ethereum_address IS NOT NULL
      AND ethereum_address <> LOWER(TRIM(ethereum_address))
  `);
  const lowercaseTargets = previewQ.rows[0].cnt;
  console.log(`  rows needing lowercase/trim: ${lowercaseTargets}`);

  let lowercased = 0;
  if (lowercaseTargets > 0) {
    if (!DRY_RUN) {
      const updQ = await c.query(`
        UPDATE guests
        SET ethereum_address = LOWER(TRIM(ethereum_address))
        WHERE ethereum_address IS NOT NULL
          AND ethereum_address <> LOWER(TRIM(ethereum_address))
      `);
      lowercased = updQ.rowCount;
      console.log(`  lowercased: ${lowercased} rows`);
    } else {
      // Show a sample of what would change
      const sampleQ = await c.query(`
        SELECT id, party_id, ethereum_address, LOWER(TRIM(ethereum_address)) AS canonical
        FROM guests
        WHERE ethereum_address IS NOT NULL
          AND ethereum_address <> LOWER(TRIM(ethereum_address))
        ORDER BY submitted_at ASC
        LIMIT 10
      `);
      console.log('  sample (up to 10):');
      for (const r of sampleQ.rows) {
        console.log(`    guest ${r.id} party ${r.party_id}: '${r.ethereum_address}' -> '${r.canonical}'`);
      }
      lowercased = lowercaseTargets;
    }
  }

  console.log('');

  // -------------------------------------------------------------------------
  // Pass 2: collapse within-party (party_id, ethereum_address) duplicates
  // -------------------------------------------------------------------------
  console.log('Pass 2: collapse within-party wallet duplicates');

  // Note: this query reads the post-Pass-1 state if --apply was used. In dry
  // run mode, we deliberately look at LOWER(TRIM(...)) to surface the groups
  // that WOULD form after Pass 1 ran for real.
  const groupsQ = await c.query(`
    SELECT party_id,
           LOWER(TRIM(ethereum_address)) AS address,
           COUNT(*)::int AS cnt
    FROM guests
    WHERE ethereum_address IS NOT NULL
    GROUP BY party_id, LOWER(TRIM(ethereum_address))
    HAVING COUNT(*) > 1
    ORDER BY party_id ASC, address ASC
  `);
  console.log(`  duplicate (party, wallet) groups: ${groupsQ.rowCount}`);

  let groupsProcessed = 0;
  let groupsFailed = 0;
  let totalNulled = 0;

  for (const g of groupsQ.rows) {
    const { party_id, address } = g;

    try {
      if (!DRY_RUN) await c.query('BEGIN');

      // Fetch all rows in this group, earliest first. Tie-break by id ASC
      // for stability.
      const rowsQ = await c.query(
        `
        SELECT id, submitted_at, wallet_source
        FROM guests
        WHERE party_id = $1
          AND LOWER(TRIM(ethereum_address)) = $2
        ORDER BY submitted_at ASC NULLS LAST, id ASC
        `,
        [party_id, address],
      );

      if (rowsQ.rowCount < 2) {
        // Race or already collapsed since the GROUP BY ran. Skip cleanly.
        if (!DRY_RUN) await c.query('COMMIT');
        continue;
      }

      const rows = rowsQ.rows;
      const kept = rows[0];
      const dropped = rows.slice(1);
      const droppedIds = dropped.map(r => r.id);

      console.log(
        `  party ${party_id} wallet ${address}: keep ${kept.id}, null out [${droppedIds.join(', ')}]`,
      );

      if (!DRY_RUN) {
        const updQ = await c.query(
          `
          UPDATE guests
          SET ethereum_address = NULL,
              wallet_source = NULL
          WHERE id = ANY($1::uuid[])
          `,
          [droppedIds],
        );
        totalNulled += updQ.rowCount;
        await c.query('COMMIT');
      } else {
        totalNulled += droppedIds.length;
      }

      groupsProcessed++;
    } catch (err) {
      if (!DRY_RUN) {
        try {
          await c.query('ROLLBACK');
        } catch (_) {
          /* ignore */
        }
      }
      groupsFailed++;
      console.error(`  group party=${party_id} wallet=${address} FAILED: ${err.message}`);
    }
  }

  console.log('');
  console.log('--- summary ---');
  console.log(`pass 1: rows lowercased         : ${lowercased}`);
  console.log(`pass 2: groups processed        : ${groupsProcessed}`);
  console.log(`pass 2: groups failed           : ${groupsFailed}`);
  console.log(`pass 2: rows nulled (wallet/src): ${totalNulled}`);
  if (DRY_RUN) console.log('(dry-run — no writes performed; pass --apply to commit)');

  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
