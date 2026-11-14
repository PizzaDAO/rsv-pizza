/**
 * Hackathon PR 4 (judging): judge authz matrix, track scope, conflict of interest, blind-mode
 * response shape, score validation, judging open/closed, rubric changes after scoring, host
 * leaderboard math + authz, and privacy (no judge emails / scores to the public).
 * Prisma is an in-memory fake (just the query API these routes use).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = 'test-secret-hackathon-judge-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: canEdit, canUserAccessTab: canTab }));
vi.mock('../helpers/eventVisibility.js', () => ({ isEventHiddenFrom: vi.fn(async () => false) }));

const media = vi.hoisted(() => ({
  signImagePaths: vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}?t=1`]))),
}));
vi.mock('../lib/hackathon/media.js', async (orig) => ({ ...(await orig<typeof import('../lib/hackathon/media.js')>()), ...media }));

import judgeRoutes, { judgeScoreLimiter } from './hackathon-judge.routes.js';
import hackathonRoutes from './hackathon.routes.js';
import hackathonPublicRoutes from './hackathon-public.routes.js';
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
  a.use('/api/hackathon-judge', judgeRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const HID = '22222222-2222-4222-8222-222222222222';
const OTHER_PARTY = '99999999-9999-4999-8999-999999999999';
const OTHER_HID = '88888888-8888-4888-8888-888888888888';
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '33333333-3333-4333-8333-444444444444';
const T3 = '33333333-3333-4333-8333-555555555555'; // no projects
const sid = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const S_A = sid(1); // submitted, T1, team alice
const S_B = sid(2); // submitted, T2, team bob + carol (carol is also a judge -> conflict)
const S_C = sid(3); // submitted, T2, team dave
const S_DRAFT = sid(4);
const S_DQ = sid(5);
const S_OTHER = sid(6); // other hackathon
const CI = '66666666-6666-4666-8666-000000000001'; // Impact w3 max 5
const CT = '66666666-6666-4666-8666-000000000002'; // Tech w1 max 10

type Row = Record<string, any>;
let db: Record<string, Row[]>;
let inTx = false;
let seq = 0;
const nextTime = () => new Date(Date.UTC(2027, 0, 1) + ++seq * 1000);

const USERS: Record<string, { id: string; email: string; name: string }> = {
  host: { id: 'u-host', email: 'host@example.com', name: 'Hosty' },
  judge: { id: 'u-j', email: 'judge@example.com', name: 'Judge Judy' },
  scoped: { id: 'u-s', email: 'scoped@example.com', name: 'Scoped' },
  removed: { id: 'u-r', email: 'removed@example.com', name: 'Removed' },
  other: { id: 'u-o', email: 'other@example.com', name: 'Other' },
  carol: { id: 'u-c', email: 'carol@example.com', name: 'Carol' },
  alice: { id: 'u-a', email: 'alice@example.com', name: 'Alice' },
  bob: { id: 'u-b', email: 'bob@example.com', name: 'Bob' },
  dave: { id: 'u-d', email: 'dave@example.com', name: 'Dave' },
  rando: { id: 'u-x', email: 'rando@example.com', name: 'Rando' },
};
const auth = (who: keyof typeof USERS, emailOverride?: string) =>
  `Bearer ${jwt.sign({ userId: USERS[who].id, email: emailOverride ?? USERS[who].email }, JWT_SECRET, { expiresIn: '1h' })}`;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === 'tracks' && cond?.some) {
      const tc = cond.some.trackId;
      const ids: string[] = typeof tc === 'string' ? [tc] : tc.in;
      const rel = row.email !== undefined
        ? db.hackathonJudgeTrack.filter((t) => t.judgeId === row.id)
        : db.hackathonSubmissionTrack.filter((t) => t.submissionId === row.id);
      if (!rel.some((t) => ids.includes(t.trackId))) return false;
      continue;
    }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(v)) return false;
      continue;
    }
    if (cond === null ? v !== null && v !== undefined : v !== cond) return false;
  }
  return true;
}

function withInclude(table: string, row: Row): Row {
  const out: Row = { ...row };
  if (table === 'hackathonSubmission') {
    out.tracks = db.hackathonSubmissionTrack.filter((t) => t.submissionId === row.id).map((t) => ({ trackId: t.trackId }));
    const team = db.hackathonTeam.find((t) => t.id === row.teamId);
    out.team = team && {
      name: team.name,
      members: db.hackathonTeamMember.filter((m) => m.teamId === team.id).map((m) => ({
        ...m,
        user: db.user.find((u) => u.id === m.userId) ?? null,
        guest: db.guest.find((g) => g.id === m.guestId) ?? null,
      })),
    };
  }
  if (table === 'hackathonJudge') {
    out.tracks = db.hackathonJudgeTrack.filter((t) => t.judgeId === row.id).map((t) => ({ trackId: t.trackId }));
  }
  if (table === 'hackathon') {
    out.tracks = db.hackathonTrack.filter((t) => t.hackathonId === row.id);
    out.prizes = [];
    out.criteria = db.hackathonCriterion.filter((c) => c.hackathonId === row.id).sort((a, b) => a.sortOrder - b.sortOrder);
    out.judges = db.hackathonJudge.filter((j) => j.hackathonId === row.id).map((j) => ({
      ...j,
      tracks: db.hackathonJudgeTrack.filter((t) => t.judgeId === j.id).map((t) => ({ trackId: t.trackId })),
    }));
  }
  return out;
}

function fakeModel(table: string) {
  const rows = () => db[table];
  return {
    findUnique: vi.fn(async ({ where }: Row) => {
      const r = rows().find((x) => matches(x, where));
      return r ? withInclude(table, r) : null;
    }),
    findFirst: vi.fn(async ({ where }: Row = {}) => {
      const r = rows().find((x) => matches(x, where));
      return r ? withInclude(table, r) : null;
    }),
    findMany: vi.fn(async ({ where }: Row = {}) => rows().filter((x) => matches(x, where)).map((r) => withInclude(table, r))),
    count: vi.fn(async ({ where }: Row = {}) => rows().filter((x) => matches(x, where)).length),
    create: vi.fn(async ({ data }: Row) => {
      const row = { id: crypto.randomUUID(), createdAt: nextTime(), ...data };
      rows().push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const rs = rows().filter((x) => matches(x, where));
      for (const r of rs) Object.assign(r, data);
      return { count: rs.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: Row) => {
      const key = where.judgeId_submissionId;
      const r = rows().find((x) => x.judgeId === key.judgeId && x.submissionId === key.submissionId);
      if (r) {
        Object.assign(r, update, { updatedAt: nextTime() });
        return { ...r };
      }
      const row = { id: crypto.randomUUID(), createdAt: nextTime(), updatedAt: nextTime(), ...create };
      rows().push(row);
      return { ...row };
    }),
    aggregate: vi.fn(async () => ({ _max: { sortOrder: null } })),
    delete: vi.fn(async ({ where }: Row) => {
      const i = rows().findIndex((x) => matches(x, where));
      if (i < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      const [r] = rows().splice(i, 1);
      if (table === 'hackathonTrack') db.hackathonJudgeTrack = db.hackathonJudgeTrack.filter((t) => t.trackId !== r.id);
      return r;
    }),
    deleteMany: vi.fn(async ({ where }: Row) => {
      const before = rows().length;
      db[table] = rows().filter((x) => !matches(x, where));
      return { count: before - db[table].length };
    }),
    createMany: vi.fn(async ({ data }: Row) => {
      for (const d of data) rows().push({ ...d });
      return { count: data.length };
    }),
  };
}

function hackathonRow(over: Row = {}): Row {
  return {
    id: HID, partyId: PARTY, rules: null, publishedAt: new Date('2027-01-01'), disabledAt: null, eligibility: 'registered',
    submissionsOpenAt: null, submissionDeadline: null, teamMinSize: 1, teamMaxSize: 5, maxTracksPerSubmission: 2,
    blindJudging: false, judgingStatus: 'open', galleryVisibility: 'after_reveal', resultsRevealedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function seed() {
  seq = 0;
  const sub = (id: string, hackathonId: string, teamId: string, status: string, name: string) => ({
    id, hackathonId, teamId, status, name, slug: name.toLowerCase(), tagline: `${name} tagline`, description: `${name} description`,
    repoUrl: `https://github.com/${name.toLowerCase()}`, demoVideoUrl: 'https://youtu.be/demo', deckUrl: null, liveUrl: `https://${name.toLowerCase()}.app`,
    coverPath: `${hackathonId}/${id}/cover.png`, screenshotPaths: [`${hackathonId}/${id}/shot.png`], tableNumber: null,
    submittedAt: status === 'draft' ? null : nextTime(), disqualifiedReason: null, createdAt: nextTime(), updatedAt: nextTime(),
  });
  const member = (teamId: string, who: keyof typeof USERS, guestEmail?: string) => ({
    id: `m-${teamId}-${who}`, teamId, hackathonId: HID, userId: USERS[who].id, guestId: guestEmail ? `g-${who}` : null, role: 'member', joinedAt: nextTime(),
  });
  db = {
    hackathon: [hackathonRow(), hackathonRow({ id: OTHER_HID, partyId: OTHER_PARTY })],
    hackathonTrack: [
      { id: T1, hackathonId: HID, name: 'DeFi', description: null, sponsorName: null, sortOrder: 0 },
      { id: T2, hackathonId: HID, name: 'Consumer', description: null, sponsorName: null, sortOrder: 1 },
      { id: T3, hackathonId: HID, name: 'Infra', description: null, sponsorName: null, sortOrder: 2 },
    ],
    hackathonCriterion: [
      { id: CI, hackathonId: HID, name: 'Impact', description: null, weight: 3, maxScore: 5, sortOrder: 0 },
      { id: CT, hackathonId: HID, name: 'Tech', description: null, weight: 1, maxScore: 10, sortOrder: 1 },
    ],
    hackathonJudge: [
      { id: 'j-all', hackathonId: HID, email: 'judge@example.com', name: 'Judge Judy', userId: null, status: 'active' },
      { id: 'j-t1', hackathonId: HID, email: 'scoped@example.com', name: 'Scoped', userId: null, status: 'active' },
      { id: 'j-rm', hackathonId: HID, email: 'removed@example.com', name: 'Gone', userId: 'u-r', status: 'removed' },
      { id: 'j-carol', hackathonId: HID, email: 'carol@example.com', name: 'Carol', userId: null, status: 'active' },
      { id: 'j-t3', hackathonId: HID, email: 't3@example.com', name: 'Tia Three', userId: null, status: 'active' },
      { id: 'j-multi', hackathonId: HID, email: 'multi@example.com', name: 'Multi', userId: null, status: 'active' },
      { id: 'j-other', hackathonId: OTHER_HID, email: 'other@example.com', name: 'Other', userId: null, status: 'active' },
    ],
    hackathonJudgeTrack: [
      { judgeId: 'j-t1', trackId: T1, hackathonId: HID },
      { judgeId: 'j-t3', trackId: T3, hackathonId: HID },
      { judgeId: 'j-multi', trackId: T1, hackathonId: HID },
      { judgeId: 'j-multi', trackId: T3, hackathonId: HID },
    ],
    hackathonPrize: [],
    user: Object.values(USERS).map((u) => ({ id: u.id, email: u.email, name: u.name, profilePictureUrl: null })),
    guest: [{ id: 'g-carol', partyId: PARTY, email: 'Carol@Example.com', name: 'Carol (rsvp)' }],
    hackathonTeam: [
      { id: 'team-a', hackathonId: HID, name: 'Crust Coders', inviteCode: 'aaaaaaaaaa' },
      { id: 'team-b', hackathonId: HID, name: 'Mozz Labs', inviteCode: 'bbbbbbbbbb' },
      { id: 'team-c', hackathonId: HID, name: 'Dough Bros', inviteCode: 'cccccccccc' },
      { id: 'team-d', hackathonId: HID, name: 'Drafty', inviteCode: 'dddddddddd' },
      { id: 'team-e', hackathonId: HID, name: 'Cheaters', inviteCode: 'eeeeeeeeee' },
      { id: 'team-o', hackathonId: OTHER_HID, name: 'Elsewhere', inviteCode: 'oooooooooo' },
    ],
    hackathonTeamMember: [
      member('team-a', 'alice'), member('team-b', 'bob'),
      // Carol's account email differs in case only through her RSVP row: conflict via guest email.
      { ...member('team-b', 'carol', 'x'), userId: 'u-unrelated' },
      member('team-c', 'dave'),
    ],
    hackathonSubmission: [
      sub(S_A, HID, 'team-a', 'submitted', 'Slice'),
      sub(S_B, HID, 'team-b', 'submitted', 'Mozz'),
      sub(S_C, HID, 'team-c', 'submitted', 'Dough'),
      sub(S_DRAFT, HID, 'team-d', 'draft', 'Drafty'),
      { ...sub(S_DQ, HID, 'team-e', 'disqualified', 'Cheat'), disqualifiedReason: 'old code' },
      sub(S_OTHER, OTHER_HID, 'team-o', 'submitted', 'Elsewhere'),
    ],
    hackathonSubmissionTrack: [
      { submissionId: S_A, trackId: T1, hackathonId: HID },
      { submissionId: S_B, trackId: T2, hackathonId: HID },
      { submissionId: S_C, trackId: T2, hackathonId: HID },
      { submissionId: S_DRAFT, trackId: T1, hackathonId: HID },
      { submissionId: S_DQ, trackId: T1, hackathonId: HID },
    ],
    hackathonScore: [],
  };
}

const setHackathon = (over: Row) => Object.assign(db.hackathon[0], over);

/** Simulates a concurrent write that commits between the route's pre-checks and its transaction. */
function raceIntoNextTransaction(before: () => void) {
  const real = mockPrisma.$transaction;
  mockPrisma.$transaction = vi.fn(async (fn: any, opts?: any) => {
    mockPrisma.$transaction = real;
    before();
    return real(fn, opts);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  for (const t of ['hackathon', 'hackathonTrack', 'hackathonCriterion', 'hackathonJudge', 'hackathonJudgeTrack', 'hackathonSubmission', 'hackathonScore', 'hackathonTeam', 'party', 'guest', 'hackathonPrize', 'hackathonSubmissionTrack']) {
    mockPrisma[t] = fakeModel(t);
  }
  db.party = [{ id: PARTY, eventType: null, eventTags: [], date: null, region: null, city: null, password: null }];
  mockPrisma.$transaction = vi.fn(async (arg: any) => {
    if (typeof arg !== 'function') return Promise.all(arg);
    inTx = true;
    try { return await arg(mockPrisma); } finally { inTx = false; }
  });
  mockPrisma.$queryRaw = vi.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM hackathons') && sql.includes('FOR UPDATE')) {
      const [id] = vals;
      return db.hackathon.filter((h) => h.id === id).map((h) => ({ id: h.id }));
    }
    if (sql.includes('FROM hackathon_judges') && sql.includes('FOR SHARE')) {
      const [id, hackathonId] = vals;
      return db.hackathonJudge.filter((j) => j.id === id && j.hackathonId === hackathonId).map((j) => ({ status: j.status }));
    }
    if (sql.includes('FROM hackathon_submissions') && sql.includes('FOR SHARE')) {
      const [id, hackathonId] = vals;
      return db.hackathonSubmission.filter((x) => x.id === id && x.hackathonId === hackathonId).map((x) => ({ status: x.status }));
    }
    if (sql.includes('FROM hackathon_judges')) {
      const [hackathonId, email] = vals;
      return db.hackathonJudge
        .filter((j) => j.hackathonId === hackathonId && j.email.toLowerCase() === String(email).toLowerCase())
        .map((j) => ({ id: j.id, name: j.name, user_id: j.userId, status: j.status }));
    }
    if (sql.includes('FROM hackathons') && sql.includes('FOR SHARE')) {
      const [id] = vals;
      return db.hackathon.filter((h) => h.id === id).map((h) => ({ judging_status: h.judgingStatus }));
    }
    throw new Error('unexpected raw query: ' + sql);
  });
  mockPrisma.$executeRaw = vi.fn(async (q: any, ...rest: any[]) => {
    // Prisma.sql object (retotal) or a tagged template.
    const strings: readonly string[] = q?.strings ?? q;
    const vals: any[] = q?.values ?? rest;
    const sql = strings.join('?');
    if (sql.includes('UPDATE hackathon_scores AS s SET total')) {
      if (!inTx) throw new Error('retotal must run inside the criterion transaction');
      const pairs = vals.slice(0, -1);
      for (let i = 0; i < pairs.length; i += 2) {
        const sc = db.hackathonScore.find((x) => x.id === pairs[i]);
        if (sc) sc.total = pairs[i + 1];
      }
      return pairs.length / 2;
    }
    throw new Error('unexpected raw SQL: ' + sql);
  });
  canEdit.mockImplementation(async (_p: string, _u?: string, email?: string) => email === 'host@example.com');
  canTab.mockImplementation(async () => true);
  for (const u of Object.values(USERS)) judgeScoreLimiter.resetKey(u.id);
});

const api = () => request(app());
const jbase = (party = PARTY) => `/api/hackathon-judge/${party}`;
const hbase = `/api/parties/${PARTY}/hackathon`;
const goodScores = { [CI]: 4, [CT]: 7 }; // total 77.5

async function score(who: keyof typeof USERS, subId: string, scores: Row = goodScores, extra: Row = {}) {
  return api().put(`${jbase()}/submissions/${subId}/score`).set('Authorization', auth(who)).send({ scores, ...extra });
}

// ------------------------------------------------------------------ authz

describe('judge authz', () => {
  it('anonymous -> 401', async () => {
    expect((await api().get(`${jbase()}/queue`)).status).toBe(401);
    expect((await api().put(`${jbase()}/submissions/${S_A}/score`).send({ scores: goodScores })).status).toBe(401);
  });

  it.each([
    ['rando', 'NOT_A_JUDGE'],
    ['removed', 'JUDGE_REMOVED'],
    ['other', 'NOT_A_JUDGE'], // judge of ANOTHER hackathon
    ['host', 'NOT_A_JUDGE'], // hosts aren't judges unless added
  ] as const)('%s -> 403 %s on every judge route', async (who, code) => {
    for (const r of [
      api().get(`${jbase()}/queue`).set('Authorization', auth(who)),
      api().get(`${jbase()}/submissions/${S_A}`).set('Authorization', auth(who)),
      api().put(`${jbase()}/submissions/${S_A}/score`).set('Authorization', auth(who)).send({ scores: goodScores }),
    ]) {
      const res = await r;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(code);
    }
    expect(db.hackathonScore).toHaveLength(0);
  });

  it('bad party id / no hackathon / disabled hackathon -> 404', async () => {
    expect((await api().get(`/api/hackathon-judge/nope/queue`).set('Authorization', auth('judge'))).status).toBe(404);
    expect((await api().get(`${jbase('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')}/queue`).set('Authorization', auth('judge'))).status).toBe(404);
    setHackathon({ disabledAt: new Date() });
    expect((await api().get(`${jbase()}/queue`).set('Authorization', auth('judge'))).status).toBe(404);
  });

  it('email match is exact and case-insensitive; user_id is linked on first visit', async () => {
    const res = await api().get(`${jbase()}/queue`).set('Authorization', auth('judge', 'JUDGE@Example.COM'));
    expect(res.status).toBe(200);
    expect(db.hackathonJudge.find((j) => j.id === 'j-all')!.userId).toBe('u-j');
    // A look-alike email never matches (no ILIKE wildcards).
    const lookalike = await api().get(`${jbase()}/queue`).set('Authorization', auth('rando', 'judge_example.com'));
    expect(lookalike.status).toBe(403);
  });

  it('a judge of another hackathon gets 404 for its own project ids through this party', async () => {
    const res = await api().get(`${jbase(OTHER_PARTY)}/submissions/${S_A}`).set('Authorization', auth('other'));
    expect(res.status).toBe(404);
  });
});

// ------------------------------------------------------------------ scope

describe('queue + scope', () => {
  it('all-tracks judge: submitted projects only (no drafts, disqualified or other hackathons), unscored first', async () => {
    await score('judge', S_C);
    const res = await api().get(`${jbase()}/queue`).set('Authorization', auth('judge'));
    expect(res.status).toBe(200);
    // Unscored first, then by table number / name (Mozz, Slice), scored last.
    expect(res.body.queue.map((q: Row) => q.id)).toEqual([S_B, S_A, S_C]);
    expect(res.body.queue.map((q: Row) => q.scored)).toEqual([false, false, true]);
    expect(res.body.progress).toEqual({ scored: 1, total: 3 });
    expect(res.body.criteria.map((c: Row) => c.id)).toEqual([CI, CT]);
    expect(res.body.judgingStatus).toBe('open');
  });

  it('track-scoped judge sees only their tracks; out-of-scope project -> 404 on read and score', async () => {
    const res = await api().get(`${jbase()}/queue`).set('Authorization', auth('scoped'));
    expect(res.body.queue.map((q: Row) => q.id)).toEqual([S_A]);
    expect(res.body.tracks.map((t: Row) => t.id)).toEqual([T1]);
    expect((await api().get(`${jbase()}/submissions/${S_B}`).set('Authorization', auth('scoped'))).status).toBe(404);
    expect((await score('scoped', S_B)).status).toBe(404);
    expect((await score('scoped', S_A)).status).toBe(200);
  });

  it.each([['draft', S_DRAFT], ['disqualified', S_DQ], ['other hackathon', S_OTHER], ['bad id', 'nope']])('%s project -> 404', async (_l, id) => {
    expect((await api().get(`${jbase()}/submissions/${id}`).set('Authorization', auth('judge'))).status).toBe(404);
    expect((await score('judge', id)).status).toBe(404);
  });

  it('conflict of interest: a judge whose (RSVP) email is on the team never sees or scores it', async () => {
    const q = await api().get(`${jbase()}/queue`).set('Authorization', auth('carol'));
    expect(q.body.queue.map((x: Row) => x.id)).toEqual([S_C, S_A]);
    const d = await api().get(`${jbase()}/submissions/${S_B}`).set('Authorization', auth('carol'));
    expect(d.status).toBe(403);
    expect(d.body.error.code).toBe('CONFLICT_OF_INTEREST');
    expect((await score('carol', S_B)).status).toBe(403);
    expect(db.hackathonScore).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ blind mode

describe('blind judging response shape', () => {
  const leaks = (body: unknown, words: string[]) => words.filter((w) => JSON.stringify(body).includes(w));

  it('blind ON: no team/member names or links before scoring; links (not names) after', async () => {
    setHackathon({ blindJudging: true });
    const q = await api().get(`${jbase()}/queue`).set('Authorization', auth('judge'));
    expect(q.body.blindJudging).toBe(true);
    expect(q.body.queue.every((x: Row) => x.teamName === null)).toBe(true);
    expect(leaks(q.body, ['Crust Coders', 'Alice', 'github.com', 'slice.app'])).toEqual([]);

    const before = await api().get(`${jbase()}/submissions/${S_A}`).set('Authorization', auth('judge'));
    expect(before.body.submission).toMatchObject({ linksLocked: true, links: null, team: null, teamName: null, myScore: null });
    expect(leaks(before.body, ['Crust Coders', 'Alice', 'alice@example.com', 'github.com', 'youtu.be', 'slice.app', 'aaaaaaaaaa'])).toEqual([]);
    expect(before.body.submission.screenshots[0].url).toContain('signed.example');

    const after = await score('judge', S_A);
    expect(after.status).toBe(200);
    expect(after.body.submission.linksLocked).toBe(false);
    expect(after.body.submission.links).toEqual({ repoUrl: 'https://github.com/slice', demoVideoUrl: 'https://youtu.be/demo', deckUrl: null, liveUrl: 'https://slice.app' });
    expect(after.body.submission.team).toBeNull();
    expect(leaks(after.body, ['Crust Coders', 'Alice', 'alice@example.com'])).toEqual([]);

    // Unlocking is per judge: another judge still sees it locked.
    const other = await api().get(`${jbase()}/submissions/${S_A}`).set('Authorization', auth('scoped'));
    expect(other.body.submission.links).toBeNull();
  });

  it('blind OFF: team + member names and links; never emails, ids or the invite code', async () => {
    const d = await api().get(`${jbase()}/submissions/${S_A}`).set('Authorization', auth('judge'));
    expect(d.body.submission.team).toEqual({ name: 'Crust Coders', members: [{ name: 'Alice', avatarUrl: null }] });
    expect(d.body.submission.links.repoUrl).toBe('https://github.com/slice');
    expect(leaks(d.body, ['alice@example.com', 'u-a', 'aaaaaaaaaa', 'team-a'])).toEqual([]);
  });
});

// ------------------------------------------------------------------ scoring

describe('score writes', () => {
  it('saves the weighted total, then edits replace it (one row per judge + project)', async () => {
    const r1 = await score('judge', S_A, goodScores, { privateComment: 'Great demo', teamFeedback: 'Ship it' });
    expect(r1.status).toBe(200);
    expect(r1.body.submission.myScore).toMatchObject({ criterionScores: goodScores, total: 77.5, privateComment: 'Great demo', teamFeedback: 'Ship it' });
    expect(db.hackathonScore).toHaveLength(1);
    expect(db.hackathonScore[0]).toMatchObject({ hackathonId: HID, judgeId: 'j-all', submissionId: S_A, total: 77.5 });

    const r2 = await score('judge', S_A, { [CI]: 5, [CT]: 10 });
    expect(r2.body.submission.myScore.total).toBe(100);
    expect(r2.body.submission.myScore.privateComment).toBeNull();
    expect(db.hackathonScore).toHaveLength(1);
  });

  it.each([
    [{ [CI]: 6, [CT]: 7 }, 'over the max'],
    [{ [CI]: 0, [CT]: 7 }, 'zero'],
    [{ [CI]: 4 }, 'missing criterion'],
    [{ [CI]: 4, [CT]: 7, '66666666-6666-4666-8666-000000000099': 1 }, 'unknown criterion'],
    [{ [CI]: 4.5, [CT]: 7 }, 'fraction'],
  ] as Array<[Row, string]>)('%j (%s) -> 400, nothing stored', async (scores) => {
    const res = await score('judge', S_A, scores);
    expect(res.status).toBe(400);
    expect(db.hackathonScore).toHaveLength(0);
  });

  it('judging not open yet -> 409 JUDGING_NOT_OPEN; closed -> 409 JUDGING_CLOSED (reads still work)', async () => {
    setHackathon({ judgingStatus: 'not_started' });
    expect((await score('judge', S_A)).body.error.code).toBe('JUDGING_NOT_OPEN');
    setHackathon({ judgingStatus: 'closed' });
    const res = await score('judge', S_A);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('JUDGING_CLOSED');
    expect((await api().get(`${jbase()}/queue`).set('Authorization', auth('judge'))).status).toBe(200);
    expect(db.hackathonScore).toHaveLength(0);
  });

  it('closed between the first check and the write -> 409 (re-checked under FOR SHARE)', async () => {
    raceIntoNextTransaction(() => setHackathon({ judgingStatus: 'closed' }));
    const res = await score('judge', S_A);
    expect(res.status).toBe(409);
    expect(db.hackathonScore).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ host: judging + rubric

describe('host judging controls + rubric after scoring', () => {
  it('host opens / closes judging; judges and randos cannot', async () => {
    const close = await api().post(`${hbase}/judging`).set('Authorization', auth('host')).send({ status: 'closed' });
    expect(close.status).toBe(200);
    expect(close.body.hackathon.judgingStatus).toBe('closed');
    expect((await api().post(`${hbase}/judging`).set('Authorization', auth('host')).send({ status: 'open' })).body.hackathon.judgingStatus).toBe('open');
    expect((await api().post(`${hbase}/judging`).set('Authorization', auth('host')).send({ status: 'whatever' })).status).toBe(400);
    expect((await api().post(`${hbase}/judging`).set('Authorization', auth('judge')).send({ status: 'closed' })).status).toBe(403);
    expect((await api().post(`${hbase}/judging`).send({ status: 'closed' })).status).toBe(401);
  });

  it('once scored: add criterion / change max score / delete -> 409; weight change re-totals', async () => {
    await score('judge', S_A); // 77.5 with weights 3/1
    const add = await api().post(`${hbase}/criteria`).set('Authorization', auth('host')).send({ name: 'Design' });
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('RUBRIC_LOCKED');
    const max = await api().patch(`${hbase}/criteria/${CT}`).set('Authorization', auth('host')).send({ maxScore: 5 });
    expect(max.status).toBe(409);
    expect((await api().delete(`${hbase}/criteria/${CT}`).set('Authorization', auth('host'))).status).toBe(409);
    // Same max score + rename is fine.
    expect((await api().patch(`${hbase}/criteria/${CT}`).set('Authorization', auth('host')).send({ maxScore: 10, name: 'Technical depth' })).status).toBe(200);

    const w = await api().patch(`${hbase}/criteria/${CT}`).set('Authorization', auth('host')).send({ weight: 3 });
    expect(w.status).toBe(200);
    // (3 * 0.8 + 3 * 0.7) / 6 = 0.75
    expect(db.hackathonScore[0].total).toBe(75);
    const lb = await api().get(`${hbase}/leaderboard`).set('Authorization', auth('host'));
    expect(lb.body.overall[0]).toMatchObject({ submissionId: S_A, average: 75 });
    const mine = await api().get(`${jbase()}/submissions/${S_A}`).set('Authorization', auth('judge'));
    expect(mine.body.submission.myScore.total).toBe(75);
  });

  it('before any score the rubric stays fully editable', async () => {
    expect((await api().post(`${hbase}/criteria`).set('Authorization', auth('host')).send({ name: 'Design' })).status).toBe(201);
    expect((await api().patch(`${hbase}/criteria/${CT}`).set('Authorization', auth('host')).send({ maxScore: 5 })).status).toBe(200);
  });
});

// ------------------------------------------------------------------ leaderboard

describe('host leaderboard', () => {
  it('authz: host only (judges, participants, anonymous blocked)', async () => {
    expect((await api().get(`${hbase}/leaderboard`)).status).toBe(401);
    expect((await api().get(`${hbase}/leaderboard`).set('Authorization', auth('judge'))).status).toBe(403);
    expect((await api().get(`${hbase}/leaderboard`).set('Authorization', auth('alice'))).status).toBe(403);
    expect((await api().get(`${hbase}/leaderboard`).set('Authorization', auth('host'))).status).toBe(200);
  });

  it('averages, ties, unscored last, per track, per-criterion means, judge progress, removed judge not counted', async () => {
    await score('judge', S_A, { [CI]: 5, [CT]: 10 }, { privateComment: 'best' }); // 100
    await score('scoped', S_A, { [CI]: 3, [CT]: 4 }); // (1.8 + 0.4) / 4 = 55
    await score('judge', S_B, { [CI]: 4, [CT]: 7 }); // 77.5
    await score('carol', S_C, { [CI]: 4, [CT]: 7 }); // 77.5 -> ties S_B
    // A removed judge's old score: listed, not averaged.
    db.hackathonScore.push({ id: 'old', hackathonId: HID, judgeId: 'j-rm', submissionId: S_C, criterionScores: { [CI]: 1, [CT]: 1 }, total: 17.5, privateComment: null, teamFeedback: null, updatedAt: nextTime() });
    // A score on a now-disqualified project is not ranked.
    db.hackathonScore.push({ id: 'dq', hackathonId: HID, judgeId: 'j-all', submissionId: S_DQ, criterionScores: goodScores, total: 77.5, privateComment: null, teamFeedback: null, updatedAt: nextTime() });

    const res = await api().get(`${hbase}/leaderboard`).set('Authorization', auth('host'));
    expect(res.status).toBe(200);
    const b = res.body;
    // All three average 77.5: a three-way tie at rank 1 (more scores listed first; the host decides).
    expect(b.overall.map((r: Row) => [r.submissionId, r.average, r.scoreCount, r.rank, r.tied])).toEqual([
      [S_A, 77.5, 2, 1, true], // (100 + 55) / 2
      [S_B, 77.5, 1, 1, true],
      [S_C, 77.5, 1, 1, true], // the removed judge's 17.5 isn't averaged
    ]);
    expect(b.overall[0]).toMatchObject({ min: 55, max: 100, criterionAverages: { [CI]: 4, [CT]: 7 } });
    expect(b.byTrack.find((t: Row) => t.trackId === T1).rows.map((r: Row) => r.submissionId)).toEqual([S_A]);
    expect(b.byTrack.find((t: Row) => t.trackId === T2).rows.map((r: Row) => [r.submissionId, r.rank])).toEqual([[S_B, 1], [S_C, 1]]);
    expect(b.projects[S_C].scores.map((s: Row) => [s.judgeId, s.counted])).toEqual([['j-carol', true], ['j-rm', false]]);
    expect(b.projects[S_A].scores.find((s: Row) => s.judgeId === 'j-all')).toMatchObject({ privateComment: 'best', total: 100, judgeEmail: 'judge@example.com' });
    expect(b.projects[S_DQ]).toBeUndefined();
    const prog = Object.fromEntries(b.judges.map((j: Row) => [j.id, [j.assigned, j.scored]]));
    expect(prog).toMatchObject({ 'j-all': [3, 2], 'j-t1': [1, 1], 'j-carol': [2, 1] });
  });

  it('distinct averages rank 1, 2 and an unscored project comes last', async () => {
    await score('judge', S_B, { [CI]: 5, [CT]: 10 });
    await score('judge', S_A, goodScores);
    const b = (await api().get(`${hbase}/leaderboard`).set('Authorization', auth('host'))).body;
    expect(b.overall.map((r: Row) => [r.submissionId, r.average, r.rank])).toEqual([[S_B, 100, 1], [S_A, 77.5, 2], [S_C, null, null]]);
  });

  it('nobody scored: every project unscored with rank null', async () => {
    const b = (await api().get(`${hbase}/leaderboard`).set('Authorization', auth('host'))).body;
    expect(b.overall.map((r: Row) => [r.average, r.rank, r.scoreCount])).toEqual([[null, null, 0], [null, null, 0], [null, null, 0]]);
  });
});

// ------------------------------------------------------------------ privacy

describe('privacy', () => {
  it('public hackathon read never includes judges, judge emails, judging status or scores', async () => {
    await score('judge', S_A, goodScores, { privateComment: 'secret-comment' });
    for (const who of [undefined, 'alice', 'judge'] as const) {
      const req = api().get(hbase);
      const res = await (who ? req.set('Authorization', auth(who)) : req);
      expect(res.status).toBe(200);
      expect(res.body.canManage).toBe(false);
      const s = JSON.stringify(res.body);
      for (const leak of ['judge@example.com', 'scoped@example.com', 'secret-comment', 'judgingStatus', 'blindJudging', '"judges"', '77.5']) {
        expect(s).not.toContain(leak);
      }
    }
  });

  it('a judge never sees other judges or their scores/comments', async () => {
    await score('scoped', S_A, goodScores, { privateComment: 'scoped-secret' });
    const d = await api().get(`${jbase()}/submissions/${S_A}`).set('Authorization', auth('judge'));
    const s = JSON.stringify(d.body);
    expect(d.body.submission.myScore).toBeNull();
    for (const leak of ['scoped-secret', 'scoped@example.com', 'j-t1']) expect(s).not.toContain(leak);
  });
});

// ------------------------------------------------------------------ review fixes (races, progress, track scope)

describe('score write re-checks everything under the transaction locks', () => {
  it('judge removed between the pre-check and the write -> 403, nothing stored', async () => {
    raceIntoNextTransaction(() => { db.hackathonJudge.find((j) => j.id === 'j-all')!.status = 'removed'; });
    const res = await score('judge', S_A);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('JUDGE_REMOVED');
    expect(db.hackathonScore).toHaveLength(0);
  });

  it('project disqualified between the pre-check and the write -> 404, nothing stored', async () => {
    raceIntoNextTransaction(() => { db.hackathonSubmission.find((x) => x.id === S_A)!.status = 'disqualified'; });
    expect((await score('judge', S_A)).status).toBe(404);
    expect(db.hackathonScore).toHaveLength(0);
  });

  it("judge's tracks changed between the pre-check and the write -> 404", async () => {
    raceIntoNextTransaction(() => { db.hackathonJudgeTrack.find((t) => t.judgeId === 'j-t1')!.trackId = T2; });
    expect((await score('scoped', S_A)).status).toBe(404);
    expect(db.hackathonScore).toHaveLength(0);
  });

  it('criterion added between the pre-check and the write -> validated against the new rubric (400, no incomplete score)', async () => {
    raceIntoNextTransaction(() => {
      db.hackathonCriterion.push({ id: '66666666-6666-4666-8666-000000000003', hackathonId: HID, name: 'Design', description: null, weight: 1, maxScore: 5, sortOrder: 2 });
    });
    const res = await score('judge', S_A);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/missing: Design/);
    expect(db.hackathonScore).toHaveLength(0);
  });

  it('max score lowered between the pre-check and the write -> validated against the new max', async () => {
    raceIntoNextTransaction(() => { db.hackathonCriterion.find((c) => c.id === CT)!.maxScore = 5; });
    expect((await score('judge', S_A)).status).toBe(400); // tech 7 > new max 5
    expect(db.hackathonScore).toHaveLength(0);
  });
});

describe('rubric writes re-check "has anyone scored" under the hackathon row lock', () => {
  const firstScore = () => db.hackathonScore.push({ id: 'race', hackathonId: HID, judgeId: 'j-all', submissionId: S_A, criterionScores: goodScores, total: 77.5, privateComment: null, teamFeedback: null, updatedAt: nextTime() });

  it('add criterion racing the first score -> 409, no criterion added', async () => {
    raceIntoNextTransaction(firstScore);
    const res = await api().post(`${hbase}/criteria`).set('Authorization', auth('host')).send({ name: 'Design' });
    expect(res.status).toBe(409);
    expect(db.hackathonCriterion).toHaveLength(2);
    expect(mockPrisma.$queryRaw.mock.calls.some((c: any[]) => c[0].join('?').includes('FOR UPDATE'))).toBe(true);
  });

  it('max-score change racing the first score -> 409, unchanged', async () => {
    raceIntoNextTransaction(firstScore);
    expect((await api().patch(`${hbase}/criteria/${CT}`).set('Authorization', auth('host')).send({ maxScore: 5 })).status).toBe(409);
    expect(db.hackathonCriterion.find((c) => c.id === CT)!.maxScore).toBe(10);
  });

  it('delete racing the first score -> 409', async () => {
    raceIntoNextTransaction(firstScore);
    expect((await api().delete(`${hbase}/criteria/${CT}`).set('Authorization', auth('host'))).status).toBe(409);
    expect(db.hackathonCriterion).toHaveLength(2);
  });

  it('weight change and re-total happen in ONE transaction', async () => {
    await score('judge', S_A);
    mockPrisma.$transaction.mockClear();
    const w = await api().patch(`${hbase}/criteria/${CI}`).set('Authorization', auth('host')).send({ weight: 1 });
    expect(w.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1); // the fake throws if the UPDATE runs outside it
    // (0.8 + 0.7) / 2 = 0.75
    expect(db.hackathonScore[0].total).toBe(75);
  });
});

describe('judge progress counts only the current assignment', () => {
  it("scores outside a judge's current tracks don't count toward 'scored'", async () => {
    await score('scoped', S_A); // j-t1 judges T1 = [S_A]
    db.hackathonJudgeTrack.find((t) => t.judgeId === 'j-t1')!.trackId = T2; // now T2 = [S_B, S_C]
    const b = (await api().get(`${hbase}/leaderboard`).set('Authorization', auth('host'))).body;
    const j = b.judges.find((x: Row) => x.id === 'j-t1');
    expect([j.assigned, j.scored]).toEqual([2, 0]);
    // The score itself still counts on the leaderboard (the judge is active).
    expect(b.overall.find((r: Row) => r.submissionId === S_A).scoreCount).toBe(1);
  });
});

describe("deleting a judge's only track never widens them to all tracks", () => {
  it('409 TRACK_HAS_JUDGES naming the judge; a multi-track judge alone does not block', async () => {
    const res = await api().delete(`${hbase}/tracks/${T3}`).set('Authorization', auth('host'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRACK_HAS_JUDGES');
    expect(res.body.error.message).toMatch(/Tia Three/);
    expect(res.body.error.message).not.toMatch(/Multi/);
    expect(db.hackathonTrack.some((t) => t.id === T3)).toBe(true);

    // Re-scope Tia to T1; now only j-multi (T1 + T3) uses T3, which just narrows: allowed.
    db.hackathonJudgeTrack.find((t) => t.judgeId === 'j-t3')!.trackId = T1;
    const ok = await api().delete(`${hbase}/tracks/${T3}`).set('Authorization', auth('host'));
    expect(ok.status).toBe(200);
    expect(db.hackathonJudgeTrack.filter((t) => t.judgeId === 'j-multi').map((t) => t.trackId)).toEqual([T1]);
  });

  it('a removed judge scoped only to the track does not block', async () => {
    db.hackathonJudge.find((j) => j.id === 'j-t3')!.status = 'removed';
    expect((await api().delete(`${hbase}/tracks/${T3}`).set('Authorization', auth('host'))).status).toBe(200);
  });
});
