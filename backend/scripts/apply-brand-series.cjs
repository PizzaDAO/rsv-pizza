#!/usr/bin/env node
/** Upsert the `team1` and `monad` white-label event_series rows (see plans/whitelabel-team1-monad.md §5).
 *  Idempotent, keyed by slug. DRY RUN by default (read-only); --apply to write.
 *  On an existing row only the brand-defining fields are updated, so later edits made in
 *  /admin/series (tags, approval, checklist defaults, ...) are not overwritten.
 *  Requires event_series.site_url / brand_name (apply-series-site-url.cjs). */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const brandRow = (slug, label, brandName, publicTags) => ({
  slug,
  name: `${label} Pizza Parties`,
  displayName: label,
  brandName,
  siteUrl: `https://${slug}.rsv.pizza`,
  themeClass: `${slug}-theme`,
  logoUrl: `https://${slug}.rsv.pizza/brands/${slug}/logo.png`,
  ogImageUrl: `https://${slug}.rsv.pizza/brands/${slug}/og.png`,
  isActive: true,
  // Not GPP (D3): stays out of GPP map / leaderboard / payouts.
  eventType: null,
  flyerTemplateKey: null,
  fundingWalletAddress: null,
  publicTags,
  internalTags: [slug],
  requireApproval: false,
  hideGuests: false,
  photosEnabled: true,
  photosPublic: true,
});

const ROWS = [
  brandRow('team1', 'Team1', 'Team1 Pizza', ['Team1', 'Avalanche']),
  brandRow('monad', 'Monad', 'Monad Pizza', ['Monad']),
];

// Fields refreshed on an existing row.
const UPDATE_KEYS = ['name', 'displayName', 'brandName', 'siteUrl', 'themeClass', 'logoUrl', 'ogImageUrl', 'isActive'];

(async () => {
  console.log(`\n=== brand series (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  for (const row of ROWS) {
    const existing = await prisma.eventSeries.findUnique({ where: { slug: row.slug } });
    if (!existing) {
      console.log(`${APPLY ? 'Creating' : 'Would create'} series '${row.slug}':`);
      console.log(JSON.stringify(row, null, 2));
      if (APPLY) await prisma.eventSeries.create({ data: row });
      continue;
    }
    const update = {};
    for (const k of UPDATE_KEYS) if (existing[k] !== row[k]) update[k] = row[k];
    if (!Object.keys(update).length) {
      console.log(`OK   '${row.slug}' already up to date`);
      continue;
    }
    console.log(`${APPLY ? 'Updating' : 'Would update'} series '${row.slug}':`, JSON.stringify(update));
    if (APPLY) await prisma.eventSeries.update({ where: { slug: row.slug }, data: update });
  }
  if (APPLY) {
    const rows = await prisma.eventSeries.findMany({
      where: { slug: { in: ROWS.map((r) => r.slug) } },
      select: { slug: true, siteUrl: true, brandName: true, isActive: true },
    });
    console.log('verified:', JSON.stringify(rows));
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
