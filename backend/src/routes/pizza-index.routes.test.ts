/**
 * sfincione-40417: auth + scoping tests for the Pizza Index routes.
 * Prisma and the auth helpers are mocked; no DB, no OpenAI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  paymentAdmins: new Set<string>(),
  underbosses: new Map<string, { isAdmin: boolean; regions: string[]; cities: string[] }>(),
  lines: new Map<string, any>(),
  outOfScopeCount: 0,
  viewRows: [] as any[],
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const email = req.headers['x-test-email'];
    if (!email) return next(Object.assign(new Error('No token'), { statusCode: 401 }));
    req.userEmail = String(email);
    next();
  },
  isPaymentAdmin: async (e?: string) => !!e && h.paymentAdmins.has(e),
  isUnderboss: async (e?: string) => !!e && h.underbosses.has(e),
}));
vi.mock('../helpers/underbossScope.js', async () => {
  const actual = await vi.importActual<typeof import('../helpers/underbossScope.js')>('../helpers/underbossScope.js').catch(() => null);
  return {
    getUnderbossScope: async (e: string) => h.underbosses.get(e) ?? { isAdmin: false, regions: [], cities: [] },
    partyMatchesScope: (party: any, scope: any) =>
      scope.isAdmin || scope.regions.includes(party.region) || scope.cities.map((c: string) => c.toLowerCase()).includes((party.city ?? '').toLowerCase()),
    buildScopedWhereClause: () => null,
    ...(actual ? {} : {}),
  };
});
vi.mock('../config/database.js', () => ({
  prisma: {
    pizzaLineItem: {
      findUnique: vi.fn(async ({ where }: any) => h.lines.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => ({ ...h.lines.get(where.id), ...data, id: where.id })),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => h.lines.get(where.id)),
    },
    pizzaSizePreset: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => ({ id: 'p1', createdAt: new Date(), updatedAt: null, sourceUrl: null, ...data })) },
    // count(*) aggregate queries always return exactly one row; row queries return none.
    $queryRaw: vi.fn(async (q: any) => (String(q?.strings?.join('?') ?? '').includes('FROM pizza_price_index_lines v') ? h.viewRows : String(q?.strings?.join('?') ?? '').includes('count(') ? [{
      c: h.outOfScopeCount,
      total: 0, total_lines: 0, verified_lines: 0, total_pizzas: 0, verified_pizzas: 0, unresolved: 0, outliers: 0,
      bundles: 0, with_items: 0, synced: 0, pending_llm: 0, lines: 0, verified: 0, excluded: 0, n: 0,
    }] : [])),
    $executeRaw: vi.fn(async () => 0),
    party: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('../services/pizzaLineSync.service.js', () => ({
  syncPizzaLineItems: vi.fn(async () => ({ docsScanned: 0, docsSynced: 0, docsSkippedNoFx: 0, linesWritten: 0, linesDeleted: 0, remaining: 0, duplicatesMarked: 0, orphansRemoved: 0 })),
  reresolveUnverified: vi.fn(async () => 0),
}));
vi.mock('../services/pizzaLineDocs.service.js', () => ({ reallocateDocDiscounts: vi.fn(async () => undefined) }));
vi.mock('../services/pizzaIndexLlm.service.js', () => ({
  runLlmPass: vi.fn(async () => ({ processed: 0 })),
  runVisionPass: vi.fn(async () => ({ processed: 0 })),
}));

import router, { publicPizzaIndexRouter } from './pizza-index.routes.js';
import { invalidatePizzaIndexCache } from '../services/pizzaIndex.service.js';
import { prisma } from '../config/database.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/pizza-index', router);
  a.use('/api/pizza-index', publicPizzaIndexRouter);
  a.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message, code: err.code } });
  });
  return a;
}

const dbLine = (partyRegion: string) => ({
  id: 'line1', documentId: 'doc1', partyId: 'party1', lineIndex: 0, lineFingerprint: 'fp', sourceCategory: 'pizza',
  rawName: 'Large', merchant: 'M', merchantKey: 'm', qty: 1, unitPriceList: 10, unitPriceNet: null, discountAmount: null,
  discountLabel: null, currency: 'USD', fxRate: 1, unitPriceUsd: 10, sizeLabel: 'large', shape: 'round',
  diameterCm: 35, lengthCm: null, widthCm: null, sliceFraction: null, areaCm2: 962.1, style: null, sizeSource: 'preset',
  sizeConfidence: 0.5, presetId: null, verifiedBy: null, verifiedAt: null, updatedBy: null, excluded: false,
  excludedReason: null, isBundle: false, outlierFlag: false, notes: null, createdAt: new Date(), updatedAt: null,
  party: { region: partyRegion, city: 'Lagos', name: 'GPP Lagos', eventType: 'gpp' },
});

beforeEach(() => {
  h.paymentAdmins.clear();
  h.underbosses.clear();
  h.lines.clear();
  h.outOfScopeCount = 0;
  h.viewRows = [];
  invalidatePizzaIndexCache();
  h.paymentAdmins.add('admin@x.com');
  h.underbosses.set('ub@x.com', { isAdmin: false, regions: ['west-africa'], cities: [] });
  h.lines.set('line1', dbLine('west-africa'));
  h.lines.set('line2', { ...dbLine('usa'), id: 'line2' });
  // archive line: no document, no party
  h.lines.set('hist1', { ...dbLine('west-africa'), id: 'hist1', documentId: null, partyId: null, party: null, historyReceiptId: 'hr1' });
});

describe('auth gates', () => {
  it('rejects unauthenticated + non-reviewers', async () => {
    expect((await request(app()).get('/api/admin/pizza-index/status')).status).toBe(401);
    expect((await request(app()).get('/api/admin/pizza-index/status').set('x-test-email', 'rando@x.com')).status).toBe(403);
  });

  it('underbosses cannot run spend / bulk ops', async () => {
    for (const path of ['sync', 'llm-pass', 'vision-pass']) {
      const r = await request(app()).post(`/api/admin/pizza-index/${path}`).set('x-test-email', 'ub@x.com').send({});
      expect(r.status).toBe(403);
    }
  });

  it('admins can run them', async () => {
    const r = await request(app()).post('/api/admin/pizza-index/sync').set('x-test-email', 'admin@x.com').send({});
    expect(r.status).toBe(200);
    expect(r.body.docsSynced).toBe(0);
    expect((await request(app()).post('/api/admin/pizza-index/llm-pass').set('x-test-email', 'admin@x.com').send({ dryRun: true })).status).toBe(200);
  });

  it('underbosses can read the queue / index / presets', async () => {
    for (const path of ['queue', 'index', 'presets']) {
      const r = await request(app()).get(`/api/admin/pizza-index/${path}`).set('x-test-email', 'ub@x.com');
      expect(r.status, path).toBe(200);
    }
  });
});

describe('PATCH /lines/:id scoping', () => {
  it('underboss can edit + verify an in-scope line, recording verified_by', async () => {
    const r = await request(app()).patch('/api/admin/pizza-index/lines/line1').set('x-test-email', 'ub@x.com').send({ diameterCm: 30, shape: 'round' });
    expect(r.status).toBe(200);
    expect(r.body.line.verifiedBy).toBe('ub@x.com');
    expect(r.body.line.sizeSource).toBe('manual');
    expect(r.body.line.sizeConfidence).toBe(1);
    expect(r.body.line.areaCm2).toBe(706.9);
    expect(r.body.line.sizeLadderUsd['30']).toBeCloseTo(10, 1);
  });

  it('underboss cannot touch an out-of-scope line', async () => {
    const r = await request(app()).patch('/api/admin/pizza-index/lines/line2').set('x-test-email', 'ub@x.com').send({ diameterCm: 30, shape: 'round' });
    expect(r.status).toBe(403);
  });

  it('admin can edit any line', async () => {
    const r = await request(app()).patch('/api/admin/pizza-index/lines/line2').set('x-test-email', 'admin@x.com').send({ diameterCm: 33, shape: 'round' });
    expect(r.status).toBe(200);
    expect(r.body.line.verifiedBy).toBe('admin@x.com');
  });

  it('validates sizes and requires a size to verify', async () => {
    const bad = await request(app()).patch('/api/admin/pizza-index/lines/line1').set('x-test-email', 'admin@x.com').send({ shape: 'round', diameterCm: 5 });
    expect(bad.status).toBe(400);
    h.lines.set('line3', { ...dbLine('west-africa'), id: 'line3', areaCm2: null, shape: null, diameterCm: null });
    const noSize = await request(app()).patch('/api/admin/pizza-index/lines/line3').set('x-test-email', 'admin@x.com').send({ verify: true });
    expect(noSize.status).toBe(400);
    expect(noSize.body.error.code).toBe('SIZE_REQUIRED');
    const excl = await request(app()).patch('/api/admin/pizza-index/lines/line3').set('x-test-email', 'admin@x.com').send({ excluded: true, excludedReason: 'not_pizza' });
    expect(excl.status).toBe(200);
    expect(excl.body.line.excluded).toBe(true);
    expect(excl.body.line.verifiedBy).toBe('admin@x.com');
  });

  it('flags bundles instead of excluding them', async () => {
    const r = await request(app()).patch('/api/admin/pizza-index/lines/line1').set('x-test-email', 'admin@x.com').send({ isBundle: true });
    expect(r.status).toBe(200);
    expect(r.body.line.isBundle).toBe(true);
    expect(r.body.line.excluded).toBe(false);
  });
});

describe('presets auth', () => {
  it('underboss may create merchant presets but not global/country/chain', async () => {
    const ok = await request(app()).post('/api/admin/pizza-index/presets').set('x-test-email', 'ub@x.com')
      .send({ scope: 'merchant', merchantName: "Joe's Pizza", sizeLabel: 'large', shape: 'round', diameterCm: 35 });
    expect(ok.status).toBe(201);
    expect(ok.body.preset.merchantKey).toBe('joe s pizza');
    for (const scope of ['global', 'country', 'chain']) {
      const r = await request(app()).post('/api/admin/pizza-index/presets').set('x-test-email', 'ub@x.com')
        .send({ scope, country: 'Peru', merchantKey: 'x', sizeLabel: 'large', shape: 'round', diameterCm: 35 });
      expect(r.status, scope).toBe(403);
    }
  });
});

describe('underboss merchant scoping', () => {
  const body = { scope: 'merchant', merchantName: 'Joe', sizeLabel: 'large', shape: 'round', diameterCm: 35 };
  it('403 OUT_OF_SCOPE when the merchant has receipts outside scope', async () => {
    h.outOfScopeCount = 2;
    const r = await request(app()).post('/api/admin/pizza-index/presets').set('x-test-email', 'ub@x.com').send(body);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('OUT_OF_SCOPE');
    const a = await request(app()).post('/api/admin/pizza-index/lines/line1/apply-to-merchant').set('x-test-email', 'ub@x.com').send({});
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe('OUT_OF_SCOPE');
    // admins are unaffected
    const ok = await request(app()).post('/api/admin/pizza-index/presets').set('x-test-email', 'admin@x.com').send(body);
    expect(ok.status).toBe(201);
  });
  it('hides createdBy from underbosses', async () => {
    const r = await request(app()).post('/api/admin/pizza-index/presets').set('x-test-email', 'ub@x.com').send(body);
    expect(r.status).toBe(201);
    expect(r.body.preset.createdBy).toBeNull();
  });
  it('underboss with no scope gets a clean 403', async () => {
    h.underbosses.set('empty@x.com', { isAdmin: false, regions: [], cities: [] });
    const r = await request(app()).get('/api/admin/pizza-index/queue').set('x-test-email', 'empty@x.com');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NO_SCOPE');
  });
});

describe('public endpoint', () => {
  it('needs no auth and returns aggregates only', async () => {
    const r = await request(app()).get('/api/pizza-index');
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2026);
    expect(Array.isArray(r.body.countries)).toBe(true);
    expect(r.headers['cache-control']).toContain('max-age=3600');
  });
});

describe('archive (history) lines', () => {
  it('admin can PATCH a history line; an underboss gets 403', async () => {
    const ok = await request(app()).patch('/api/admin/pizza-index/lines/hist1').set('x-test-email', 'admin@x.com').send({ diameterCm: 30, shape: 'round' });
    expect(ok.status).toBe(200);
    expect(ok.body.line.documentId).toBeNull();
    expect(ok.body.line.historyReceiptId).toBe('hr1');
    expect(ok.body.line.verifiedBy).toBe('admin@x.com');
    const ub = await request(app()).patch('/api/admin/pizza-index/lines/hist1').set('x-test-email', 'ub@x.com').send({ diameterCm: 30, shape: 'round' });
    expect(ub.status).toBe(403);
  });

  const sqlOf = () => (prisma.$queryRaw as any).mock.calls.map((c: any[]) => String(c[0]?.strings?.join('?') ?? '')).join('\n');

  it('index + index/lines: underbosses are restricted to event rows; admins are not', async () => {
    (prisma.$queryRaw as any).mockClear();
    for (const path of ['index', 'index/lines']) {
      expect((await request(app()).get(`/api/admin/pizza-index/${path}?year=2022`).set('x-test-email', 'ub@x.com')).status).toBe(200);
    }
    expect(sqlOf()).toContain("v.origin = 'event'");
    (prisma.$queryRaw as any).mockClear();
    await request(app()).get('/api/admin/pizza-index/index/lines?year=2022').set('x-test-email', 'admin@x.com');
    expect(sqlOf()).not.toContain("v.origin = 'event'");
  });

  it('queue defaults to event receipts', async () => {
    (prisma.$queryRaw as any).mockClear();
    await request(app()).get('/api/admin/pizza-index/queue').set('x-test-email', 'admin@x.com');
    expect(sqlOf()).toContain('li.history_receipt_id IS NULL');
  });

  it('queue: underbosses never see archive receipts (no scope mapping); admins can filter them', async () => {
    (prisma.$queryRaw as any).mockClear();
    const ub = await request(app()).get('/api/admin/pizza-index/queue?origin=history&year=2022').set('x-test-email', 'ub@x.com');
    expect(ub.status).toBe(200);
    expect(ub.body.receipts).toEqual([]);
    expect(sqlOf()).toContain('li.history_receipt_id IS NULL');
    (prisma.$queryRaw as any).mockClear();
    const ad = await request(app()).get('/api/admin/pizza-index/queue?origin=history&year=2022').set('x-test-email', 'admin@x.com');
    expect(ad.status).toBe(200);
    expect(sqlOf()).toContain('li.history_receipt_id IS NOT NULL');
    const bad = await request(app()).get('/api/admin/pizza-index/queue?origin=nope').set('x-test-email', 'admin@x.com');
    expect(bad.status).toBe(400);
  });
});

describe('public endpoint: years + trends', () => {
  const vrow = (year: number, key: string, usd = 0.01) => ({
    line_id: `${year}${key}`, document_id: null, party_id: null, party_name: `${year} X`, country: 'India', city: 'Delhi', region: 'india',
    event_year: year, event_series_slug: null, document_url: null, document_mime_type: null, source_receipt_index: null, source_receipt_count: null,
    merchant: 'M', merchant_key: 'm', raw_name: 'Pizza', qty: 1, currency: 'INR', fx_rate: 0.012, unit_price_list: 100, unit_price_net: null,
    unit_price_usd: usd * 706.9, unit_price_net_usd: null, size_label: 'large', shape: 'round', diameter_cm: 30, area_cm2: 706.9, style: null,
    size_source: 'parsed', size_confidence: 0.9, verified_at: null, verified_by: null, is_verified: false, outlier_flag: false, is_bundle: false,
    usd_per_cm2: usd, local_per_cm2: usd / 0.012, net_usd_per_cm2: null,
    event_key: `hist:${year}:${key}|India`, origin: 'history', fx_source: 'frankfurter:x', is_lump_sum: false,
  });
  beforeEach(() => {
    h.viewRows = [vrow(2022, 'delhi', 0.005), vrow(2023, 'delhi', 0.007), vrow(2026, 'delhi', 0.012)];
  });

  it('defaults to the latest year and exposes years + trends', async () => {
    const r = await request(app()).get('/api/pizza-index');
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2026);
    expect(r.body.years).toEqual([2022, 2023, 2026]);
    expect(r.body.trends.India.map((t: any) => t.year)).toEqual([2022, 2023, 2026]);
  });
  it('?year= selects a published year', async () => {
    const r = await request(app()).get('/api/pizza-index?year=2023');
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2023);
    expect(r.body.countries[0].ladderUsd['30']).toBeCloseTo(0.007 * 706.9, 1);
  });
  it('rejects unknown or malformed years with 400', async () => {
    for (const y of ['1999', 'abc', '2024', '20231']) {
      const r = await request(app()).get(`/api/pizza-index?year=${y}`);
      expect(r.status, y).toBe(400);
      expect(r.body.error.code).toBe('BAD_YEAR');
    }
  });
  it('photos: archive years return an empty list for a published country', async () => {
    const r = await request(app()).get('/api/pizza-index/photos?country=India&year=2022');
    expect(r.status).toBe(200);
    expect(r.body.photos).toEqual([]);
    expect((await request(app()).get('/api/pizza-index/photos?country=India&year=2024')).status).toBe(404);
    expect((await request(app()).get('/api/pizza-index/photos?country=India&year=abc')).status).toBe(400);
  });
});
