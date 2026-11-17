import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const IA = 'c0000000-0000-4000-8000-0000000000a1'; // item of A
const IB = 'c0000000-0000-4000-8000-0000000000b1'; // item of B
const IG = 'c0000000-0000-4000-8000-0000000000e1'; // global default

const m = vi.hoisted(() => {
  const rows: any[] = [];
  const audit: any[] = [];
  const writes = vi.fn();
  const match = (r: any, w: any) => Object.entries(w).every(([k, v]) => r[k] === v);
  const prisma: any = {
    eventSeries: { findUnique: async ({ where }: any) => ({ id: where.id }) },
    checklistDefault: {
      findFirst: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
      aggregate: async () => ({ _max: { sortOrder: 0 } }),
      create: async ({ data }: any) => { writes('create', data); const row = { id: 'c0000000-0000-4000-8000-0000000000c1', ...data }; rows.push(row); return row; },
      updateMany: async ({ where, data }: any) => {
        writes('updateMany', where, data);
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: any) => {
        writes('deleteMany', where);
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
        return { count: hit.length };
      },
    },
    checklistItem: { updateMany: async (a: any) => { writes('itemUpdateMany', a); return { count: 0 }; } },
    seriesAudit: { create: async ({ data }: any) => { audit.push(data); } },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { rows, audit, writes, prisma };
});

vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = 'u1'; req.userEmail = 'boss@example.com'; next(); },
  isSuperAdmin: async () => true,
  AuthRequest: {},
}));
vi.mock('../services/partyStatusEmailNotify.js', () => ({ emailHostOfStatusChange: vi.fn() }));
vi.mock('../helpers/statusAudit.js', () => ({ writeStatusAudit: vi.fn() }));

import router from './admin-series.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/admin/series', router);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  m.rows.length = 0;
  m.audit.length = 0;
  m.rows.push(
    { id: IA, seriesId: A, name: 'A item' },
    { id: IB, seriesId: B, name: 'B item' },
    { id: IG, seriesId: null, name: 'Global item' },
  );
});

describe('super-admin series checklist routes are series-scoped', () => {
  it('PATCH only edits an item of the path series; another series item and the global default are 404', async () => {
    expect((await request(app).patch(`/api/admin/series/${A}/checklist/${IA}`).send({ name: 'Renamed' })).status).toBe(200);
    expect(m.rows.find((r) => r.id === IA).name).toBe('Renamed');
    m.writes.mockClear();
    for (const id of [IB, IG]) {
      expect((await request(app).patch(`/api/admin/series/${A}/checklist/${id}`).send({ name: 'hacked' })).status).toBe(404);
    }
    expect(m.rows.find((r) => r.id === IB).name).toBe('B item');
    expect(m.rows.find((r) => r.id === IG).name).toBe('Global item');
    expect(m.writes).not.toHaveBeenCalled();
  });

  it('DELETE is scoped the same way and audited', async () => {
    for (const id of [IB, IG]) expect((await request(app).delete(`/api/admin/series/${A}/checklist/${id}`)).status).toBe(404);
    expect(m.rows).toHaveLength(3);
    expect((await request(app).delete(`/api/admin/series/${A}/checklist/${IA}`)).status).toBe(200);
    expect(m.rows.map((r) => r.id)).not.toContain(IA);
    expect(m.audit.at(-1)).toMatchObject({ seriesId: A, action: 'checklist.delete', actorKind: 'super_admin' });
  });

  it('writes are audited and use { id, seriesId } in the where clause', async () => {
    await request(app).patch(`/api/admin/series/${A}/checklist/${IA}`).send({ sortOrder: 4 });
    expect(m.audit.at(-1)).toMatchObject({ seriesId: A, action: 'checklist.update' });
    const call = m.writes.mock.calls.find((c: any[]) => c[0] === 'updateMany')!;
    expect(call[1]).toEqual({ id: IA, seriesId: A });
    const created = await request(app).post(`/api/admin/series/${A}/checklist`).send({ name: 'New', autoRule: 'hackathon_prizes_paid' });
    expect(created.status).toBe(201);
    expect(m.audit.at(-1)).toMatchObject({ action: 'checklist.create' });
  });

  it('validates autoRule and dueDate', async () => {
    expect((await request(app).post(`/api/admin/series/${A}/checklist`).send({ name: 'x', autoRule: 'DROP TABLE;' })).status).toBe(400);
    expect((await request(app).post(`/api/admin/series/${A}/checklist`).send({ name: 'x', dueDate: 'soon' })).status).toBe(400);
    expect((await request(app).patch(`/api/admin/series/${A}/checklist/${IA}`).send({ autoRule: '<b>' })).status).toBe(400);
  });

  it('non-uuid ids are 404, and the old unscoped paths are gone', async () => {
    expect((await request(app).patch(`/api/admin/series/${A}/checklist/nope`).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/admin/series/nope/checklist/${IA}`)).status).toBe(404);
    expect((await request(app).patch(`/api/admin/series/checklist/${IA}`).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/admin/series/checklist/${IA}`)).status).toBe(404);
  });
});
