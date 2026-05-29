// sicilian-58196: dedup `photos` rows for the same party that share
// (file_size, mime_type) — these are the same bytes uploaded multiple times.
//
// Sources of the existing 266 duplicate rows:
//   - native dupes: same user uploaded same file twice via event-page UI
//   - napoletana-58211 backfill: payout-side dupes that didn't match by
//     file_name (file_name differs but file_size + mime_type are identical)
//
// For each (party_id, file_size, mime_type) group with >1 rows and
// file_size > 10000 (skip tiny-file collisions):
//   1. Pick CANONICAL = earliest created_at. Tie-break by highest vote_count,
//      then by id (lexicographic) for stability.
//   2. Absorb metadata from siblings into canonical:
//        caption       — canonical's if non-null, else first non-null sibling
//        tags          — union(canonical, all siblings) preserving order
//        photo_year    — canonical's if set, else first sibling's
//        starred       — true if any of (canonical, siblings) is starred. If
//                        canonical was false but a sibling true, also pull
//                        starred_at + reviewed_at + reviewed_by from that
//                        sibling.
//        status        — upgrade 'pending' -> 'approved' if any sibling
//                        already approved
//   3. Transfer photo_votes from siblings -> canonical. ON CONFLICT
//      (photo_id, user_id) DO NOTHING — a user might have voted on both
//      copies, but we only count once.
//   4. Re-point payout_documents.photo_id from any sibling -> canonical.
//   5. DELETE the sibling photos rows. The schema cascades photo_votes;
//      payout_documents.photo_id has ON DELETE SET NULL but we already
//      retargeted those above.
//   6. Recompute canonical's vote_count from the surviving photo_votes.
//
// Each group runs inside its own transaction so a per-group failure rolls
// back cleanly without half-merging.
//
// Important scoping caveat: the candidate query is scoped per-party_id, so
// the same bytes uploaded to two different parties are NEVER merged. They
// are separate photos that just happen to share size.
//
// Run from a main session (not a worktree agent):
//   cd backend && node scripts/dedup-photos.cjs
// Optional dry-run: pass --dry-run to print the plan without writing.

const { Client } = require('pg');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');

function uniqOrdered(...arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const v of arr) {
      if (v == null) continue;
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`sicilian-58196 dedup-photos start${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // Find every (party_id, file_size, mime_type) group with >1 rows. file_size
  // gate keeps trivially-small files (icons, junk, sub-10KB) out of the dedup
  // bucket where collisions are likely meaningless.
  const groupsQ = await c.query(`
    SELECT party_id, file_size, mime_type, COUNT(*) AS cnt
    FROM photos
    WHERE file_size > 10000
    GROUP BY party_id, file_size, mime_type
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, party_id ASC
  `);
  console.log(`Duplicate groups: ${groupsQ.rowCount}`);

  let groupsProcessed = 0;
  let siblingsDeleted = 0;
  let votesTransferred = 0;
  let payoutRelinks = 0;
  let groupsFailed = 0;

  for (const g of groupsQ.rows) {
    const { party_id, file_size, mime_type } = g;

    try {
      await c.query('BEGIN');

      // Fetch all rows in this group. Order canonicalization rule:
      //   1) earliest created_at first
      //   2) then highest vote_count first (canonical absorbs popularity)
      //   3) then id ASC for stability
      const rowsQ = await c.query(
        `
        SELECT id,
               party_id,
               created_at,
               vote_count,
               caption,
               tags,
               photo_year,
               starred,
               starred_at,
               status,
               reviewed_at,
               reviewed_by
        FROM photos
        WHERE party_id = $1 AND file_size = $2 AND mime_type = $3
        ORDER BY created_at ASC, vote_count DESC, id ASC
        `,
        [party_id, file_size, mime_type],
      );

      if (rowsQ.rowCount < 2) {
        // Race: another process merged this group between SELECT GROUP BY and
        // the row fetch. Nothing to do.
        await c.query('COMMIT');
        continue;
      }

      const rows = rowsQ.rows;
      const canonical = rows[0];
      const siblings = rows.slice(1);

      // Sanity: every row in the group MUST belong to the same party. This
      // should be guaranteed by the GROUP BY scope, but assert it loudly so
      // we never cross parties.
      for (const r of rows) {
        if (r.party_id !== canonical.party_id) {
          throw new Error(
            `cross-party row in group ${party_id}/${file_size}/${mime_type}: ` +
              `${r.id} party=${r.party_id} vs canonical party=${canonical.party_id}`,
          );
        }
      }

      // 2. Absorb metadata into canonical.
      const newCaption =
        canonical.caption ?? siblings.find((s) => s.caption != null)?.caption ?? null;
      const newTags = uniqOrdered(canonical.tags, ...siblings.map((s) => s.tags));
      const newPhotoYear =
        canonical.photo_year ?? siblings.find((s) => s.photo_year != null)?.photo_year ?? null;

      const anyStarred = canonical.starred || siblings.some((s) => s.starred);
      let newStarred = canonical.starred;
      let newStarredAt = canonical.starred_at;
      let newReviewedAt = canonical.reviewed_at;
      let newReviewedBy = canonical.reviewed_by;
      if (anyStarred && !canonical.starred) {
        const starSib = siblings.find((s) => s.starred);
        newStarred = true;
        newStarredAt = starSib.starred_at ?? newStarredAt;
        newReviewedAt = starSib.reviewed_at ?? newReviewedAt;
        newReviewedBy = starSib.reviewed_by ?? newReviewedBy;
      }

      const anyApproved =
        canonical.status === 'approved' || siblings.some((s) => s.status === 'approved');
      const newStatus =
        canonical.status === 'pending' && anyApproved ? 'approved' : canonical.status;

      const siblingIds = siblings.map((s) => s.id);

      if (!DRY_RUN) {
        // Write absorbed metadata to canonical first so the snapshot is
        // consistent even if vote_count is recomputed later.
        await c.query(
          `
          UPDATE photos
          SET caption = $1,
              tags = $2,
              photo_year = $3,
              starred = $4,
              starred_at = $5,
              reviewed_at = $6,
              reviewed_by = $7,
              status = $8
          WHERE id = $9
          `,
          [
            newCaption,
            newTags,
            newPhotoYear,
            newStarred,
            newStarredAt,
            newReviewedAt,
            newReviewedBy,
            newStatus,
            canonical.id,
          ],
        );

        // 3. Transfer photo_votes from siblings -> canonical. ON CONFLICT
        // skips duplicates (same user voted on both copies).
        const transferQ = await c.query(
          `
          INSERT INTO photo_votes (id, photo_id, user_id, created_at)
          SELECT gen_random_uuid(), $1, pv.user_id, pv.created_at
          FROM photo_votes pv
          WHERE pv.photo_id = ANY($2::uuid[])
          ON CONFLICT (photo_id, user_id) DO NOTHING
          RETURNING id
          `,
          [canonical.id, siblingIds],
        );
        votesTransferred += transferQ.rowCount;

        // 4. Re-point payout_documents.photo_id (any kind) from sibling ->
        // canonical. The FK has ON DELETE SET NULL, but we want the link to
        // survive — retarget before the delete.
        const relinkQ = await c.query(
          `
          UPDATE payout_documents
          SET photo_id = $1
          WHERE photo_id = ANY($2::uuid[])
          `,
          [canonical.id, siblingIds],
        );
        payoutRelinks += relinkQ.rowCount;

        // 5. Delete sibling photos rows. photo_votes still owned by the
        // siblings cascade away; we already moved the ones that mattered.
        const delQ = await c.query(
          `DELETE FROM photos WHERE id = ANY($1::uuid[])`,
          [siblingIds],
        );
        siblingsDeleted += delQ.rowCount;

        // 6. Recompute canonical's vote_count from surviving photo_votes.
        await c.query(
          `
          UPDATE photos
          SET vote_count = (SELECT COUNT(*) FROM photo_votes WHERE photo_id = $1)
          WHERE id = $1
          `,
          [canonical.id],
        );
      } else {
        // Dry-run accounting — count what we would do.
        siblingsDeleted += siblings.length;
      }

      await c.query('COMMIT');
      groupsProcessed++;

      if (groupsProcessed % 25 === 0) {
        console.log(
          `  ...${groupsProcessed}/${groupsQ.rowCount} groups, ${siblingsDeleted} sibling rows deleted so far`,
        );
      }
    } catch (err) {
      await c.query('ROLLBACK');
      groupsFailed++;
      console.error(
        `Group ${party_id}/${file_size}/${mime_type} FAILED: ${err.message}`,
      );
    }
  }

  console.log('');
  console.log('--- summary ---');
  console.log(`groups processed:    ${groupsProcessed}`);
  console.log(`groups failed:       ${groupsFailed}`);
  console.log(`sibling rows deleted:${siblingsDeleted}`);
  console.log(`votes transferred:   ${votesTransferred}`);
  console.log(`payout_docs relinked:${payoutRelinks}`);
  if (DRY_RUN) console.log('(dry-run — no writes performed)');

  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
