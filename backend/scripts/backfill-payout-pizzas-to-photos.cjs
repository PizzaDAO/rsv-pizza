// napoletana-58211: link existing payout_documents (kind='pizza', photo_id IS NULL)
// to the canonical `photos` table. For each candidate doc:
//   1. If a photos row already exists in the same party with matching url OR
//      matching (file_name, file_size), link the doc to it (UPDATE photo_id).
//   2. Otherwise, INSERT a new photos row (auto-starred + auto-approved so it
//      mirrors the in-place new-upload flow), then link the doc.
//   3. Transfer any payout_document_votes for the linked doc into photo_votes
//      (deduping on (photo_id, user_id)) and refresh photos.vote_count.
//      Original payout_document_votes rows are left intact for audit.
//
// Run AFTER the 20260528000000_payout_documents_photo_id migration is applied
// to production. Idempotent on re-run — already-linked docs are skipped because
// the SELECT filters on photo_id IS NULL.

const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log('Backfilling payout pizzas to photos...');

  // Get all unlinked payout pizzas.
  const docs = await c.query(`
    SELECT pd.id AS pd_id,
           pd.party_id,
           pd.url,
           pd.file_name,
           pd.file_size,
           pd.mime_type,
           pd.uploaded_by_user_id,
           pd.uploaded_by_email,
           pd.created_at AS uploaded_at
    FROM payout_documents pd
    LEFT JOIN payouts p ON p.id = pd.payout_id
    WHERE pd.kind = 'pizza'
      AND pd.photo_id IS NULL
      AND (p.id IS NULL OR p.status <> 'rejected')
    ORDER BY pd.created_at ASC
  `);
  console.log(`Candidates: ${docs.rowCount}`);

  let linked = 0;
  let inserted = 0;
  let votesTransferred = 0;
  let skipped = 0;

  for (const d of docs.rows) {
    // Dedup: does a photo exist in the same party with the same url OR same
    // (file_name, file_size)? URL match takes precedence — same Supabase URL
    // is the strongest signal. file_name+file_size catches the Cape Town
    // pattern where the host uploaded the same file twice from different
    // pages (different Supabase paths but identical file metadata).
    const dupQ = await c.query(
      `
      SELECT id FROM photos
      WHERE party_id = $1
        AND (
          url = $2
          OR (file_name = $3 AND file_size = $4)
        )
      ORDER BY created_at ASC
      LIMIT 1
    `,
      [d.party_id, d.url, d.file_name, d.file_size],
    );

    let photoIdToLink;
    if (dupQ.rowCount > 0) {
      photoIdToLink = dupQ.rows[0].id;
      linked++;
    } else {
      // Insert a new photo row with auto-star + auto-approve so it surfaces
      // immediately on the event gallery + /photos feed. Schema mirrors the
      // new-upload path in payout.routes.ts:
      //   - status='approved', starred=true, starred_at=uploaded_at
      //   - reviewed_at=uploaded_at, reviewed_by=uploaded_by_user_id
      //   - uploaded_by is the Guest FK — payouts come from Users, so null
      //   - uploader_email is the User's email at upload time
      const newPhoto = await c.query(
        `
        INSERT INTO photos (
          id, party_id, url, file_name, file_size, mime_type,
          status, starred, starred_at, reviewed_at, reviewed_by,
          uploader_email, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5,
          'approved', true, $6, $6, $7,
          $8, $6, $6
        ) RETURNING id
      `,
        [
          d.party_id,
          d.url,
          d.file_name,
          d.file_size,
          d.mime_type,
          d.uploaded_at,
          d.uploaded_by_user_id,
          d.uploaded_by_email,
        ],
      );
      photoIdToLink = newPhoto.rows[0].id;
      inserted++;
    }

    // Stamp photo_id on the payout doc.
    await c.query(`UPDATE payout_documents SET photo_id = $1 WHERE id = $2`, [
      photoIdToLink,
      d.pd_id,
    ]);

    // Transfer payout_document_votes -> photo_votes (idempotent via
    // ON CONFLICT). Keep the original payout_document_votes rows as an audit
    // trail; the toggle endpoints still write to their respective vote tables
    // for new votes, but the feed/gallery only reads vote_count from photos
    // for linked rows (because they're excluded from the payout-side UNION).
    const voteTransfer = await c.query(
      `
      INSERT INTO photo_votes (photo_id, user_id, created_at)
      SELECT $1, user_id, created_at
      FROM payout_document_votes
      WHERE payout_document_id = $2
      ON CONFLICT (photo_id, user_id) DO NOTHING
      RETURNING id
    `,
      [photoIdToLink, d.pd_id],
    );
    votesTransferred += voteTransfer.rowCount;

    // Refresh the denormalized counter on photos.
    await c.query(
      `
      UPDATE photos SET vote_count = (
        SELECT COUNT(*) FROM photo_votes WHERE photo_id = $1
      ) WHERE id = $1
    `,
      [photoIdToLink],
    );
  }

  console.log(
    `Done. linked=${linked} inserted=${inserted} votesTransferred=${votesTransferred} skipped=${skipped}`,
  );
  await c.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
