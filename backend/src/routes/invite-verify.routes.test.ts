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
  resetRsvpCodeLimits,
  RSVP_CODE_PER_EMAIL_IP,
  RSVP_CODE_PER_EMAIL_HOUR,
  MAX_CODE_ATTEMPTS,
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
  mockPrisma.magicLink.create.mockImplementation(({ data }: any) => {
    const row = { id: `ml-${links.size}`, used: false, attempts: 0, lockedAt: null, user: null, ...data };
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
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_ID },
        data: expect.objectContaining({ status: 'CONFIRMED', submittedVia: 'rsvp' }),
      }),
    );
    expect(mockPrisma.magicLink.create).not.toHaveBeenCalled();
    expect(resendSends()).toHaveLength(0);
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

  it('a rate-limited request gets the same 202 as one that sent a code', async () => {
    setup();
    const first = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    for (let i = 1; i < RSVP_CODE_PER_EMAIL_IP; i++) await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    const limited = await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    expect(limited.status).toBe(first.status);
    expect(limited.body).toEqual(first.body);
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

describe('code send rate limits', () => {
  it(`at most ${RSVP_CODE_PER_EMAIL_IP} codes per email + IP per window`, async () => {
    setup();
    for (let i = 0; i < RSVP_CODE_PER_EMAIL_IP + 3; i++) {
      const r = await request(app()).post('/api/rsvp/abc123/guest').set('X-Forwarded-For', '1.2.3.4').send(CODE_BODY);
      expect(r.status).toBe(202);
    }
    expect(mockPrisma.magicLink.create).toHaveBeenCalledTimes(RSVP_CODE_PER_EMAIL_IP);
    expect(resendSends()).toHaveLength(RSVP_CODE_PER_EMAIL_IP);

    // Another IP is a separate bucket, but still bounded by the per-email hourly cap below.
    await request(app()).post('/api/rsvp/abc123/guest').set('X-Forwarded-For', '5.6.7.8').send(CODE_BODY);
    expect(mockPrisma.magicLink.create).toHaveBeenCalledTimes(RSVP_CODE_PER_EMAIL_IP + 1);
  });

  it(`no send once the email has ${RSVP_CODE_PER_EMAIL_HOUR} sign-in codes in the last hour (any IP)`, async () => {
    setup();
    mockPrisma.magicLink.count.mockResolvedValue(RSVP_CODE_PER_EMAIL_HOUR);
    const r = await request(app()).post('/api/rsvp/abc123/guest').set('X-Forwarded-For', '9.9.9.9').send(CODE_BODY);
    expect(r.status).toBe(202);
    expect(mockPrisma.magicLink.create).not.toHaveBeenCalled();
    expect(resendSends()).toHaveLength(0);
    expect(mockPrisma.magicLink.count).toHaveBeenCalledWith({
      where: { email: 'ivy@example.com', createdAt: { gte: expect.any(Date) } },
    });
  });
});

describe('POST /api/auth/verify-code bound to an email', () => {
  async function getCode(existing: Partial<typeof INVITED> = {}) {
    setup({ existing });
    await request(app()).post('/api/rsvp/abc123/guest').send(CODE_BODY);
    return lastCode();
  }

  it('a wrong code: 401 INVALID_CODE, counted against that email, no login', async () => {
    const code = await getCode();
    const wrong = code === '123456' ? '654321' : '123456';
    const res = await request(app()).post('/api/auth/verify-code').send({ code: wrong, email: 'ivy@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CODE');
    expect(res.body.accessToken).toBeUndefined();
    expect(mockPrisma.magicLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'ivy@example.com' }), data: { attempts: { increment: 1 } } }),
    );
    expect(mockPrisma.magicLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ attempts: { gte: MAX_CODE_ATTEMPTS } }), data: { lockedAt: expect.any(Date) } }),
    );
  });

  it("someone else's valid code is INVALID_CODE for this email (same answer as a code that doesn't exist)", async () => {
    const code = await getCode();
    const other = await request(app()).post('/api/auth/verify-code').send({ code, email: 'mallory@example.com' });
    const missing = await request(app()).post('/api/auth/verify-code').send({ code: '000000', email: 'mallory@example.com' });
    expect(other.status).toBe(401);
    expect(other.body).toEqual(missing.body);
    expect(mockPrisma.magicLink.update).not.toHaveBeenCalled();
  });

  it('an expired code: 401 CODE_EXPIRED', async () => {
    const code = await getCode();
    links.get(code).expiresAt = new Date(Date.now() - 1000);
    const res = await request(app()).post('/api/auth/verify-code').send({ code, email: 'ivy@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('a locked code (too many wrong guesses): 429 CODE_LOCKED even when right', async () => {
    const code = await getCode();
    links.get(code).lockedAt = new Date();
    const res = await request(app()).post('/api/auth/verify-code').send({ code, email: 'ivy@example.com' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('CODE_LOCKED');
  });

  it('a used code: 401 CODE_USED', async () => {
    const code = await getCode();
    links.get(code).used = true;
    const res = await request(app()).post('/api/auth/verify-code').send({ code, email: 'IVY@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CODE_USED');
  });

  it('callers that send only the code behave as before', async () => {
    const code = await getCode();
    const res = await request(app()).post('/api/auth/verify-code').send({ code });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(mockPrisma.magicLink.updateMany).not.toHaveBeenCalled();
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
    expect(mockPrisma.guest.update).toHaveBeenCalledTimes(1);
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
