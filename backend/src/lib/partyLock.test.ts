import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import { withPartyLock } from './partyLock.js';

beforeEach(() => vi.clearAllMocks());

describe('withPartyLock', () => {
  it('sets a local lock_timeout BEFORE taking the advisory lock, then runs fn', async () => {
    const stmts: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
        stmts.push(strings.join('?'));
        return 1;
      }),
    };
    mockPrisma.$transaction.mockImplementation(async (fn: any, opts: any) => {
      expect(opts.maxWait).toBeUndefined(); // client default (5s)
      return fn(tx);
    });
    const out = await withPartyLock('p1', async () => 'done');
    expect(out).toBe('done');
    expect(stmts[0]).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(stmts[1]).toMatch(/pg_advisory_xact_lock\(hashtext\(\?\)\)/);
  });

  it.each([
    ['lock timeout', Object.assign(new Error('canceling statement due to lock timeout'), { code: 'P2010', meta: { code: '55P03' } })],
    ['transaction wait timeout', Object.assign(new Error('Unable to start a transaction in the given time'), { code: 'P2028' })],
  ])('maps %s to a 503', async (_l, err) => {
    mockPrisma.$transaction.mockRejectedValue(err);
    await expect(withPartyLock('p1', async () => 1)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('passes other errors through', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('boom'));
    await expect(withPartyLock('p1', async () => 1)).rejects.toThrow('boom');
  });
});
