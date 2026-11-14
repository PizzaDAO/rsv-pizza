/**
 * rsvp-overwrite-fix: POST /api/rsvp/:inviteCode/guest no longer lets an anonymous caller
 * overwrite an existing RSVP, can't be used as an "is this email on the list" oracle, and no
 * longer hands out other guests' ids or names. Guest-scoped endpoints that used to accept a
 * bare guest id (raffle, quiz, discount, NFT bookkeeping, send-confirmation) now need the
 * per-guest token or a login as the guest.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-rsvp-overwrite-fix-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  slugAlias: { findUnique: vi.fn(() => Promise.resolve(null)) },
  admin: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  raffle: { findFirst: vi.fn() },
  raffleEntry: { findFirst: vi.fn(), create: vi.fn() },
  quizQuestion: { findMany: vi.fn() },
  quizAnswer: { upsert: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
// nft.routes.ts builds its own PrismaClient; hand it the same mock.
vi.mock('@prisma/client', async (orig) => ({
  ...(await orig<typeof import('@prisma/client')>()),
  PrismaClient: vi.fn(function () { return mockPrisma; }),
}));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('../services/privy.service.js', () => ({ createEmbeddedWalletForGuest: vi.fn(() => Promise.resolve(null)) }));
vi.mock('./scorecard.routes.js', () => ({ autoCompleteScorecardItem: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import rsvpRoutes from './rsvp.routes.js';
import raffleRoutes from './raffle.routes.js';
import { quizPublicRouter } from './quiz.routes.js';
import checkinRoutes from './checkin.routes.js';
import nftRoutes from './nft.routes.js';
import { errorHandler } from '../middleware/error.js';
import { signGuestToken, verifyGuestToken } from '../lib/guestToken.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/rsvp', rsvpRoutes);
  a.use('/api/parties', raffleRoutes);
  a.use('/api/events', quizPublicRouter);
  a.use('/api/checkin', checkinRoutes);
  a.use('/api/nft', nftRoutes);
  a.use(errorHandler);
  return a;
}

const auth = (email: string, userId = 'u1') => ({
  Authorization: `Bearer ${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' })}`,
});

const PARTY_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_ID = '22222222-2222-4222-8222-222222222222';
const NEW_ID = '33333333-3333-4333-8333-333333333333';

const PARTY = {
  id: PARTY_ID,
  name: 'Test Party',
  date: new Date('2026-06-15T18:00:00Z'),
  timezone: 'America/New_York',
  address: '1 Pizza St',
  customUrl: null,
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

const EXISTING = {
  id: EXISTING_ID,
  name: 'Alice Original',
  email: 'alice@example.com',
  ethereumAddress: '0x' + 'b'.repeat(40),
  status: 'CONFIRMED',
  approved: null as boolean | null,
  submittedVia: 'link',
};

const BODY = {
  name: 'Mallory',
  email: 'Alice@Example.com',
  ethereumAddress: '0x' + 'c'.repeat(40),
  dietaryRestrictions: ['Vegan'],
};

function setup(opts: { party?: Partial<typeof PARTY>; existing?: Partial<typeof EXISTING> | null } = {}) {
  mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, ...opts.party });
  mockPrisma.guest.count.mockResolvedValue(0);
  mockPrisma.guest.aggregate.mockResolvedValue({ _max: { waitlistPosition: 3 } });
  mockPrisma.guest.findFirst.mockResolvedValue(opts.existing === null ? null : { ...EXISTING, ...opts.existing });
  mockPrisma.guest.create.mockImplementation(({ data }: any) => Promise.resolve({ id: NEW_ID, ...data }));
  mockPrisma.guest.update.mockImplementation(({ where, data }: any) => Promise.resolve({ ...EXISTING, id: where.id, ...data }));
}

/** The response with the per-guest random parts blanked, for exact comparison. */
function shape(body: any) {
  return { ...body, guest: { ...body.guest, id: '<id>' }, guestToken: '<token>' };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  mockPrisma.admin.findUnique.mockResolvedValue(null);
  mockPrisma.slugAlias.findUnique.mockResolvedValue(null);
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

describe('POST /api/rsvp/:inviteCode/guest: duplicate email', () => {
  it('logged out: changes nothing and returns a fresh-RSVP response with no trace of the existing guest', async () => {
    setup();
    const res = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);

    expect(res.status).toBe(201);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    expect(mockPrisma.guest.create).not.toHaveBeenCalled();
    expect(res.body.updated).toBeUndefined();
    expect(res.body.walletShared).toBeUndefined();
    expect(res.body.guest.id).not.toBe(EXISTING_ID);
    expect(res.body.guest.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.guest.name).toBe('Mallory');
    expect(verifyGuestToken(EXISTING_ID, res.body.guestToken)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('Alice Original');
    expect(JSON.stringify(res.body)).not.toContain(EXISTING_ID);
  });

  it.each([
    ['open event', {}],
    ['approval-required event', { requireApproval: true }],
    ['event at capacity (waitlist)', { maxGuests: 1 }],
  ])('%s: duplicate response is identical to a brand-new RSVP (status, keys, values)', async (_l, party) => {
    // Brand-new RSVP
    setup({ party, existing: null });
    if ((party as any).maxGuests) mockPrisma.guest.count.mockResolvedValue(5);
    const fresh = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);

    // Same submission, but the email is already on the list (and caller isn't its owner)
    setup({ party });
    if ((party as any).maxGuests) mockPrisma.guest.count.mockResolvedValue(5);
    const dup = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);

    expect(fresh.status).toBe(201);
    expect(dup.status).toBe(fresh.status);
    expect(shape(dup.body)).toEqual(shape(fresh.body));
    expect(Object.keys(dup.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(Object.keys(dup.body.guest).sort()).toEqual(Object.keys(fresh.body.guest).sort());
    expect(typeof dup.body.guestToken).toBe('string');
    expect(dup.body.guestToken).toHaveLength(fresh.body.guestToken.length);
  });

  it('logged in as a different email: still the decoy, nothing written', async () => {
    setup();
    const res = await request(app()).post('/api/rsvp/abc123/guest').set(auth('mallory@example.com')).send(BODY);
    expect(res.status).toBe(201);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    expect(res.body.guest.id).not.toBe(EXISTING_ID);
  });

  it.each([
    ['forged', () => jwt.sign({ userId: 'x', email: 'alice@example.com' }, 'wrong-secret')],
    ['expired', () => jwt.sign({ userId: 'x', email: 'alice@example.com', exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET)],
  ])('a %s JWT gets 401 (not a silent anonymous decoy) and nothing is read or written', async (_l, tok) => {
    setup();
    const res = await request(app())
      .post('/api/rsvp/abc123/guest')
      .set({ Authorization: `Bearer ${tok()}` })
      .send(BODY);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(mockPrisma.guest.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    expect(mockPrisma.guest.create).not.toHaveBeenCalled();
  });

  it('the 401 is the same whether or not the email is on the list (no oracle)', async () => {
    const bad = { Authorization: `Bearer ${jwt.sign({ userId: 'x', email: 'a@b.c' }, 'wrong-secret')}` };
    setup({ existing: null });
    const a = await request(app()).post('/api/rsvp/abc123/guest').set(bad).send(BODY);
    setup();
    const b = await request(app()).post('/api/rsvp/abc123/guest').set(bad).send(BODY);
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it('logged in as the owner (case-insensitive): updates as before and returns the real id + token', async () => {
    setup();
    const res = await request(app()).post('/api/rsvp/abc123/guest').set(auth('ALICE@example.com')).send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.guest.id).toBe(EXISTING_ID);
    expect(verifyGuestToken(EXISTING_ID, res.body.guestToken)).toBe(true);
    expect(res.body.walletShared).toBeUndefined();
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXISTING_ID }, data: expect.objectContaining({ name: 'Mallory' }) })
    );
  });

  it('owner whose RSVP the host rejected: no reactivation (unchanged behaviour)', async () => {
    setup({ existing: { approved: false } });
    const res = await request(app()).post('/api/rsvp/abc123/guest').set(auth('alice@example.com')).send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(false);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('logged out on a rejected guest: decoy, not the old 200 `updated:false` reply', async () => {
    setup({ existing: { approved: false } });
    const res = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.guest.id).not.toBe(EXISTING_ID);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('logged out on a host invite (INVITED) WITHOUT its token: decoy, nothing written (invite-verify)', async () => {
    setup({ existing: { status: 'INVITED', submittedVia: 'invite', ethereumAddress: null as any } });
    const res = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.guest.id).not.toBe(EXISTING_ID);
    expect(verifyGuestToken(EXISTING_ID, res.body.guestToken)).toBe(false);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('logged out on a host invite (INVITED) with its invite-link token: completes it like a new RSVP', async () => {
    setup({ existing: { status: 'INVITED', submittedVia: 'invite', ethereumAddress: null as any } });
    const res = await request(app())
      .post('/api/rsvp/abc123/guest')
      .send({ ...BODY, guestToken: signGuestToken(EXISTING_ID) });
    expect(res.status).toBe(201);
    expect(res.body.updated).toBeUndefined();
    expect(res.body.guest).toEqual({ id: EXISTING_ID, name: 'Mallory', status: 'CONFIRMED', waitlistPosition: null });
    expect(verifyGuestToken(EXISTING_ID, res.body.guestToken)).toBe(true);
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', submittedVia: 'rsvp' }) })
    );
    expect(mockPrisma.guest.create).not.toHaveBeenCalled();
  });

  it('a new RSVP returns its own id + a token that verifies, and never looks up other guests by wallet', async () => {
    setup({ existing: null });
    const res = await request(app()).post('/api/rsvp/abc123/guest').send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.guest.id).toBe(NEW_ID);
    expect(verifyGuestToken(NEW_ID, res.body.guestToken)).toBe(true);
    expect(res.body.walletShared).toBeUndefined();
    for (const [arg] of mockPrisma.guest.findFirst.mock.calls) {
      expect(arg.where).not.toHaveProperty('ethereumAddress');
    }
  });
});

describe('guest-scoped endpoints need the guest token or a login as the guest', () => {
  const GUEST = { id: EXISTING_ID, email: 'alice@example.com', name: 'Alice', partyId: PARTY_ID };

  describe('POST /api/parties/:partyId/raffles/:raffleId/enter', () => {
    beforeEach(() => {
      mockPrisma.party.findUnique.mockResolvedValue({ cancelledAt: null });
      mockPrisma.raffle.findFirst.mockResolvedValue({ id: 'r1', status: 'open' });
      mockPrisma.guest.findFirst.mockResolvedValue(GUEST);
      mockPrisma.raffleEntry.findFirst.mockResolvedValue(null);
      mockPrisma.raffleEntry.create.mockResolvedValue({ id: 'e1' });
    });
    const enter = (body: object, headers: Record<string, string> = {}) =>
      request(app()).post(`/api/parties/${PARTY_ID}/raffles/${NEW_ID}/enter`).set(headers).send(body);

    it('rejects a bare guest id (404, no entry)', async () => {
      const res = await enter({ guestId: EXISTING_ID });
      expect(res.status).toBe(404);
      expect(mockPrisma.raffleEntry.create).not.toHaveBeenCalled();
    });
    it("rejects another guest's token", async () => {
      const res = await enter({ guestId: EXISTING_ID, guestToken: signGuestToken(NEW_ID) });
      expect(res.status).toBe(404);
    });
    it('rejects a login as someone else', async () => {
      const res = await enter({ guestId: EXISTING_ID }, auth('mallory@example.com'));
      expect(res.status).toBe(404);
    });
    it('accepts the guest token (body or header)', async () => {
      expect((await enter({ guestId: EXISTING_ID, guestToken: signGuestToken(EXISTING_ID) })).status).toBe(201);
      expect((await enter({ guestId: EXISTING_ID }, { 'X-Guest-Token': signGuestToken(EXISTING_ID) })).status).toBe(201);
    });
    it('accepts a login as the guest', async () => {
      expect((await enter({ guestId: EXISTING_ID }, auth('Alice@Example.com'))).status).toBe(201);
    });
  });

  describe('POST /api/events/:slug/quiz/answers', () => {
    beforeEach(() => {
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, quizEnabled: true });
      mockPrisma.guest.findFirst.mockResolvedValue(GUEST);
      mockPrisma.quizQuestion.findMany.mockResolvedValue([{ id: 'q1', correctIndex: 0, explanation: null }]);
    });
    const answers = [{ questionId: 'q1', selectedIndex: 0 }];

    it('rejects a bare guest id without writing answers', async () => {
      const res = await request(app()).post('/api/events/abc123/quiz/answers').send({ guestId: EXISTING_ID, answers });
      expect(res.status).toBe(404);
      expect(mockPrisma.quizAnswer.upsert).not.toHaveBeenCalled();
    });
    it('accepts the guest token', async () => {
      const res = await request(app())
        .post('/api/events/abc123/quiz/answers')
        .send({ guestId: EXISTING_ID, guestToken: signGuestToken(EXISTING_ID), answers });
      expect(res.status).toBe(200);
      expect(mockPrisma.quizAnswer.upsert).toHaveBeenCalled();
    });
  });

  describe('GET/POST /api/checkin/:inviteCode/:guestId/discount', () => {
    const ENDED = { date: new Date('2020-01-01T00:00:00Z'), duration: 3 };
    beforeEach(() => {
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, name: 'P', userId: 'host-1', coHosts: [{ email: 'cohost@example.com' }] });
      mockPrisma.guest.findFirst.mockResolvedValue({ ...GUEST, checkedInAt: new Date(), discountClaimedAt: null, party: ENDED });
      mockPrisma.guest.update.mockResolvedValue({ discountClaimedAt: new Date() });
    });
    const path = `/api/checkin/abc123/${EXISTING_ID}/discount`;

    it('GET with a bare guest id: 404 and no name', async () => {
      const res = await request(app()).get(path);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Alice');
    });
    it('POST with a bare guest id: 404 and the discount is not burned', async () => {
      const res = await request(app()).post(path);
      expect(res.status).toBe(404);
      expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    });
    it('GET/POST with ?t=<token> work', async () => {
      const t = signGuestToken(EXISTING_ID);
      expect((await request(app()).get(`${path}?t=${t}`)).status).toBe(200);
      expect((await request(app()).post(`${path}?t=${t}`)).status).toBe(200);
    });
    it('a login as the guest works; a login as a stranger does not', async () => {
      expect((await request(app()).get(path).set(auth('alice@example.com'))).status).toBe(200);
      expect((await request(app()).get(path).set(auth('mallory@example.com', 'u-mallory'))).status).toBe(404);
    });
    it('the host and co-hosts keep access', async () => {
      expect((await request(app()).get(path).set(auth('host@example.com', 'host-1'))).status).toBe(200);
      expect((await request(app()).get(path).set(auth('CoHost@example.com', 'u-co'))).status).toBe(200);
    });
  });

  describe('PATCH /api/nft/guest/:guestId', () => {
    beforeEach(() => {
      mockPrisma.guest.findUnique.mockResolvedValue({ id: EXISTING_ID, email: 'alice@example.com', nftTokenId: null });
      mockPrisma.guest.update.mockResolvedValue({ id: EXISTING_ID, nftTokenId: 7 });
    });
    const body = { tokenId: 7, transactionHash: '0x' + 'a'.repeat(64) };

    it('id + email (the old check) is no longer enough', async () => {
      const res = await request(app()).patch(`/api/nft/guest/${EXISTING_ID}`).send({ ...body, email: 'alice@example.com' });
      expect(res.status).toBe(404);
      expect(mockPrisma.guest.update).not.toHaveBeenCalled();
    });
    it('the guest token works and only NFT fields come back', async () => {
      const res = await request(app())
        .patch(`/api/nft/guest/${EXISTING_ID}`)
        .set('X-Guest-Token', signGuestToken(EXISTING_ID))
        .send(body);
      expect(res.status).toBe(200);
      expect(mockPrisma.guest.update.mock.calls[0][0].select).toEqual({
        id: true, nftTokenId: true, nftTransactionHash: true, nftMintedAt: true,
      });
    });
  });

  describe('POST /api/rsvp/:inviteCode/send-confirmation', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 're_test';
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'msg_1' }) });
      mockPrisma.party.findUnique.mockResolvedValue(PARTY);
      mockPrisma.guest.findFirst.mockResolvedValue({ id: EXISTING_ID, name: 'Alice', email: 'alice@example.com' });
    });

    it('refuses without a token or login, and sends nothing', async () => {
      const res = await request(app())
        .post('/api/rsvp/abc123/send-confirmation')
        .send({ guestId: EXISTING_ID, guestEmail: 'victim@example.com', guestName: 'X' });
      expect(res.status).toBe(404);
      expect(mockFetch).not.toHaveBeenCalled();
    });
    it('with the token, sends only to the stored address (body email is ignored)', async () => {
      const res = await request(app())
        .post('/api/rsvp/abc123/send-confirmation')
        .send({ guestId: EXISTING_ID, guestToken: signGuestToken(EXISTING_ID), guestEmail: 'victim@example.com' });
      expect(res.status).toBe(200);
      const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sent.to).toEqual(['alice@example.com']);
    });
  });
});

describe('malformed guest ids get the uniform 404, never a 500', () => {
  const tok = { 'X-Guest-Token': signGuestToken('not-a-uuid') };
  beforeEach(() => {
    mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, quizEnabled: true, cancelledAt: null, name: 'P', userId: 'h', coHosts: [] });
  });
  it.each([
    ['raffle enter', () => request(app()).post(`/api/parties/${PARTY_ID}/raffles/${PARTY_ID}/enter`).set(tok).send({ guestId: 'not-a-uuid' })],
    ['quiz answers', () => request(app()).post('/api/events/abc123/quiz/answers').set(tok).send({ guestId: 'not-a-uuid', answers: [{ questionId: 'q', selectedIndex: 0 }] })],
    ['discount GET', () => request(app()).get('/api/checkin/abc123/not-a-uuid/discount').set(tok)],
    ['discount POST', () => request(app()).post('/api/checkin/abc123/not-a-uuid/discount').set(tok)],
    ['nft PATCH', () => request(app()).patch('/api/nft/guest/not-a-uuid').set(tok).send({ tokenId: 1, transactionHash: '0x' + 'a'.repeat(64) })],
    ['nft GET', () => request(app()).get('/api/nft/guest/not-a-uuid')],
  ])('%s', async (_l, call) => {
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockPrisma.guest.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.guest.findUnique).not.toHaveBeenCalled();
  });
});
