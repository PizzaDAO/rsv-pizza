#!/usr/bin/env node
/**
 * One-off (sfincione-40417-bundle-fix): the LLM text pass over-flagged ordinary
 * multi-quantity pizza lines as is_bundle=true. Reset those flags on UNVERIFIED,
 * unedited lines and clear pizza_line_sync.llm_pass_at so the (fixed) LLM pass
 * reprocesses the documents.
 *
 * A flag is "sync's own deterministic" when looksLikeBundle(raw_name) matches
 * (BUNDLE_RE in src/services/pizzaSize.service.ts, mirrored below); those are
 * kept. Everything else on an unverified, unedited line was set by the LLM pass.
 *
 * DRY RUN by default; --apply to execute (single transaction).
 *   node backend/scripts/pizza-index-reset-llm-bundles.cjs [--apply]
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// KEEP IN SYNC with BUNDLE_RE in backend/src/services/pizzaSize.service.ts
const BUNDLE_RE = new RegExp(
  [
    'all[- ]you[- ]can', 'unlimited', 'ilimitad', 'rod[ií]zio', 'buffet',
    'pizza\\s+libre', 'libre\\s+de\\s+pizza', 'pizza\\s+party', 'party\\s+pack',
    'pizzas?\\s+varias?', 'pizzas?\\s+varios', 'varias\\s+pizzas', 'pizzas?\\s+surtid',
    'barra\\s+libre', 'promoci[oó]n.*libre', 'pizza\\s+combo\\s+x\\s*\\d+',
  ].join('|'),
  'i',
);

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, document_id, raw_name, qty::float AS qty
    FROM pizza_line_items
    WHERE is_bundle = true AND verified_at IS NULL AND updated_by IS NULL`);
  const [{ total, verified, edited }] = await prisma.$queryRawUnsafe(`
    SELECT count(*) FILTER (WHERE is_bundle)::int AS total,
           count(*) FILTER (WHERE is_bundle AND verified_at IS NOT NULL)::int AS verified,
           count(*) FILTER (WHERE is_bundle AND verified_at IS NULL AND updated_by IS NOT NULL)::int AS edited
    FROM pizza_line_items`);

  const keep = rows.filter((r) => BUNDLE_RE.test(r.raw_name));
  const reset = rows.filter((r) => !BUNDLE_RE.test(r.raw_name));
  const lineIds = reset.map((r) => r.id);
  const docIds = [...new Set(reset.map((r) => r.document_id))];

  console.log(`is_bundle=true lines total:                 ${total}`);
  console.log(`  verified (untouched):                     ${verified}`);
  console.log(`  hand-edited, updated_by set (untouched):  ${edited}`);
  console.log(`  unverified+unedited:                      ${rows.length}`);
  console.log(`    kept (sync heuristic matches name):     ${keep.length}`);
  console.log(`    to RESET is_bundle=false:               ${reset.length}`);
  console.log(`      of which qty > 1:                     ${reset.filter((r) => r.qty > 1).length}`);
  console.log(`  documents to reset llm_pass_at/attempts:  ${docIds.length}`);
  console.log('sample of lines to reset:');
  for (const r of reset.slice(0, 15)) console.log(`  qty ${r.qty}  ${r.raw_name}`);

  if (!APPLY) {
    console.log('\nDRY RUN - nothing written. Re-run with --apply to execute.');
    return;
  }
  const res = await prisma.$transaction(async (tx) => {
    const a = await tx.$executeRawUnsafe(
      `UPDATE pizza_line_items SET is_bundle = false, updated_at = now()
       WHERE id = ANY($1::uuid[]) AND is_bundle = true AND verified_at IS NULL AND updated_by IS NULL`, lineIds);
    const b = await tx.$executeRawUnsafe(
      `UPDATE pizza_line_sync SET llm_pass_at = NULL, llm_attempts = 0, llm_last_error_at = NULL
       WHERE document_id = ANY($1::uuid[])`, docIds);
    return { lines: a, docs: b };
  });
  console.log(`\nAPPLIED: ${res.lines} lines reset, ${res.docs} documents queued for the LLM pass.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
