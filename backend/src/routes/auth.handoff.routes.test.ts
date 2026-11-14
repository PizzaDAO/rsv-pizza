import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

// In-memory MagicLink store so the real route logic (create -> redeem) runs end to end.
const db = vi.hoisted(() => ({ rows: [] as any[] }));

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  magicLink: {
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `ml_${db.rows.length + 1}`, used: false, ...data };
      db.rows.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const row = db.rows.find((r: any) => (where.token ? r.token === where.token : r.code === where.code));
      if (!row) return null;
      return { ...row, user: { id: row.userId, email: row.email, name: 'Sam' } };
    }),
    // Mirrors Prisma updateMany semantics: the where clause is evaluated atomically.
    updateMany: vi.fn(async ({ where, data }: any) => {
      const row = db.rows.find((r: any) => r.id === where.id);
      if (!row) return { count: 0 };
      if (where.used !== undefined && row.used !== where.used) return { count: 0 };
      if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    update: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../config/secrets.js', () => ({ getJwtSecret: () => JWT_SECRET }));
vi.mock('../lib/siteBrand.js', () => ({
  siteForOrigin: async (_o: string | undefined, fallback: string) => ({ url: fallback }),
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const h = req.headers.authorization;
    try {
      if (!h?.startsWith('Bearer ')) throw new Error('no');
      const d = jwt.verify(h.split(' ')[1], JWT_SECRET) as any;
      req.userId = d.userId;
      req.userEmail = d.email;
      next();
    } catch {
      res.status(401).json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
    }
  },
}));

import authRoutes from './auth.routes.js';
import { errorHandler } from '../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRoutes);
  a.use(errorHandler);
  return a;
}
const bearer = () => `Bearer ${jwt.sign({ userId: 'u1', email: 'sam@example.com' }, JWT_SECRET)}`;

describe('POST /api/auth/handoff + /verify-token', () => {
  beforeEach(() => {
    db.rows.length = 0;
    vi.clearAllMocks();
    process.env.FRONTEND_URL = 'https://rsv.pizza';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'sam@example.com', name: 'Sam' });
  });
  afterEach(() => vi.useRealTimers());

  it('requires auth', async () => {
    const res = await request(app()).post('/api/auth/handoff').send({});
    expect(res.status).toBe(401);
    expect(db.rows).toHaveLength(0);
  });

  it('mints a 2-minute token with a non-6-digit code and a next param', async () => {
    const res = await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({ next: '/e/party?x=1' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const url = new URL(res.body.url);
    expect(url.pathname).toBe('/auth/verify');
    expect(url.searchParams.get('token')).toBe(res.body.token);
    expect(url.searchParams.get('next')).toBe('/e/party?x=1');
    const row = db.rows[0];
    expect(row.userId).toBe('u1');
    expect(/^\d{6}$/.test(row.code)).toBe(false);
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(110_000);
    expect(ttl).toBeLessThanOrEqual(120_000);
  });

  it('drops non-local next values', async () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)']) {
      const res = await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({ next: bad });
      expect(new URL(res.body.url).searchParams.has('next')).toBe(false);
    }
  });

  it('redeems once; a second redemption is rejected', async () => {
    const { body } = await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({});
    const first = await request(app()).post('/api/auth/verify-token').send({ token: body.token });
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    const second = await request(app()).post('/api/auth/verify-token').send({ token: body.token });
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('TOKEN_USED');
  });

  it('is atomic: concurrent redemptions yield exactly one success', async () => {
    const { body } = await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({});
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app()).post('/api/auth/verify-token').send({ token: body.token })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(4);
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { body } = await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({});
    vi.setSystemTime(Date.now() + 121_000);
    const res = await request(app()).post('/api/auth/verify-token').send({ token: body.token });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect(db.rows[0].used).toBe(false);
  });

  it('rejects when the atomic spend loses the race (count 0)', async () => {
    const { body } = await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({});
    mockPrisma.magicLink.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await request(app()).post('/api/auth/verify-token').send({ token: body.token });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_USED');
  });

  it('cannot be redeemed through /verify-code', async () => {
    await request(app()).post('/api/auth/handoff').set('Authorization', bearer()).send({});
    const res = await request(app()).post('/api/auth/verify-code').send({ code: db.rows[0].code });
    expect(res.status).toBe(400);
  });
});
