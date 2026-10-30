/**
 * sfincione-40417 (pizza count): ONE-TIME LLM pass over receipts whose lump-sum
 * line was excluded as 'lump_sum' but that still have no pizza count.
 *
 * It calls the existing text pass (gpt-4o-mini, runLlmPass) in `countOnly` mode: the model is
 * asked for the stated "lumpSum.pizzaCount" and ONLY that is stored (source 'llm', confidence
 * <= 0.7, never over a host value). No line classification is applied and no pass markers are
 * touched. Each doc that gets a count is re-synced (force) so its synthetic per-pizza line
 * appears. Cost: one small text call per doc (a few dozen docs, well under $1).
 *
 * Usage (from backend/, needs DATABASE_URL + the OpenAI key available to the backend config):
 *   npx tsx scripts/backfill-pizza-count-llm.ts                 -> DRY RUN (default): lists the docs, no LLM calls
 *   npx tsx scripts/backfill-pizza-count-llm.ts --apply         -> runs the LLM over them (batches of 10)
 *   options: --year 2026 (default; filters on the party date / upload year), --limit N (max docs)
 *
 * DO NOT run against prod without Snax's go-ahead. Needs sfincione-40417-7-pizza-count.sql applied.
 */
process.env.NODE_ENV ??= 'production'; // keep Prisma from logging every query

interface Args { apply: boolean; year: number; limit: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { apply: false, year: 2026, limit: 500 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--apply') a.apply = true;
    else if (k === '--dry-run') a.apply = false;
    else if (k === '--year') a.year = Number(argv[++i]);
    else if (k === '--limit') a.limit = Number(argv[++i]);
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!Number.isInteger(a.year) || !Number.isInteger(a.limit) || a.limit < 1) throw new Error('--year/--limit must be integers');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { prisma } = await import('../src/config/database.js');
  const { Prisma } = await import('@prisma/client');

  const docs = await prisma.$queryRaw<Array<{ id: string; name: string; summary: string | null }>>(Prisma.sql`
    SELECT d.id, p.name, d.ocr_summary AS summary
    FROM payout_documents d
    JOIN parties p ON p.id = d.party_id
    JOIN pizza_line_sync s ON s.document_id = d.id
    WHERE d.kind = 'receipt' AND d.is_duplicate = false AND d.ineligible = false
      AND d.pizza_count IS NULL AND d.pizza_count_source IS NULL
      AND COALESCE(EXTRACT(YEAR FROM p.date)::int, EXTRACT(YEAR FROM d.created_at)::int) = ${args.year}
      AND EXISTS (SELECT 1 FROM pizza_line_items li WHERE li.document_id = d.id AND li.excluded_reason = 'lump_sum')
    ORDER BY d.created_at
    LIMIT ${args.limit}`);

  console.log(`${args.apply ? 'APPLY' : 'DRY RUN (no LLM calls, nothing written)'}: ${docs.length} ${args.year} receipt(s) with a lump_sum-excluded line and no count`);
  for (const d of docs.slice(0, 50)) console.log(`  ${d.id}  ${d.name}  "${(d.summary ?? '').slice(0, 70)}"`);
  if (docs.length > 50) console.log(`  ... and ${docs.length - 50} more`);

  if (args.apply && docs.length > 0) {
    const { runLlmPass } = await import('../src/services/pizzaIndexLlm.service.js');
    let counted = 0;
    let processed = 0;
    for (let i = 0; i < docs.length; i += 10) {
      const ids = docs.slice(i, i + 10).map((d) => d.id);
      const r = await runLlmPass({ docIds: ids, limit: 10, countOnly: true });
      processed += r.processed;
      counted += r.linesUpdated; // countOnly: one per doc that got a count
      for (const e of r.errors) console.error(`  error ${e.documentId}: ${e.error}`);
    }
    console.log(`\nprocessed ${processed}, counts written ${counted}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
