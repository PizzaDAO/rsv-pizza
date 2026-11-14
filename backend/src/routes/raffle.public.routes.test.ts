/**
 * raffle-list-trim: the public raffle GETs no longer list every entrant's guest id + name.
 * Hosts keep the full rows; everyone else gets the count, their own hasEntered/isMine
 * (proved by guest token or login) and, after the draw, winners' names + prize (no ids).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-raffle-list-trim-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  admin: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: { findUnique: vi.fn() },
  raffle: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
const canEdit = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: canEdit,
  canUserAccessTab: vi.fn(() => Promise.resolve(true)),
}));

import raffleRoutes from './raffle.routes.js';
import { errorHandler } from '../middleware/error.js';
import { signGuestToken } from '../lib/guestToken.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', raffleRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY_ID = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const BOB = '33333333-3333-4333-8333-333333333333';
const RAFFLE_ID = '44444444-4444-4444-8444-444444444444';

const raffle = (status: string) => ({
  id: RAFFLE_ID,
  partyId: PARTY_ID,
  name: 'Door prize',
  description: null,
  status,
  entriesPerGuest: 1,
  prizes: [{ id: 'p1', name: 'Pizza' }],
  entries: [
    { id: 'e1', raffleId: RAFFLE_ID, guestId: ALICE, guest: { id: ALICE, name: 'Alice' } },
    { id: 'e2', raffleId: RAFFLE_ID, guestId: BOB, guest: { id: BOB, name: 'Bob' } },
  ],
  winners:
    status === 'drawn'
      ? [{ id: 'w1', raffleId: RAFFLE_ID, prizeId: 'p1', guestId: ALICE, claimedAt: null, guest: { id: ALICE, name: 'Alice Anderson' }, prize: { id: 'p1', name: 'Pizza' } }]
      : [],
  _count: { entries: 2 },
});

beforeEach(() => {
  vi.clearAllMocks();
  canEdit.mockResolvedValue(false);
  mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID });
  mockPrisma.guest.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: where.id, email: where.id === ALICE ? 'alice@example.com' : 'bob@example.com', partyId: PARTY_ID }),
  );
  mockPrisma.raffle.findMany.mockResolvedValue([raffle('drawn')]);
  mockPrisma.raffle.findFirst.mockResolvedValue(raffle('drawn'));
});

describe('GET /:partyId/raffles', () => {
  it('anonymous: count only, no entrant ids or names, winner names without ids', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY_ID}/raffles`);
    expect(res.status).toBe(200);
    const r = res.body.raffles[0];
    expect(r.entries).toEqual([]);
    expect(r._count.entries).toBe(2);
    expect(r.hasEntered).toBe(false);
    expect(r.winners).toEqual([
      { id: 'w1', raffleId: RAFFLE_ID, prizeId: 'p1', guest: { name: 'Alice A.' }, prize: { id: 'p1', name: 'Pizza' }, isMine: false },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Anderson');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(ALICE);
    expect(body).not.toContain(BOB);
    expect(body).not.toContain('Bob');
  });

  it('winners are hidden until the draw', async () => {
    mockPrisma.raffle.findMany.mockResolvedValue([{ ...raffle('open'), winners: [{ id: 'w1', guestId: ALICE, guest: { name: 'Alice' } }] }]);
    const res = await request(app()).get(`/api/parties/${PARTY_ID}/raffles`);
    expect(res.body.raffles[0].winners).toEqual([]);
  });

  it('a bare guestId proves nothing', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY_ID}/raffles?guestId=${ALICE}`);
    expect(res.body.raffles[0].hasEntered).toBe(false);
    expect(res.body.raffles[0].winners[0].isMine).toBe(false);
  });

  it('guest token: own hasEntered / isMine only', async () => {
    const a = await request(app())
      .get(`/api/parties/${PARTY_ID}/raffles?guestId=${ALICE}`)
      .set('X-Guest-Token', signGuestToken(ALICE));
    expect(a.body.raffles[0].hasEntered).toBe(true);
    expect(a.body.raffles[0].winners[0].isMine).toBe(true);
    expect(a.body.raffles[0].entries).toEqual([]);

    const wrong = await request(app())
      .get(`/api/parties/${PARTY_ID}/raffles?guestId=${BOB}`)
      .set('X-Guest-Token', signGuestToken(ALICE));
    expect(wrong.body.raffles[0].hasEntered).toBe(false);
  });

  it('logged in as the guest works without a token', async () => {
    const hdr = `Bearer ${jwt.sign({ userId: 'u2', email: 'bob@example.com' }, JWT_SECRET, { expiresIn: '1h' })}`;
    const res = await request(app()).get(`/api/parties/${PARTY_ID}/raffles?guestId=${BOB}`).set('Authorization', hdr);
    expect(res.body.raffles[0].hasEntered).toBe(true);
    expect(res.body.raffles[0].winners[0].isMine).toBe(false);
  });

  it('host: full entries and winners with ids', async () => {
    canEdit.mockResolvedValue(true);
    const res = await request(app()).get(`/api/parties/${PARTY_ID}/raffles`);
    const r = res.body.raffles[0];
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].guest).toEqual({ id: ALICE, name: 'Alice' });
    expect(r.winners[0].guestId).toBe(ALICE);
    expect(r.winners[0].guest.name).toBe('Alice Anderson');
  });
});

describe('GET /:partyId/raffles/:raffleId', () => {
  it('anonymous is trimmed; host is full', async () => {
    const anon = await request(app()).get(`/api/parties/${PARTY_ID}/raffles/${RAFFLE_ID}`);
    expect(anon.body.raffle.entries).toEqual([]);
    expect(JSON.stringify(anon.body)).not.toContain(BOB);
    canEdit.mockResolvedValue(true);
    const host = await request(app()).get(`/api/parties/${PARTY_ID}/raffles/${RAFFLE_ID}`);
    expect(host.body.raffle.entries).toHaveLength(2);
  });
});
