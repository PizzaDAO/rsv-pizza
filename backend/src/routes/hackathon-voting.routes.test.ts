/**
 * Hackathon PR 7 (public voting) routes: login required, eligibility per the voting setting
 * (checked_in default / registered), the window (scheduled / open / closed, server time),
 * gallery-visible submitted projects only, self-vote block (user id or RSVP email), one vote
 * per scope (change + retract, track scope), tallies hidden from everyone incl. the host until
 * close, People's Choice suggestions after close, host settings (scope lock, window check,
 * manual open / close), privacy of the public shape and of ip_hash, rate limiting.
 *
 * The DB layer (lib/hackathon/votingStore.ts) is an in-memory fake here; its SQL (ON CONFLICT
 * on the expression index, own-team matching, counted votes, FOR SHARE re-check) is tested
 * against a real Postgres in votingStore.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-hackathon-voting-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: canEdit, canUserAccessTab: canTab }));
const canSee = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../lib/hackathon/gallery.js', () => ({ viewerCanSeeEvent: canSee }));
const store = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../lib/hackathon/votingStore.js', () => store);

import votingRoutes from './hackathon-voting.routes.js';
import { errorHandler } from '../middleware/error.js';
import { decideEligibility } from '../lib/hackathon/eligibility.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.set('trust proxy', true);
  a.use(express.json());
  a.use('/api/parties', votingRoutes);
  a.use(errorHandler);
  return a;
}
// The per-user vote limiter lives in the router module and outlives a test, so every test gets
// fresh user ids (u-<name>-<n>).
let server: ReturnType<typeof app>;

const PARTY = '11111111-1111-4111-8111-111111111111';
const HID = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '33333333-3333-4333-8333-444444444444';
const S_A = '55555555-5555-4555-8555-00000000000a';
const S_B = '55555555-5555-4555-8555-00000000000b';
const S_DRAFT = '55555555-5555-4555-8555-00000000000c';
const S_DQ = '55555555-5555-4555-8555-00000000000d';
const P_PC = '44444444-4444-4444-8444-000000000004';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

let uid = 0;
const users: Record<string, { id: string; email: string }> = {};
function user(name: string, email = `${name}@example.com`) {
  users[name] = { id: `u-${name}-${uid}`, email };
  return users[name];
}
const auth = (name: string) => `Bearer ${jwt.sign({ userId: users[name].id, email: users[name].email }, JWT_SECRET, { expiresIn: '1h' })}`;

type Row = Record<string, any>;
let state: {
  h: Row;
  voting: Row | null;
  subs: Row[];
  members: Row[];
  guests: Row[];
  votes: Row[];
};

const ago = (min: number) => new Date(Date.now() - min * 60_000);
const later = (min: number) => new Date(Date.now() + min * 60_000);

function seed() {
  uid++;
  for (const n of ['host', 'cohost', 'alice', 'bob', 'carol', 'dave', 'rando', 'pending']) user(n);
  user('alt', 'Alice.RSVP@Example.com'); // a second account whose email is alice's RSVP email
  state = {
    h: {
      id: HID, partyId: PARTY, publishedAt: ago(1000), disabledAt: null, galleryVisibility: 'after_deadline',
      submissionDeadline: ago(60), resultsRevealedAt: null,
      tracks: [{ id: T1, name: 'DeFi' }, { id: T2, name: 'Consumer' }],
      prizes: [{ id: P_PC, trackId: null, name: "People's Choice", rank: null, quantity: 1, kind: 'peoples_choice', sortOrder: 0 }],
    },
    voting: { enabled: true, scope: 'event', eligibility: 'checked_in', opensAt: ago(10), closesAt: later(60) },
    subs: [
      { id: S_A, slug: 'slice-router', name: 'Slice Router', status: 'submitted', teamId: TEAM_A, teamName: 'Crust', trackIds: [T1] },
      { id: S_B, slug: 'pepperoni-pass', name: 'Pepperoni Pass', status: 'submitted', teamId: TEAM_B, teamName: 'Mozz', trackIds: [T2] },
      { id: S_DRAFT, slug: 'half-baked', name: 'Half Baked', status: 'draft', teamId: 'team-c', teamName: 'Drafty', trackIds: [T1] },
      { id: S_DQ, slug: 'totally-original', name: 'Totally Original', status: 'disqualified', teamId: 'team-d', teamName: 'Bad', trackIds: [T1] },
    ],
    members: [
      { teamId: TEAM_A, userId: users.alice.id, emails: ['alice@example.com', 'alice.rsvp@example.com'] },
      { teamId: TEAM_B, userId: users.bob.id, emails: ['bob@example.com'] },
    ],
    // RSVPs (checked in unless noted)
    guests: [
      { email: 'alice@example.com', approved: true, status: 'CONFIRMED', checkedInAt: ago(100) },
      { email: 'alice.rsvp@example.com', approved: true, status: 'CONFIRMED', checkedInAt: ago(100) },
      { email: 'bob@example.com', approved: true, status: 'CONFIRMED', checkedInAt: ago(100) },
      { email: 'carol@example.com', approved: true, status: 'CONFIRMED', checkedInAt: ago(100) },
      { email: 'dave@example.com', approved: true, status: 'CONFIRMED', checkedInAt: null }, // registered, not checked in
      { email: 'pending@example.com', approved: null, status: 'CONFIRMED', checkedInAt: ago(1) },
      { email: 'host@example.com', approved: true, status: 'CONFIRMED', checkedInAt: ago(100) },
    ],
    votes: [],
  };
}

const low = (s?: string) => (s ?? '').trim().toLowerCase();
const NIL = 'nil';
function installStore() {
  const ownTeams = (userId: string, email?: string) =>
    [...new Set(state.members.filter((m) => m.userId === userId || (!!email && m.emails.includes(low(email)))).map((m) => m.teamId))];
  Object.assign(store, {
    loadVotingHackathon: vi.fn(async (partyId: string) => (partyId === PARTY ? { ...state.h, voting: state.voting ? { ...state.voting } : null } : null)),
    loadVoting: vi.fn(async () => (state.voting ? { ...state.voting } : null)),
    lockVotingShared: vi.fn(async () => (state.voting ? { ...state.voting } : null)),
    lockHackathonRow: vi.fn(async () => undefined),
    saveVoting: vi.fn(async (_tx: unknown, _id: string, v: Row) => { state.voting = { ...v }; }),
    voterEligibility: vi.fn(async (_p: string, h: Row, eligibility: string, email?: string) => {
      const guests = state.guests.filter((g) => !!email && g.email === low(email)).map((g, i) => ({ id: `g${i}`, approved: g.approved, status: g.status, checkedInAt: g.checkedInAt }));
      return decideEligibility({ ...h, eligibility } as any, guests, { loggedIn: !!email, isJudge: false, requireApproval: true });
    }),
    findSubmissionBySlug: vi.fn(async (_h: string, slug: string) => {
      const s = state.subs.find((x) => x.slug === slug);
      return s ? { id: s.id, status: s.status, teamId: s.teamId, trackIds: s.trackIds } : null;
    }),
    ownTeamIds: vi.fn(async (_h: string, userId: string, email?: string) => ownTeams(userId, email)),
    ownProjectSlugs: vi.fn(async (_h: string, teamIds: string[]) => state.subs.filter((s) => teamIds.includes(s.teamId)).map((s) => s.slug)),
    myVotes: vi.fn(async (_h: string, userId: string) =>
      state.votes.filter((v) => v.voterUserId === userId).map((v) => ({ trackId: v.trackId, projectSlug: state.subs.find((s) => s.id === v.submissionId)!.slug }))),
    upsertVote: vi.fn(async (_tx: unknown, v: Row) => {
      const existing = state.votes.find((x) => x.hackathonId === v.hackathonId && (x.trackId ?? NIL) === (v.trackId ?? NIL) && x.voterUserId === v.voterUserId);
      if (existing) { Object.assign(existing, { submissionId: v.submissionId, ipHash: v.ipHash }); return { changed: true }; }
      state.votes.push({ ...v });
      return { changed: false };
    }),
    deleteVote: vi.fn(async (_tx: unknown, hackathonId: string, trackId: string | null, voterUserId: string) => {
      const before = state.votes.length;
      state.votes = state.votes.filter((x) => !(x.hackathonId === hackathonId && (x.trackId ?? NIL) === (trackId ?? NIL) && x.voterUserId === voterUserId));
      return before - state.votes.length;
    }),
    voteTotals: vi.fn(async () => ({ votes: state.votes.length, voters: new Set(state.votes.map((v) => v.voterUserId)).size })),
    ipBucketRows: vi.fn(async () => {
      const m = new Map<string | null, number>();
      for (const v of state.votes) m.set(v.ipHash ?? null, (m.get(v.ipHash ?? null) ?? 0) + 1);
      return [...m].map(([ipHash, votes]) => ({ ipHash, votes }));
    }),
    countedVotes: vi.fn(async () => state.votes
      .filter((v) => state.subs.find((s) => s.id === v.submissionId)?.status === 'submitted')
      .filter((v) => {
        const voter = Object.values(users).find((u) => u.id === v.voterUserId);
        const team = state.subs.find((s) => s.id === v.submissionId)!.teamId;
        return !ownTeams(v.voterUserId, voter?.email).includes(team);
      })
      .map((v) => ({ submissionId: v.submissionId, trackId: v.trackId }))),
    submittedProjects: vi.fn(async () => state.subs.filter((s) => s.status === 'submitted').map((s) => ({ id: s.id, name: s.name, slug: s.slug, teamName: s.teamName, trackIds: s.trackIds }))),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  installStore();
  server = app();
  const tx = { hackathonVote: { count: vi.fn(async () => state.votes.length) } };
  mockPrisma.$transaction = vi.fn(async (fn: any) => fn(tx));
  // hosts: host (tab) and cohost (no tab)
  canEdit.mockImplementation(async (_p: string, _u?: string, email?: string) => email === 'host@example.com' || email === 'cohost@example.com');
  canTab.mockImplementation(async (_p: string, email?: string) => email === 'host@example.com');
  canSee.mockImplementation(async () => true);
});

const base = `/api/parties/${PARTY}/hackathon`;
const vote = (who: string, body: Row, ip = '203.0.113.7') =>
  request(server).post(`${base}/votes`).set('Authorization', auth(who)).set('X-Forwarded-For', ip).send(body);

// ------------------------------------------------------------------ public read

describe('GET /voting (voter state)', () => {
  it('logged out: window + scope + who can vote, "log in", and never any counts', async () => {
    state.votes.push({ hackathonId: HID, trackId: null, submissionId: S_A, voterUserId: users.carol.id, ipHash: 'f'.repeat(64) });
    const r = await request(server).get(`${base}/voting`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body.voting).toMatchObject({ status: 'open', scope: 'event', eligibility: 'checked_in' });
    expect(r.body.me).toMatchObject({ loggedIn: false, eligible: false, reason: 'login', votes: [] });
    const json = JSON.stringify(r.body);
    for (const leak of ['totals', 'results', 'tally', 'ipHash', 'ffffffff', users.carol.id, S_A]) expect(json).not.toContain(leak);
  });

  it("logged in: eligibility, the caller's own votes and own project, never others' votes", async () => {
    state.votes.push({ hackathonId: HID, trackId: null, submissionId: S_B, voterUserId: users.carol.id, ipHash: null });
    let r = await request(server).get(`${base}/voting`).set('Authorization', auth('alice'));
    expect(r.body.me).toMatchObject({ loggedIn: true, eligible: true, votes: [], ownProjectSlugs: ['slice-router'] });
    r = await request(server).get(`${base}/voting`).set('Authorization', auth('carol'));
    expect(r.body.me.votes).toEqual([{ trackId: null, projectSlug: 'pepperoni-pass' }]);
    r = await request(server).get(`${base}/voting`).set('Authorization', auth('dave'));
    expect(r.body.me).toMatchObject({ eligible: false, reason: 'not_checked_in' });
    expect(r.body.me.message).toMatch(/checked-in/);
  });

  it('nothing for an unpublished / disabled hackathon or a hidden event', async () => {
    state.h.publishedAt = null;
    expect((await request(server).get(`${base}/voting`)).body).toMatchObject({ voting: null, me: null });
    state.h.publishedAt = ago(5);
    canSee.mockImplementation(async () => false);
    expect((await request(server).get(`${base}/voting`)).body).toMatchObject({ voting: null });
    expect((await request(server).get(`/api/parties/not-a-uuid/hackathon/voting`)).status).toBe(404);
  });
});

// ------------------------------------------------------------------ casting

describe('POST /votes', () => {
  it('login required (401), nothing written', async () => {
    const r = await request(server).post(`${base}/votes`).send({ projectSlug: 'slice-router' });
    expect(r.status).toBe(401);
    expect(state.votes).toHaveLength(0);
  });

  it('an eligible checked-in attendee votes (201); ip_hash is a 64-hex HMAC, never the IP', async () => {
    const r = await vote('carol', { projectSlug: 'slice-router' }, '198.51.100.23');
    expect(r.status).toBe(201);
    expect(r.body.changed).toBe(false);
    expect(r.body.me.votes).toEqual([{ trackId: null, projectSlug: 'slice-router' }]);
    expect(state.votes).toHaveLength(1);
    expect(state.votes[0]).toMatchObject({ hackathonId: HID, trackId: null, submissionId: S_A, voterUserId: users.carol.id });
    expect(state.votes[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(state.votes[0])).not.toContain('198.51');
    expect(JSON.stringify(r.body)).not.toMatch(/ipHash|198\.51/);
  });

  it('eligibility: checked_in (default) rejects registered-only, pending and no-RSVP voters; registered accepts registered', async () => {
    for (const [who, reason] of [['dave', 'not_checked_in'], ['pending', 'pending_approval'], ['rando', 'no_rsvp']] as const) {
      const r = await vote(who, { projectSlug: 'slice-router' });
      expect(r.status, who).toBe(403);
      expect(r.body.error.code).toBe('NOT_ELIGIBLE');
      expect(r.body.error.reason).toBe(reason);
    }
    expect(state.votes).toHaveLength(0);
    state.voting!.eligibility = 'registered';
    expect((await vote('dave', { projectSlug: 'slice-router' })).status).toBe(201);
    expect((await vote('pending', { projectSlug: 'slice-router' })).status).toBe(403); // still needs approval
  });

  it('hosts vote like anyone else when they qualify (no special pass)', async () => {
    expect((await vote('host', { projectSlug: 'slice-router' })).status).toBe(201);
    expect((await vote('cohost', { projectSlug: 'slice-router' })).status).toBe(403); // no RSVP
  });

  it('window: scheduled / off / closed are rejected (409), server time decides', async () => {
    state.voting!.opensAt = later(5);
    let r = await vote('carol', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([409, 'VOTING_NOT_OPEN']);
    state.voting = null;
    r = await vote('carol', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([409, 'VOTING_NOT_OPEN']);
    state.voting = { enabled: true, scope: 'event', eligibility: 'checked_in', opensAt: ago(60), closesAt: ago(1) };
    r = await vote('carol', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([409, 'VOTING_CLOSED']);
    state.voting = { enabled: false, scope: 'event', eligibility: 'checked_in', opensAt: ago(60), closesAt: null };
    expect((await vote('carol', { projectSlug: 'slice-router' })).status).toBe(409);
    expect(state.votes).toHaveLength(0);
  });

  it('a close that commits while the vote is in flight wins (re-check under the settings lock)', async () => {
    store.lockVotingShared.mockImplementationOnce(async () => ({ ...state.voting, closesAt: ago(0.01) }));
    const r = await vote('carol', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([409, 'VOTING_CLOSED']);
    expect(store.upsertVote).not.toHaveBeenCalled();
  });

  it('only gallery-visible, submitted projects', async () => {
    state.h.galleryVisibility = 'after_reveal';
    let r = await vote('carol', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([409, 'GALLERY_CLOSED']);
    state.h.galleryVisibility = 'after_deadline';
    for (const slug of ['half-baked', 'totally-original', 'no-such-project']) {
      r = await vote('carol', { projectSlug: slug });
      expect(r.status, slug).toBe(404);
    }
    expect(state.votes).toHaveLength(0);
  });

  it("self-votes are blocked: by user id, and by the team member's RSVP email on another account", async () => {
    let r = await vote('alice', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([403, 'OWN_PROJECT']);
    r = await vote('alt', { projectSlug: 'slice-router' });
    expect([r.status, r.body.error.code]).toEqual([403, 'OWN_PROJECT']);
    // ...but they can vote for another team.
    expect((await vote('alice', { projectSlug: 'pepperoni-pass' })).status).toBe(201);
    expect(state.votes).toHaveLength(1);
  });

  it('one vote per scope: a second vote changes it (200, changed), and it can be retracted while open', async () => {
    expect((await vote('carol', { projectSlug: 'slice-router' })).status).toBe(201);
    const r = await vote('carol', { projectSlug: 'pepperoni-pass' });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);
    expect(state.votes).toHaveLength(1);
    expect(state.votes[0].submissionId).toBe(S_B);
    const d = await request(server).delete(`${base}/votes`).set('Authorization', auth('carol'));
    expect(d.status).toBe(200);
    expect(d.body.me.votes).toEqual([]);
    expect(state.votes).toHaveLength(0);
  });

  it('after close votes are final: no change, no retract', async () => {
    await vote('carol', { projectSlug: 'slice-router' });
    state.voting!.closesAt = ago(0.01);
    expect((await vote('carol', { projectSlug: 'pepperoni-pass' })).status).toBe(409);
    expect((await request(server).delete(`${base}/votes`).set('Authorization', auth('carol'))).status).toBe(409);
    expect(state.votes[0].submissionId).toBe(S_A);
  });

  it('track scope: one vote per track, the track is required and must be one the project entered', async () => {
    state.voting!.scope = 'track';
    let r = await vote('carol', { projectSlug: 'slice-router' });
    expect(r.status).toBe(400);
    r = await vote('carol', { projectSlug: 'slice-router', trackId: T2 });
    expect([r.status, r.body.error.code]).toEqual([400, 'WRONG_TRACK']);
    expect((await vote('carol', { projectSlug: 'slice-router', trackId: T1 })).status).toBe(201);
    expect((await vote('carol', { projectSlug: 'pepperoni-pass', trackId: T2 })).status).toBe(201);
    expect(state.votes).toHaveLength(2);
    const d = await request(server).delete(`${base}/votes?trackId=${T1}`).set('Authorization', auth('carol'));
    expect(d.body.me.votes).toEqual([{ trackId: T2, projectSlug: 'pepperoni-pass' }]);
    // event scope rejects a track id
    state.voting!.scope = 'event';
    expect((await vote('carol', { projectSlug: 'slice-router', trackId: T1 })).status).toBe(400);
  });

  it('rate limit: 20 vote writes / hour / user, then 429', async () => {
    const who = 'carol';
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await vote(who, { projectSlug: i % 2 ? 'slice-router' : 'pepperoni-pass' })).status;
      if (i < 20) expect(last, `write ${i + 1}`).toBeLessThan(300);
    }
    expect(last).toBe(429);
  });
});

// ------------------------------------------------------------------ host

describe('host voting routes', () => {
  const host = (m: 'get' | 'put' | 'post', path: string, who = 'host') => (request(server) as any)[m](`${base}${path}`).set('Authorization', auth(who));

  it('authz: anonymous 401; participant / random user / co-host without the tab 403', async () => {
    for (const [m, path] of [['get', '/voting/host'], ['put', '/voting'], ['post', '/voting/open'], ['post', '/voting/close']] as const) {
      expect((await (request(server) as any)[m](`${base}${path}`).send({})).status, `${m} ${path}`).toBe(401);
      for (const who of ['alice', 'rando', 'cohost']) expect((await host(m, path, who).send({})).status, `${who} ${m} ${path}`).toBe(403);
    }
  });

  it('while open: only totals and ip buckets; NO per-project tally, not even for the host', async () => {
    await vote('carol', { projectSlug: 'slice-router' }, '203.0.113.1');
    await vote('bob', { projectSlug: 'slice-router' }, '203.0.113.1');
    await vote('host', { projectSlug: 'pepperoni-pass' }, '203.0.113.9');
    const r = await host('get', '/voting/host');
    expect(r.status).toBe(200);
    expect(r.body.settings.status).toBe('open');
    expect(r.body.totals).toEqual({ votes: 3, voters: 3 });
    expect(r.body.results).toBeNull();
    expect(r.body.ip.bucketCount).toBe(2);
    expect(r.body.ip.buckets[0].votes).toBe(2);
    expect(r.body.ip.buckets[0].label).toMatch(/^[0-9a-f]{8}$/);
    const json = JSON.stringify(r.body);
    expect(json).not.toContain('203.0.113');
    expect(json).not.toContain(state.votes[0].ipHash); // only the 8-hex prefix
    expect(json).not.toContain('slice-router');
  });

  it("after close: tallies (self-votes and non-submitted dropped) + People's Choice suggestion", async () => {
    await vote('carol', { projectSlug: 'slice-router' });
    await vote('bob', { projectSlug: 'slice-router' });
    await vote('alice', { projectSlug: 'pepperoni-pass' });
    // a vote that slipped in for alice's own project (e.g. she joined the team later) doesn't count
    state.votes.push({ hackathonId: HID, trackId: null, submissionId: S_A, voterUserId: users.alt.id, ipHash: null });
    const closed = await host('post', '/voting/close');
    expect(closed.status).toBe(200);
    expect(closed.body.settings.status).toBe('closed');
    expect(closed.body.results.countedVotes).toBe(3);
    expect(closed.body.results.overall.map((r: Row) => [r.slug, r.votes, r.rank])).toEqual([['slice-router', 2, 1], ['pepperoni-pass', 1, 2]]);
    expect(closed.body.results.suggestions[P_PC]).toEqual([S_A]);
    expect(closed.body.peoplesChoicePrizes.map((p: Row) => p.id)).toEqual([P_PC]);
    // closing again is idempotent; public read still has no counts
    expect((await host('post', '/voting/close')).body.settings.status).toBe('closed');
    const pub = await request(server).get(`${base}/voting`);
    expect(JSON.stringify(pub.body)).not.toMatch(/"votes":\s*[1-9]|countedVotes|results/);
  });

  it('settings: save, window check, scope locked once votes exist; manual open re-opens', async () => {
    state.voting = null;
    let r = await host('put', '/voting').send({ enabled: true, scope: 'track', eligibility: 'registered', opensAt: later(10).toISOString(), closesAt: later(70).toISOString() });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ enabled: true, scope: 'track', eligibility: 'registered', status: 'scheduled' });
    r = await host('put', '/voting').send({ closesAt: later(5).toISOString() });
    expect(r.status).toBe(400);
    r = await host('post', '/voting/open');
    expect(r.body.settings.status).toBe('open');
    expect((await vote('dave', { projectSlug: 'slice-router', trackId: T1 })).status).toBe(201);
    r = await host('put', '/voting').send({ scope: 'event' });
    expect([r.status, r.body.error.code]).toEqual([409, 'VOTING_SCOPE_LOCKED']);
    r = await host('put', '/voting').send({ eligibility: 'checked_in' });
    expect(r.status).toBe(200);
    await host('post', '/voting/close');
    r = await host('post', '/voting/open');
    expect(r.body.settings.status).toBe('open');
    expect(r.body.results).toBeNull(); // re-opened: tallies hidden again
    expect((await host('put', '/voting').send({ scope: 'bogus' })).status).toBe(400);
  });
});
