/**
 * durable-rate-limits: the sign-in code budgets (lib/loginCode.ts) are counted in a shared
 * store (auth_rate_events), so they hold across serverless instances.
 *
 * "Instances" are simulated by importing lib/loginCode.ts twice (vi.resetModules), so each
 * copy has its own in-memory fast path, and pointing both at ONE shared store.
 *
 * The real-Postgres block runs only when AUTH_RATE_TEST_DATABASE_URL points at a throwaway
 * database (it creates auth_rate_events there from the migration file). Locally:
 *   initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o '-p 54329' start && createdb -p 54329 ratetest
 *   AUTH_RATE_TEST_DATABASE_URL=postgresql://localhost:54329/ratetest npx vitest run src/lib/authRateLimit.test.ts
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'test-secret-auth-rate-0123456789abcdef0123';

const mockPrisma = vi.hoisted(() => ({
  magicLink: { count: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import { hashRateKey, memoryRateStore, prismaRateStore, RATE_EVENT_RETENTION_MS, type RateStore } from './authRateLimit.js';

type LoginCode = typeof import('./loginCode.js');

/** A fresh copy of lib/loginCode.ts = one simulated serverless instance. */
async function instance(store: RateStore, random: () => number = () => 1): Promise<LoginCode> {
  vi.resetModules();
  const mod = (await import('./loginCode.js')) as LoginCode;
  mod.resetCodeLimits({ store, random });
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.magicLink.count.mockResolvedValue(0);
  mockPrisma.magicLink.updateMany.mockResolvedValue({ count: 1 });
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

describe('hashing: no plaintext IPs or emails are stored', () => {
  it('hashRateKey is a stable 32-hex HMAC, distinct per bucket and per secret', () => {
    const a = hashRateKey('send', 'ivy@example.com|1.2.3.4');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(hashRateKey('send', 'ivy@example.com|1.2.3.4')).toBe(a);
    expect(hashRateKey('verify_email_ip', 'ivy@example.com|1.2.3.4')).not.toBe(a);
    expect(hashRateKey('send', 'ivy@example.com|1.2.3.5')).not.toBe(a);
    const saved = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'another-secret-auth-rate-0123456789abcdef';
    try {
      expect(hashRateKey('send', 'ivy@example.com|1.2.3.4')).not.toBe(a);
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });

  it('the rows a send and a verify write hold only digests', async () => {
    const store = memoryRateStore();
    const lc = await instance(store);
    expect(await lc.takeCodeSend('ivy@example.com', '1.2.3.4')).toBe(true);
    const attempt = await lc.reserveVerifyAttempt('1.2.3.4', 'ivy@example.com');
    expect(attempt).not.toBeNull();
    expect(store.rows.map((r) => [r.bucket, r.key])).toEqual([
      ['send', hashRateKey('send', 'ivy@example.com|1.2.3.4')],
      ['verify_ip', hashRateKey('verify_ip', '1.2.3.4')],
      ['verify_email_ip', hashRateKey('verify_email_ip', 'ivy@example.com|1.2.3.4')],
    ]);
    for (const r of store.rows) {
      expect(r.key).not.toContain('ivy');
      expect(r.key).not.toContain('1.2.3.4');
    }
  });
});

describe('budgets are global across instances (shared store)', () => {
  it(`sends: 8 parallel on each of two instances, same (email, IP) → exactly 3 in total`, async () => {
    const store = memoryRateStore({ latencyMs: 2 });
    const a = await instance(store);
    const b = await instance(store);
    expect(a).not.toBe(b);
    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => a.takeCodeSend('race@example.com', '7.7.7.7')),
      ...Array.from({ length: 8 }, () => b.takeCodeSend('race@example.com', '7.7.7.7')),
    ]);
    expect(results.filter(Boolean)).toHaveLength(a.SEND_PER_EMAIL_IP);
  });

  it('code-only verify: 20 parallel on each instance from one IP → exactly 10 reserved', async () => {
    const store = memoryRateStore({ latencyMs: 1 });
    const a = await instance(store);
    const b = await instance(store);
    const res = await Promise.all([
      ...Array.from({ length: 20 }, () => a.reserveVerifyAttempt('2.2.2.2')),
      ...Array.from({ length: 20 }, () => b.reserveVerifyAttempt('2.2.2.2')),
    ]);
    expect(res.filter(Boolean)).toHaveLength(a.FAIL_PER_IP_CODE_ONLY);
  });

  it('email-bound verify: 12 parallel on each instance for one (email, IP) → exactly 5 reserved', async () => {
    const store = memoryRateStore({ latencyMs: 1 });
    const a = await instance(store);
    const b = await instance(store);
    const res = await Promise.all([
      ...Array.from({ length: 12 }, () => a.reserveVerifyAttempt('2.2.2.3', 'ivy@example.com')),
      ...Array.from({ length: 12 }, () => b.reserveVerifyAttempt('2.2.2.3', 'ivy@example.com')),
    ]);
    expect(res.filter(Boolean)).toHaveLength(a.FAIL_PER_EMAIL_IP);
  });

  it('email-bound per-IP budget (40) is global too: spread over emails and instances', async () => {
    const store = memoryRateStore();
    const a = await instance(store);
    const b = await instance(store);
    let granted = 0;
    for (let i = 0; i < 60; i++) {
      const lc = i % 2 ? a : b;
      if (await lc.reserveVerifyAttempt('3.3.3.3', `v${i}@example.com`)) granted++;
    }
    expect(granted).toBe(a.FAIL_PER_IP);
  });

  it('a right code on one instance gives the slot back for every instance', async () => {
    const store = memoryRateStore();
    const a = await instance(store);
    const b = await instance(store);
    const held = [];
    for (let i = 0; i < 5; i++) held.push(await a.reserveVerifyAttempt('2.2.2.4', 'ivy@example.com'));
    expect(await b.reserveVerifyAttempt('2.2.2.4', 'ivy@example.com')).toBeNull();
    await held[0]!.release();
    expect(await b.reserveVerifyAttempt('2.2.2.4', 'ivy@example.com')).not.toBeNull();
    expect(await b.reserveVerifyAttempt('2.2.2.4', 'ivy@example.com')).toBeNull();
  });

  it('the under-attack squeeze uses the GLOBAL (email, IP) count: one wrong try per (email, IP) across instances', async () => {
    const store = memoryRateStore();
    const a = await instance(store);
    const b = await instance(store);
    mockPrisma.magicLink.count.mockResolvedValue(1); // the email is under attack
    expect(await a.reserveVerifyAttempt('5.5.5.5', 'ivy@example.com')).not.toBeNull();
    expect(await b.reserveVerifyAttempt('5.5.5.5', 'ivy@example.com')).toBeNull();
    // ...and the refused check was given back (only the first row remains for that key).
    expect(store.rows.filter((r) => r.bucket === 'verify_email_ip')).toHaveLength(1);
  });

  it('a send the magic_links check refuses is released from the shared store', async () => {
    const store = memoryRateStore();
    const a = await instance(store);
    const b = await instance(store);
    expect(await a.takeCodeSend('rb@example.com', '8.8.8.8')).toBe(true);
    mockPrisma.magicLink.count.mockResolvedValue(a.SEND_PER_EMAIL_HOUR);
    expect(await b.takeCodeSend('rb@example.com', '8.8.8.8')).toBe(false); // had a send (on A)
    expect(store.rows.filter((r) => r.bucket === 'send')).toHaveLength(1);
  });
});

describe('cleanup', () => {
  it('~1% of reservations delete rows older than an hour; the rest do not', async () => {
    const store = memoryRateStore();
    const cleanup = vi.spyOn(store, 'cleanup');
    const lc = await instance(store, () => 0.5);
    store.rows.push({ id: 'old', bucket: 'send', key: 'x', createdAt: Date.now() - RATE_EVENT_RETENTION_MS - 1 });
    await lc.takeCodeSend('a@example.com', '1.1.1.1');
    expect(cleanup).not.toHaveBeenCalled();
    lc.resetCodeLimits({ store, random: () => 0.001 });
    await lc.takeCodeSend('a@example.com', '1.1.1.1');
    expect(cleanup).toHaveBeenCalledWith(RATE_EVENT_RETENTION_MS);
    expect(store.rows.find((r) => r.id === 'old')).toBeUndefined();
    expect(store.rows.filter((r) => r.bucket === 'send')).toHaveLength(2);
  });

  it('a failing cleanup does not fail the request', async () => {
    const store = memoryRateStore();
    vi.spyOn(store, 'cleanup').mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lc = await instance(store, () => 0);
    expect(await lc.takeCodeSend('a@example.com', '1.1.1.1')).toBe(true);
    expect(await lc.reserveVerifyAttempt('1.1.1.1', 'a@example.com')).not.toBeNull();
    err.mockRestore();
  });
});

describe('when the rate-limit store is down', () => {
  const broken = (): RateStore => ({
    reserve: vi.fn().mockRejectedValue(new Error('relation "auth_rate_events" does not exist')),
    release: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  });

  it('sends fail OPEN to the per-instance in-memory budget (still 3 per (email, IP))', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lc = await instance(broken());
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await lc.takeCodeSend('a@example.com', '1.1.1.1'));
    expect(results).toEqual([true, true, true, false, false]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('sends that fail open still apply the hourly squeeze from the local count', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lc = await instance(broken());
    mockPrisma.magicLink.count.mockResolvedValue(lc.SEND_PER_EMAIL_HOUR);
    expect(await lc.takeCodeSend('a@example.com', '1.1.1.1')).toBe(true);
    expect(await lc.takeCodeSend('a@example.com', '1.1.1.1')).toBe(false);
    err.mockRestore();
  });

  it('verify fails CLOSED: 503 RATE_LIMIT_UNAVAILABLE, and the local slot is given back', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = broken();
    const lc = await instance(store);
    await expect(lc.reserveVerifyAttempt('1.1.1.1', 'a@example.com')).rejects.toMatchObject({
      statusCode: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
    // Once the store is back, the failed attempts did not use up this instance's budget.
    lc.resetCodeLimits({ store: memoryRateStore() });
    for (let i = 0; i < lc.FAIL_PER_EMAIL_IP; i++) expect(await lc.reserveVerifyAttempt('1.1.1.1', 'a@example.com')).not.toBeNull();
    err.mockRestore();
  });
});

// ---- Real Postgres ------------------------------------------------------------------------

const PG_URL = process.env.AUTH_RATE_TEST_DATABASE_URL;

describe.skipIf(!PG_URL)('real Postgres: prismaRateStore is atomic across connections', () => {
  // Two clients = two serverless instances, each with its own connection pool.
  let c1: any;
  let c2: any;

  beforeAll(async () => {
    const { PrismaClient } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    c1 = new PrismaClient({ datasourceUrl: PG_URL });
    c2 = new PrismaClient({ datasourceUrl: PG_URL });
    for (const role of ['anon', 'authenticated']) {
      await c1.$executeRawUnsafe(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    }
    await c1.$executeRawUnsafe('DROP TABLE IF EXISTS auth_rate_events');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(path.join(here, '../../prisma/migrations/20261114_auth_rate_events/migration.sql'), 'utf8');
    const stmts = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
    for (const s of stmts) await c1.$executeRawUnsafe(s);
  });

  beforeEach(async () => {
    await c1.$executeRawUnsafe('TRUNCATE auth_rate_events');
  });

  afterAll(async () => {
    await c1?.$disconnect();
    await c2?.$disconnect();
  });

  it('40 parallel reservations split over two clients → exactly the limit is inserted', async () => {
    const s1 = prismaRateStore(c1);
    const s2 = prismaRateStore(c2);
    const b = [{ bucket: 'verify_ip_code_only', key: 'k1', limit: 10 }];
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? s1 : s2).reserve(b, 15 * 60 * 1000)));
    expect(res.filter((r) => r.ids)).toHaveLength(10);
    const [{ n }] = await c1.$queryRawUnsafe('SELECT count(*)::int AS n FROM auth_rate_events');
    expect(n).toBe(10);
    // The granted ones saw 0..9 rows before them, once each.
    expect(res.filter((r) => r.ids).map((r) => r.counts[0]).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('multi-bucket: all-or-nothing (a full email+IP bucket inserts nothing in the IP bucket)', async () => {
    const s = prismaRateStore(c1);
    const ip = { bucket: 'verify_ip', key: 'ip', limit: 40 };
    const em = { bucket: 'verify_email_ip', key: 'em', limit: 2 };
    expect((await s.reserve([ip, em], 900_000)).ids).toHaveLength(2);
    expect((await s.reserve([ip, em], 900_000)).ids).toHaveLength(2);
    const refused = await s.reserve([ip, em], 900_000);
    expect(refused.ids).toBeNull();
    expect(refused.counts).toEqual([2, 2]);
    const rows = await c1.$queryRawUnsafe('SELECT bucket, count(*)::int AS n FROM auth_rate_events GROUP BY 1 ORDER BY 1');
    expect(rows).toEqual([{ bucket: 'verify_email_ip', n: 2 }, { bucket: 'verify_ip', n: 2 }]);
  });

  it('only the window counts; release deletes; cleanup drops rows past retention', async () => {
    const s = prismaRateStore(c2);
    const b = [{ bucket: 'send', key: 'k', limit: 1 }];
    await c1.$executeRawUnsafe(`INSERT INTO auth_rate_events (bucket, key, created_at) VALUES ('send', 'k', now() - interval '20 minutes'), ('send', 'k', now() - interval '2 hours')`);
    const r = await s.reserve(b, 15 * 60 * 1000);
    expect(r.counts).toEqual([0]);
    expect(r.ids).toHaveLength(1);
    expect((await s.reserve(b, 15 * 60 * 1000)).ids).toBeNull();
    await s.release(r.ids!);
    expect((await s.reserve(b, 15 * 60 * 1000)).ids).toHaveLength(1);
    await s.cleanup(RATE_EVENT_RETENTION_MS);
    const [{ n }] = await c1.$queryRawUnsafe('SELECT count(*)::int AS n FROM auth_rate_events');
    expect(n).toBe(2); // the 20-minute-old row and the new one; the 2-hour one is gone
  });

  it('end to end: two loginCode instances on two clients share one budget', async () => {
    const a = await instance(prismaRateStore(c1));
    const b = await instance(prismaRateStore(c2));
    const sends = await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? a : b).takeCodeSend('ivy@example.com', '9.9.9.9')));
    expect(sends.filter(Boolean)).toHaveLength(a.SEND_PER_EMAIL_IP);
    const checks = await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).reserveVerifyAttempt('9.9.9.9', 'ivy@example.com')));
    expect(checks.filter(Boolean)).toHaveLength(a.FAIL_PER_EMAIL_IP);
    const keys: Array<{ key: string }> = await c1.$queryRawUnsafe('SELECT key FROM auth_rate_events');
    for (const { key } of keys) {
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
