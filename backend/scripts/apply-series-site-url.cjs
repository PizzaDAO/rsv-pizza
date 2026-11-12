#!/usr/bin/env node
/** Apply 20261112_series_site_url (add event_series.site_url + brand_name).
 *  Additive/nullable, idempotent. DRY RUN default (read-only); --apply to execute. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const APPLY = process.argv.includes('--apply');
const COLS = ['site_url', 'brand_name'];
const prisma = new PrismaClient();
const existing = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='event_series' AND column_name = ANY($1::text[])`, COLS);
  return rows.map(r => r.column_name);
};
(async () => {
  console.log(`\n=== series_site_url (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  const have = await existing();
  const missing = COLS.filter(c => !have.includes(c));
  console.log('existing columns:', have.join(', ') || '(none)');
  if (!missing.length) { console.log('all columns already exist - nothing to do.'); return; }
  for (const c of missing) console.log(`${APPLY ? 'Running' : 'Would run'}: ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "${c}" TEXT`);
  if (!APPLY) return;
  for (const c of missing) await prisma.$executeRawUnsafe(`ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "${c}" TEXT`);
  const after = await existing();
  const ok = COLS.every(c => after.includes(c));
  console.log(ok ? 'OK   verified both columns exist' : 'FAIL columns missing after apply: ' + COLS.filter(c => !after.includes(c)).join(', '));
  if (!ok) process.exit(1);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
