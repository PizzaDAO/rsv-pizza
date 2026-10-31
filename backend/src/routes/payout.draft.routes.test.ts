import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  docs: [] as any[],
  canEdit: true,
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    payoutDocument: {
      findFirst: async ({ where }: any) =>
        m.docs.find((d) => d.id === where.id && d.partyId === where.partyId && d.source !== 'upload' && (d.payoutId ?? null) === where.payoutId) ?? null,
      deleteMany: async ({ where }: any) => {
        const before = m.docs.length;
        m.docs = m.docs.filter((d) => !(d.id === where.id && d.source !== 'upload' && (d.payoutId ?? null) === where.payoutId));
        return { count: before - m.docs.length };
      },
      findMany: async () => m.docs,
    },
  },
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-id']) return res.status(401).json({});
    req.userId = req.headers['x-user-id'];
    req.userEmail = 'h@x.com';
    next();
  },
  isPaymentAdmin: async () => false,
}));
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: async () => m.canEdit }));

import router from './payout.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', router);
  a.use(errorHandler);
  return a;
};
const draft = { id: 'd1', partyId: 'p1', kind: 'receipt', source: 'ai_call', payoutId: null };
const upload = { id: 'u1', partyId: 'p1', kind: 'receipt', source: 'upload', payoutId: null };

beforeEach(() => {
  m.docs = [{ ...draft }, { ...upload }];
  m.canEdit = true;
});

describe('removing the reminder line a pizza order leaves (DELETE /reimbursement/receipts/:docId)', () => {
  it('a host can remove a draft (this was a 404)', async () => {
    const res = await request(app()).delete('/api/parties/p1/reimbursement/receipts/d1').set('x-user-id', 'h1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removedDraft: true, id: 'd1' });
    expect(m.docs.map((d) => d.id)).toEqual(['u1']);
  });

  it('never deletes an uploaded receipt through the draft path, nor a draft already attached to a request', async () => {
    const res = await request(app()).delete('/api/parties/p1/reimbursement/receipts/u1').set('x-user-id', 'h1');
    expect(res.body.removedDraft).toBeUndefined();
    expect(m.docs.some((d) => d.id === 'u1')).toBe(true);
    m.docs[0].payoutId = 'pay1';
    await request(app()).delete('/api/parties/p1/reimbursement/receipts/d1').set('x-user-id', 'h1');
    expect(m.docs.some((d) => d.id === 'd1')).toBe(true);
  });

  it('is refused for someone who cannot edit the party', async () => {
    m.canEdit = false;
    const res = await request(app()).delete('/api/parties/p1/reimbursement/receipts/d1').set('x-user-id', 'x');
    expect(res.status).toBe(404);
    expect(m.docs.some((d) => d.id === 'd1')).toBe(true);
  });
});
