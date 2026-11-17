import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: {
    party: { findUnique: vi.fn() },
    partyStatusAudit: { count: vi.fn() },
  },
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../config/secrets.js', () => ({ getJwtSecret: () => 'test-secret' }));

import { isBrandOnlyApproved, isPizzadaoSet, notBrandOnlyApproved, BRAND_ADMIN_REASON } from './partyApproval.js';
import { assertPartyApproved } from '../routes/payout.routes.js';

/** Rows in a fake party_status_audit; count() applies the same where-shape the helper sends. */
function fakeAudit(rows: Array<{ newStatus: string; actorKind: string; reason: string | null }>) {
  m.prisma.partyStatusAudit.count.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => {
      if (r.newStatus !== where.newStatus) return false;
      if ('reason' in where && r.reason !== where.reason) return false; // brand-admin query
      if (where.actorKind) {
        if (!where.actorKind.in.includes(r.actorKind)) return false;
        return r.reason === null || r.reason !== BRAND_ADMIN_REASON;
      }
      return true;
    }).length);
}

beforeEach(() => vi.clearAllMocks());

describe('isBrandOnlyApproved', () => {
  it('true when only a brand admin approved', async () => {
    fakeAudit([{ newStatus: 'approved', actorKind: 'admin', reason: BRAND_ADMIN_REASON }]);
    expect(await isBrandOnlyApproved('p')).toBe(true);
  });
  it('false once a super-admin or underboss approved too', async () => {
    fakeAudit([
      { newStatus: 'approved', actorKind: 'admin', reason: BRAND_ADMIN_REASON },
      { newStatus: 'approved', actorKind: 'admin', reason: null },
    ]);
    expect(await isBrandOnlyApproved('p')).toBe(false);
    fakeAudit([
      { newStatus: 'approved', actorKind: 'admin', reason: BRAND_ADMIN_REASON },
      { newStatus: 'approved', actorKind: 'underboss', reason: null },
    ]);
    expect(await isBrandOnlyApproved('p')).toBe(false);
  });
  it('false for legacy approvals (no brand-admin row at all)', async () => {
    fakeAudit([{ newStatus: 'approved', actorKind: 'admin', reason: null }]);
    expect(await isBrandOnlyApproved('p')).toBe(false);
    fakeAudit([]);
    expect(await isBrandOnlyApproved('p')).toBe(false);
  });
});

describe('isPizzadaoSet', () => {
  it('admin/underboss without the brand-admin reason are PizzaDAO; brand admin, owner, system are not', () => {
    expect(isPizzadaoSet({ actorKind: 'admin', reason: null })).toBe(true);
    expect(isPizzadaoSet({ actorKind: 'underboss', reason: null })).toBe(true);
    expect(isPizzadaoSet({ actorKind: 'admin', reason: BRAND_ADMIN_REASON })).toBe(false);
    expect(isPizzadaoSet({ actorKind: 'owner', reason: null })).toBe(false);
    expect(isPizzadaoSet({ actorKind: 'system', reason: null })).toBe(false);
    expect(isPizzadaoSet(null)).toBe(false);
  });
});

describe('payout gate (assertPartyApproved)', () => {
  it('blocks a brand-series event approved only by a brand admin', async () => {
    m.prisma.party.findUnique.mockResolvedValue({ underbossStatus: 'approved', eventSeriesId: 's1' });
    fakeAudit([{ newStatus: 'approved', actorKind: 'admin', reason: BRAND_ADMIN_REASON }]);
    await expect(assertPartyApproved('p')).rejects.toMatchObject({ statusCode: 403, code: 'PARTY_NOT_APPROVED' });
  });
  it('passes a brand-series event once PizzaDAO approved', async () => {
    m.prisma.party.findUnique.mockResolvedValue({ underbossStatus: 'approved', eventSeriesId: 's1' });
    fakeAudit([
      { newStatus: 'approved', actorKind: 'admin', reason: BRAND_ADMIN_REASON },
      { newStatus: 'approved', actorKind: 'underboss', reason: null },
    ]);
    await expect(assertPartyApproved('p')).resolves.toBeUndefined();
  });
  it('is unchanged for non-series events (no extra query) and for unapproved ones', async () => {
    m.prisma.party.findUnique.mockResolvedValue({ underbossStatus: 'approved', eventSeriesId: null });
    await expect(assertPartyApproved('p')).resolves.toBeUndefined();
    expect(m.prisma.partyStatusAudit.count).not.toHaveBeenCalled();
    m.prisma.party.findUnique.mockResolvedValue({ underbossStatus: 'pending', eventSeriesId: 's1' });
    await expect(assertPartyApproved('p')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('admin payout queue fragment', () => {
  it('excludes parties with a brand-admin approval and no PizzaDAO approval', () => {
    const and = (notBrandOnlyApproved.NOT.AND as any[]);
    expect(and[0].statusAudit.some).toMatchObject({ newStatus: 'approved', reason: BRAND_ADMIN_REASON });
    expect(and[1].statusAudit.none).toMatchObject({ newStatus: 'approved', actorKind: { in: ['admin', 'underboss'] } });
  });
});
