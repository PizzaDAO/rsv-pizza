/**
 * sfincione-40417 (submissions): how the third origin ('submission') flows through the view
 * mapping and the public aggregation. No receipt file URL may ever reach a public payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ viewRows: [] as any[], flag: null as string | null }));

vi.mock('../config/database.js', () => ({
  prisma: {
    appConfig: { findUnique: vi.fn(async () => (h.flag === null ? null : { key: 'k', value: h.flag })) },
    $queryRaw: vi.fn(async (q: any) => (String(q?.strings?.join('?') ?? '').includes('pizza_price_index_lines') ? h.viewRows : [])),
  },
}));

import {
  buildPublicIndexFromRows,
  getPublicCountryEvents,
  getPublicCountryReceipts,
  getPublicPizzaIndex,
  invalidatePizzaIndexCache,
  mapViewRow,
  selectPublicRows,
  type ViewRow,
} from './pizzaIndex.service.js';
import { prisma } from '../config/database.js';

let seq = 0;
function view(over: Partial<ViewRow> = {}): ViewRow {
  const n = ++seq;
  return {
    line_id: `l${n}`, document_id: null, party_id: null, party_name: 'Da Michele',
    country: 'Italy', city: 'Naples', region: 'western-europe', event_year: 2026, event_series_slug: null,
    document_url: null, document_mime_type: null, source_receipt_index: null, source_receipt_count: null,
    merchant: 'Da Michele', merchant_key: 'da michele', raw_name: 'Margherita', qty: 2, currency: 'EUR', fx_rate: 1.1,
    unit_price_list: 8, unit_price_net: null, unit_price_usd: 8.8, unit_price_net_usd: null,
    size_label: '32cm', shape: 'round', diameter_cm: 32, area_cm2: 804.2, style: null, size_source: 'parsed', size_confidence: 0.95,
    verified_at: null, verified_by: null, is_verified: false, outlier_flag: false, is_bundle: false,
    usd_per_cm2: 8.8 / 804.2, local_per_cm2: 8 / 804.2, net_usd_per_cm2: null,
    event_key: 'sub:2026:da michele|naples|Italy', origin: 'submission', fx_source: 'frankfurter:2026-10-10',
    is_lump_sum: false, receipt_key: 's:sub-1',
    ...over,
  };
}

beforeEach(() => {
  h.viewRows = [];
  h.flag = null;
  invalidatePizzaIndexCache();
});

describe('mapViewRow', () => {
  it('maps the submission origin and unknown origins to event (backward compatible)', () => {
    expect(mapViewRow(view()).origin).toBe('submission');
    expect(mapViewRow(view({ origin: 'history' })).origin).toBe('history');
    expect(mapViewRow(view({ origin: 'event' })).origin).toBe('event');
    expect(mapViewRow(view({ origin: 'something-new' })).origin).toBe('event');
  });
  it('drops any document url/mime for a submission even if the view leaked one', () => {
    const r = mapViewRow(view({ document_url: 'https://proj.supabase.co/storage/v1/object/sign/pizza-index-submissions/x.jpg', document_mime_type: 'image/jpeg' }));
    expect(r.documentUrl).toBeNull();
    expect(r.documentMimeType).toBeNull();
    // other origins keep theirs
    expect(mapViewRow(view({ origin: 'event', document_url: 'https://x/r.jpg' })).documentUrl).toBe('https://x/r.jpg');
  });
});

describe('aggregation with community rows', () => {
  it('counts one pizzeria-city-year as one event, and tags community events per country', () => {
    const rows = [
      view(), view(),                                                    // same pizzeria: one event
      view({ merchant: 'Sorbillo', merchant_key: 'sorbillo', event_key: 'sub:2026:sorbillo|naples|Italy' }),
      view({ origin: 'event', party_id: 'p1', document_id: 'd1', event_key: 'p1', party_name: 'GPP Rome', city: 'Rome' }),
    ].map(mapViewRow);
    const idx = buildPublicIndexFromRows(rows, 2026);
    const italy = idx.countries.find((c) => c.country === 'Italy')!;
    expect(italy.nParties).toBe(3);
    expect(italy.nCommunityParties).toBe(2);
  });
  it('a country can publish from community receipts alone', () => {
    const idx = buildPublicIndexFromRows([mapViewRow(view())], 2026);
    expect(idx.countries).toHaveLength(1);
    expect(idx.countries[0]).toMatchObject({ country: 'Italy', nParties: 1, nCommunityParties: 1 });
  });
  it('payload for GPP-only countries is unchanged except for the additive count (0)', () => {
    const idx = buildPublicIndexFromRows([mapViewRow(view({ origin: 'event', party_id: 'p1', document_id: 'd1', event_key: 'p1' }))], 2026);
    expect(idx.countries[0].nCommunityParties).toBe(0);
  });
  it('selectPublicRows keeps community rows like any other origin', () => {
    expect(selectPublicRows([mapViewRow(view())]).rows).toHaveLength(1);
  });
});

describe('public drill-down', () => {
  it('flags community events and exposes no file url, path, email or storage host', async () => {
    h.viewRows = [
      view({ document_url: 'https://proj.supabase.co/storage/v1/object/sign/pizza-index-submissions/anon/secret.jpg?token=abc' }),
      view({ origin: 'event', party_id: 'p1', document_id: 'd1', event_key: 'p1', party_name: 'GPP Rome', city: 'Rome', document_url: 'https://x/gpp.jpg' }),
    ];
    const events = (await getPublicCountryEvents('Italy', 2026))!;
    expect(events).toHaveLength(2);
    const community = events.find((e) => e.name === 'Da Michele')!;
    expect(community.community).toBe(true);
    expect(events.find((e) => e.name === 'GPP Rome')!.community).toBe(false);
    expect(community.photos).toEqual([]);
    const text = JSON.stringify([events, await getPublicPizzaIndex(2026)]);
    for (const bad of ['supabase', 'secret.jpg', 'storage', 'token=', 'anon/', '@']) expect(text).not.toContain(bad);
  });

  it('admin public-receipts never lists a submission receipt (no url on those rows)', async () => {
    h.viewRows = [view({ document_url: 'https://proj.supabase.co/storage/secret.jpg' })];
    expect(await getPublicCountryReceipts('Italy', 2026)).toEqual({});
  });

  it('app_config pizza_index.submissions_public = false pulls community rows out of every figure', async () => {
    h.viewRows = [
      view(),
      view({ origin: 'event', party_id: 'p1', document_id: 'd1', event_key: 'p1', party_name: 'GPP Rome', city: 'Rome' }),
    ];
    h.flag = 'false';
    const off = await getPublicPizzaIndex(2026);
    expect(off.countries[0]).toMatchObject({ nParties: 1, nCommunityParties: 0 });
    invalidatePizzaIndexCache();
    h.flag = 'true';
    expect((await getPublicPizzaIndex(2026)).countries[0]).toMatchObject({ nParties: 2, nCommunityParties: 1 });
    invalidatePizzaIndexCache();
    h.flag = null; // missing row = included
    expect((await getPublicPizzaIndex(2026)).countries[0].nParties).toBe(2);
  });

  it('survives a config read failure (included)', async () => {
    h.viewRows = [view()];
    (prisma.appConfig.findUnique as any).mockRejectedValueOnce(new Error('db down'));
    expect((await getPublicPizzaIndex(2026)).countries).toHaveLength(1);
  });
});
