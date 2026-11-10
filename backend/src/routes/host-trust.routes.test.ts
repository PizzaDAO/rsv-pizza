/**
 * Route-level tests for the host trust report and settings: authz, the report switch (404 when off),
 * stricter-only settings writes with an audit row, and that nothing writes outside app_config.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  isPaymentAdmin: vi.fn(),
  isSuperAdmin: vi.fn(),
  rows: [] as Array<{ key: string; value: string }>,
  audit: [] as unknown[],
  prisma: {
    appConfig: { findMany: vi.fn(), upsert: vi.fn() },
    appConfigAudit: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  listHostCandidates: vi.fn(),
  loadHostTrustRows: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-email']) return res.status(401).json({ error: 'unauth' });
    req.userId = req.headers['x-user-id'];
    req.userEmail = req.headers['x-user-email'];
    next();
  },
  isPaymentAdmin: m.isPaymentAdmin,
  isSuperAdmin: m.isSuperAdmin,
}));
vi.mock('../services/hostTrust.service.js', () => ({
  MAX_REPORT_PAGE: 100,
  listHostCandidates: m.listHostCandidates,
  loadHostTrustRows: m.loadHostTrustRows,
}));

import router from './host-trust.routes.js';
import { errorHandler } from '../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/host-trust', router);
  a.use(errorHandler);
  return a;
}
const as = (email: string) => ({ 'x-user-email': email, 'x-user-id': 'u1' });

function setStored(rows: Array<{ key: string; value: string }>) {
  m.rows = rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [];
  m.isPaymentAdmin.mockResolvedValue(true);
  m.isSuperAdmin.mockResolvedValue(true);
  m.prisma.appConfig.findMany.mockImplementation(async ({ where }: any) =>
    m.rows.filter((r) => where.key.in.includes(r.key)),
  );
  m.prisma.appConfig.upsert.mockImplementation(async (a: unknown) => a);
  m.prisma.appConfigAudit.create.mockImplementation(async (a: unknown) => a);
  m.prisma.appConfigAudit.findMany.mockResolvedValue([]);
  m.prisma.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  m.listHostCandidates.mockResolvedValue({ hosts: [{ userId: 'h1', name: 'Host', email: 'h@example.com' }], total: 1 });
  m.loadHostTrustRows.mockResolvedValue([]);
});

describe('report gating', () => {
  it('needs auth', async () => {
    expect((await request(app()).get('/api/admin/host-trust')).status).toBe(401);
  });

  it('403 for non payment admins', async () => {
    m.isPaymentAdmin.mockResolvedValue(false);
    expect((await request(app()).get('/api/admin/host-trust').set(as('x@example.com'))).status).toBe(403);
  });

  it('404 while the report switch is off (default), and never loads hosts', async () => {
    const res = await request(app()).get('/api/admin/host-trust').set(as('a@example.com'));
    expect(res.status).toBe(404);
    expect(m.loadHostTrustRows).not.toHaveBeenCalled();
    const one = await request(app()).get('/api/admin/host-trust/h1').set(as('a@example.com'));
    expect(one.status).toBe(404);
  });

  it('/enabled reports the switch without a 404', async () => {
    const off = await request(app()).get('/api/admin/host-trust/enabled').set(as('a@example.com'));
    expect(off.body).toEqual({ enabled: false });
    setStored([{ key: 'host_trust.report_enabled', value: '1' }]);
    const on = await request(app()).get('/api/admin/host-trust/enabled').set(as('a@example.com'));
    expect(on.body).toEqual({ enabled: true });
  });

  it('lists hosts when the switch is on', async () => {
    setStored([{ key: 'host_trust.report_enabled', value: '1' }]);
    const res = await request(app()).get('/api/admin/host-trust').set(as('a@example.com'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.hosts).toEqual([]);
  });
});

describe('settings', () => {
  it('403 for a payment admin who is not a super admin', async () => {
    m.isSuperAdmin.mockResolvedValue(false);
    expect((await request(app()).get('/api/admin/host-trust/settings').set(as('p@example.com'))).status).toBe(403);
    const put = await request(app()).put('/api/admin/host-trust/settings').set(as('p@example.com'))
      .send({ key: 'host_trust.min_verified_parties', value: 3 });
    expect(put.status).toBe(403);
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('GET returns the registry with defaults for unseeded rows', async () => {
    const res = await request(app()).get('/api/admin/host-trust/settings').set(as('s@example.com'));
    expect(res.status).toBe(200);
    const s = res.body.settings.find((x: any) => x.key === 'host_trust.min_verified_parties');
    expect(s).toMatchObject({ value: 2, source: 'default', default: 2, stricterOnly: true });
  });

  it('tightening writes the value and an audit row', async () => {
    const res = await request(app()).put('/api/admin/host-trust/settings').set(as('s@example.com'))
      .send({ key: 'host_trust.min_verified_parties', value: 4 });
    expect(res.status).toBe(200);
    expect(m.prisma.appConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { key: 'host_trust.min_verified_parties', value: '4' } }),
    );
    expect(m.prisma.appConfigAudit.create).toHaveBeenCalledWith({
      data: { key: 'host_trust.min_verified_parties', oldValue: 2, newValue: 4, actorEmail: 's@example.com', note: null },
    });
  });

  it('refuses a value looser than the shipped default', async () => {
    const res = await request(app()).put('/api/admin/host-trust/settings').set(as('s@example.com'))
      .send({ key: 'host_trust.min_verified_parties', value: 1, note: 'please' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('OUT_OF_RANGE');
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('loosening relative to the stored value needs a note', async () => {
    setStored([{ key: 'host_trust.min_verified_parties', value: '5' }]);
    const without = await request(app()).put('/api/admin/host-trust/settings').set(as('s@example.com'))
      .send({ key: 'host_trust.min_verified_parties', value: 3 });
    expect(without.status).toBe(400);
    const withNote = await request(app()).put('/api/admin/host-trust/settings').set(as('s@example.com'))
      .send({ key: 'host_trust.min_verified_parties', value: 3, note: 'reviewed with ops' });
    expect(withNote.status).toBe(200);
    expect(m.prisma.appConfigAudit.create).toHaveBeenCalledWith({
      data: { key: 'host_trust.min_verified_parties', oldValue: 5, newValue: 3, actorEmail: 's@example.com', note: 'reviewed with ops' },
    });
  });

  it('rejects unknown keys (no arbitrary app_config writes)', async () => {
    const res = await request(app()).put('/api/admin/host-trust/settings').set(as('s@example.com'))
      .send({ key: 'private.payout_caps', value: 1 });
    expect(res.status).toBe(400);
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not write when the current value cannot be read', async () => {
    m.prisma.appConfig.findMany.mockRejectedValue(new Error('db down'));
    const res = await request(app()).put('/api/admin/host-trust/settings').set(as('s@example.com'))
      .send({ key: 'host_trust.min_verified_parties', value: 3 });
    expect(res.status).toBe(503);
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });
});
