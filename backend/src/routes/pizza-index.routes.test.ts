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
    $queryRaw: vi.fn(async (q: any) => (String(q?.strings?.join('?') ?? '').includes('count(') ? [{
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
  h.paymentAdmins.add('admin@x.com');
  h.underbosses.set('ub@x.com', { isAdmin: false, regions: ['west-africa'], cities: [] });
  h.lines.set('line1', dbLine('west-africa'));
  h.lines.set('line2', { ...dbLine('usa'), id: 'line2' });
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
