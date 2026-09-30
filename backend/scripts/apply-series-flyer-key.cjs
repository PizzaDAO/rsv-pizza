#!/usr/bin/env node
/** Apply 20260929_series_flyer_template_key (add event_series.flyer_template_key).
 *  Additive/nullable, no behavior change. DRY RUN default; --apply to execute. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const hasCol = () => prisma.$queryRawUnsafe(
  `SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_series' AND column_name='flyer_template_key'))::text AS t`
).then(r => r[0].t);
(async () => {
  console.log(`\n=== series_flyer_template_key (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  if (await hasCol() === 'true') { console.log('column already exists — aborting.'); return; }
  if (!APPLY) { console.log('Would run: ALTER TABLE event_series ADD COLUMN flyer_template_key TEXT'); return; }
  await prisma.$executeRawUnsafe(`ALTER TABLE "event_series" ADD COLUMN "flyer_template_key" TEXT`);
  console.log('OK   added column; verify exists =', await hasCol());
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
