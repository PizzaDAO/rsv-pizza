import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ sqls: [] as string[], params: [] as unknown[][] }));
vi.mock('../config/database.js', () => ({
  prisma: {
    $queryRaw: vi.fn(async (q: any) => {
      h.sqls.push(q.strings.join('?'));
      h.params.push(q.values);
      return String(q.strings.join('?')).includes('count(*)') ? [{ n: 0 }] : [];
    }),
    $executeRaw: vi.fn(async () => 0),
  },
}));

import { syncPizzaLineItems } from './pizzaLineSync.service.js';

beforeEach(() => { h.sqls = []; h.params = []; });

describe('syncPizzaLineItems force mode advances', () => {
  it('force filters on synced_at < forceBefore and echoes it back', async () => {
    const fb = new Date('2026-10-27T12:00:00Z');
    const r = await syncPizzaLineItems({ force: true, forceBefore: fb });
    expect(r.forceBefore).toBe(fb.toISOString());
    const sql = h.sqls[0];
    expect(sql).toContain('s.synced_at IS NULL OR s.synced_at <');
    expect(h.params[0]).toContainEqual(fb);
  });
  it('defaults forceBefore to now when omitted', async () => {
    const before = Date.now();
    const r = await syncPizzaLineItems({ force: true });
    expect(new Date(r.forceBefore!).getTime()).toBeGreaterThanOrEqual(before);
  });
  it('non-force mode is unchanged (hash filter, no forceBefore)', async () => {
    const r = await syncPizzaLineItems({});
    expect(r.forceBefore).toBeNull();
    expect(h.sqls[0]).toContain('s.items_hash <>');
    expect(h.sqls[0]).not.toContain('synced_at <');
  });
});
