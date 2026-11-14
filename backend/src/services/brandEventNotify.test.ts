import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  admin: { findMany: vi.fn() },
}));
const mockBranded = vi.hoisted(() => vi.fn());
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../lib/siteBrand.js', () => ({ brandedSiteForParty: mockBranded }));

import { notifyAdminsOfBrandEvent, buildAdminNotifyEmail } from './brandEventAdminNotify.js';
import { emailHostOfStatusChange, buildBrandedStatusEmail } from './partyStatusEmailNotify.js';

const TEAM1 = { url: 'https://team1.rsv.pizza', name: 'Team1', fromEmail: 'Team1 <noreply@rsv.pizza>' };
const party = {
  name: 'Team1 Hack <Berlin>', customUrl: 'team1-berlin', inviteCode: 'abc', eventSeriesId: 's1',
  underbossStatus: 'pending', user: { email: 'host@x.com', name: 'Hana' },
};

// Every send goes through this stub: nothing here can reach the real Resend API.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.BRAND_EVENT_NOTIFY_EMAILS;
  process.env.BRAND_EVENT_ADMIN_ALERTS = 'on';
  mockPrisma.party.findUnique.mockResolvedValue(party);
  mockPrisma.admin.findMany.mockResolvedValue([{ email: 'A@x.com' }, { email: 'b@x.com' }, { email: 'a@x.com' }]);
  mockBranded.mockResolvedValue(TEAM1);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.BRAND_EVENT_ADMIN_ALERTS;
});

describe('notifyAdminsOfBrandEvent', () => {
  it('emails DB admins (deduped) with event, brand and approval link', async () => {
    await notifyAdminsOfBrandEvent('p1');
    expect(mockPrisma.admin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { in: ['admin', 'super_admin'] } } }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(['a@x.com', 'b@x.com']);
    expect(body.subject).toContain('Team1');
    expect(body.html).toContain('Team1 Hack &lt;Berlin&gt;');
    expect(body.html).toContain('https://team1.rsv.pizza/team1-berlin');
    expect(body.html).toContain('/underboss');
  });

  it('BRAND_EVENT_NOTIFY_EMAILS overrides the admin list', async () => {
    process.env.BRAND_EVENT_NOTIFY_EMAILS = 'ops@x.com, ops2@x.com';
    await notifyAdminsOfBrandEvent('p1');
    expect(mockPrisma.admin.findMany).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(['ops@x.com', 'ops2@x.com']);
  });

  it('is off by default: no DB read, no send', async () => {
    delete process.env.BRAND_EVENT_ADMIN_ALERTS;
    await notifyAdminsOfBrandEvent('p1');
    expect(mockPrisma.party.findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing without RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY;
    await notifyAdminsOfBrandEvent('p1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips non-brand and non-pending events', async () => {
    mockBranded.mockResolvedValue(null);
    await notifyAdminsOfBrandEvent('p1');
    mockBranded.mockResolvedValue(TEAM1);
    mockPrisma.party.findUnique.mockResolvedValue({ ...party, underbossStatus: 'approved' });
    await notifyAdminsOfBrandEvent('p1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws, even when sending fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(notifyAdminsOfBrandEvent('p1')).resolves.toBeUndefined();
  });

  it('builds the subject', () => {
    expect(buildAdminNotifyEmail({ eventName: 'E', brandName: 'B', hostLabel: 'h', eventUrl: 'u', adminUrl: 'a' }).subject)
      .toBe('New B event pending approval: E');
  });
});

describe('emailHostOfStatusChange (brand-aware)', () => {
  it('approved brand event: brand name, brand URL and brand from', async () => {
    await emailHostOfStatusChange('p1', 'approved');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('Team1 <noreply@rsv.pizza>');
    expect(body.to).toBe('host@x.com');
    expect(body.subject).toContain('Team1');
    expect(body.html).toContain('https://team1.rsv.pizza/team1-berlin');
    expect(body.html).not.toContain('PizzaDAO');
    expect(body.html).not.toContain('https://rsv.pizza/host');
  });

  it('non-brand event keeps the generic Global Pizza Party email', async () => {
    mockBranded.mockResolvedValue(null);
    mockPrisma.party.findUnique.mockResolvedValue({ ...party, name: 'Global Pizza Party Paris', eventSeriesId: null });
    await emailHostOfStatusChange('p1', 'approved');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('RSV.Pizza <noreply@rsv.pizza>');
    expect(body.subject).toBe('🍕 Your Global Pizza Party in Paris is approved!');
    expect(body.html).toContain('https://rsv.pizza/host/team1-berlin');
    expect(body.html).toContain('Dread Pizza Roberts');
  });

  it('rejected brand email is branded too', () => {
    const e = buildBrandedStatusEmail(TEAM1, { hostName: 'H', eventName: 'E', slug: 's' }, 'rejected');
    expect(e.subject).toBe('Update on your Team1 event');
    expect(e.html).toContain('Team1');
  });
});
