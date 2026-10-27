/**
 * Route-level tests for host fast pass: authz, self-approval, cap, risk block,
 * and that the host route never leaks admin-only flag data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  isPaymentAdmin: vi.fn(),
  canUserEditParty: vi.fn(),
  isSelfInterested: vi.fn(),
  loadReviewAssist: vi.fn(),
  loadHostTrackRecord: vi.fn(),
  prisma: {
    party: { findUnique: vi.fn() },
    hostFastPassApproval: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
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
}));
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: m.canUserEditParty }));
vi.mock('./budget.routes.js', () => ({
  BUDGET_CATEGORIES: ['pizza', 'drinks', 'venue', 'supplies', 'entertainment', 'tips', 'other'],
}));
vi.mock('../services/hostFastPass.service.js', () => ({
  isSelfInterested: m.isSelfInterested,
  loadReviewAssist: m.loadReviewAssist,
  loadHostTrackRecord: m.loadHostTrackRecord,
}));

import { adminFastPassRouter, hostFastPassRouter } from './host-fast-pass.routes.js';
import { errorHandler } from '../middleware/error.js';
import { computeTrackRecord } from '../lib/hostTrackRecord.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/host-fast-pass', adminFastPassRouter);
  a.use('/api/parties', hostFastPassRouter);
  a.use(errorHandler);
  return a;
}

const admin = { 'x-user-id': 'admin1', 'x-user-email': 'admin@pizzadao.xyz' };
const body = { amountUsd: 200, covers: ['pizza'] };
const P = '/api/admin/host-fast-pass/party/p1/approve';

function assist(over: Record<string, unknown> = {}) {
  return {
    hostUserId: 'h1',
    hostEmail: 'host@x.com',
    track: computeTrackRecord([], new Date('2026-01-01'), new Date('2026-10-29')),
    review: { flags: [], checklist: [], riskLevel: 'low' },
    capUsd: 300,
    eligibleForFastPass: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isPaymentAdmin.mockResolvedValue(true);
  m.isSelfInterested.mockResolvedValue(false);
  m.loadReviewAssist.mockResolvedValue(assist());
  m.prisma.party.findUnique.mockResolvedValue({
    id: 'p1',
    userId: 'h1',
    date: new Date('2026-12-01T00:00:00Z'),
    cancelledAt: null,
  });
  m.prisma.hostFastPassApproval.upsert.mockImplementation(async ({ create }: any) => ({
    ...create,
    receiptDeadline: create.receiptDeadline,
    approvedAt: new Date(),
  }));
});

describe('admin approve', () => {
  it('rejects unauthenticated and non-payment-admin callers', async () => {
    await request(app()).post(P).send(body).expect(401);
    m.isPaymentAdmin.mockResolvedValue(false);
    await request(app()).post(P).set(admin).send(body).expect(403);
    expect(m.prisma.hostFastPassApproval.upsert).not.toHaveBeenCalled();
  });

  it('approves an eligible host within the cap', async () => {
    const r = await request(app()).post(P).set(admin).send(body).expect(200);
    expect(r.body.approval.approvedAmountUsd).toBe(200);
    expect(r.body.approval.basis).toBe('fast_pass');
  });

  it('blocks self-approval (host, co-host or payout payee)', async () => {
    m.isSelfInterested.mockResolvedValue(true);
    const r = await request(app()).post(P).set(admin).send(body).expect(403);
    expect(r.body.error?.code ?? r.body.code).toBe('SELF_APPROVAL');
    expect(m.prisma.hostFastPassApproval.upsert).not.toHaveBeenCalled();
  });

  it('requires a cap and never exceeds it', async () => {
    m.loadReviewAssist.mockResolvedValue(assist({ capUsd: null }));
    await request(app()).post(P).set(admin).send(body).expect(400);
    m.loadReviewAssist.mockResolvedValue(assist({ capUsd: 100 }));
    await request(app()).post(P).set(admin).send(body).expect(400);
    expect(m.prisma.hostFastPassApproval.upsert).not.toHaveBeenCalled();
  });

  it('high risk blocks both fast_pass and manual_review bases', async () => {
    const high = { flags: [], checklist: [], riskLevel: 'high' };
    m.loadReviewAssist.mockResolvedValue(assist({ review: high }));
    await request(app()).post(P).set(admin).send(body).expect(409);
    m.loadReviewAssist.mockResolvedValue(assist({ review: high, eligibleForFastPass: false }));
    await request(app()).post(P).set(admin).send({ ...body, note: 'looked fine' }).expect(409);
    expect(m.prisma.hostFastPassApproval.upsert).not.toHaveBeenCalled();
  });

  it('ineligible host needs a note, then is stored as manual_review', async () => {
    m.loadReviewAssist.mockResolvedValue(assist({ eligibleForFastPass: false }));
    await request(app()).post(P).set(admin).send(body).expect(400);
    const r = await request(app()).post(P).set(admin).send({ ...body, note: 'underboss vouched' }).expect(200);
    expect(r.body.approval.basis).toBe('manual_review');
  });
});

describe('host route', () => {
  it('requires auth and party edit access', async () => {
    await request(app()).get('/api/parties/p1/fast-pass').expect(401);
    m.canUserEditParty.mockResolvedValue(false);
    await request(app()).get('/api/parties/p1/fast-pass').set({ 'x-user-email': 'a@b.c' }).expect(404);
  });

  it('is path-scoped: other /api/parties paths are not gated by it', async () => {
    const a = express();
    a.use('/api/parties', hostFastPassRouter);
    a.get('/api/parties/public', (_q, s) => s.json({ ok: true }));
    await request(a).get('/api/parties/public').expect(200);
  });

  it('shows a flagged host as building with no flag data', async () => {
    m.canUserEditParty.mockResolvedValue(true);
    const flagged = computeTrackRecord(
      [
        {
          partyId: 'x',
          date: new Date('2026-05-01'),
          cancelledAt: null,
          eventTags: ['possible-scam'],
          photoCount: 0,
          rsvpCount: 0,
          receiptCount: 0,
          firstReceiptAt: null,
          hasDuplicateReceipts: false,
          payouts: [],
        },
      ],
      new Date('2026-01-01'),
      new Date('2026-10-29'),
    );
    expect(flagged.tier).toBe('flagged');
    m.loadHostTrackRecord.mockResolvedValue({ track: flagged, accountCreatedAt: new Date('2026-01-01') });
    m.prisma.hostFastPassApproval.findUnique.mockResolvedValue(null);
    const r = await request(app()).get('/api/parties/p1/fast-pass').set({ 'x-user-email': 'h@x.com' }).expect(200);
    expect(r.body.track.tier).toBe('building');
    expect(JSON.stringify(r.body)).not.toMatch(/issue|flag|scam/i);
  });
});
