/**
 * sfincione-40417 (pizza count): deterministic backfill of payout_documents.pizza_*
 * from the stored ocr_line_items / ocr_raw. NO OpenAI, no network.
 *
 * Usage (from backend/, needs DATABASE_URL; apply sfincione-40417-7-pizza-count.sql first):
 *   npx tsx scripts/backfill-pizza-count.ts            -> DRY RUN (default): report only, writes nothing
 *   npx tsx scripts/backfill-pizza-count.ts --apply    -> writes in batches of 200
 *   options: --samples N (how many sample matches per source to print, default 15)
 *
 * Scope: kind='receipt' docs with pizza_count_source IS NULL AND pizza_size_source IS NULL
 * (host values and earlier auto values are never touched; mergeAutofill is host-sticky anyway).
 * Effect: auto-filled docs get a different count_hash, so the NEXT pizza line sync
 * (POST /api/pizza-index/sync) re-plans them once. That is a plan-only sync: HASH_SQL is
 * unchanged so no LLM/vision pass marker is reset.
 */
process.env.NODE_ENV ??= 'production'; // keep Prisma from logging every query

interface Args { apply: boolean; samples: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { apply: false, samples: 15 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--apply') a.apply = true;
    else if (k === '--dry-run') a.apply = false;
    else if (k === '--samples') a.samples = Number(argv[++i]);
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!Number.isInteger(a.samples) || a.samples < 0) throw new Error('--samples must be a non-negative integer');
  return a;
}

const band = (c: number | null) => (c === null ? 'n/a' : c >= 0.7 ? '>=0.70' : c >= 0.5 ? '0.50-0.69' : '<0.50');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { prisma } = await import('../src/config/database.js');
  const { derivePizzaAutofill, mergeAutofill, pizzaFieldsFromDoc } = await import('../src/services/pizzaCountAutofill.js');

  const BATCH = 200;
  let cursor: string | null = null;
  let scanned = 0;
  let withCount = 0;
  let withSize = 0;
  let written = 0;
  const byCountBand = new Map<string, number>();
  const bySource = new Map<string, number>();
  const samples: string[] = [];
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (;;) {
    const docs: Array<Record<string, any>> = await prisma.payoutDocument.findMany({
      where: { kind: 'receipt', pizzaCountSource: null, pizzaSizeSource: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: {
        id: true, ocrLineItems: true, ocrRaw: true, ocrConfidence: true, ocrSummary: true,
        pizzaCount: true, pizzaCountSource: true, pizzaCountConfidence: true,
        pizzaSizeCm: true, pizzaSizeLabel: true, pizzaSizeSource: true, pizzaSizeConfidence: true,
      },
    });
    if (docs.length === 0) break;
    cursor = docs[docs.length - 1].id;
    const ops: any[] = [];
    for (const d of docs) {
      scanned += 1;
      const conf = d.ocrConfidence == null ? null : Number(d.ocrConfidence.toString());
      const auto = derivePizzaAutofill(d.ocrLineItems, d.ocrRaw, conf);
      const patch = mergeAutofill(pizzaFieldsFromDoc(d), auto);
      if (Object.keys(patch).length === 0) continue;
      if (patch.pizzaCount != null) {
        withCount += 1;
        bump(byCountBand, band(patch.pizzaCountConfidence ?? null));
        bump(bySource, `${patch.pizzaCountSource}`);
        if (samples.length < args.samples) {
          samples.push(`${d.id}  count=${patch.pizzaCount} (${patch.pizzaCountSource}, ${patch.pizzaCountConfidence})  size=${patch.pizzaSizeCm ?? patch.pizzaSizeLabel ?? '-'}  summary="${(d.ocrSummary ?? '').slice(0, 70)}"`);
        }
      }
      if (patch.pizzaSizeCm != null || patch.pizzaSizeLabel != null) withSize += 1;
      if (args.apply) ops.push(prisma.payoutDocument.update({ where: { id: d.id }, data: patch }));
    }
    if (args.apply && ops.length) {
      await prisma.$transaction(ops);
      written += ops.length;
    }
  }

  console.log(`\n${args.apply ? 'APPLIED' : 'DRY RUN (nothing written)'}`);
  console.log(`receipts scanned (no pizza_* yet): ${scanned}`);
  console.log(`would get a count: ${withCount}   a size: ${withSize}`);
  console.log('count confidence bands:', Object.fromEntries(byCountBand));
  console.log('count sources:', Object.fromEntries(bySource));
  console.log('sample matches:');
  for (const s of samples) console.log('  ' + s);
  if (args.apply) console.log(`\nrows written: ${written}. Run POST /api/pizza-index/sync next (plan-only; no OpenAI).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
