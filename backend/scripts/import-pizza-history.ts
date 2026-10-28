/**
 * sfincione-40417 (history): import pre-2026 GPP receipts (transcribed from
 * Drive into JSON) into pizza_history_receipts + pizza_line_items, as a
 * SEPARATE yearly index (no 2021-2025 price is ever mixed into a 2026 figure).
 *
 * Usage (from backend/):
 *   npx tsx scripts/import-pizza-history.ts --in <file.json|dir> [--year 2023] [--no-db]
 *       -> DRY RUN (default): validates, resolves FX + sizes, prints a report. Writes nothing.
 *   npx tsx scripts/import-pizza-history.ts --in <file.json|dir> --apply [--force] [--batch name]
 *       -> writes. One transaction per receipt (upsert on source_file_id; its lines are replaced
 *          UNLESS a line has verified_at/updated_by = human work, then the receipt is skipped
 *          unless --force). Calls flagOutliers() at the end.
 *
 * Needs DATABASE_URL (presets are read even in a dry run; --no-db skips that and uses no
 * presets). Apply requires sfincione-40417-6-history.sql to be applied first.
 * Records with year >= 2026 are skipped: those receipts already exist as payout documents.
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV ??= 'production'; // keep Prisma from logging every query

interface Args { input: string; apply: boolean; force: boolean; year: number | null; batch: string; noDb: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { input: '', apply: false, force: false, year: null, batch: `history-${new Date().toISOString().slice(0, 10)}`, noDb: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--in') a.input = argv[++i] ?? '';
    else if (k === '--apply') a.apply = true;
    else if (k === '--force') a.force = true;
    else if (k === '--no-db') a.noDb = true;
    else if (k === '--year') a.year = Number(argv[++i]);
    else if (k === '--batch') a.batch = argv[++i] ?? a.batch;
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!a.input) throw new Error('--in <file.json|dir> is required');
  if (a.year !== null && !Number.isInteger(a.year)) throw new Error('--year must be an integer');
  if (a.apply && a.noDb) throw new Error('--apply cannot be combined with --no-db');
  return a;
}

function loadRecords(input: string): unknown[] {
  const st = fs.statSync(input);
  const files = st.isDirectory()
    ? fs.readdirSync(input).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(input, f))
    : [input];
  const out: unknown[] = [];
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(j)) throw new Error(`${f}: expected a JSON array of records`);
    out.push(...j);
  }
  return out;
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const countBy = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [{ validateRecord, keyReceipts, normalizeCountry, buildHistoryLines, medianOf }, { getReceiptFx, FxUnavailableError }, sizeSvc] = await Promise.all([
    import('./lib/historyImport.js'),
    import('./lib/historicalFx.js'),
    import('../src/services/pizzaSize.service.js'),
  ]);
  type HistoryRecord = import('./lib/historyImport.js').HistoryRecord;
  type HistoryLine = import('./lib/historyImport.js').HistoryLine;

  const rawRecords = loadRecords(args.input);
  console.log(`Loaded ${rawRecords.length} records from ${args.input} (${args.apply ? 'APPLY' : 'dry run'}${args.force ? ', force' : ''})`);

  // 1. validate + dedupe + year filter
  const skipped: Array<{ id: string; reason: string }> = [];
  const valid: HistoryRecord[] = [];
  const rawBySourceId = new Map<string, unknown[]>();
  for (const raw of rawRecords) {
    const v = validateRecord(raw);
    if (!v.ok) { skipped.push({ id: v.sourceFileId ?? '?', reason: v.reason }); continue; }
    if (args.year !== null && v.record.year !== args.year) continue;
    valid.push(v.record);
    (rawBySourceId.get(v.record.sourceFileId) ?? rawBySourceId.set(v.record.sourceFileId, []).get(v.record.sourceFileId)!).push(raw);
  }
  const keyed = keyReceipts(valid);
  skipped.push(...keyed.notes);
  const seen = new Map<string, HistoryRecord>(keyed.records.map((r) => [r.sourceFileId, r]));
  // raw JSON kept per final key (the original record, for audit/re-import)
  const rawById = new Map<string, unknown>();
  for (const r of keyed.records) {
    const base = r.sourceFileId.split('#')[0];
    const cands = rawBySourceId.get(base) ?? [];
    const match = cands.find((c) => { const v = validateRecord(c); return v.ok && JSON.stringify({ ...v.record, sourceFileId: r.sourceFileId }) === JSON.stringify(r); });
    rawById.set(r.sourceFileId, match ?? cands[0]);
  }

  // 2. country normalisation
  type Prepared = { rec: HistoryRecord; country: string; region: string | null };
  const prepared: Prepared[] = [];
  const unknownCountries = new Set<string>();
  for (const rec of seen.values()) {
    const c = normalizeCountry(rec.country);
    if (!c) { unknownCountries.add(rec.country); skipped.push({ id: rec.sourceFileId, reason: `unknown country "${rec.country}"` }); continue; }
    prepared.push({ rec, country: c.country, region: c.region });
  }

  // 3-5. FX + lines
  const presets = args.noDb ? [] : await (await import('../src/services/pizzaLineSync.service.js')).loadPresets();
  type Built = Prepared & { fx: Awaited<ReturnType<typeof getReceiptFx>>; lines: HistoryLine[] };
  const built: Built[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const p of prepared) {
    try {
      if (p.rec.kind === 'not_pizza') {
        // Stored for coverage/dedupe only: no prices, so no FX needed.
        built.push({ ...p, fx: { rate: 0, source: 'n/a', date: p.rec.receiptDate ?? `${p.rec.year}-10-01`, assumedDate: false }, lines: [] });
        continue;
      }
      const fx = await getReceiptFx(p.rec.currency, p.rec.receiptDate, p.rec.year, { crossCheck: true });
      built.push({ ...p, fx, lines: buildHistoryLines(p.rec, presets, fx.rate, p.country) });
    } catch (e) {
      failed.push({ id: p.rec.sourceFileId, reason: e instanceof FxUnavailableError ? e.message : String(e) });
    }
  }

  // 7. report
  console.log(`\n== Receipts: ${built.length} importable, ${skipped.length} skipped, ${failed.length} failed`);
  const byYCK = countBy(built, (b) => `${b.rec.year} | ${b.country} | ${b.rec.kind}`);
  for (const [k, n] of [...byYCK].sort()) console.log(`  ${pad(k, 52)} ${n}`);
  if (skipped.length) {
    console.log('\n== Skipped');
    for (const s of skipped) console.log(`  ${s.id}: ${s.reason}`);
  }
  if (unknownCountries.size) console.log(`\n!! Unknown countries (fix the spelling): ${[...unknownCountries].join(', ')}`);
  if (failed.length) {
    console.log('\n== FAILED (no FX rate; add scripts/data/pizza-history-fx-overrides.json)');
    for (const s of failed) console.log(`  ${s.id}: ${s.reason}`);
  }

  console.log('\n== FX source mix');
  for (const [k, n] of [...countBy(built, (b) => b.fx.source.split(':')[0])].sort()) console.log(`  ${pad(k, 20)} ${n}`);
  const assumed = built.filter((b) => b.fx.assumedDate);
  if (assumed.length) {
    const risky = new Set(['ARS', 'VES', 'NGN', 'TRY', 'EGP', 'LBP', 'GHS']);
    console.log(`  assumed-date receipts (no receiptDate): ${assumed.length}; high-inflation currencies among them: ${
      [...new Set(assumed.filter((b) => risky.has(b.rec.currency)).map((b) => `${b.rec.currency} ${b.rec.year}`))].join(', ') || 'none'}`);
  }
  for (const b of built) if (b.fx.warning) console.log(`  FX warning ${b.rec.sourceFileId} ${b.rec.currency} ${b.rec.receiptDate}: ${b.fx.warning}`);

  const allLines = built.flatMap((b) => b.lines.map((l) => ({ b, l })));
  const sane = sizeSvc.roundArea; // (kept for the 30 cm ladder below)
  const { ESTIMATE_SANE_USD_PER_CM2 } = await import('../src/services/pizzaIndex.service.js');
  const sizedLines = allLines.filter(({ l }) => l.areaCm2 && l.areaCm2 > 0 && l.unitPriceUsd > 0 && !l.excluded);
  const outside = sizedLines.filter(({ l }) => {
    const x = l.unitPriceUsd / l.areaCm2!;
    return x < ESTIMATE_SANE_USD_PER_CM2.min || x > ESTIMATE_SANE_USD_PER_CM2.max;
  });
  console.log(`\n== Lines: ${allLines.length} (${sizedLines.length} sized and priced, ${allLines.length - sizedLines.length} unsized/excluded, ${allLines.filter(({ l }) => l.isBundle).length} bundles)`);
  console.log(`== Lines outside the sane band (${ESTIMATE_SANE_USD_PER_CM2.min}-${ESTIMATE_SANE_USD_PER_CM2.max} USD/cm2): ${outside.length}`);
  for (const { b, l } of outside.slice(0, 40)) {
    console.log(`  ${b.rec.year} ${b.country}/${b.rec.city ?? '-'} "${l.rawName}" ${l.unitPriceList} ${l.currency} -> ${(l.unitPriceUsd / l.areaCm2!).toFixed(4)} USD/cm2  [${b.rec.sourceFileId}]`);
  }

  console.log('\n== Provisional median USD for a 30 cm pizza (median of per-receipt medians; non-bundle, sized lines)');
  const perReceipt = new Map<string, number[]>();
  for (const { b, l } of sizedLines) {
    if (l.isBundle) continue;
    const k = `${b.rec.sourceFileId}`;
    (perReceipt.get(k) ?? perReceipt.set(k, []).get(k)!).push(l.unitPriceUsd / l.areaCm2!);
  }
  const byCountryYear = new Map<string, { vals: number[]; lump: number }>();
  for (const b of built) {
    const vs = perReceipt.get(b.rec.sourceFileId);
    if (!vs) continue;
    const m = medianOf(vs)!;
    const k = `${b.country} | ${b.rec.year}`;
    const e = byCountryYear.get(k) ?? { vals: [], lump: 0 };
    e.vals.push(m);
    if (b.rec.kind === 'lump_sum') e.lump += 1;
    byCountryYear.set(k, e);
  }
  const area30 = sane(30);
  for (const [k, e] of [...byCountryYear].sort()) {
    console.log(`  ${pad(k, 36)} $${(medianOf(e.vals)! * area30).toFixed(2).padStart(7)}   receipts=${e.vals.length}${e.lump ? ` (${e.lump} lump-sum)` : ''}`);
  }

  if (!args.apply) {
    console.log('\nDry run only: nothing was written. Re-run with --apply after reviewing.');
    return;
  }

  // 6. writes
  const { prisma } = await import('../src/config/database.js');
  const { flagOutliers } = await import('../src/services/pizzaIndex.service.js');
  const stats = { written: 0, skippedHuman: 0, lines: 0 };
  for (const b of built) {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.pizzaHistoryReceipt.findUnique({ where: { sourceFileId: b.rec.sourceFileId }, select: { id: true } });
      if (existing && !args.force) {
        const human = await tx.pizzaLineItem.count({
          where: { historyReceiptId: existing.id, OR: [{ verifiedAt: { not: null } }, { updatedBy: { not: null } }] },
        });
        if (human > 0) return 'skipped-human' as const;
      }
      const data = {
        sourceTitle: b.rec.sourceTitle, sourceUrl: b.rec.sourceUrl, year: b.rec.year,
        receiptDate: b.rec.receiptDate ? new Date(`${b.rec.receiptDate}T00:00:00Z`) : null,
        country: b.country, city: b.rec.city, region: b.region,
        merchant: b.rec.merchant, merchantKey: sizeSvc.normalizeMerchantKey(b.rec.merchant),
        currency: b.rec.currency, total: b.rec.total, kind: b.rec.kind, pizzaCount: b.rec.pizzaCount,
        fxRate: b.rec.kind === 'not_pizza' ? null : b.fx.rate,
        fxSource: b.rec.kind === 'not_pizza' ? null : b.fx.source,
        fxDate: b.rec.kind === 'not_pizza' ? null : new Date(`${b.fx.date}T00:00:00Z`),
        raw: rawById.get(b.rec.sourceFileId) as object, importBatch: args.batch,
      };
      const receipt = await tx.pizzaHistoryReceipt.upsert({
        where: { sourceFileId: b.rec.sourceFileId },
        create: { sourceFileId: b.rec.sourceFileId, ...data },
        update: { ...data, updatedAt: new Date() },
        select: { id: true },
      });
      await tx.pizzaLineItem.deleteMany({ where: { historyReceiptId: receipt.id } });
      if (b.lines.length) {
        await tx.pizzaLineItem.createMany({ data: b.lines.map((l) => ({ ...l, historyReceiptId: receipt.id })) });
      }
      return 'written' as const;
    });
    if (outcome === 'written') { stats.written += 1; stats.lines += b.lines.length; } else stats.skippedHuman += 1;
  }
  const outliers = await flagOutliers();
  console.log(`\nApplied: ${stats.written} receipts written (${stats.lines} lines), ${stats.skippedHuman} skipped (human-reviewed; use --force), outliers flagged: ${outliers.flagged}`);
  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
