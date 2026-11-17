import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  prisma: { party: { findFirst: vi.fn(), update: vi.fn() }, seriesAudit: { create: vi.fn() }, $transaction: vi.fn() },
  notify: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../services/partyStatusEmailNotify.js', () => ({ emailHostOfStatusChange: m.notify }));
vi.mock('../helpers/statusAudit.js', () => ({ writeStatusAudit: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = 'u1'; req.userEmail = 'admin@example.com'; next(); },
  isSuperAdmin: async () => true,
  AuthRequest: {},
}));

import router from './admin-series.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/admin/series', router);
app.use(errorHandler);

const SID = '11111111-1111-4111-8111-111111111111';
const patch = (status: string) => request(app).patch(`/api/admin/series/${SID}/events/p1/status`).send({ status });

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.$transaction.mockImplementation(async (fn: any) => fn(m.prisma));
  m.prisma.party.findFirst.mockResolvedValue({ eventSeriesId: SID, underbossStatus: 'pending' });
  m.prisma.party.update.mockResolvedValue({ id: 'p1', underbossStatus: 'approved' });
});

describe('PATCH /api/admin/series/:id/events/:partyId/status host email', () => {
  it.each(['approved', 'rejected'])('emails the host on a real change to %s', async (status) => {
    const res = await patch(status);
    expect(res.status).toBe(200);
    expect(m.notify).toHaveBeenCalledWith('p1', status);
  });

  it('does not email on hidden', async () => {
    expect((await patch('hidden')).status).toBe(200);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('does not email when the status is unchanged', async () => {
    m.prisma.party.findFirst.mockResolvedValue({ eventSeriesId: SID, underbossStatus: 'approved' });
    expect((await patch('approved')).status).toBe(200);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('does not email when the party is not in the series', async () => {
    m.prisma.party.findFirst.mockResolvedValue(null); // scoped lookup {id, eventSeriesId}: another series' party is not found
    expect((await patch('approved')).status).toBe(404);
    expect(m.notify).not.toHaveBeenCalled();
  });
});
