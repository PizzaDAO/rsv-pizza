import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ tg: vi.fn(), site: vi.fn() }));
vi.mock('../config/database.js', () => ({
  prisma: {
    user: { findUnique: async () => ({ email: 'host@x.com' }) },
    party: { findUnique: async () => ({ customUrl: 'p', inviteCode: 'abc', hostTelegramChatId: 123n, userId: 'u1' }) },
  },
}));
vi.mock('../lib/siteBrand.js', () => ({ siteForParty: m.site }));
vi.mock('./telegramSend.js', () => ({ sendTelegramMessage: m.tg }));

import { notifyHostOfOrder, buildOrderNotice } from './pizzaOrderNotify.js';

const row = { id: 'r', userId: 'u1', partyId: 'p', shopName: "Sal's", tier: 'listing', confirmedTotalCents: 18740, readyAtText: 'about 6:30' } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  m.tg.mockReset();
  m.site.mockReset();
});

beforeEach(() => {
  m.site.mockImplementation(async (_p: unknown, fallback: string) => ({ url: fallback, name: 'RSV.Pizza', fromEmail: 'RSV.Pizza <noreply@rsv.pizza>' })); // brand-check-ignore-line
});

describe('notifyHostOfOrder (awaited, bounded)', () => {
  it('sends the email and the Telegram DM before it resolves', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    m.tg.mockResolvedValue({ ok: true });
    await notifyHostOfOrder(row);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body).to).toEqual(['host@x.com']);
    expect(m.tg).toHaveBeenCalledTimes(1);
  });

  it('gives up after its budget when the mail provider hangs, so the webhook still answers inside 5 s', async () => {
    process.env.RESEND_API_KEY = 're_test';
    vi.stubGlobal('fetch', () => new Promise(() => undefined)); // never resolves
    const t0 = Date.now();
    await notifyHostOfOrder(row, 60);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('never throws', async () => {
    process.env.RESEND_API_KEY = 're_test';
    vi.stubGlobal('fetch', async () => { throw new Error('boom'); });
    m.tg.mockRejectedValue(new Error('tg down'));
    await expect(notifyHostOfOrder(row)).resolves.toBeUndefined();
  });

  it('does not promise a draft receipt it will not provide', () => {
    const n = buildOrderNotice(row, 'https://x/pay');
    expect(n.text).not.toMatch(/attach the receipt photo to the draft/);
    expect(n.text).toMatch(/not counted as a receipt/);
    // pizza-mcp 662d51c confirms a phone order only with a total that includes tax
    expect(n.text).toMatch(/^Sal's confirmed your order for \$187\.40 with tax, ready about 6:30\./);
  });
});

describe('notifyHostOfOrder (white-label)', () => {
  it('uses the party series brand for the from-address, the payments link and the Telegram DM', async () => {
    process.env.RESEND_API_KEY = 're_test';
    m.site.mockResolvedValue({ url: 'https://team1.rsv.pizza', name: 'Team1', fromEmail: 'Team1 <noreply@rsv.pizza>' }); // brand-check-ignore-line
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    m.tg.mockResolvedValue({ ok: true });
    await notifyHostOfOrder(row);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.from).toBe('Team1 <noreply@rsv.pizza>'); // brand-check-ignore-line
    expect(body.html).toContain('https://team1.rsv.pizza/host/p/payments'); // brand-check-ignore-line
    expect(body.html).not.toContain('https://rsv.pizza'); // brand-check-ignore-line
    expect(m.tg.mock.calls[0][1]).toContain('https://team1.rsv.pizza/host/p/payments'); // brand-check-ignore-line
  });
});
