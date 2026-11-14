/**
 * Hackathon PR 2 (host setup + public read): authz matrix, validation, response-shape privacy,
 * and the 409 delete paths. Prisma and the party-access helpers are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-hackathon-routes-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const model = () => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(async () => ({})),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
  findMany: vi.fn(async () => []),
});
const mockPrisma = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
const eventHidden = vi.hoisted(() => vi.fn());
vi.mock('../helpers/eventVisibility.js', () => ({ isEventHiddenFrom: eventHidden }));
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: canEdit,
  canUserAccessTab: canTab,
}));

import hackathonPublicRoutes from './hackathon-public.routes.js';
import hackathonRoutes from './hackathon.routes.js';
import { errorHandler } from '../middleware/error.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', hackathonPublicRoutes);
  a.use('/api/parties', hackathonRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const HID = '22222222-2222-4222-8222-222222222222';
const TRACK = '33333333-3333-4333-8333-333333333333';
const PRIZE = '44444444-4444-4444-8444-444444444444';
const CRIT = '55555555-5555-4555-8555-555555555555';
const JUDGE = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const JUDGE_USER = 'judge-user-id-secret';

const auth = (email = 'host@example.com', userId = 'u-host') =>
  `Bearer ${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' })}`;

function fullRow(over: Record<string, unknown> = {}) {
  return {
    id: HID,
    partyId: PARTY,
    rules: 'Be nice',
    submissionsOpenAt: null,
    submissionDeadline: new Date('2027-03-06T23:00:00Z'),
    teamMinSize: 1,
    teamMaxSize: 5,
    maxTracksPerSubmission: 1,
    eligibility: 'registered',
    blindJudging: true,
    judgingStatus: 'not_started',
    publishedAt: new Date('2027-01-01T00:00:00Z'),
    galleryVisibility: 'after_reveal',
    resultsRevealedAt: null,
    disabledAt: null,
    createdAt: new Date('2026-12-01T00:00:00Z'),
    updatedAt: new Date('2026-12-01T00:00:00Z'),
    tracks: [{ id: TRACK, hackathonId: HID, name: 'DeFi', description: 'Money legos', sponsorName: 'Acme', sortOrder: 0, createdAt: new Date() }],
    prizes: [{ id: PRIZE, hackathonId: HID, trackId: TRACK, name: 'Best DeFi', description: null, rank: 1, amountText: '$5,000', amountValue: '5000', currency: 'USD', quantity: 1, kind: 'judged', sortOrder: 0, createdAt: new Date() }],
    criteria: [{ id: CRIT, hackathonId: HID, name: 'Impact', description: 'Does it matter', weight: 2, maxScore: 5, sortOrder: 0, createdAt: new Date() }],
    judges: [{ id: JUDGE, hackathonId: HID, email: 'judge@secret.example', name: 'Jude', userId: JUDGE_USER, status: 'active', invitedBy: 'u-host', createdAt: new Date(), tracks: [{ trackId: TRACK }] }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ['party', 'guest', 'hackathon', 'hackathonTrack', 'hackathonPrize', 'hackathonCriterion', 'hackathonJudge', 'hackathonJudgeTrack', 'hackathonSubmission', 'hackathonSubmissionTrack', 'hackathonScore', 'hackathonAward']) {
    mockPrisma[k] = model();
  }
  mockPrisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
  // Host by default: owner of the party.
  canEdit.mockImplementation(async (_p: string, _u?: string, email?: string) => email === 'host@example.com' || email === 'cohost@example.com');
  canTab.mockImplementation(async (_p: string, email?: string) => email === 'host@example.com');
  mockPrisma.hackathon.findUnique.mockImplementation(async () => fullRow());
  eventHidden.mockResolvedValue(false);
  mockPrisma.party.findUnique.mockResolvedValue({ eventType: null, eventTags: [], date: null, region: null, city: null, password: null });
  mockPrisma.guest.findFirst.mockResolvedValue(null);
  mockPrisma.$queryRaw = vi.fn(async () => []);
  mockPrisma.hackathonTrack.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
  for (const k of ['hackathonTrack', 'hackathonPrize', 'hackathonCriterion', 'hackathonJudge', 'hackathonAward', 'hackathonScore', 'hackathonSubmission', 'hackathonSubmissionTrack']) {
    mockPrisma[k].count.mockResolvedValue(0);
    mockPrisma[k].aggregate.mockResolvedValue({ _max: { sortOrder: null } });
  }
  mockPrisma.hackathonTrack.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.hackathonPrize.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.hackathonCriterion.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.hackathonTrack.findFirst.mockResolvedValue({ id: TRACK });
  mockPrisma.hackathonPrize.findFirst.mockResolvedValue({ id: PRIZE });
  mockPrisma.hackathonCriterion.findFirst.mockResolvedValue({ id: CRIT });
  mockPrisma.hackathonJudge.findFirst.mockResolvedValue({ id: JUDGE });
  mockPrisma.hackathonJudge.create.mockResolvedValue({ id: JUDGE });
});

// ------------------------------------------------------------------ public read

describe('GET /:partyId/hackathon (public read)', () => {
  it('anonymous + published: public shape only (no emails, judges, user ids, judging config)', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY}/hackathon`);
    expect(res.status).toBe(200);
    expect(res.body.canManage).toBe(false);
    const h = res.body.hackathon;
    expect(Object.keys(h).sort()).toEqual([
      'criteria', 'eligibility', 'maxTracksPerSubmission', 'prizes', 'publishedAt', 'rules',
      'submissionDeadline', 'submissionsOpenAt', 'teamMaxSize', 'teamMinSize', 'tracks',
    ]);
    expect(h.tracks[0]).toEqual({ id: TRACK, name: 'DeFi', description: 'Money legos', sponsorName: 'Acme', sortOrder: 0 });
    expect(h.prizes[0].amountValue).toBe(5000);
    expect(Object.keys(h.prizes[0])).not.toContain('hackathonId');
    const body = JSON.stringify(res.body);
    for (const secret of ['judge@secret.example', JUDGE_USER, JUDGE, 'u-host', HID, 'blindJudging', 'judgingStatus', 'disabledAt', 'galleryVisibility']) {
      expect(body).not.toContain(secret);
    }
  });

  it('unpublished or disabled: null for the public, still full for the host', async () => {
    mockPrisma.hackathon.findUnique.mockResolvedValue(fullRow({ publishedAt: null }));
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon`)).body.hackathon).toBeNull();
    mockPrisma.hackathon.findUnique.mockResolvedValue(fullRow({ disabledAt: new Date() }));
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon`)).body.hackathon).toBeNull();
    const host = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth());
    expect(host.body.canManage).toBe(true);
    expect(host.body.hackathon.enabled).toBe(false);
  });

  it('no hackathon row: null (200)', async () => {
    mockPrisma.hackathon.findUnique.mockResolvedValue(null);
    const res = await request(app()).get(`/api/parties/${PARTY}/hackathon`);
    expect(res.status).toBe(200);
    expect(res.body.hackathon).toBeNull();
  });

  it('logged-in non-host and co-host without the tab get the public shape', async () => {
    for (const email of ['rando@example.com', 'cohost@example.com']) {
      const res = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth(email, 'u-x'));
      expect(res.body.canManage).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('judge@secret.example');
    }
  });

  it('host: full shape incl. judges with emails and track scope, but no judge user id', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth());
    expect(res.body.canManage).toBe(true);
    const h = res.body.hackathon;
    expect(h.blindJudging).toBe(true);
    expect(h.judges).toEqual([
      { id: JUDGE, email: 'judge@secret.example', name: 'Jude', status: 'active', trackIds: [TRACK], linked: true, createdAt: expect.any(String) },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(JUDGE_USER);
  });

  it('pre-launch hidden event (GPP27 / side gate): null for non-hosts, host still gets it', async () => {
    eventHidden.mockResolvedValue(true);
    const anon = await request(app()).get(`/api/parties/${PARTY}/hackathon`);
    expect(anon.body.hackathon).toBeNull();
    expect(eventHidden.mock.calls[0][1]).toBeUndefined();
    const user = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth('ub@example.com', 'u-ub'));
    expect(user.body.hackathon).toBeNull();
    expect(eventHidden.mock.calls[1][1]).toBe('ub@example.com');
    const host = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth());
    expect(host.body.hackathon.judges).toHaveLength(1);
  });

  it('password-protected event: null unless logged in as a non-rejected guest', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ eventType: null, eventTags: [], date: null, region: null, city: null, password: '$2a$hash' });
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon`)).body.hackathon).toBeNull();

    const stranger = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth('rando@example.com', 'u-x'));
    expect(stranger.body.hackathon).toBeNull();
    // Exact lower(email) = lower($) (no ILIKE wildcards), scoped to the party.
    const [strings, ...vals] = mockPrisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain('lower(email) = lower(');
    expect(strings.join('?')).not.toMatch(/ILIKE/i);
    expect(vals.slice(0, 2)).toEqual([PARTY, 'rando@example.com']);

    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'g0', approved: false, status: 'CONFIRMED', checked_in_at: null }]);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth('Guest@Example.com', 'u-g'))).body.hackathon).toBeNull();
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'g1', approved: null, status: 'CONFIRMED', checked_in_at: null }]);
    const guest = await request(app()).get(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth('Guest@Example.com', 'u-g'));
    expect(guest.body.hackathon.tracks).toHaveLength(1);
    expect(JSON.stringify(guest.body)).not.toContain('judge@secret.example');
  });

  it('bad party id: 404', async () => {
    expect((await request(app()).get('/api/parties/not-a-uuid/hackathon')).status).toBe(404);
  });
});

// ------------------------------------------------------------------ authz matrix

const WRITES: Array<[string, string, Record<string, unknown>?]> = [
  ['post', `/api/parties/${PARTY}/hackathon/enable`],
  ['put', `/api/parties/${PARTY}/hackathon`, { rules: 'x' }],
  ['delete', `/api/parties/${PARTY}/hackathon`],
  ['post', `/api/parties/${PARTY}/hackathon/tracks`, { name: 'T' }],
  ['patch', `/api/parties/${PARTY}/hackathon/tracks/${TRACK}`, { name: 'T' }],
  ['delete', `/api/parties/${PARTY}/hackathon/tracks/${TRACK}`],
  ['post', `/api/parties/${PARTY}/hackathon/prizes`, { name: 'P' }],
  ['patch', `/api/parties/${PARTY}/hackathon/prizes/${PRIZE}`, { name: 'P' }],
  ['delete', `/api/parties/${PARTY}/hackathon/prizes/${PRIZE}`],
  ['post', `/api/parties/${PARTY}/hackathon/criteria`, { name: 'C' }],
  ['patch', `/api/parties/${PARTY}/hackathon/criteria/${CRIT}`, { weight: 3 }],
  ['delete', `/api/parties/${PARTY}/hackathon/criteria/${CRIT}`],
  ['post', `/api/parties/${PARTY}/hackathon/judges`, { email: 'new@example.com' }],
  ['patch', `/api/parties/${PARTY}/hackathon/judges/${JUDGE}`, { name: 'J' }],
  ['delete', `/api/parties/${PARTY}/hackathon/judges/${JUDGE}`],
];

describe('authz matrix (every host write)', () => {
  it.each(WRITES)('%s %s: anonymous 401', async (m, url, body) => {
    const res = await (request(app()) as any)[m](url).send(body ?? {});
    expect(res.status).toBe(401);
  });

  it.each(WRITES)('%s %s: logged-in non-host 403', async (m, url, body) => {
    const res = await (request(app()) as any)[m](url).set('Authorization', auth('rando@example.com', 'u-x')).send(body ?? {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each(WRITES)('%s %s: co-host without the hackathon tab 403', async (m, url, body) => {
    const res = await (request(app()) as any)[m](url).set('Authorization', auth('cohost@example.com', 'u-co')).send(body ?? {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAB_ACCESS_DENIED');
  });

  it.each(WRITES)('%s %s: host 2xx', async (m, url, body) => {
    const res = await (request(app()) as any)[m](url).set('Authorization', auth()).send(body ?? {});
    expect(res.status).toBeLessThan(300);
    expect(res.body.canManage).toBe(true);
  });

  it('nothing is written for a rejected caller', async () => {
    for (const [m, url, body] of WRITES) {
      await (request(app()) as any)[m](url).set('Authorization', auth('cohost@example.com', 'u-co')).send(body ?? {});
    }
    for (const k of ['hackathon', 'hackathonTrack', 'hackathonPrize', 'hackathonCriterion', 'hackathonJudge']) {
      expect(mockPrisma[k].create).not.toHaveBeenCalled();
      expect(mockPrisma[k].update).not.toHaveBeenCalled();
      expect(mockPrisma[k].delete).not.toHaveBeenCalled();
    }
  });
});

// ------------------------------------------------------------------ enable / settings

describe('enable / disable / settings', () => {
  it('enable creates the row with plan defaults and the event end as deadline', async () => {
    mockPrisma.hackathon.findUnique.mockResolvedValueOnce(null).mockResolvedValue(fullRow());
    mockPrisma.party.findUnique.mockResolvedValue({ date: new Date('2027-03-04T15:00:00Z'), endTime: null, duration: 6 });
    const res = await request(app()).post(`/api/parties/${PARTY}/hackathon/enable`).set('Authorization', auth());
    expect(res.status).toBe(201);
    expect(mockPrisma.hackathon.create.mock.calls[0][0].data).toEqual({
      partyId: PARTY,
      submissionDeadline: new Date('2027-03-04T21:00:00Z'),
      teamMinSize: 1, teamMaxSize: 5, maxTracksPerSubmission: 1, eligibility: 'registered', blindJudging: false, galleryVisibility: 'after_reveal',
    });
  });

  it('enable re-enables a disabled row', async () => {
    mockPrisma.hackathon.findUnique.mockResolvedValue(fullRow({ disabledAt: new Date() }));
    await request(app()).post(`/api/parties/${PARTY}/hackathon/enable`).set('Authorization', auth());
    expect(mockPrisma.hackathon.update).toHaveBeenCalledWith({ where: { partyId: PARTY }, data: { disabledAt: null } });
    expect(mockPrisma.hackathon.create).not.toHaveBeenCalled();
  });

  it('DELETE soft-disables by default', async () => {
    await request(app()).delete(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth());
    expect(mockPrisma.hackathon.update.mock.calls[0][0].data.disabledAt).toBeInstanceOf(Date);
    expect(mockPrisma.hackathon.delete).not.toHaveBeenCalled();
  });

  it('hard delete: 409 while projects exist, deletes a setup-only hackathon', async () => {
    mockPrisma.hackathonSubmission.count.mockResolvedValue(2);
    const blocked = await request(app()).delete(`/api/parties/${PARTY}/hackathon?hard=true`).set('Authorization', auth());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('HACKATHON_HAS_SUBMISSIONS');
    expect(mockPrisma.hackathon.delete).not.toHaveBeenCalled();

    mockPrisma.hackathonSubmission.count.mockResolvedValue(0);
    const ok = await request(app()).delete(`/api/parties/${PARTY}/hackathon?hard=true`).set('Authorization', auth());
    expect(ok.status).toBe(200);
    expect(mockPrisma.hackathon.delete).toHaveBeenCalledWith({ where: { id: HID } });
  });

  it('settings: writes only the sent fields; publish stamps publishedAt once', async () => {
    mockPrisma.hackathon.findUnique.mockResolvedValue(fullRow({ publishedAt: null }));
    await request(app()).put(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth())
      .send({ teamMaxSize: 4, eligibility: 'checked_in', blindJudging: false, published: true, galleryVisibility: 'hidden' });
    const data = mockPrisma.hackathon.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['blindJudging', 'eligibility', 'galleryVisibility', 'publishedAt', 'teamMaxSize']);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it.each([
    [{ teamMinSize: 4, teamMaxSize: 3 }, 'Maximum team size'],
    [{ teamMaxSize: 21 }, 'Maximum team size'],
    [{ teamMinSize: 0 }, 'Minimum team size'],
    [{ eligibility: 'anyone' }, 'Eligibility'],
    [{ galleryVisibility: 'public' }, 'Gallery visibility'],
    [{ blindJudging: 'yes' }, 'Blind judging'],
    [{ submissionDeadline: 'not a date' }, 'Submission deadline'],
    [{ submissionsOpenAt: '2027-03-07T00:00:00Z' }, 'deadline must be after'],
    [{ rules: 'x'.repeat(20001) }, 'Rules'],
    [{ maxTracksPerSubmission: 1.5 }, 'Tracks per project'],
  ])('settings validation %j -> 400', async (body, msg) => {
    const res = await request(app()).put(`/api/parties/${PARTY}/hackathon`).set('Authorization', auth()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain(msg);
    expect(mockPrisma.hackathon.update).not.toHaveBeenCalled();
  });

  it('settings / child writes before enable: 404 HACKATHON_NOT_ENABLED', async () => {
    mockPrisma.hackathon.findUnique.mockResolvedValue(null);
    for (const [m, url, body] of [['put', `/api/parties/${PARTY}/hackathon`, { rules: 'x' }], ['post', `/api/parties/${PARTY}/hackathon/tracks`, { name: 'T' }]] as const) {
      const res = await (request(app()) as any)[m](url).set('Authorization', auth()).send(body);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HACKATHON_NOT_ENABLED');
    }
  });
});

// ------------------------------------------------------------------ tracks / prizes / criteria

describe('tracks, prizes, criteria', () => {
  it('track create: trimmed, appended after the last sort order, scoped to the hackathon', async () => {
    mockPrisma.hackathonTrack.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
    await request(app()).post(`/api/parties/${PARTY}/hackathon/tracks`).set('Authorization', auth()).send({ name: '  AI  ', sponsorName: '' });
    expect(mockPrisma.hackathonTrack.create.mock.calls[0][0].data).toEqual({ name: 'AI', sponsorName: null, sortOrder: 3, hackathonId: HID });
  });

  it('track validation: name required and <= 80', async () => {
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      const res = await request(app()).post(`/api/parties/${PARTY}/hackathon/tracks`).set('Authorization', auth()).send({ name });
      expect(res.status).toBe(400);
    }
  });

  it('track cap', async () => {
    mockPrisma.hackathonTrack.count.mockResolvedValue(50);
    const res = await request(app()).post(`/api/parties/${PARTY}/hackathon/tracks`).set('Authorization', auth()).send({ name: 'T' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_REACHED');
  });

  it('track of another hackathon: 404 (updateMany scoped by hackathonId)', async () => {
    mockPrisma.hackathonTrack.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app()).patch(`/api/parties/${PARTY}/hackathon/tracks/${OTHER}`).set('Authorization', auth()).send({ name: 'T' });
    expect(res.status).toBe(404);
    expect(mockPrisma.hackathonTrack.updateMany.mock.calls[0][0].where).toEqual({ id: OTHER, hackathonId: HID });
  });

  it('deleting a track with prizes: 409 with a clear message, nothing deleted', async () => {
    mockPrisma.hackathonPrize.count.mockResolvedValue(2);
    const res = await request(app()).delete(`/api/parties/${PARTY}/hackathon/tracks/${TRACK}`).set('Authorization', auth());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRACK_HAS_PRIZES');
    expect(res.body.error.message).toBe('This track has 2 prize(s). Delete them or move them to another track first.');
    expect(mockPrisma.hackathonTrack.delete).not.toHaveBeenCalled();
  });

  it('deleting a track with project entries: 409', async () => {
    mockPrisma.hackathonSubmissionTrack.count.mockResolvedValue(1);
    const res = await request(app()).delete(`/api/parties/${PARTY}/hackathon/tracks/${TRACK}`).set('Authorization', auth());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRACK_HAS_SUBMISSIONS');
  });

  it('a raw FK violation on track delete (race) maps to 409, not 500', async () => {
    mockPrisma.hackathonTrack.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));
    const res = await request(app()).delete(`/api/parties/${PARTY}/hackathon/tracks/${TRACK}`).set('Authorization', auth());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRACK_IN_USE');
  });

  it('track-scoped prize: track must belong to this hackathon', async () => {
    mockPrisma.hackathonTrack.count.mockResolvedValue(0);
    const bad = await request(app()).post(`/api/parties/${PARTY}/hackathon/prizes`).set('Authorization', auth()).send({ name: 'P', trackId: OTHER });
    expect(bad.status).toBe(400);
    expect(mockPrisma.hackathonTrack.count.mock.calls[0][0].where).toEqual({ hackathonId: HID, id: { in: [OTHER] } });

    mockPrisma.hackathonTrack.count.mockResolvedValue(1);
    const ok = await request(app()).post(`/api/parties/${PARTY}/hackathon/prizes`).set('Authorization', auth())
      .send({ name: 'Best DeFi', trackId: TRACK, rank: 1, amountText: '$5,000', amountValue: '5000', currency: 'USD', quantity: 2, kind: 'judged' });
    expect(ok.status).toBe(201);
    expect(mockPrisma.hackathonPrize.create.mock.calls[0][0].data).toMatchObject({ trackId: TRACK, amountValue: 5000, quantity: 2, hackathonId: HID });
  });

  it.each([
    [{ name: 'P', kind: 'raffle' }],
    [{ name: 'P', quantity: 0 }],
    [{ name: 'P', rank: 0 }],
    [{ name: 'P', amountValue: -1 }],
    [{ name: 'P', trackId: 'nope' }],
    [{ name: 'x'.repeat(121) }],
  ])('prize validation %j -> 400', async (body) => {
    const res = await request(app()).post(`/api/parties/${PARTY}/hackathon/prizes`).set('Authorization', auth()).send(body);
    expect(res.status).toBe(400);
  });

  it('prize with awards: 409', async () => {
    mockPrisma.hackathonAward.count.mockResolvedValue(1);
    const res = await request(app()).delete(`/api/parties/${PARTY}/hackathon/prizes/${PRIZE}`).set('Authorization', auth());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRIZE_AWARDED');
    expect(mockPrisma.hackathonPrize.delete).not.toHaveBeenCalled();
  });

  it('criterion weight / max score bounds', async () => {
    for (const body of [{ name: 'C', weight: 0 }, { name: 'C', weight: 11 }, { name: 'C', maxScore: 0 }, { name: 'C', maxScore: 11 }]) {
      const res = await request(app()).post(`/api/parties/${PARTY}/hackathon/criteria`).set('Authorization', auth()).send(body);
      expect(res.status).toBe(400);
    }
    const ok = await request(app()).post(`/api/parties/${PARTY}/hackathon/criteria`).set('Authorization', auth()).send({ name: 'Impact', weight: 3, maxScore: 10 });
    expect(ok.status).toBe(201);
    expect(mockPrisma.hackathonCriterion.create.mock.calls[0][0].data).toMatchObject({ name: 'Impact', weight: 3, maxScore: 10, hackathonId: HID });
  });

  it('criterion delete once scoring started: 409', async () => {
    mockPrisma.hackathonScore.count.mockResolvedValue(3);
    const res = await request(app()).delete(`/api/parties/${PARTY}/hackathon/criteria/${CRIT}`).set('Authorization', auth());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RUBRIC_LOCKED');
  });
});

// ------------------------------------------------------------------ judges

describe('judges', () => {
  it('add by email: trimmed + lowercased, track scope rows carry hackathon_id', async () => {
    mockPrisma.hackathonJudge.findUnique.mockResolvedValue(null);
    mockPrisma.hackathonTrack.count.mockResolvedValue(1);
    const res = await request(app()).post(`/api/parties/${PARTY}/hackathon/judges`).set('Authorization', auth())
      .send({ email: '  Judge@Example.COM ', name: 'Jude', trackIds: [TRACK] });
    expect(res.status).toBe(201);
    expect(mockPrisma.hackathonJudge.create.mock.calls[0][0].data).toEqual({ hackathonId: HID, email: 'judge@example.com', name: 'Jude', invitedBy: 'u-host' });
    expect(mockPrisma.hackathonJudgeTrack.deleteMany).toHaveBeenCalledWith({ where: { judgeId: JUDGE } });
    expect(mockPrisma.hackathonJudgeTrack.createMany).toHaveBeenCalledWith({ data: [{ judgeId: JUDGE, trackId: TRACK, hackathonId: HID }] });
  });

  it('empty trackIds = all tracks (rows cleared, none created)', async () => {
    await request(app()).patch(`/api/parties/${PARTY}/hackathon/judges/${JUDGE}`).set('Authorization', auth()).send({ trackIds: [] });
    expect(mockPrisma.hackathonJudgeTrack.deleteMany).toHaveBeenCalledWith({ where: { judgeId: JUDGE } });
    expect(mockPrisma.hackathonJudgeTrack.createMany).not.toHaveBeenCalled();
  });

  it('invalid email / foreign track / email change: 400', async () => {
    mockPrisma.hackathonJudge.findUnique.mockResolvedValue(null);
    expect((await request(app()).post(`/api/parties/${PARTY}/hackathon/judges`).set('Authorization', auth()).send({ email: 'nope' })).status).toBe(400);
    mockPrisma.hackathonTrack.count.mockResolvedValue(0);
    expect((await request(app()).post(`/api/parties/${PARTY}/hackathon/judges`).set('Authorization', auth()).send({ email: 'a@b.co', trackIds: [OTHER] })).status).toBe(400);
    expect((await request(app()).patch(`/api/parties/${PARTY}/hackathon/judges/${JUDGE}`).set('Authorization', auth()).send({ email: 'x@y.co' })).status).toBe(400);
  });

  it('duplicate active judge: 409; a removed judge is reactivated', async () => {
    mockPrisma.hackathonJudge.findUnique.mockResolvedValue({ id: JUDGE, status: 'active' });
    const dup = await request(app()).post(`/api/parties/${PARTY}/hackathon/judges`).set('Authorization', auth()).send({ email: 'judge@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('JUDGE_EXISTS');

    mockPrisma.hackathonJudge.findUnique.mockResolvedValue({ id: JUDGE, status: 'removed' });
    const re = await request(app()).post(`/api/parties/${PARTY}/hackathon/judges`).set('Authorization', auth()).send({ email: 'judge@example.com' });
    expect(re.status).toBe(201);
    expect(mockPrisma.hackathonJudge.update).toHaveBeenCalledWith({ where: { id: JUDGE }, data: { status: 'active' } });
    expect(mockPrisma.hackathonJudge.create).not.toHaveBeenCalled();
  });

  it('delete: hard while no scores, soft remove once they scored', async () => {
    await request(app()).delete(`/api/parties/${PARTY}/hackathon/judges/${JUDGE}`).set('Authorization', auth());
    expect(mockPrisma.hackathonJudge.delete).toHaveBeenCalledWith({ where: { id: JUDGE } });

    vi.clearAllMocks();
    mockPrisma.hackathonJudge.findFirst.mockResolvedValue({ id: JUDGE });
    mockPrisma.hackathonScore.count.mockResolvedValue(4);
    const res = await request(app()).delete(`/api/parties/${PARTY}/hackathon/judges/${JUDGE}`).set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.softRemoved).toBe(true);
    expect(mockPrisma.hackathonJudge.update).toHaveBeenCalledWith({ where: { id: JUDGE }, data: { status: 'removed' } });
    expect(mockPrisma.hackathonJudge.delete).not.toHaveBeenCalled();
  });
});
