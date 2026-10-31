import { describe, it, expect, vi, afterEach } from 'vitest';

const m = vi.hoisted(() => ({ tg: vi.fn() }));
vi.mock('../config/database.js', () => ({
  prisma: {
    user: { findUnique: async () => ({ email: 'host@x.com' }) },
    party: { findUnique: async () => ({ customUrl: 'p', inviteCode: 'abc', hostTelegramChatId: 123n, userId: 'u1' }) },
  },
}));
vi.mock('./telegramSend.js', () => ({ sendTelegramMessage: m.tg }));

import { notifyHostOfOrder, buildOrderNotice } from './pizzaOrderNotify.js';

const row = { id: 'r', userId: 'u1', partyId: 'p', shopName: "Sal's", tier: 'listing', confirmedTotalCents: 18740, readyAtText: 'about 6:30' } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  m.tg.mockReset();
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
  });
});
