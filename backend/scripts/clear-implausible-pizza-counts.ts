/**
 * sfincione-40417 (pizza count): clear AUTO pizza counts that imply more than
 * MAX_USD_PER_PIZZA per pizza (a single catering line read as "1 pizza").
 * NO OpenAI, no network.
 *
 * Usage (from backend/, needs DATABASE_URL):
 *   npx tsx --env-file=.env scripts/clear-implausible-pizza-counts.ts
 *       -> DRY RUN (default): lists affected docs, writes nothing
 *   npx tsx --env-file=.env scripts/clear-implausible-pizza-counts.ts --apply --backup <file.json> [--skip id,id]
 *       --skip takes full or short (prefix) ids and leaves those docs out of --apply.
 *       Rows tagged [verify] have a USD total worth checking by hand (USD-stamped
 *       without a matching original_currency/original_amount, fx usd-passthrough, or
 *       an admin-corrected ocr_amount).
 *       -> writes a JSON backup of the affected rows' pizza_* values, then clears them
 *
 * Scope: kind='receipt' docs with pizza_count set and pizza_count_source not 'host'
 * whose count fails isPlausiblePizzaCount (imported from the service, not copied).
 * Receipts whose USD total can't be told are left alone. Only pizza_count,
 * pizza_count_source and pizza_count_confidence are cleared; size is untouched.
 *
 * Sync: no extra work is needed here. Clearing the count changes COUNT_HASH_SQL
 * (to NULL, or to a different hash if a size remains), so the next
 * POST /api/pizza-index/sync picks the doc up (it has line items, or is cleaned
 * by removeOrphans). With no count, buildLumpSumWrite returns null, the
 * line_index -1 row is not in `keep`, and planDocSync deletes it. HASH_SQL is
 * untouched, so no LLM/vision pass marker is reset. Run the sync after --apply.
 */
import { writeFileSync } from 'node:fs';

process.env.NODE_ENV ??= 'production'; // keep Prisma from logging every query

interface Args { apply: boolean; backup: string | null; skip: string[] }

function parseArgs(argv: string[]): Args {
  const a: Args = { apply: false, backup: null, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--apply') a.apply = true;
    else if (k === '--dry-run') a.apply = false;
    else if (k === '--backup') a.backup = argv[++i] ?? null;
    else if (k === '--skip') a.skip = (argv[++i] ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    else throw new Error(`Unknown argument ${k}`);
  }
  if (a.apply && !a.backup) throw new Error('--apply requires --backup <file>');
  return a;
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { prisma } = await import('../src/config/database.js');
  const { isPlausiblePizzaCount, receiptUsdTotalDetailed, usdPerPizza, MAX_USD_PER_PIZZA } =
    await import('../src/services/pizzaCountAutofill.js');

  const BATCH = 200;
  let cursor: string | null = null;
  let scanned = 0;
  let unknownTotal = 0;
  const affected: Array<Record<string, any>> = [];
  const rows: string[] = [];

  for (;;) {
    const docs: Array<Record<string, any>> = await prisma.payoutDocument.findMany({
      where: {
        kind: 'receipt',
        source: 'upload', // basil-14648: pizza-order drafts are not receipts
        pizzaCount: { not: null },
        OR: [{ pizzaCountSource: null }, { pizzaCountSource: { not: 'host' } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: {
        id: true, ocrRaw: true, ocrAmount: true, ocrCurrency: true, originalAmount: true, originalCurrency: true, exchangeRate: true,
        pizzaCount: true, pizzaCountSource: true, pizzaCountConfidence: true,
        party: { select: { country: true, city: true } },
      },
    });
    if (docs.length === 0) break;
    cursor = docs[docs.length - 1].id;
    for (const d of docs) {
      scanned += 1;
      const { usd: total, corrected } = receiptUsdTotalDetailed(d);
      if (total === null) { unknownTotal += 1; continue; }
      if (isPlausiblePizzaCount(d.pizzaCount, total)) continue;
      const effCur = String(d.originalCurrency ?? d.ocrCurrency ?? '').trim().toUpperCase();
      const fxSource = d.ocrRaw && typeof d.ocrRaw === 'object' ? (d.ocrRaw as any).fx?.source : null;
      const verifyReasons: string[] = [];
      if (effCur === 'USD') {
        if (String(d.originalCurrency ?? '').trim().toUpperCase() !== 'USD') verifyReasons.push('original_currency not USD');
        if (d.originalAmount == null) verifyReasons.push('no original_amount');
        if (fxSource === 'usd-passthrough') verifyReasons.push('fx usd-passthrough');
      }
      if (corrected) verifyReasons.push('admin-corrected ocr_amount used');
      const skipped = args.skip.some((x) => d.id.toLowerCase().startsWith(x));
      const per = usdPerPizza(d.pizzaCount, total);
      affected.push({
        id: d.id,
        verify: verifyReasons,
        skipped,
        pizzaCount: d.pizzaCount,
        pizzaCountSource: d.pizzaCountSource,
        pizzaCountConfidence: d.pizzaCountConfidence == null ? null : Number(d.pizzaCountConfidence.toString()),
        usdTotal: total,
        usdPerPizza: per === null ? null : Math.round(per * 100) / 100,
        country: d.party?.country ?? null,
        city: d.party?.city ?? null,
        ocrAmount: d.ocrAmount == null ? null : d.ocrAmount.toString(),
        ocrCurrency: d.ocrCurrency,
        originalAmount: d.originalAmount == null ? null : d.originalAmount.toString(),
        originalCurrency: d.originalCurrency,
        exchangeRate: d.exchangeRate == null ? null : d.exchangeRate.toString(),
      });
      rows.push(
        `${pad(d.id.slice(0, 8), 9)}${pad(String(d.party?.country ?? '-'), 16)}${pad(String(d.party?.city ?? '-'), 22)}` +
        `count=${pad(String(d.pizzaCount), 5)} usd=${pad(total.toFixed(2), 11)} $/pizza=${per === null ? '-' : per.toFixed(2)}` +
        `  (${d.originalAmount ?? '-'} ${d.originalCurrency ?? d.ocrCurrency ?? '?'} @ ${d.exchangeRate ?? '-'})` +
        (verifyReasons.length ? `  [verify] ${verifyReasons.join('; ')}` : '') + (skipped ? '  [SKIPPED]' : ''),
      );
    }
  }

  console.log(`\n${args.apply ? 'APPLY' : 'DRY RUN (nothing written)'}  max $/pizza = ${MAX_USD_PER_PIZZA}`);
  for (const r of rows) console.log('  ' + r);

  let cleared = 0;
  const toClear = affected.filter((a) => !a.skipped);
  if (args.apply && toClear.length > 0) {
    writeFileSync(args.backup!, JSON.stringify(toClear, null, 2));
    console.log(`\nbackup written: ${args.backup} (${toClear.length} rows)`);
    for (let i = 0; i < toClear.length; i += BATCH) {
      const ids = toClear.slice(i, i + BATCH).map((a) => a.id as string);
      // Re-assert the scope in the WHERE so a host edit made since the read is never overwritten.
      const res = await prisma.payoutDocument.updateMany({
        where: { id: { in: ids }, kind: 'receipt', source: 'upload', OR: [{ pizzaCountSource: null }, { pizzaCountSource: { not: 'host' } }] },
        data: { pizzaCount: null, pizzaCountSource: null, pizzaCountConfidence: null },
      });
      cleared += res.count;
    }
  }

  console.log(`\nauto-count receipts scanned: ${scanned}`);
  console.log(`USD total unknown (left alone): ${unknownTotal}`);
  console.log(`implausible (> $${MAX_USD_PER_PIZZA}/pizza): ${affected.length}  tagged [verify]: ${affected.filter((a) => a.verify.length).length}  skipped: ${affected.length - toClear.length}`);
  if (args.apply) console.log(`cleared: ${cleared}. Run POST /api/pizza-index/sync next (drops the lump-sum -1 lines; no OpenAI).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
