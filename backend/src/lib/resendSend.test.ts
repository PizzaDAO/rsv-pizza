import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({ eventSeries: { updateMany: vi.fn() } }));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
const inval = vi.hoisted(() => vi.fn());
vi.mock('./siteBrand.js', () => ({ invalidateSiteBrandCache: inval }));

import { sendBrandedEmail, isUnverifiedDomainError } from './resendSend.js';

const ok = () => ({ ok: true, status: 200, json: async () => ({ id: 'e1' }), text: async () => '', clone() { return this; } });
const fail = (status: number, text: string) => ({ ok: false, status, text: async () => text, json: async () => ({}), clone() { return this; } });
const bodyOf = (f: any, i = 0) => JSON.parse(f.mock.calls[i][1].body);

const PAYLOAD = { to: ['a@b.co'], subject: 'S', html: '<p>x</p>' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.eventSeries.updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendBrandedEmail', () => {
  it('posts the legacy body shape: from first, no reply_to key when unset', async () => {
    const f = vi.fn().mockResolvedValue(ok());
    await sendBrandedEmail({ site: { fromEmail: 'RSV.Pizza <noreply@rsv.pizza>' }, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(f.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(f.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer k', 'Content-Type': 'application/json' });
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect(f.mock.calls[0][1].body).toBe(JSON.stringify({ from: 'RSV.Pizza <noreply@rsv.pizza>', ...PAYLOAD }));
    expect(bodyOf(f)).not.toHaveProperty('reply_to');
  });

  it('adds reply_to only when set', async () => {
    const f = vi.fn().mockResolvedValue(ok());
    await sendBrandedEmail({ site: { fromEmail: 'X <x@rsv.pizza>', replyTo: 'hi@p.com' }, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(bodyOf(f).reply_to).toBe('hi@p.com');
  });

  it('uses the global fetch looked up at call time when no fetchImpl is given', async () => {
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', f);
    await sendBrandedEmail({ site: { fromEmail: 'X <x@rsv.pizza>' }, apiKey: 'k', payload: PAYLOAD });
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  const partner = { fromEmail: 'P <e@mail.p.com>', fallbackFrom: 'P <noreply@rsv.pizza>', seriesId: 's1', replyTo: 'hi@p.com' };

  it('retries once from the fallback sender on an unverified-domain 403, clears verified_at and busts the cache', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fail(403, '{"message":"The mail.p.com domain is not verified. Please, add and verify your domain"}'))
      .mockResolvedValueOnce(ok());
    const r = await sendBrandedEmail({ site: partner, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 0).from).toBe('P <e@mail.p.com>');
    expect(bodyOf(f, 1).from).toBe('P <noreply@rsv.pizza>');
    expect(bodyOf(f, 1).reply_to).toBe('hi@p.com'); // reply_to kept on the retry
    expect(mockPrisma.eventSeries.updateMany).toHaveBeenCalledWith({ where: { id: 's1' }, data: { emailDomainVerifiedAt: null } });
    expect(inval).toHaveBeenCalled();
  });

  it('does not retry on an unrelated failure or status', async () => {
    const f = vi.fn().mockResolvedValue(fail(422, 'Invalid `to` field'));
    const r = await sendBrandedEmail({ site: partner, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValue(fail(500, 'domain is not verified'));
    await sendBrandedEmail({ site: partner, apiKey: 'k', payload: PAYLOAD, fetchImpl: g as any });
    expect(g).toHaveBeenCalledTimes(1);
    expect(mockPrisma.eventSeries.updateMany).not.toHaveBeenCalled();
  });

  it('does not retry when already on the fallback sender', async () => {
    const f = vi.fn().mockResolvedValue(fail(403, 'domain is not verified'));
    const site = { fromEmail: 'P <noreply@rsv.pizza>', fallbackFrom: 'P <noreply@rsv.pizza>', seriesId: 's1' };
    await sendBrandedEmail({ site, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(f).toHaveBeenCalledTimes(1);
    expect(mockPrisma.eventSeries.updateMany).not.toHaveBeenCalled();
  });

  it('does not retry for an unbranded site (no fallbackFrom)', async () => {
    const f = vi.fn().mockResolvedValue(fail(403, 'domain is not verified'));
    await sendBrandedEmail({ site: { fromEmail: 'RSV.Pizza <noreply@rsv.pizza>' }, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('still returns the retry response when the DB clear fails', async () => {
    mockPrisma.eventSeries.updateMany.mockRejectedValue(new Error('db'));
    const f = vi.fn().mockResolvedValueOnce(fail(403, 'domain is not verified')).mockResolvedValueOnce(ok());
    const r = await sendBrandedEmail({ site: partner, apiKey: 'k', payload: PAYLOAD, fetchImpl: f as any });
    expect(r.ok).toBe(true);
  });
});

describe('isUnverifiedDomainError', () => {
  it.each([
    [403, 'The send.p.com domain is not verified'],
    [422, 'Your domain is unverified'],
    [403, 'You can only send testing emails; verify your domain'],
  ])('%s %s', (s, t) => expect(isUnverifiedDomainError(s, t)).toBe(true));
  it.each([[500, 'domain is not verified'], [403, 'API key is invalid'], [429, 'rate limit']])('%s %s is not', (s, t) =>
    expect(isUnverifiedDomainError(s, t)).toBe(false));
});
