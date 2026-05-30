#!/usr/bin/env node
/**
 * provola-92106: add `ineligible boolean` to payout_documents +
 * grant column-level SELECT to anon/authenticated. Mirrors the
 * culatello-92104 `is_duplicate` migration pattern.
 *
 * Run from rsvpizza root:
 *   DATABASE_URL=... node .claude/worktrees/agent-a4ff5cee72ace5cb3/scripts/apply-provola-92106-migration.cjs
 *
 * Idempotent — uses IF NOT EXISTS for the column add and re-grants are no-ops.
 */
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    console.log('-- Adding payout_documents.ineligible ...');
    await client.query(`
      ALTER TABLE payout_documents
      ADD COLUMN IF NOT EXISTS ineligible boolean NOT NULL DEFAULT false;
    `);

    console.log('-- Granting column-level SELECT to anon, authenticated ...');
    await client.query(`
      GRANT SELECT (ineligible) ON payout_documents TO anon, authenticated;
    `);

    const { rows } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'payout_documents'
        AND column_name = 'ineligible';
    `);
    console.log('-- post-migration:', rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
