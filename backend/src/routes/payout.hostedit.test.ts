/**
 * Host PATCH /:partyId/payouts/:payoutId: amount / method / wallet / bank edits only while
 * pending; documents-only on approved/queued; nothing on terminal states; and the write is
 * guarded by a status check so a concurrent admin transition returns 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  prisma: {
    party: { findUnique: vi.fn() },
    payout: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    admin: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    payoutAudit: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'host1';
    req.userEmail = 'host@example.org';
    next();
  },
  isPaymentAdmin: vi.fn(async () => false),
  isSuperAdmin: vi.fn(async () => false),
  isFullAdmin: vi.fn(async () => false),
  isUnderboss: vi.fn(async () => false),
}));
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: vi.fn(async () => true), canUserAccessTab: vi.fn(async () => false) }));
vi.mock('../services/ocr.service.js', () => ({ analyzeReceipt: vi.fn(), analyzeReceiptMulti: vi.fn() }));
vi.mock('../services/fx.service.js', () => ({ convertToUSD: vi.fn() }));
vi.mock('../services/ens.service.js', () => ({ looksLikeEnsName: vi.fn(), resolveWalletInput: vi.fn(), resolveWalletInputWithMeta: vi.fn() }));
vi.mock('../services/refundTag.js', () => ({ recomputeRefundTags: vi.fn() }));
vi.mock('../lib/partyApproval.js', () => ({ isBrandOnlyApproved: vi.fn(async () => false) }));
vi.mock('./tax-form.routes.js', () => ({ getLatestSubmittedTaxFormForUser: vi.fn(), getYtdPayoutTotalUsd: vi.fn() }));
vi.mock('../services/taxFormCore.service.js', () => ({ submitTaxFormCore: vi.fn() }));
vi.mock('../services/payoutReceiptStorage.service.js', () => ({
  isPrivateReceiptPath: vi.fn(),
  partyIdFromPrivateReceiptPath: vi.fn(),
  buildReceiptUploadPath: vi.fn(),
  createReceiptUploadTarget: vi.fn(),
}));
vi.mock('../helpers/payoutReceiptAccess.js', () => ({ canAccessPartyReceipts: vi.fn() }));

import payoutRoutes from './payout.routes.js';
import { errorHandler } from '../middleware/error.js';

const PARTY = '11111111-1111-1111-1111-111111111111';
const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', payoutRoutes);
  a.use(errorHandler);
  return a;
};
const patch = (body: object) => request(app()).patch(`/api/parties/${PARTY}/payouts/po1`).send(body);
const existing = (status: string) => ({
  id: 'po1',
  partyId: PARTY,
  status,
  hostUserId: 'host1',
  finalAmountUsd: { toString: () => '100' },
  payoutWalletAddress: null,
  payoutBankDetails: null,
  documents: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.party.findUnique.mockResolvedValue({ underbossStatus: 'approved', eventSeriesId: null });
});

describe('host payout edit gating', () => {
  it.each(['paid', 'rejected', 'failed', 'withdrawn', 'completed'])('freezes %s payouts entirely', async (status) => {
    m.prisma.payout.findFirst.mockResolvedValue(existing(status));
    const r = await patch({ receiptPhotos: [] });
    expect(r.status).toBe(400);
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['approved', 'queued'])('blocks amount edits on %s payouts', async (status) => {
    m.prisma.payout.findFirst.mockResolvedValue(existing(status));
    const r = await patch({ finalAmountUsd: 1 });
    expect(r.status).toBe(400);
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['payoutMethod', { payoutMethod: 'wire' }],
    ['payoutBankDetails', { payoutBankDetails: { iban: 'x' } }],
    ['payoutWalletAddress', { payoutWalletAddress: '0x0000000000000000000000000000000000000001' }],
  ])('blocks %s edits on queued payouts', async (_n, body) => {
    m.prisma.payout.findFirst.mockResolvedValue(existing('queued'));
    const r = await patch(body);
    expect(r.status).toBe(400);
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows documents-only edits on queued payouts (reaches the guarded write)', async () => {
    m.prisma.payout.findFirst.mockResolvedValue(existing('queued'));
    m.prisma.$transaction.mockImplementation(async (cb: any) => cb(m.prisma));
    m.prisma.payout.updateMany.mockResolvedValue({ count: 0 });
    const r = await patch({ removeDocumentIds: [] , eventPhotos: []});
    expect(r.status).toBe(409);
    expect(m.prisma.payout.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'po1', status: 'queued' });
  });

  it('pending amount edit is guarded by the status in the write (409 if it changed)', async () => {
    m.prisma.payout.findFirst.mockResolvedValue(existing('pending'));
    m.prisma.$transaction.mockImplementation(async (cb: any) => cb(m.prisma));
    m.prisma.payout.updateMany.mockResolvedValue({ count: 0 });
    const r = await patch({ finalAmountUsd: 50 });
    expect(r.status).toBe(409);
    expect(m.prisma.payout.updateMany.mock.calls[0][0].where.status).toBe('pending');
    expect(m.prisma.payout.update).not.toHaveBeenCalled();
  });
});
