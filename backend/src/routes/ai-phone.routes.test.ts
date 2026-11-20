import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({ initiateCall: vi.fn(), retryCall: vi.fn(), getCallById: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ error: 'unauth' });
    req.userId = req.headers['x-user-id'];
    next();
  },
}));
vi.mock('../middleware/webhookAuth.js', () => ({ verifyBlandWebhook: (_q: any, _s: any, n: any) => n() }));
vi.mock('../services/blandAI.service.js', () => ({
  initiateCall: m.initiateCall,
  retryCall: m.retryCall,
  getCallById: m.getCallById,
  processWebhook: vi.fn(),
}));

import router from './ai-phone.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/ai-phone', router);
  a.use(errorHandler);
  return a;
};

const body = {
  partyId: 'p1',
  pizzeriaName: 'Any Shop',
  pizzeriaPhone: '+16175550123',
  items: [{ name: 'Cheese', quantity: 1 }],
  customerName: 'Host',
  customerPhone: '+16175550199',
  fulfillmentType: 'pickup',
};

beforeEach(() => {
  m.initiateCall.mockReset().mockResolvedValue({ success: true, callId: 'c1' });
  m.retryCall.mockReset().mockResolvedValue({ success: true });
  m.getCallById.mockReset().mockResolvedValue({ id: 'a1', userId: 'u1', status: 'failed' });
});

describe('legacy /api/ai-phone call placing is retired (basil-14648)', () => {
  it('initiate answers 410 and never reaches Bland', async () => {
    const r = await request(app()).post('/api/ai-phone/initiate').set('x-user-id', 'u1').send(body);
    expect(r.status).toBe(410);
    expect(JSON.stringify(r.body)).toContain('ENDPOINT_RETIRED');
    expect(m.initiateCall).not.toHaveBeenCalled();
  });

  it('retry answers 410 and never reaches Bland, even for the caller\'s own failed call', async () => {
    const r = await request(app()).post('/api/ai-phone/a1/retry').set('x-user-id', 'u1').send({});
    expect(r.status).toBe(410);
    expect(m.retryCall).not.toHaveBeenCalled();
  });

  it('still requires sign-in first', async () => {
    const r = await request(app()).post('/api/ai-phone/initiate').send(body);
    expect(r.status).toBe(401);
  });
});

describe('/api/ai-phone/:id/status and /transcript are owner-only', () => {
  for (const path of ['status', 'transcript']) {
    it(`${path}: 401 without sign-in`, async () => {
      expect((await request(app()).get(`/api/ai-phone/a1/${path}`)).status).toBe(401);
    });
    it(`${path}: 403 for a signed-in user who does not own the call`, async () => {
      const r = await request(app()).get(`/api/ai-phone/a1/${path}`).set('x-user-id', 'u2');
      expect(r.status).toBe(403);
    });
    it(`${path}: 200 for the owner`, async () => {
      const r = await request(app()).get(`/api/ai-phone/a1/${path}`).set('x-user-id', 'u1');
      expect(r.status).toBe(200);
    });
  }
});
