import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn(), count: vi.fn() },
  admin: { findMany: vi.fn() },
  seriesAdmin: { findMany: vi.fn() },
}));
const mockBranded = vi.hoisted(() => vi.fn());
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../lib/siteBrand.js', () => ({ brandedSiteForParty: mockBranded }));

import { notifyAdminsOfBrandEvent, buildAdminNotifyEmail } from './brandEventAdminNotify.js';
import { emailHostOfStatusChange, buildBrandedStatusEmail } from './partyStatusEmailNotify.js';

const TEAM1 = { url: 'https://team1.rsv.pizza', name: 'Team1', fromEmail: 'Team1 <noreply@rsv.pizza>' };
const party = {
  name: 'Team1 Hack <Berlin>', userId: 'u1', customUrl: 'team1-berlin', inviteCode: 'abc', eventSeriesId: 's1',
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
  mockPrisma.party.count.mockResolvedValue(1);
  mockPrisma.seriesAdmin.findMany.mockResolvedValue([]); // no brand admin yet: PizzaDAO alerts as before
  delete process.env.SERIES_ADMIN_ALERTS;
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

  it('both channels off: no DB read, no send', async () => {
    delete process.env.BRAND_EVENT_ADMIN_ALERTS;
    process.env.SERIES_ADMIN_ALERTS = 'off';
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

  it('caps alerts per creator: the 4th brand event in an hour is created but not announced', async () => {
    mockPrisma.party.count.mockResolvedValue(3);
    await notifyAdminsOfBrandEvent('p1');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockPrisma.party.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }));
    fetchMock.mockClear();
    mockPrisma.party.count.mockResolvedValue(4);
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

describe('brand-admin alerts (series_admins)', () => {
  const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));

  it('with no brand admin the PizzaDAO email is exactly the same as before', async () => {
    await notifyAdminsOfBrandEvent('p1');
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]).toEqual({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: ['a@x.com', 'b@x.com'],
      subject: 'New Team1 event pending approval: Team1 Hack <Berlin>',
      html: buildAdminNotifyEmail({
        eventName: 'Team1 Hack <Berlin>', brandName: 'Team1', hostLabel: 'Hana / host@x.com',
        eventUrl: 'https://team1.rsv.pizza/team1-berlin', adminUrl: 'https://rsv.pizza/underboss',
      }).html,
    });
  });

  it('brand admins with alerts on get the brand-site link; PizzaDAO stops getting that brand alerts', async () => {
    mockPrisma.seriesAdmin.findMany.mockResolvedValue([
      { email: 'Owner@Partner.com', alertsEnabled: true },
      { email: 'quiet@partner.com', alertsEnabled: false },
    ]);
    await notifyAdminsOfBrandEvent('p1');
    const sent = bodies();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['owner@partner.com']);
    expect(sent[0].from).toBe('Team1 <noreply@rsv.pizza>');
    expect(sent[0].html).toContain('https://team1.rsv.pizza/brand-admin/events');
    expect(sent[0].html).not.toContain('/underboss');
    expect(mockPrisma.admin.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.seriesAdmin.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seriesId: 's1', status: 'active' } }));
  });

  it('works even when PizzaDAO alerts are off (default), and PizzaDAO is not emailed', async () => {
    delete process.env.BRAND_EVENT_ADMIN_ALERTS;
    mockPrisma.seriesAdmin.findMany.mockResolvedValue([{ email: 'o@partner.com', alertsEnabled: true }]);
    await notifyAdminsOfBrandEvent('p1');
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].to).toEqual(['o@partner.com']);
  });

  it('every admin gets their own message', async () => {
    mockPrisma.seriesAdmin.findMany.mockResolvedValue([
      { email: 'a@partner.com', alertsEnabled: true }, { email: 'b@partner.com', alertsEnabled: true },
    ]);
    await notifyAdminsOfBrandEvent('p1');
    expect(bodies().map((b) => b.to)).toEqual([['a@partner.com'], ['b@partner.com']]);
  });

  it('brand admins who all opted out do not silence PizzaDAO: someone is always told', async () => {
    mockPrisma.seriesAdmin.findMany.mockResolvedValue([{ email: 'q@partner.com', alertsEnabled: false }]);
    await notifyAdminsOfBrandEvent('p1');
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].to).toEqual(['a@x.com', 'b@x.com']);
  });

  it('SERIES_ADMIN_ALERTS=off restores the PizzaDAO alert and sends nothing to brand admins', async () => {
    process.env.SERIES_ADMIN_ALERTS = 'off';
    mockPrisma.seriesAdmin.findMany.mockResolvedValue([{ email: 'o@partner.com', alertsEnabled: true }]);
    await notifyAdminsOfBrandEvent('p1');
    expect(mockPrisma.seriesAdmin.findMany).not.toHaveBeenCalled();
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].to).toEqual(['a@x.com', 'b@x.com']);
  });

  it('a failed brand-admin lookup falls back to the PizzaDAO alert', async () => {
    mockPrisma.seriesAdmin.findMany.mockRejectedValue(new Error('db'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAdminsOfBrandEvent('p1');
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].to).toEqual(['a@x.com', 'b@x.com']);
    warn.mockRestore();
  });

  it('escapes the brand name and event name in the brand-admin email', async () => {
    mockBranded.mockResolvedValue({ ...TEAM1, name: '<b>Evil</b>' });
    mockPrisma.seriesAdmin.findMany.mockResolvedValue([{ email: 'o@partner.com', alertsEnabled: true }]);
    await notifyAdminsOfBrandEvent('p1');
    const html: string = bodies()[0].html;
    expect(html).not.toContain('<b>Evil</b>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
  });
});
