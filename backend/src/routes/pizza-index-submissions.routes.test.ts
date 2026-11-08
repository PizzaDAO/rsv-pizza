/**
 * sfincione-40417 (submissions): public submission routes. Prisma, Supabase storage and the
 * auth helpers are mocked; no DB, no storage, no OpenAI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  flag: 'true' as string | null,
  countHour: 0,
  countDay: 0,
  pending: 0,
  existingSha: null as string | null,
  created: [] as any[],
  files: new Map<string, Buffer>(),
  removed: [] as string[],
}));

vi.mock('../middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => {
    if (req.headers['x-test-user']) {
      req.userId = String(req.headers['x-test-user']);
      req.userEmail = 'member@x.com';
    }
    next();
  },
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    appConfig: {
      findUnique: vi.fn(async () => (h.flag === null ? null : { key: 'k', value: h.flag })),
    },
    pizzaSubmission: {
      // finalize: hour count first, then day count; the pending cap is the only { status: 'pending' } query
      count: vi.fn(async ({ where }: any) => {
        if (where?.status === 'pending') return h.pending;
        const since = where?.createdAt?.gte as Date | undefined;
        const ageMs = since ? Date.now() - since.getTime() : 0;
        return ageMs < 4_000_000 ? h.countHour : h.countDay;
      }),
      findUnique: vi.fn(async () => (h.existingSha ? { id: 'old' } : null)),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        h.created.push(data);
        return { id: 'sub-1' };
      }),
    },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({ data: { token: 'tok', path, signedUrl: 'https://x/up' }, error: null }),
        download: async (path: string) => {
          const b = h.files.get(path);
          return b ? { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null } : { data: null, error: { message: 'nope' } };
        },
        remove: async (paths: string[]) => { h.removed.push(...paths); return { data: [], error: null }; },
      }),
    },
  }),
}));

// heavy deps the service imports but these tests never reach
vi.mock('../services/ocr.service.js', () => ({ analyzeReceiptMulti: vi.fn() }));
vi.mock('../services/pdfRasterize.js', () => ({ rasterizePdfFirstPage: vi.fn() }));
vi.mock('../services/fx.service.js', () => ({ convertToUSD: vi.fn() }));
vi.mock('../services/pizzaLineSync.service.js', () => ({ loadPresets: vi.fn(async () => []), lineFingerprint: () => 'fp' }));
vi.mock('../services/pizzaIndex.service.js', () => ({ invalidatePizzaIndexCache: vi.fn(), refreshOutliers: vi.fn() }));

import router from './pizza-index-submissions.routes.js';

process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 2)]);
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const ANON_PATH = `anon/${UUID}.jpg`;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/pizza-index/submissions', router);
  a.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message, code: err.code } });
  });
  return a;
}

const body = (over: Record<string, unknown> = {}) => ({
  path: ANON_PATH,
  receiptDate: '2026-10-10',
  merchant: 'Pizzeria Da Michele',
  city: 'Naples',
  country: 'Italy',
  ...over,
});
const post = (b: Record<string, unknown>, user?: string) => {
  const r = request(app()).post('/api/pizza-index/submissions');
  return (user ? r.set('x-test-user', user) : r).send(b);
};

beforeEach(() => {
  h.flag = 'true';
  h.countHour = 0;
  h.countDay = 0;
  h.pending = 0;
  h.existingSha = null;
  h.created = [];
  h.removed = [];
  h.files = new Map([[ANON_PATH, JPEG]]);
});

describe('kill switch', () => {
  it('is closed until app_config pizza_index.submissions_enabled is true', async () => {
    h.flag = null;
    expect((await post(body())).status).toBe(503);
    h.flag = 'false';
    const r = await request(app()).post('/api/pizza-index/submissions/upload-url').send({ mimeType: 'image/jpeg', fileSize: 1000 });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('SUBMISSIONS_CLOSED');
  });
});

describe('POST /upload-url', () => {
  it('returns an anonymous path + token', async () => {
    const r = await request(app()).post('/api/pizza-index/submissions/upload-url').send({ mimeType: 'image/jpeg', fileSize: 1000 });
    expect(r.status).toBe(200);
    expect(r.body.path).toMatch(/^anon\/[0-9a-f-]{36}\.jpg$/);
    expect(r.body.token).toBe('tok');
  });
  it('uses the user folder when logged in', async () => {
    const r = await request(app()).post('/api/pizza-index/submissions/upload-url').set('x-test-user', 'u123').send({ mimeType: 'application/pdf', fileSize: 1000 });
    expect(r.body.path).toMatch(/^u123\/.+\.pdf$/);
  });
  it('rejects bad types, missing sizes and files over 10 MB', async () => {
    const send = (b: any) => request(app()).post('/api/pizza-index/submissions/upload-url').send(b);
    expect((await send({ mimeType: 'text/html', fileSize: 10 })).body.error.code).toBe('BAD_FILE_TYPE');
    expect((await send({ mimeType: 'image/png' })).body.error.code).toBe('BAD_FILE_SIZE');
    const big = await send({ mimeType: 'image/png', fileSize: 10 * 1024 * 1024 + 1 });
    expect(big.status).toBe(413);
  });
  it('503 when the pending queue is full', async () => {
    h.pending = 300;
    const r = await request(app()).post('/api/pizza-index/submissions/upload-url').send({ mimeType: 'image/png', fileSize: 10 });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('QUEUE_FULL');
  });
});

describe('POST / (finalize)', () => {
  it('accepts an anonymous submission and returns only id + status (no path, url or email)', async () => {
    const r = await post(body({ email: 'Fan@Example.com' }));
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: 'sub-1', status: 'pending' });
    const text = JSON.stringify(r.body);
    for (const bad of ['anon/', 'supabase', '@', 'storage', 'http']) expect(text).not.toContain(bad);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({
      status: 'pending', submitterUserId: null, submitterEmail: 'fan@example.com', notify: true,
      storagePath: ANON_PATH, mimeType: 'image/jpeg', country: 'Italy', year: 2026, merchant: 'Pizzeria Da Michele',
    });
    expect(h.created[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.created[0].fileSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records the submitter when logged in, and needs their own folder', async () => {
    h.files.set(`u1/${UUID}.jpg`, JPEG);
    const ok = await post(body({ path: `u1/${UUID}.jpg` }), 'u1');
    expect(ok.status).toBe(201);
    expect(h.created[0]).toMatchObject({ submitterUserId: 'u1', submitterEmail: 'member@x.com', notify: false });
    // someone else's folder, or an anon path while logged in, is refused
    expect((await post(body({ path: `u2/${UUID}.jpg` }), 'u1')).body.error.code).toBe('BAD_PATH');
    expect((await post(body({ path: ANON_PATH }), 'u1')).body.error.code).toBe('BAD_PATH');
  });

  it('honeypot: a filled website field looks like success but stores nothing', async () => {
    const r = await post(body({ website: 'http://spam.example' }));
    expect(r.status).toBe(201);
    expect(h.created).toHaveLength(0);
  });

  it('validates the fields', async () => {
    const code = async (over: Record<string, unknown>) => (await post(body(over))).body.error?.code;
    expect(await code({ path: '../../etc/passwd' })).toBe('BAD_PATH');
    expect(await code({ path: 'anon/not-a-uuid.jpg' })).toBe('BAD_PATH');
    expect(await code({ merchant: '   ' })).toBe('MERCHANT_REQUIRED');
    expect(await code({ merchant: undefined })).toBe('MERCHANT_REQUIRED');
    expect(await code({ country: 'Atlantis' })).toBe('BAD_COUNTRY');
    expect(await code({ country: '' })).toBe('BAD_COUNTRY');
    expect(await code({ email: 'not-an-email' })).toBe('BAD_EMAIL');
    expect(await code({ sizeNote: 'x'.repeat(201) })).toBe('SIZE_NOTE_TOO_LONG');
    expect(h.created).toHaveLength(0);
  });

  it('enforces the receipt date range: 2021-01-01 up to today', async () => {
    const code = async (receiptDate: unknown) => (await post(body({ receiptDate }))).body.error?.code;
    expect(await code('2020-12-31')).toBe('DATE_TOO_OLD');
    expect(await code('2021-02-30')).toBe('BAD_DATE');
    expect(await code('yesterday')).toBe('BAD_DATE');
    expect(await code(undefined)).toBe('BAD_DATE');
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect(await code(future)).toBe('DATE_IN_FUTURE');
    // boundaries are accepted
    expect((await post(body({ receiptDate: '2021-01-01' }))).status).toBe(201);
    h.files.set(ANON_PATH, JPEG);
    expect((await post(body({ receiptDate: new Date().toISOString().slice(0, 10) }))).status).toBe(201);
  });

  it('429 after 3 per hour or 10 per day from one IP', async () => {
    h.countHour = 3;
    const hour = await post(body());
    expect(hour.status).toBe(429);
    expect(hour.body.error.code).toBe('RATE_LIMITED');
    h.countHour = 0;
    h.countDay = 10;
    expect((await post(body())).status).toBe(429);
    h.countDay = 9;
    h.countHour = 2;
    expect((await post(body())).status).toBe(201);
  });

  it('503 when 300 submissions are already pending', async () => {
    h.pending = 300;
    const r = await post(body());
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('QUEUE_FULL');
    h.pending = 299;
    expect((await post(body())).status).toBe(201);
  });

  it('rejects an uploaded file whose bytes do not match, and deletes it', async () => {
    h.files.set(ANON_PATH, Buffer.from('<html>' + 'x'.repeat(100)));
    const r = await post(body());
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('BAD_FILE_TYPE');
    expect(h.removed).toContain(ANON_PATH);
    // a PDF uploaded under a .jpg path is a mismatch too
    h.files.set(ANON_PATH, PDF);
    expect((await post(body())).body.error.code).toBe('BAD_FILE_TYPE');
  });

  it('400 when the object was never uploaded', async () => {
    h.files.clear();
    expect((await post(body())).body.error.code).toBe('FILE_MISSING');
  });

  it('409 for an exact re-upload (same sha256) and removes the new copy', async () => {
    h.existingSha = 'x';
    const r = await post(body());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALREADY_SUBMITTED');
    expect(h.removed).toContain(ANON_PATH);
    expect(h.created).toHaveLength(0);
  });
});
