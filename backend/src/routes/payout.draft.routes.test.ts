import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  docs: [] as any[],
  canEdit: true,
  record: null as any,
  lookups: 0,
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    payoutDocument: {
      findFirst: async ({ where }: any) => {
        m.lookups++;
        return m.docs.find((d) => d.id === where.id && d.partyId === where.partyId && d.source !== 'upload' && (d.payoutId ?? null) === where.payoutId) ?? null;
      },
      deleteMany: async ({ where }: any) => {
        const before = m.docs.length;
        m.docs = m.docs.filter((d) => !(d.id === where.id && d.source !== 'upload' && (d.payoutId ?? null) === where.payoutId));
        return { count: before - m.docs.length };
      },
      findMany: async () => m.docs,
    },
    payout: { findFirst: async () => m.record },
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
const D1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft = { id: D1, partyId: 'p1', kind: 'receipt', source: 'ai_call', payoutId: null };
const upload = { id: U1, partyId: 'p1', kind: 'receipt', source: 'upload', payoutId: null };

beforeEach(() => {
  m.docs = [{ ...draft }, { ...upload }];
  m.canEdit = true;
  m.record = null;
  m.lookups = 0;
});

describe('removing the reminder line a pizza order leaves (DELETE /reimbursement/receipts/:docId)', () => {
  it('a host can remove a draft (this was a 404)', async () => {
    const res = await request(app()).delete(`/api/parties/p1/reimbursement/receipts/${D1}`).set('x-user-id', 'h1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removedDraft: true, id: D1 });
    expect(m.docs.map((d) => d.id)).toEqual([U1]);
  });

  it('never deletes an uploaded receipt through the draft path, nor a draft already attached to a request', async () => {
    const res = await request(app()).delete(`/api/parties/p1/reimbursement/receipts/${U1}`).set('x-user-id', 'h1');
    expect(res.body.removedDraft).toBeUndefined();
    expect(m.docs.some((d) => d.id === U1)).toBe(true);
    m.docs[0].payoutId = 'pay1';
    await request(app()).delete(`/api/parties/p1/reimbursement/receipts/${D1}`).set('x-user-id', 'h1');
    expect(m.docs.some((d) => d.id === D1)).toBe(true);
  });

  it('is refused for someone who cannot edit the party', async () => {
    m.canEdit = false;
    const res = await request(app()).delete(`/api/parties/p1/reimbursement/receipts/${D1}`).set('x-user-id', 'x');
    expect(res.status).toBe(404);
    expect(m.docs.some((d) => d.id === D1)).toBe(true);
  });

  describe('hosts with no pizza order see the old behaviour', () => {
    const del = (id: string) => request(app()).delete(`/api/parties/p1/reimbursement/receipts/${id}`).set('x-user-id', 'h1');

    it('a malformed id with no active reimbursement is the old 404, and the draft lookup is skipped (Prisma would throw)', async () => {
      const res = await del('not-a-uuid');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NO_ACTIVE_REIMBURSEMENT');
      expect(m.lookups).toBe(0);
    });

    it('a malformed id with an active reimbursement is the old 404', async () => {
      m.record = { id: 'pay1', documents: [{ id: U1 }] };
      const res = await del('d1');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Receipt not found on your active reimbursement' });
      expect(m.lookups).toBe(0);
    });

    it('a well-formed id that is no draft reaches the same 404s', async () => {
      const unknown = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      expect((await del(unknown)).body.error.code).toBe('NO_ACTIVE_REIMBURSEMENT');
      m.record = { id: 'pay1', documents: [] };
      expect((await del(unknown)).body.error.code).toBe('NOT_FOUND');
      expect(m.docs.map((d) => d.id)).toEqual([D1, U1]);
    });
  });
});
