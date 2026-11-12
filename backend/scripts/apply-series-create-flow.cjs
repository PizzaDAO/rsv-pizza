#!/usr/bin/env node
/** Apply 20261113_series_create_flow (event_series.create_flow + name_template + CHECK).
 *  Additive/nullable, idempotent. DRY RUN default (read-only); --apply to execute.
 *  Plain statements only: DATABASE_URL is the 6543 transaction pooler, so no session SETs. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const APPLY = process.argv.includes('--apply');
const COLS = ['create_flow', 'name_template'];
const CHECK = 'event_series_create_flow_check';
const CHECK_SQL = `ALTER TABLE "event_series" ADD CONSTRAINT "${CHECK}" CHECK ("create_flow" IS NULL OR "create_flow" IN ('global_day', 'meetup', 'hackathon'))`;
const prisma = new PrismaClient();
const existingCols = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='event_series' AND column_name = ANY($1::text[])`, COLS);
  return rows.map(r => r.column_name);
};
const hasCheck = async () => {
  const rows = await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_constraint WHERE conname = $1`, CHECK);
  return rows.length > 0;
};
(async () => {
  console.log(`\n=== series_create_flow (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  const have = await existingCols();
  const missing = COLS.filter(c => !have.includes(c));
  const checkExists = await hasCheck();
  console.log('existing columns:', have.join(', ') || '(none)');
  console.log('check constraint:', checkExists ? 'present' : 'absent');
  if (!missing.length && checkExists) { console.log('nothing to do.'); return; }
  for (const c of missing) console.log(`${APPLY ? 'Running' : 'Would run'}: ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "${c}" TEXT`);
  if (!checkExists) console.log(`${APPLY ? 'Running' : 'Would run'}: ${CHECK_SQL}`);
  if (!APPLY) return;
  for (const c of missing) await prisma.$executeRawUnsafe(`ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "${c}" TEXT`);
  if (!checkExists) await prisma.$executeRawUnsafe(CHECK_SQL);
  const after = await existingCols();
  const okCols = COLS.every(c => after.includes(c));
  const okCheck = await hasCheck();
  console.log(okCols && okCheck ? 'OK   verified columns + check constraint exist'
    : `FAIL columns missing: ${COLS.filter(c => !after.includes(c)).join(', ') || '(none)'}; check ${okCheck ? 'present' : 'absent'}`);
  if (!(okCols && okCheck)) process.exit(1);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
