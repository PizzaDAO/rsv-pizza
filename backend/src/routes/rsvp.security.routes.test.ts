/**
 * Security regressions for the public RSVP routes (sec-rsvp-party):
 *  - guest/host-controlled text is HTML-escaped in every email; subjects can't carry CR/LF
 *  - capacity is re-checked under a per-party advisory lock (no overshoot / duplicate waitlist slot)
 *  - "send-confirmation" sends the status-appropriate email (or refuses)
 *  - webhooks never block the RSVP response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(() => Promise.resolve(null)) },
  party: { findUnique: vi.fn() },
  slugAlias: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  eventSeries: { findMany: vi.fn(() => Promise.resolve([])), findFirst: vi.fn() },
  $executeRaw: vi.fn(() => Promise.resolve(1)),
  $transaction(fn: any) { return fn(this); },
}));
process.env.JWT_SECRET ??= 'test-secret-rsvp-overwrite-fix-0123456789';
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('../services/privy.service.js', () => ({
  createEmbeddedWalletForGuest: vi.fn(),
  guestWalletsEnabled: () => false,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import rsvpRoutes from './rsvp.routes.js';
import { triggerWebhook } from '../services/webhook.service.js';
import { errorHandler } from '../middleware/error.js';
import { signGuestToken } from '../lib/guestToken.js';
import { _resetSiteBrandCache } from '../lib/siteBrand.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/rsvp', rsvpRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = {
  id: 'p1',
  name: 'Pizza Night',
  date: new Date('2026-06-15T18:00:00Z'),
  timezone: 'America/New_York',
  address: '1 Main St',
  customUrl: 'pizza-night',
  eventImageUrl: null,
  eventSeriesId: null,
  eventType: null,
  rsvpClosedAt: null,
  maxGuests: null,
  requireApproval: false,
  userId: 'owner-1',
  cancelledAt: null,
};

const resendCalls = () =>
  mockFetch.mock.calls
    .filter((c) => c[0] === 'https://api.resend.com/emails')
    .map((c) => JSON.parse(c[1].body as string));

beforeEach(() => {
  vi.clearAllMocks();
  _resetSiteBrandCache();
  process.env.RESEND_API_KEY = 're_test';
  process.env.FRONTEND_URL = 'https://rsv.pizza';
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }), text: async () => '', headers: new Headers() });
  mockPrisma.party.findUnique.mockResolvedValue(PARTY);
  mockPrisma.guest.findFirst.mockResolvedValue(null);
  mockPrisma.guest.count.mockResolvedValue(0);
  mockPrisma.guest.aggregate.mockResolvedValue({ _max: { waitlistPosition: null } });
  mockPrisma.guest.create.mockImplementation(async ({ data }: any) => ({ id: 'g-new', ...data }));
  mockPrisma.guest.update.mockResolvedValue({});
});

describe('email HTML injection', () => {
  const EVIL_NAME = '<a href="https://evil.example.org/login">Verify your account</a>';

  it('escapes the guest name, party name and address in the confirmation email', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      ...PARTY,
      name: 'Party <b>Bold</b>',
      address: '<img src=x onerror=alert(1)>',
    });
    const res = await request(app())
      .post('/api/rsvp/abc123/guest')
      .send({ name: EVIL_NAME, email: 'victim@example.org' });
    expect(res.status).toBe(201);
    const [mail] = resendCalls();
    expect(mail.html).not.toContain('<a href="https://evil.example.org');
    expect(mail.html).toContain('&lt;a href=&quot;https://evil.example.org/login&quot;&gt;');
    expect(mail.html).not.toContain('<b>Bold</b>');
    expect(mail.html).toContain('Party &lt;b&gt;Bold&lt;/b&gt;');
    expect(mail.html).not.toContain('<img src=x');
  });

  it('escapes the guest name in the waitlist email', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, maxGuests: 1 });
    mockPrisma.guest.count.mockResolvedValue(1);
    const res = await request(app())
      .post('/api/rsvp/abc123/guest')
      .send({ name: EVIL_NAME, email: 'victim@example.org' });
    expect(res.status).toBe(201);
    const [mail] = resendCalls();
    expect(mail.html).not.toContain('<a href="https://evil.example.org');
    expect(mail.html).toContain('&lt;a href=');
  });

  it('strips CR/LF from subjects', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, name: 'Line1\r\nBcc: attacker@example.org' });
    await request(app()).post('/api/rsvp/abc123/guest').send({ name: 'A', email: 'a@example.org' });
    const [mail] = resendCalls();
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain('Line1 Bcc: attacker@example.org');
  });
});

describe('capacity lock', () => {
  it('takes the per-party advisory lock before counting and creating', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, maxGuests: 10 });
    const res = await request(app()).post('/api/rsvp/abc123/guest').send({ name: 'A', email: 'a@example.org' });
    expect(res.status).toBe(201);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    const lockOrder = mockPrisma.$executeRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(mockPrisma.guest.create.mock.invocationCallOrder[0]);
    // the in-lock count is the one that decides the status
    const countOrders = mockPrisma.guest.count.mock.invocationCallOrder;
    expect(countOrders.some((o) => o > lockOrder)).toBe(true);
  });

  it('a seat taken by a concurrent RSVP between the first check and the lock waitlists this one', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, maxGuests: 1 });
    // first (unlocked) count sees a free seat; the in-lock count sees it taken
    mockPrisma.guest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    mockPrisma.guest.aggregate.mockResolvedValue({ _max: { waitlistPosition: 3 } });
    const res = await request(app()).post('/api/rsvp/abc123/guest').send({ name: 'Late', email: 'late@example.org' });
    expect(res.status).toBe(201);
    expect(mockPrisma.guest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED', waitlistPosition: 4 }) }),
    );
    expect(res.body.waitlisted).toBe(true);
    expect(res.body.waitlistPosition).toBe(4);
    expect(res.body.guest.status).toBe('WAITLISTED');
    // the waitlist email matches the final status
    expect(resendCalls()[0].subject).toContain('#4 on the waitlist');
  });
});

describe('send-confirmation is status-aware', () => {
  const send = (row: Record<string, unknown>) => {
    mockPrisma.guest.findFirst.mockResolvedValue({ id: 'g1', name: 'Gus', email: 'gus@example.org', approved: null, waitlistPosition: null, ...row });
    return request(app())
      .post('/api/rsvp/abc123/send-confirmation')
      .send({ guestId: 'g1', guestToken: signGuestToken('g1') });
  };

  it('CONFIRMED guests get the full "you\'re going" email with the QR', async () => {
    const res = await send({ status: 'CONFIRMED', approved: true });
    expect(res.status).toBe(200);
    const [mail] = resendCalls();
    expect(mail.subject).toContain("You're going to");
    expect(mail.attachments?.length).toBe(1);
  });

  it('PENDING guests get the pending email, no QR / check-in', async () => {
    const res = await send({ status: 'PENDING' });
    expect(res.status).toBe(200);
    const [mail] = resendCalls();
    expect(mail.subject).toContain('Pending Approval');
    expect(mail.attachments).toBeUndefined();
  });

  it('WAITLISTED guests get the waitlist email, no QR / address', async () => {
    const res = await send({ status: 'WAITLISTED', waitlistPosition: 2 });
    expect(res.status).toBe(200);
    const [mail] = resendCalls();
    expect(mail.subject).toContain('#2 on the waitlist');
    expect(mail.attachments).toBeUndefined();
    expect(mail.html).not.toContain('1 Main St');
  });

  it.each([
    ['rejected', { status: 'CONFIRMED', approved: false }],
    ['declined', { status: 'DECLINED' }],
    ['invited-only', { status: 'INVITED' }],
  ])('refuses %s guests (409, nothing sent)', async (_l, row) => {
    const res = await send(row);
    expect(res.status).toBe(409);
    expect(resendCalls()).toHaveLength(0);
  });
});

describe('webhooks do not block the RSVP response', () => {
  it('responds 201 even if webhook delivery never settles, and sends it to the party owner', async () => {
    vi.mocked(triggerWebhook).mockReturnValue(new Promise<void>(() => {}));
    const res = await request(app()).post('/api/rsvp/abc123/guest').send({ name: 'A', email: 'a@example.org' });
    expect(res.status).toBe(201);
    expect(triggerWebhook).toHaveBeenCalledWith('guest.registered', expect.anything(), 'owner-1');
  });

  it('a rejecting webhook does not fail the RSVP or leak an unhandled rejection', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(triggerWebhook).mockRejectedValue(new Error('hook down'));
    const res = await request(app()).post('/api/rsvp/abc123/guest').send({ name: 'A', email: 'a@example.org' });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    spy.mockRestore();
  });
});
