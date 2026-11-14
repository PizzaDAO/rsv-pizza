/**
 * invite-verify: closes the gap #1240 left open. A host invite (status INVITED) can no
 * longer be completed by a logged-out caller who merely knows the invitee's email.
 *   - Invite emails carry the invitee's guest token on the RSVP link (?t=); with it, a
 *     logged-out invitee completes their invite instantly.
 *   - Anyone else submitting an email that is already on the party (RSVP'd, invited,
 *     waitlisted, rejected) gets an inline sign-in code step (202 verificationRequired),
 *     identical for every kind of row. The code is the normal sign-in code email; entering
 *     it (POST /api/auth/verify-code with the email) logs them in, and the retried RSVP
 *     runs as the owner. Sends are rate-limited; wrong codes lock the email's codes.
 *   - Brand-new emails still RSVP instantly.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-invite-verify-0123456789abcdef';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  slugAlias: { findUnique: vi.fn(() => Promise.resolve(null)) },
  admin: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  magicLink: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('../services/privy.service.js', () => ({ createEmbeddedWalletForGuest: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../helpers/partyAccess.js', () => ({ canUserAccessTab: vi.fn(() => Promise.resolve(true)) }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import rsvpRoutes, { verificationRequiredResponse } from './rsvp.routes.js';
import authRoutes from './auth.routes.js';
import v1PartiesRoutes from './v1/parties.js';
import { buildInviteEmail } from './v1/guests.js';
import { errorHandler } from '../middleware/error.js';
import { signGuestToken, verifyGuestToken } from '../lib/guestToken.js';
import {
  resetCodeLimits as resetRsvpCodeLimits,
  SEND_PER_EMAIL_IP as RSVP_CODE_PER_EMAIL_IP,
  SEND_PER_EMAIL_HOUR,
  FAIL_PER_IP,
  FAIL_PER_EMAIL_IP,
  EMAIL_UNDER_ATTACK_FAILS,
  takeCodeSend,
  MINT_PER_EMAIL_WINDOW,
} from '../lib/loginCode.js';

function app() {
  const a = express();
  a.set('trust proxy', true);
  a.use(express.json());
  a.use('/api/rsvp', rsvpRoutes);
  a.use('/api/auth', authRoutes);
  a.use('/api/v1/parties', v1PartiesRoutes);
  a.use(errorHandler);
  return a;
}

const auth = (email: string, userId = 'u1') => ({
  Authorization: `Bearer ${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' })}`,
});

const PARTY_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const NEW_ID = '33333333-3333-4333-8333-333333333333';

const PARTY = {
  id: PARTY_ID,
  name: 'Test Party',
  date: new Date('2026-06-15T18:00:00Z'),
  timezone: 'America/New_York',
  address: '1 Pizza St',
  customUrl: null as string | null,
  inviteCode: 'abc123',
  eventImageUrl: null,
  eventSeriesId: null,
  rsvpClosedAt: null,
  cancelledAt: null,
  maxGuests: null as number | null,
  requireApproval: false,
  userId: 'host-1',
  user: { name: 'Host' },
  _count: { guests: 1 },
};

const INVITED = {
  id: EXISTING_ID,
  name: 'Ivy Invitee',
  email: 'ivy@example.com',
  ethereumAddress: null as string | null,
  status: 'INVITED',
  approved: null as boolean | null,
  submittedVia: 'invite',
};

const BODY = { name: 'Ivy', email: 'Ivy@Example.com', dietaryRestrictions: ['Vegan'] };
const CODE_BODY = { ...BODY, codeStep: true };

/** magic_links rows created in this test, by code. */
let links: Map<string, any>;

function setup(opts: { party?: Partial<typeof PARTY>; existing?: Partial<typeof INVITED> | null } = {}) {
  mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, ...opts.party });
  mockPrisma.guest.count.mockResolvedValue(0);
  mockPrisma.guest.aggregate.mockResolvedValue({ _max: { waitlistPosition: 3 } });
  mockPrisma.guest.findFirst.mockResolvedValue(opts.existing === null ? null : { ...INVITED, ...opts.existing });
  mockPrisma.guest.create.mockImplementation(({ data }: any) => Promise.resolve({ id: NEW_ID, ...data }));
  mockPrisma.guest.update.mockImplementation(({ where, data }: any) => Promise.resolve({ ...INVITED, id: where.id, ...data }));
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-user', name: null, ...data }));
  mockPrisma.magicLink.count.mockResolvedValue(0);
  mockPrisma.magicLink.findFirst.mockImplementation(({ where }: any) => {
    const live = [...links.values()]
      .filter((l) => l.email === where.email && !l.used && !l.lockedAt && l.expiresAt > new Date())
      .sort((a, b) => b.createdAt - a.createdAt);
    return Promise.resolve(live[0] ?? null);
  });
  mockPrisma.magicLink.create.mockImplementation(({ data }: any) => {
    const row = { id: `ml-${links.size}`, used: false, attempts: 0, lockedAt: null, user: null, createdAt: Date.now() + links.size, ...data };
    links.set(data.code, row);
    return Promise.resolve(row);
  });
  mockPrisma.magicLink.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.code ? links.get(where.code) ?? null : null),
  );
  mockPrisma.magicLink.update.mockResolvedValue({});
  mockPrisma.magicLink.updateMany.mockResolvedValue({ count: 1 });
}

/** Resend calls made so far (to, subject). */
function resendSends() {
  return mockFetch.mock.calls
    .filter(([url]) => String(url).includes('api.resend.com'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function lastCode(): string {
  const created = mockPrisma.magicLink.create.mock.calls;
  return created[created.length - 1][0].data.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  links = new Map();
  resetRsvpCodeLimits();
  process.env.RESEND_API_KEY = 're_test';
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'resend-1' }), text: async () => '' });
  mockPrisma.admin.findUnique.mockResolvedValue(null);
  mockPrisma.slugAlias.findUnique.mockResolvedValue(null);
});

afterAll(() => {
  delete process.env.RESEND_API_KEY;
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

describe('invite links carry the invitee token', () => {
  it('buildInviteEmail puts ?t=<guest token> on the RSVP link when the guest row is known', () => {
    const { html } = buildInviteEmail(
      { name: 'P', date: null, address: null, inviteCode: 'abc123', customUrl: 'my-party', timezone: null },
      { name: 'Ivy', email: 'ivy@example.com', id: EXISTING_ID },
      undefined,
      'https://rsv.pizza',
    );
    expect(html).toContain(`href="https://rsv.pizza/my-party?t=${signGuestToken(EXISTING_ID)}"`);
    // Nothing third-party sees it: no QR service in the invite email.
    expect(html).not.toContain('qrserver');
  });

  it('no guest row (testOnly send) means no token on the link', () => {
    const { html } = buildInviteEmail(
      { name: 'P', date: null, address: null, inviteCode: 'abc123', customUrl: null, timezone: null },
      { name: 'Ivy', email: 'ivy@example.com' },
    );
    expect(html).toContain('href="https://rsv.pizza/abc123"');
    expect(html).not.toContain('?t=');
  });

  it('bulk-invite emails each invitee a link with THEIR OWN token', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY });
    mockPrisma.guest.findMany.mockResolvedValue([]);
    let n = 0;
    const ids = [EXISTING_ID, OTHER_ID];
    mockPrisma.guest.create.mockImplementation(({ data }: any) => Promise.resolve({ id: ids[n++], ...data }));
    const res = await request(app())
      .post(`/api/v1/parties/${PARTY_ID}/guests/bulk-invite`)
      .set(auth('host@example.com', 'host-1'))
      .send({ guests: [{ name: 'Ivy', email: 'ivy@example.com' }, { name: 'Oz', email: 'oz@example.com' }] });
    expect(res.status).toBe(200);
    const sends = resendSends();
    expect(sends).toHaveLength(2);
    for (const s of sends) {
      const id = mockPrisma.guest.create.mock.calls.find(([a]: any) => a.data.email === s.to[0]);
      const guestId = mockPrisma.guest.create.mock.results[mockPrisma.guest.create.mock.calls.indexOf(id!)].value;
      const created = await guestId;
      expect(s.html).toContain(`?t=${signGuestToken(created.id)}`);
    }
    expect(sends[0].html).not.toEqual(sends[1].html);
  });
});

describe('POST /api/rsvp/:inviteCode/guest: completing a host invite', () => {
  it.each([
    ['?t= query', (r: request.Test) => r.query({ t: signGuestToken(EXISTING_ID) }).send(CODE_BODY)],
    ['X-Guest-Token header', (r: request.Test) => r.set('X-Guest-Token', signGuestToken(EXISTING_ID)).send(CODE_BODY)],
    ['body guestToken', (r: request.Test) => r.send({ ...CODE_BODY, guestToken: signGuestToken(EXISTING_ID) })],
  ])('logged out with the invite token (%s): completes the INVITED row like a new RSVP', async (_l, go) => {
    setup();
    const res = await go(request(app()).post('/api/rsvp/abc123/guest'));
    expect(res.status).toBe(201);
    expect(res.body.guest).toEqual({ id: EXISTING_ID, name: 'Ivy', status: 'CONFIRMED', waitlistPosition: null });
    expect(verifyGuestToken(EXISTING_ID, res.body.guestToken)).toBe(true);
    // Conditional on still being INVITED, so only one request can complete it.
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_ID, status: 'INVITED' },
        data: expect.objectContaining({ status: 'CONFIRMED', submittedVia: 'rsvp' }),
      }),
    );
    expect(mockPrisma.magicLink.create).not.toHaveBeenCalled();
    // The normal new-RSVP confirmation email, and no sign-in code.
    const sends = resendSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toBe("You're going to Test Party! 🍕");
  });

  describe('completing an invite gets the same side effects as a brand-new RSVP, exactly once', () => {
    const complete = (extra: Record<string, unknown> = {}) =>
      request(app()).post('/api/rsvp/abc123/guest').send({ ...CODE_BODY, guestToken: signGuestToken(EXISTING_ID), ...extra });

    it.each([
      ['open event', {}, "You're going to Test Party! 🍕"],
      ['approval-required event', { requireApproval: true }, 'RSVP Submitted for Test Party - Pending Approval'],
      ['event at capacity', { maxGuests: 1 }, "You're #4 on the waitlist for Test Party"],
    ])('%s: same email template a new RSVP gets', async (_l, party, subject) => {
      // A brand-new RSVP first, for the reference subject/sender.
      setup({ party, existing: null });
      if ((party as any).maxGuests) mockPrisma.guest.count.mockResolvedValue(5);
      await request(app()).post('/api/rsvp/abc123/guest').send({ ...CODE_BODY, email: 'new@example.com' });
      const fresh = resendSends()[0];
      mockFetch.mockClear();

      setup({ party });
      if ((party as any).maxGuests) mockPrisma.guest.count.mockResolvedValue(5);
      const res = await complete();
      expect(res.status).toBe(201);
      const sends = resendSends();
      expect(sends).toHaveLength(1);
      expect(sends[0].subject).toBe(subject);
      expect(sends[0].subject).toBe(fresh.subject);
      expect(sends[0].from).toBe(fresh.from);
      expect(sends[0].to.map((t: string) => t.toLowerCase())).toEqual(['ivy@example.com']);
    });

    it('provisions a Privy wallet like a new RSVP (no wallet submitted)', async () => {
      const privy = await import('../services/privy.service.js');
      (privy.createEmbeddedWalletForGuest as any).mockResolvedValueOnce({ walletAddress: '0xABC', privyUserId: 'p-1' });
      setup();
      await complete();
      expect(privy.createEmbeddedWalletForGuest).toHaveBeenCalledWith('ivy@example.com', 'Ivy');
      expect(mockPrisma.guest.update).toHaveBeenCalledWith({
        where: { id: EXISTING_ID },
        data: { ethereumAddress: '0xabc', privyUserId: 'p-1', walletSource: 'privy-embedded' },
      });
    });

    it('a later re-submit by the owner (row no longer INVITED) does not resend or re-provision', async () => {
      const privy = await import('../services/privy.service.js');
      setup({ existing: { status: 'CONFIRMED', submittedVia: 'rsvp' } });
      const res = await complete();
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);
      expect(resendSends()).toHaveLength(0);
      expect(privy.createEmbeddedWalletForGuest).not.toHaveBeenCalled();
    });

    it('two concurrent completions: only the one that flips INVITED sends; the other is a plain update', async () => {
      setup();
      // The second request's conditional update finds the row already completed (P2025).
      let flipped = false;
      mockPrisma.guest.update.mockImplementation(({ where, data }: any) => {
        if (where.status === 'INVITED') {
          if (flipped) return Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' }));
          flipped = true;
        }
        return Promise.resolve({ ...INVITED, id: where.id, ...data });
      });
      const a = await complete();
      mockFetch.mockClear();
      const b = await complete();
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.body.updated).toBe(true);
      expect(resendSends()).toHaveLength(0);
    });

    it('a non-owner (no token) gets only the sign-in code email: no confirmation, no wallet', async () => {
      const privy = await import('../services/privy.service.js');
      setup();
      const res = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
      expect(res.status).toBe(202);
      const sends = resendSends();
      expect(sends).toHaveLength(1);
      expect(sends[0].subject).toMatch(/^RSV\.Pizza Code \d{6}$/);
      expect(privy.createEmbeddedWalletForGuest).not.toHaveBeenCalled();
    });

    it('a rejected invite (approved=false) completed by its owner: no reactivation, nothing sent', async () => {
      setup({ existing: { approved: false } });
      const res = await complete();
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(false);
      expect(mockPrisma.guest.update).not.toHaveBeenCalled();
      expect(resendSends()).toHaveLength(0);
    });
  });

  it('the token answers with the same shape a brand-new RSVP gets (approval-required event)', async () => {
    setup({ party: { requireApproval: true }, existing: null });
    const fresh = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    setup({ party: { requireApproval: true } });
    const viaInvite = await request(app())
      .post('/api/rsvp/abc123/guest')
      .send({ ...CODE_BODY, guestToken: signGuestToken(EXISTING_ID) });
    expect(viaInvite.status).toBe(fresh.status);
    expect(Object.keys(viaInvite.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(viaInvite.body.guest.status).toBe('PENDING');
  });

  it("another guest's token does not open this row: code step, nothing written", async () => {
    setup();
    const res = await request(app())
      .post('/api/rsvp/abc123/guest')
      .send({ ...CODE_BODY, guestToken: signGuestToken(OTHER_ID) });
    expect(res.status).toBe(202);
    expect(res.body.verificationRequired).toBe(true);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('logged out WITHOUT a token: 202 code step, no write, the sign-in code email goes to the address', async () => {
    setup();
    const res = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    expect(res.status).toBe(202);
    expect(res.body).toEqual(verificationRequiredResponse('ivy@example.com'));
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    expect(mockPrisma.guest.create).not.toHaveBeenCalled();
    // Nothing about the existing guest leaks.
    expect(JSON.stringify(res.body)).not.toContain(EXISTING_ID);
    expect(JSON.stringify(res.body)).not.toContain('Ivy Invitee');
    expect(res.body.guestToken).toBeUndefined();
    // The existing sign-in code email, nothing new.
    const sends = resendSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toEqual(['ivy@example.com']);
    expect(sends[0].subject).toBe(`RSV.Pizza Code ${lastCode()}`);
    expect(sends[0].html).toContain('YOUR SIGN-IN CODE');
  });

  it('a logged-in caller with a different email also gets the code step and writes nothing', async () => {
    setup({ existing: { status: 'CONFIRMED', submittedVia: 'link' } });
    const res = await request(app()).post('/api/rsvp/abc123/guest').set(auth('mallory@example.com')).send(CODE_BODY);
    expect(res.status).toBe(202);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('a brand-new email still RSVPs instantly (no code, no sign-in email)', async () => {
    setup({ existing: null });
    const res = await request(app()).post('/api/rsvp/abc123/guest').send({ ...CODE_BODY, email: 'new@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.guest.id).toBe(NEW_ID);
    expect(res.body.verificationRequired).toBeUndefined();
    expect(mockPrisma.magicLink.create).not.toHaveBeenCalled();
  });
});

describe('the code step does not say WHICH kind of row the email has', () => {
  const kinds: Array<[string, Partial<typeof INVITED>]> = [
    ['host invite', { status: 'INVITED', submittedVia: 'invite' }],
    ['confirmed RSVP', { status: 'CONFIRMED', submittedVia: 'link' }],
    ['pending RSVP', { status: 'PENDING', submittedVia: 'link' }],
    ['waitlisted RSVP', { status: 'WAITLISTED', submittedVia: 'link' }],
    ['rejected RSVP', { status: 'DECLINED', approved: false, submittedVia: 'link' }],
    ['rejected invite', { status: 'INVITED', approved: false, submittedVia: 'invite' }],
  ];

  it('every kind of existing row gets the byte-identical 202 and the same single email', async () => {
    const bodies: string[] = [];
    for (const [, existing] of kinds) {
      setup({ existing });
      resetRsvpCodeLimits();
      mockFetch.mockClear();
      const res = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
      expect(res.status).toBe(202);
      expect(resendSends()).toHaveLength(1);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('an over-budget requester gets the same 429 for every kind of row (no extra information)', async () => {
    const bodies: string[] = [];
    for (const [, existing] of kinds) {
      setup({ existing });
      resetRsvpCodeLimits();
      for (let i = 0; i < RSVP_CODE_PER_EMAIL_IP; i++) await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
      const limited = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('CODE_SEND_LIMIT');
      bodies.push(JSON.stringify(limited.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('legacy clients (no codeStep flag) keep the #1240 decoy for every kind of row, nothing written', async () => {
    for (const [, existing] of kinds) {
      setup({ existing });
      const res = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);
      expect(res.status).toBe(201);
      expect(res.body.guest.id).not.toBe(EXISTING_ID);
      expect(verifyGuestToken(EXISTING_ID, res.body.guestToken)).toBe(false);
    }
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    expect(mockPrisma.magicLink.create).not.toHaveBeenCalled();
  });
});

describe('code send limits (shared by /magic-link and the RSVP code step, charged to the requester)', () => {
  const rsvpFrom = (ip: string) => request(app()).post('/api/rsvp/abc123/guest').set('X-Forwarded-For', ip).send(CODE_BODY);
  const magicFrom = (ip: string, email = 'ivy@example.com') =>
    request(app()).post('/api/auth/magic-link').set('X-Forwarded-For', ip).send({ email });

  it(`at most ${RSVP_CODE_PER_EMAIL_IP} codes per email + IP per window; then 429 "try again in a few minutes"`, async () => {
    setup();
    for (let i = 0; i < RSVP_CODE_PER_EMAIL_IP; i++) expect((await rsvpFrom('1.2.3.4')).status).toBe(202);
    const limited = await rsvpFrom('1.2.3.4');
    expect(limited.status).toBe(429);
    expect(limited.body.error.message).toMatch(/Try again in a few minutes/);
    expect(mockPrisma.magicLink.create).toHaveBeenCalledTimes(RSVP_CODE_PER_EMAIL_IP);
    expect(resendSends()).toHaveLength(RSVP_CODE_PER_EMAIL_IP);
  });

  it('/magic-link and the RSVP code step share the (email, IP) budget', async () => {
    setup();
    for (let i = 0; i < RSVP_CODE_PER_EMAIL_IP; i++) expect((await magicFrom('1.2.3.4')).status).toBe(200);
    expect((await rsvpFrom('1.2.3.4')).status).toBe(429);
    expect((await magicFrom('1.2.3.4')).status).toBe(429);
    // Another address from the same IP is its own budget.
    expect((await magicFrom('1.2.3.4', 'other@example.com')).status).toBe(200);
  });

  it("an attacker spamming the victim's address can't use up the victim's own sends", async () => {
    setup();
    // Attacker burns their budget from one IP and the email is over the hourly cap.
    for (let i = 0; i < RSVP_CODE_PER_EMAIL_IP; i++) await magicFrom('6.6.6.6');
    mockPrisma.magicLink.count.mockResolvedValue(SEND_PER_EMAIL_HOUR + 50);
    expect((await magicFrom('6.6.6.6')).status).toBe(429);
    // The victim, from their own IP, still gets a code (both entry points).
    expect((await rsvpFrom('10.0.0.1')).status).toBe(202);
    expect((await magicFrom('10.0.0.2')).status).toBe(200);
  });

  it(`over ${SEND_PER_EMAIL_HOUR}/hour for the email, each (email, IP) gets just one per window`, async () => {
    setup();
    mockPrisma.magicLink.count.mockResolvedValue(SEND_PER_EMAIL_HOUR);
    expect((await rsvpFrom('9.9.9.9')).status).toBe(202);
    expect((await rsvpFrom('9.9.9.9')).status).toBe(429);
    expect(mockPrisma.magicLink.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.magicLink.count).toHaveBeenCalledWith({
      where: { email: 'ivy@example.com', createdAt: { gte: expect.any(Date) } },
    });
  });

  it(`at most ${MINT_PER_EMAIL_WINDOW} distinct live codes per email: past that the newest live code is re-sent (still delivered, not multiplied)`, async () => {
    setup();
    // Three IPs mint three codes.
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      mockPrisma.magicLink.count.mockResolvedValue(links.size);
      expect((await magicFrom(ip)).status).toBe(200);
    }
    expect(mockPrisma.magicLink.create).toHaveBeenCalledTimes(MINT_PER_EMAIL_WINDOW);
    const newest = lastCode();
    // A fourth requester (e.g. the real owner) still gets an email, carrying the newest live code.
    mockPrisma.magicLink.count.mockResolvedValue(links.size);
    mockFetch.mockClear();
    expect((await rsvpFrom('10.0.0.1')).status).toBe(202);
    expect(mockPrisma.magicLink.create).toHaveBeenCalledTimes(MINT_PER_EMAIL_WINDOW);
    const sends = resendSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toBe(`RSV.Pizza Code ${newest}`);
  });

  it('race: concurrent requests reserve synchronously, so no more than the budget get through', async () => {
    setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockPrisma.magicLink.count.mockImplementation(async () => { await gate; return 0; });
    const pending = Array.from({ length: 8 }, () => takeCodeSend('race@example.com', '7.7.7.7'));
    release();
    const results = await Promise.all(pending);
    expect(results.filter(Boolean)).toHaveLength(RSVP_CODE_PER_EMAIL_IP);
  });

  it('a send the DB check refuses is rolled back (does not use up the budget)', async () => {
    setup();
    mockPrisma.magicLink.count.mockResolvedValue(0);
    expect(await takeCodeSend('rb@example.com', '8.8.8.8')).toBe(true);
    // Over the hourly cap: this caller already sent, so refused, and the refusal isn't charged.
    mockPrisma.magicLink.count.mockResolvedValue(SEND_PER_EMAIL_HOUR);
    expect(await takeCodeSend('rb@example.com', '8.8.8.8')).toBe(false);
    mockPrisma.magicLink.count.mockResolvedValue(0);
    expect(await takeCodeSend('rb@example.com', '8.8.8.8')).toBe(true);
    expect(await takeCodeSend('rb@example.com', '8.8.8.8')).toBe(true);
    expect(await takeCodeSend('rb@example.com', '8.8.8.8')).toBe(false);
  });
});

describe('POST /api/auth/verify-code bound to an email', () => {
  async function getCode(existing: Partial<typeof INVITED> = {}) {
    setup({ existing });
    await request(app()).post('/api/rsvp/abc123/guest').set('X-Forwarded-For', '10.0.0.1').send(CODE_BODY);
    return lastCode();
  }
  const verify = (ip: string, body: Record<string, unknown>) =>
    request(app()).post('/api/auth/verify-code').set('X-Forwarded-For', ip).send(body);
  const wrongOf = (code: string) => (code === '123456' ? '654321' : '123456');

  it('a wrong code: 401 INVALID_CODE, never locks the stored code', async () => {
    const code = await getCode();
    const res = await verify('6.6.6.6', { code: wrongOf(code), email: 'ivy@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CODE');
    expect(res.body.accessToken).toBeUndefined();
    // Only the cross-instance "under attack" counter moves; nothing sets locked_at.
    expect(mockPrisma.magicLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'ivy@example.com' }), data: { attempts: { increment: 1 } } }),
    );
    for (const [arg] of mockPrisma.magicLink.updateMany.mock.calls) expect(arg.data).not.toHaveProperty('lockedAt');
    expect(links.get(code).lockedAt).toBeNull();
  });

  it(`after ${FAIL_PER_EMAIL_IP} wrong codes for (email, IP) that caller gets 429, and is refused BEFORE the lookup (even with the right code)`, async () => {
    const code = await getCode();
    for (let i = 0; i < FAIL_PER_EMAIL_IP; i++) {
      expect((await verify('6.6.6.6', { code: wrongOf(code), email: 'ivy@example.com' })).status).toBe(401);
    }
    mockPrisma.magicLink.findUnique.mockClear();
    const blocked = await verify('6.6.6.6', { code, email: 'ivy@example.com' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('VERIFY_RATE_LIMITED');
    expect(blocked.body.accessToken).toBeUndefined();
    expect(mockPrisma.magicLink.findUnique).not.toHaveBeenCalled();
  });

  it("an attacker's wrong guesses from another IP don't block the victim's correct code", async () => {
    const code = await getCode();
    for (let i = 0; i < FAIL_PER_EMAIL_IP + 5; i++) {
      await verify('6.6.6.6', { code: wrongOf(code), email: 'ivy@example.com' });
    }
    // Email is now "under attack" (cross-instance signal says so too).
    mockPrisma.magicLink.count.mockResolvedValue(1);
    const ok = await verify('10.0.0.1', { code, email: 'ivy@example.com' });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.accessToken).toBe('string');
    // ...and the normal code-only login works for the victim too.
    links.get(code).used = false;
    expect((await verify('10.0.0.9', { code })).status).toBe(200);
  });

  it(`once the email has ${EMAIL_UNDER_ATTACK_FAILS}+ wrong guesses from anyone, each (email, IP) gets only one wrong try`, async () => {
    const code = await getCode();
    mockPrisma.magicLink.count.mockResolvedValue(1); // some live code has attempts >= threshold
    expect((await verify('5.5.5.5', { code: wrongOf(code), email: 'ivy@example.com' })).status).toBe(401);
    expect((await verify('5.5.5.5', { code: wrongOf(code), email: 'ivy@example.com' })).status).toBe(429);
    expect(mockPrisma.magicLink.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ email: 'ivy@example.com', attempts: { gte: EMAIL_UNDER_ATTACK_FAILS } }),
    });
  });

  it("someone else's valid code is INVALID_CODE for this email (same answer as a code that doesn't exist)", async () => {
    const code = await getCode();
    const other = await verify('6.6.6.6', { code, email: 'mallory@example.com' });
    const missing = await verify('6.6.6.6', { code: '000000', email: 'mallory@example.com' });
    expect(other.status).toBe(401);
    expect(other.body).toEqual(missing.body);
    expect(mockPrisma.magicLink.update).not.toHaveBeenCalled();
  });

  it('an expired code: 401 CODE_EXPIRED', async () => {
    const code = await getCode();
    links.get(code).expiresAt = new Date(Date.now() - 1000);
    const res = await verify('10.0.0.1', { code, email: 'ivy@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('a used code: 401 CODE_USED', async () => {
    const code = await getCode();
    links.get(code).used = true;
    const res = await verify('10.0.0.1', { code, email: 'IVY@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CODE_USED');
  });

  it('callers that send only the code still work and touch no stored row on success', async () => {
    const code = await getCode();
    const res = await verify('10.0.0.1', { code });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(mockPrisma.magicLink.updateMany).not.toHaveBeenCalled();
  });

  it(`code-only path: ${FAIL_PER_IP} wrong codes per IP, then 429 for that IP only`, async () => {
    const code = await getCode();
    for (let i = 0; i < FAIL_PER_IP; i++) {
      expect((await verify('4.4.4.4', { code: String(100000 + i) === code ? '999999' : String(100000 + i) })).status).toBe(401);
    }
    expect((await verify('4.4.4.4', { code })).status).toBe(429);
    // Code-only failures never touch the stored rows.
    expect(mockPrisma.magicLink.updateMany).not.toHaveBeenCalled();
    // Another IP is unaffected.
    expect((await verify('4.4.4.5', { code })).status).toBe(200);
  });

  it('the per-IP budget is shared across emails (one IP cannot spray many victims)', async () => {
    const code = await getCode();
    for (let i = 0; i < FAIL_PER_IP; i++) {
      await verify('3.3.3.3', { code: wrongOf(code), email: `v${i}@example.com` });
    }
    expect((await verify('3.3.3.3', { code, email: 'ivy@example.com' })).status).toBe(429);
  });
});

describe('full inline flow: submit, enter code, retry as the logged-in owner', () => {
  async function flow(existing: Partial<typeof INVITED>) {
    setup({ existing });
    const first = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    expect(first.status).toBe(202);
    const code = lastCode();

    const login = await request(app())
      .post('/api/auth/verify-code')
      .send({ code, email: first.body.email, name: 'Ivy' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('ivy@example.com');
    const claims = jwt.verify(login.body.accessToken, JWT_SECRET) as { email: string };
    expect(claims.email).toBe('ivy@example.com');
    expect(mockPrisma.magicLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: { used: true } }));

    const retry = await request(app())
      .post('/api/rsvp/abc123/guest')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .send(CODE_BODY);
    return retry;
  }

  it('host invite: the code completes it (201, new-RSVP shape, real id + token)', async () => {
    const retry = await flow({ status: 'INVITED', submittedVia: 'invite' });
    expect(retry.status).toBe(201);
    expect(retry.body.guest.id).toBe(EXISTING_ID);
    expect(retry.body.guest.status).toBe('CONFIRMED');
    expect(verifyGuestToken(EXISTING_ID, retry.body.guestToken)).toBe(true);
    // One completion (plus the Resend-id bookkeeping write from the confirmation email).
    expect(mockPrisma.guest.update.mock.calls.filter(([a]: any) => a.where.status === 'INVITED')).toHaveLength(1);
    const subjects = resendSends().map((s) => s.subject);
    expect(subjects.filter((s) => s.startsWith("You're going to"))).toHaveLength(1);
  });

  it('existing RSVP: the code lets the real owner update it (200 updated)', async () => {
    const retry = await flow({ status: 'CONFIRMED', submittedVia: 'link', name: 'Ivy Old' });
    expect(retry.status).toBe(200);
    expect(retry.body.updated).toBe(true);
    expect(retry.body.guest.id).toBe(EXISTING_ID);
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Ivy', dietaryRestrictions: ['Vegan'] }) }),
    );
  });

  it('the sign-in code links to the existing user when there is one (no duplicate user row)', async () => {
    setup();
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    expect(mockPrisma.magicLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'ivy@example.com', userId: 'existing-user' }) }),
    );
  });
});
