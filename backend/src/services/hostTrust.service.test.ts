/** Service test: a payout to someone else on the host's party must not make the owner share a payee. */
import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: {
    user: { findMany: vi.fn() },
    party: { findMany: vi.fn() },
    photo: { groupBy: vi.fn() },
    payout: { findMany: vi.fn() },
    payoutDocument: { findMany: vi.fn() },
  },
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../lib/fakeDetectionScan.js', () => ({ buildSybilWalletSetFromDb: vi.fn(), scorePartiesByIds: vi.fn() }));

import { loadHostTrustRows } from './hostTrust.service.js';
import { defaultHostTrustConfig } from '../lib/hostTrustSettings.js';

const NOW = new Date('2026-06-01T12:00:00Z');

/** payout.findMany is used for (a) payouts the host received and (b) wallet lookups across hosts. */
function walletQueries(received: unknown[], byWallet: unknown[]) {
  return async ({ where }: any) => (where.hostUserId?.in ? received : byWallet);
}

function setup(payoutHostUserId: string, otherWallet: string) {
  m.prisma.user.findMany.mockResolvedValue([
    { id: 'owner', name: 'O', email: 'o@example.com', createdAt: new Date('2025-01-01'), payoutWalletAddress: '0xowner' },
  ]);
  m.prisma.party.findMany.mockResolvedValue([
    {
      id: 'p1', userId: 'owner', name: 'P', date: new Date('2026-05-01'), cancelledAt: null, eventTags: [], eventType: 'gpp',
      estimatedAttendance: null, underbossStatus: 'pending',
      payouts: [{ status: 'paid', reviewedBy: 'a@example.com', hostUserId: payoutHostUserId, payoutWalletAddress: otherWallet,
        payoutMethod: 'usdc_base', transactionHash: '0xtx', wireReference: null, mercuryCardLast4: null, mercuryCardId: null, externalProofUrl: null }],
      payoutDocuments: [],
      guests: [],
    },
  ]);
  m.prisma.photo.groupBy.mockResolvedValue([]);
  m.prisma.payoutDocument.findMany.mockResolvedValue([]);
  // The recipient (a co-host) owns that wallet.
  m.prisma.payout.findMany.mockImplementation(walletQueries([], [{ hostUserId: 'cohost', payoutWalletAddress: otherWallet }]));
}

describe('shared payee', () => {
  it('payout to a different recipient does not restrict the owner', async () => {
    setup('cohost', '0xcohost');
    const [row] = await loadHostTrustRows(['owner'], defaultHostTrustConfig(), NOW, { scoreFakeRisk: false });
    expect(row.trust.blockers).not.toContain('shared_payee');
    expect(row.provisional).toBe(true);
  });

  it('the owner wallet used by another account still blocks', async () => {
    setup('owner', '0xowner');
    m.prisma.payout.findMany.mockImplementation(walletQueries([], [{ hostUserId: 'other', payoutWalletAddress: '0xowner' }]));
    const [row] = await loadHostTrustRows(['owner'], defaultHostTrustConfig(), NOW, { scoreFakeRisk: false });
    expect(row.trust.blockers).toContain('shared_payee');
  });

  it('a wallet from a payout the host received on another party counts', async () => {
    setup('cohost', '0xcohost');
    m.prisma.payout.findMany.mockImplementation(
      walletQueries([{ hostUserId: 'owner', payoutWalletAddress: '0xelsewhere' }], [{ hostUserId: 'other', payoutWalletAddress: '0xelsewhere' }]),
    );
    const [row] = await loadHostTrustRows(['owner'], defaultHostTrustConfig(), NOW, { scoreFakeRisk: false });
    expect(row.trust.blockers).toContain('shared_payee');
  });
});
