/**
 * Hackathon PR 5 (winners, reveal, payout tracking): authz, award validation (quantity, track
 * scope, status), payout status + recipient rules, delete-with-payout 409, reveal / un-reveal
 * rules, judging reopen while revealed, public winners (only after reveal, allowlisted fields),
 * the team's own feedback + awards on /me (no judge identity; wallet only for the recipient),
 * guards on disqualify / withdraw / prize edits, and the awards CSV.
 *
 * Prisma is an in-memory fake with just the relations these routes read.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = 'test-secret-hackathon-awards-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: canEdit, canUserAccessTab: canTab }));
vi.mock('../helpers/eventVisibility.js', () => ({ isEventHiddenFrom: vi.fn(async () => false) }));
vi.mock('../lib/hackathon/media.js', async (orig) => ({
  ...(await orig<typeof import('../lib/hackathon/media.js')>()),
  signImagePaths: vi.fn(async () => ({})),
  removeImages: vi.fn(async () => undefined),
}));

import hackathonPublicRoutes from './hackathon-public.routes.js';
import participantRoutes from './hackathon-participant.routes.js';
import hackathonRoutes from './hackathon.routes.js';
import awardsRoutes from './hackathon-awards.routes.js';
import { errorHandler } from '../middleware/error.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', hackathonPublicRoutes);
  a.use('/api/parties', participantRoutes);
  a.use('/api/parties', hackathonRoutes);
  a.use('/api/parties', awardsRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const HID = '22222222-2222-4222-8222-222222222222';
const OTHER_HID = '22222222-2222-4222-8222-999999999999';
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '33333333-3333-4333-8333-444444444444';
const P_GRAND = '44444444-4444-4444-8444-000000000001';
const P_DEFI = '44444444-4444-4444-8444-000000000002';
const P_HM = '44444444-4444-4444-8444-000000000003';
const P_PC = '44444444-4444-4444-8444-000000000004';
const P_OTHER = '44444444-4444-4444-8444-000000000009';
const S_A = '55555555-5555-4555-8555-00000000000a'; // team A, DeFi, submitted, ranked 1
const S_B = '55555555-5555-4555-8555-00000000000b'; // team B, Consumer, submitted, ranked 2
const S_DRAFT = '55555555-5555-4555-8555-00000000000c';
const S_DQ = '55555555-5555-4555-8555-00000000000d';
const M_ALICE = '66666666-6666-4666-8666-00000000000a';
const M_BOB = '66666666-6666-4666-8666-00000000000b';
const M_CAROL = '66666666-6666-4666-8666-00000000000c';

const USERS: Record<string, { id: string; email: string; name: string }> = {
  host: { id: 'u-host', email: 'host@example.com', name: 'Hosty' },
  cohost: { id: 'u-co', email: 'cohost@example.com', name: 'Co Host' },
  alice: { id: 'u-a', email: 'alice@example.com', name: 'Alice' },
  bob: { id: 'u-b', email: 'bob@example.com', name: 'Bob' },
  carol: { id: 'u-c', email: 'carol@example.com', name: 'Carol' },
  rando: { id: 'u-x', email: 'rando@example.com', name: 'Rando' },
};
const auth = (who: keyof typeof USERS) => `Bearer ${jwt.sign({ userId: USERS[who].id, email: USERS[who].email }, JWT_SECRET, { expiresIn: '1h' })}`;

// ------------------------------------------------------------------ in-memory fake prisma

type Row = Record<string, any>;
let db: Record<string, Row[]>;

/** relation name -> [table, kind, local key, foreign key] */
const RELATIONS: Record<string, Record<string, [string, 'one' | 'many', string, string]>> = {
  hackathon: {
    tracks: ['hackathonTrack', 'many', 'id', 'hackathonId'],
    prizes: ['hackathonPrize', 'many', 'id', 'hackathonId'],
    criteria: ['hackathonCriterion', 'many', 'id', 'hackathonId'],
    judges: ['hackathonJudge', 'many', 'id', 'hackathonId'],
  },
  hackathonJudge: { tracks: ['hackathonJudgeTrack', 'many', 'id', 'judgeId'] },
  hackathonAward: {
    prize: ['hackathonPrize', 'one', 'prizeId', 'id'],
    submission: ['hackathonSubmission', 'one', 'submissionId', 'id'],
    recipient: ['user', 'one', 'recipientUserId', 'id'],
  },
  hackathonSubmission: {
    tracks: ['hackathonSubmissionTrack', 'many', 'id', 'submissionId'],
    team: ['hackathonTeam', 'one', 'teamId', 'id'],
  },
  hackathonTeam: {
    members: ['hackathonTeamMember', 'many', 'id', 'teamId'],
    submissions: ['hackathonSubmission', 'many', 'id', 'teamId'],
  },
  hackathonTeamMember: { user: ['user', 'one', 'userId', 'id'], guest: ['guest', 'one', 'guestId', 'id'] },
  hackathonScore: { judge: ['hackathonJudge', 'one', 'judgeId', 'id'] },
};

function related(table: string, row: Row, rel: string): Row[] | Row | null {
  const [t, kind, local, foreign] = RELATIONS[table][rel];
  const rows = db[t].filter((r) => r[foreign] === row[local] && row[local] != null);
  return kind === 'one' ? rows[0] ?? null : rows;
}

function matches(table: string, row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (RELATIONS[table]?.[k]) {
      const [t, kind] = RELATIONS[table][k];
      const r = related(table, row, k);
      if (kind === 'one') {
        if (!r || !matches(t, r as Row, cond)) return false;
      } else if (cond?.some && !(r as Row[]).some((x) => matches(t, x, cond.some))) return false;
      continue;
    }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('not' in cond && v === cond.not) return false;
      if ('equals' in cond && v !== cond.equals) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function shape(table: string, row: Row, spec: Row | undefined): Row {
  const out: Row = { ...row };
  if (!spec) return out;
  for (const [k, v] of Object.entries(spec)) {
    if (!RELATIONS[table]?.[k] || !v) continue;
    const [t, kind] = RELATIONS[table][k];
    const nested = typeof v === 'object' ? (v.include ?? v.select) : undefined;
    const r = related(table, row, k);
    if (kind === 'one') out[k] = r ? shape(t, r as Row, nested) : null;
    else out[k] = (r as Row[]).filter((x) => matches(t, x, typeof v === 'object' ? v.where : undefined)).map((x) => shape(t, x, nested));
  }
  return out;
}

function fakeModel(table: string, defaults: () => Row = () => ({})) {
  const rows = () => db[table];
  const spec = (a: Row) => a.include ?? a.select;
  return {
    findUnique: vi.fn(async (a: Row) => { const r = rows().find((x) => matches(table, x, a.where)); return r ? shape(table, r, spec(a)) : null; }),
    findFirst: vi.fn(async (a: Row = {}) => { const r = rows().find((x) => matches(table, x, a.where)); return r ? shape(table, r, spec(a)) : null; }),
    findMany: vi.fn(async (a: Row = {}) => rows().filter((x) => matches(table, x, a.where)).slice(0, a.take ?? 1e9).map((r) => shape(table, r, spec(a)))),
    count: vi.fn(async (a: Row = {}) => rows().filter((x) => matches(table, x, a.where)).length),
    create: vi.fn(async ({ data }: Row) => {
      if (table === 'hackathonAward' && rows().some((x) => x.prizeId === data.prizeId && x.submissionId === data.submissionId)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const row = { id: crypto.randomUUID(), ...defaults(), ...data };
      rows().push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const r = rows().find((x) => matches(table, x, where));
      if (!r) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const rs = rows().filter((x) => matches(table, x, where));
      for (const r of rs) Object.assign(r, data);
      return { count: rs.length };
    }),
    delete: vi.fn(async ({ where }: Row) => {
      const i = rows().findIndex((x) => matches(table, x, where));
      if (i < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      return rows().splice(i, 1)[0];
    }),
    aggregate: vi.fn(async () => ({ _max: { sortOrder: null } })),
  };
}

const TABLES = ['hackathon', 'party', 'guest', 'user', 'hackathonTrack', 'hackathonPrize', 'hackathonCriterion', 'hackathonJudge', 'hackathonJudgeTrack',
  'hackathonTeam', 'hackathonTeamMember', 'hackathonSubmission', 'hackathonSubmissionTrack', 'hackathonScore', 'hackathonAward'];

const prizeRow = (id: string, over: Row) => ({ id, hackathonId: HID, trackId: null, description: null, rank: null, amountText: null, amountValue: null, currency: null, quantity: 1, kind: 'judged', sortOrder: 0, createdAt: new Date(), ...over });
const subRow = (id: string, teamId: string, status: string, name: string) => ({
  id, hackathonId: HID, teamId, name, slug: name.toLowerCase().replace(/\s+/g, '-'), tagline: `${name} tagline`, description: null, repoUrl: 'https://github.com/x/secret-repo',
  demoVideoUrl: null, deckUrl: null, liveUrl: null, coverPath: null, screenshotPaths: [], status, submittedAt: status === 'draft' ? null : new Date('2027-03-06T10:00:00Z'),
  disqualifiedReason: status === 'disqualified' ? 'cheated' : null, tableNumber: null, createdAt: new Date(), updatedAt: new Date(),
});

function seed() {
  const member = (id: string, teamId: string, who: keyof typeof USERS, role = 'member') => ({ id, teamId, hackathonId: HID, userId: USERS[who].id, guestId: null, role, joinedAt: new Date(), showOnGallery: true });
  db = {
    hackathon: [{
      id: HID, partyId: PARTY, rules: null, publishedAt: new Date('2027-01-01'), disabledAt: null, eligibility: 'registered', submissionsOpenAt: null,
      submissionDeadline: new Date(Date.now() + 86400_000), teamMinSize: 1, teamMaxSize: 5, maxTracksPerSubmission: 2, blindJudging: false,
      judgingStatus: 'closed', galleryVisibility: 'after_reveal', resultsRevealedAt: null, createdAt: new Date(), updatedAt: new Date(),
    }],
    party: [{ id: PARTY, requireApproval: true, eventType: null, eventTags: [], date: null, region: null, city: null, password: null }],
    guest: ['alice', 'bob', 'carol'].map((w) => ({ id: `g-${w}`, partyId: PARTY, email: USERS[w].email, approved: true, status: 'CONFIRMED', checkedInAt: null })),
    user: Object.values(USERS).map((u) => ({ ...u, profilePictureUrl: null })),
    hackathonTrack: [
      { id: T1, hackathonId: HID, name: 'DeFi', description: null, sponsorName: null, sortOrder: 0, createdAt: new Date() },
      { id: T2, hackathonId: HID, name: 'Consumer', description: null, sponsorName: null, sortOrder: 1, createdAt: new Date() },
    ],
    hackathonPrize: [
      prizeRow(P_GRAND, { name: 'Grand prize', rank: 1, amountText: '$5,000', sortOrder: 0 }),
      prizeRow(P_DEFI, { name: 'Best DeFi', trackId: T1, sortOrder: 1 }),
      prizeRow(P_HM, { name: 'Honorable mention', rank: 2, quantity: 2, sortOrder: 2 }),
      prizeRow(P_PC, { name: "People's Choice", kind: 'peoples_choice', sortOrder: 3 }),
      prizeRow(P_OTHER, { hackathonId: OTHER_HID, name: 'Elsewhere' }),
    ],
    hackathonCriterion: [{ id: 'c1', hackathonId: HID, name: 'Impact', description: null, weight: 1, maxScore: 5, sortOrder: 0, createdAt: new Date() }],
    hackathonJudge: [
      { id: 'j1', hackathonId: HID, email: 'judge1@secret.example', name: 'Judge Judy', userId: 'u-j1', status: 'active', createdAt: new Date() },
      { id: 'j2', hackathonId: HID, email: 'judge2@secret.example', name: 'Removed Rex', userId: null, status: 'removed', createdAt: new Date() },
    ],
    hackathonJudgeTrack: [],
    hackathonTeam: [
      { id: '77777777-7777-4777-8777-00000000000a', hackathonId: HID, name: 'Crust Coders', inviteCode: 'AAAAAAAAAA', createdAt: new Date() },
      { id: '77777777-7777-4777-8777-00000000000b', hackathonId: HID, name: 'Mozz Labs', inviteCode: 'BBBBBBBBBB', createdAt: new Date() },
      { id: '77777777-7777-4777-8777-00000000000c', hackathonId: HID, name: 'Drafty', inviteCode: 'CCCCCCCCCC', createdAt: new Date() },
      { id: '77777777-7777-4777-8777-00000000000d', hackathonId: HID, name: 'Bad Apples', inviteCode: 'DDDDDDDDDD', createdAt: new Date() },
    ],
    hackathonTeamMember: [member(M_ALICE, '77777777-7777-4777-8777-00000000000a', 'alice', 'captain'), member(M_BOB, '77777777-7777-4777-8777-00000000000a', 'bob'), member(M_CAROL, '77777777-7777-4777-8777-00000000000b', 'carol', 'captain')],
    hackathonSubmission: [subRow(S_A, '77777777-7777-4777-8777-00000000000a', 'submitted', 'Slice Router'), subRow(S_B, '77777777-7777-4777-8777-00000000000b', 'submitted', 'Pepperoni Pass'), subRow(S_DRAFT, '77777777-7777-4777-8777-00000000000c', 'draft', 'Half Baked'), subRow(S_DQ, '77777777-7777-4777-8777-00000000000d', 'disqualified', 'Totally Original')],
    hackathonSubmissionTrack: [
      { submissionId: S_A, trackId: T1, hackathonId: HID }, { submissionId: S_B, trackId: T2, hackathonId: HID },
      { submissionId: S_DQ, trackId: T1, hackathonId: HID },
    ],
    hackathonScore: [
      { id: 'sc1', hackathonId: HID, judgeId: 'j1', submissionId: S_A, criterionScores: { c1: 5 }, total: 100, privateComment: 'PRIVATE: loved it', teamFeedback: 'Great demo, ship it.', updatedAt: new Date() },
      { id: 'sc2', hackathonId: HID, judgeId: 'j1', submissionId: S_B, criterionScores: { c1: 3 }, total: 60, privateComment: null, teamFeedback: null, updatedAt: new Date() },
      // A removed judge's feedback is not shown to the team.
      { id: 'sc3', hackathonId: HID, judgeId: 'j2', submissionId: S_A, criterionScores: { c1: 1 }, total: 20, privateComment: null, teamFeedback: 'REMOVED JUDGE FEEDBACK', updatedAt: new Date() },
    ],
    hackathonAward: [],
  };
}

const H = () => db.hackathon[0];
const base = `/api/parties/${PARTY}/hackathon`;
const api = () => request(app());

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  for (const t of TABLES) mockPrisma[t] = fakeModel(t, t === 'hackathonAward' ? () => ({ payoutStatus: 'unpaid', recipientWallet: null, payoutReference: null, paidAt: null, payoutNotes: null, awardedAt: new Date(), updatedAt: new Date() }) : undefined);
  mockPrisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
  mockPrisma.$queryRaw = vi.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM hackathons') && (sql.includes('FOR UPDATE') || sql.includes('FOR SHARE'))) return db.hackathon.filter((h) => h.id === vals[0]).map((h) => ({ id: h.id }));
    if (sql.includes('FROM hackathon_teams') && sql.includes('FOR UPDATE')) {
      return db.hackathonTeam.filter((t) => t.id === vals[0] && t.hackathonId === vals[1]).map((t) => ({ id: t.id }));
    }
    if (sql.includes('FROM guests')) {
      return db.guest.filter((g) => g.partyId === vals[0] && g.email.toLowerCase() === String(vals[1]).toLowerCase())
        .map((g) => ({ id: g.id, approved: g.approved, status: g.status, checked_in_at: g.checkedInAt }));
    }
    throw new Error('unexpected raw query: ' + sql);
  });
  canEdit.mockImplementation(async (_p: string, _u?: string, email?: string) => email === 'host@example.com' || email === 'cohost@example.com');
  canTab.mockImplementation(async (_p: string, email?: string) => email === 'host@example.com');
});

const award = (prizeId: string, submissionId: string, extra: Row = {}) =>
  api().post(`${base}/awards`).set('Authorization', auth('host')).send({ prizeId, submissionId, ...extra });
const awardIdFor = (prizeId: string, submissionId: string) => db.hackathonAward.find((a) => a.prizeId === prizeId && a.submissionId === submissionId)!.id;

// ------------------------------------------------------------------ authz

describe('authz: awards, payouts, reveal and the awards CSV are host only', () => {
  const calls: Array<[string, string, Row?]> = [
    ['get', '/awards'],
    ['post', '/awards', { prizeId: P_GRAND, submissionId: S_A }],
    ['patch', `/awards/${crypto.randomUUID()}/payout`, { status: 'paid' }],
    ['delete', `/awards/${crypto.randomUUID()}`],
    ['post', '/reveal'],
    ['post', '/unreveal'],
    ['get', '/export.csv?kind=awards'],
  ];
  it('anonymous 401; participant / random user / co-host without the tab 403; nothing written', async () => {
    for (const [m, path, body] of calls) {
      const anon = await (api() as any)[m](base + path).send(body ?? {});
      expect(anon.status, `${m} ${path}`).toBe(401);
      for (const who of ['alice', 'rando', 'cohost'] as const) {
        const r = await (api() as any)[m](base + path).set('Authorization', auth(who)).send(body ?? {});
        expect(r.status, `${who} ${m} ${path}`).toBe(403);
      }
    }
    expect(db.hackathonAward).toHaveLength(0);
    expect(H().resultsRevealedAt).toBeNull();
  });

  it('host: GET /awards lists candidates (submitted only), prizes and leaderboard suggestions', async () => {
    const r = await api().get(`${base}/awards`).set('Authorization', auth('host'));
    expect(r.status).toBe(200);
    expect(r.body.candidates.map((c: Row) => c.id).sort()).toEqual([S_A, S_B].sort());
    expect(r.body.prizes.map((p: Row) => p.id)).not.toContain(P_OTHER);
    expect(r.body.suggestions[P_GRAND]).toEqual([S_A]);
    expect(r.body.suggestions[P_HM]).toEqual([S_B]);
    expect(r.body.suggestions[P_DEFI]).toEqual([S_A]);
    expect(r.body.suggestions[P_PC]).toBeUndefined();
    expect(r.body.ranking.overall[0]).toMatchObject({ submissionId: S_A, rank: 1 });
    // Candidates carry member ids for the recipient picker, never user ids.
    expect(JSON.stringify(r.body)).not.toContain('u-a');
    expect(r.headers['cache-control']).toBe('private, no-store');
  });
});

// ------------------------------------------------------------------ award validation

describe('awarding prizes', () => {
  it('creates an award with place 1 and the captain as default recipient', async () => {
    const r = await award(P_GRAND, S_A);
    expect(r.status).toBe(201);
    expect(db.hackathonAward[0]).toMatchObject({ hackathonId: HID, prizeId: P_GRAND, submissionId: S_A, place: 1, recipientUserId: 'u-a', awardedBy: 'u-host', payoutStatus: 'unpaid' });
    const a = r.body.awards[0];
    expect(a).toMatchObject({ projectName: 'Slice Router', teamName: 'Crust Coders', recipient: { name: 'Alice', email: 'alice@example.com' }, recipientMemberId: M_ALICE });
    // Hackathon row locked for the write.
    expect(mockPrisma.$queryRaw.mock.calls.some((c: any[]) => c[0].join('?').includes('FROM hackathons'))).toBe(true);
  });

  it('respects prize quantity (409 PRIZE_FULL) and assigns the next place', async () => {
    expect((await award(P_GRAND, S_A)).status).toBe(201);
    const full = await award(P_GRAND, S_B);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('PRIZE_FULL');
    expect((await award(P_HM, S_A)).status).toBe(201);
    expect((await award(P_HM, S_B)).status).toBe(201);
    expect(db.hackathonAward.filter((a) => a.prizeId === P_HM).map((a) => a.place).sort()).toEqual([1, 2]);
  });

  it('same project twice: 409 ALREADY_AWARDED', async () => {
    await award(P_HM, S_A);
    const r = await award(P_HM, S_A);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALREADY_AWARDED');
  });

  it('track prize only to a project in that track', async () => {
    const r = await award(P_DEFI, S_B);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('WRONG_TRACK');
    expect((await award(P_DEFI, S_A)).status).toBe(201);
  });

  it('only submitted, non-disqualified projects', async () => {
    for (const s of [S_DRAFT, S_DQ]) {
      const r = await award(P_GRAND, s);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('NOT_AWARDABLE');
    }
    expect(db.hackathonAward).toHaveLength(0);
  });

  it("another hackathon's prize, or an unknown project: 404; bad ids: 400", async () => {
    expect((await award(P_OTHER, S_A)).status).toBe(404);
    expect((await award(P_GRAND, crypto.randomUUID())).status).toBe(404);
    expect((await award('nope', S_A)).status).toBe(400);
  });

  it("People's Choice can be awarded by hand for now", async () => {
    expect((await award(P_PC, S_B)).status).toBe(201);
  });
});

// ------------------------------------------------------------------ payouts

describe('payout tracking', () => {
  const patch = (id: string, body: Row) => api().patch(`${base}/awards/${id}/payout`).set('Authorization', auth('host')).send(body);

  it('status transitions keep paid_at consistent', async () => {
    await award(P_GRAND, S_A);
    const id = awardIdFor(P_GRAND, S_A);
    let r = await patch(id, { status: 'pending', recipientWallet: '0xabc' });
    expect(r.status).toBe(200);
    expect(db.hackathonAward[0]).toMatchObject({ payoutStatus: 'pending', paidAt: null, recipientWallet: '0xabc' });
    r = await patch(id, { status: 'paid', payoutReference: '0xtxhash' });
    expect(db.hackathonAward[0].payoutStatus).toBe('paid');
    expect(db.hackathonAward[0].paidAt).toBeInstanceOf(Date);
    expect(r.body.awards[0]).toMatchObject({ payoutStatus: 'paid', payoutReference: '0xtxhash', recipientWallet: '0xabc' });
    r = await patch(id, { status: 'not_applicable' });
    expect(db.hackathonAward[0]).toMatchObject({ payoutStatus: 'not_applicable', paidAt: null });
    expect((await patch(id, { status: 'sent' })).status).toBe(400);
    expect((await patch(id, { status: 'unpaid', paidAt: '2027-03-01T00:00:00Z' })).status).toBe(400);
  });

  it('recipient must be a member of the winning team', async () => {
    await award(P_GRAND, S_A);
    const id = awardIdFor(P_GRAND, S_A);
    expect((await patch(id, { recipientMemberId: M_BOB })).status).toBe(200);
    expect(db.hackathonAward[0].recipientUserId).toBe('u-b');
    const other = await patch(id, { recipientMemberId: M_CAROL }); // team B
    expect(other.status).toBe(400);
    expect(db.hackathonAward[0].recipientUserId).toBe('u-b');
    expect((await patch(id, { recipientMemberId: null })).status).toBe(200);
    expect(db.hackathonAward[0].recipientUserId).toBeNull();
  });

  it('unknown award: 404', async () => {
    expect((await patch(crypto.randomUUID(), { status: 'paid' })).status).toBe(404);
  });

  it('delete: fine while unpaid; 409 once a payout is recorded (pending / paid / reference)', async () => {
    await award(P_GRAND, S_A);
    await award(P_HM, S_A);
    const g = awardIdFor(P_GRAND, S_A);
    await patch(g, { status: 'paid' });
    const blocked = await api().delete(`${base}/awards/${g}`).set('Authorization', auth('host'));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PAYOUT_RECORDED');
    expect(blocked.body.error.message).toMatch(/recorded payout/);
    expect(db.hackathonAward).toHaveLength(2);

    const hm = awardIdFor(P_HM, S_A);
    await patch(hm, { payoutReference: 'ref-1' });
    expect((await api().delete(`${base}/awards/${hm}`).set('Authorization', auth('host'))).status).toBe(409);
    await patch(hm, { payoutReference: null });
    const ok = await api().delete(`${base}/awards/${hm}`).set('Authorization', auth('host'));
    expect(ok.status).toBe(200);
    expect(db.hackathonAward).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ reveal

describe('reveal / un-reveal', () => {
  const reveal = () => api().post(`${base}/reveal`).set('Authorization', auth('host'));
  const unreveal = () => api().post(`${base}/unreveal`).set('Authorization', auth('host'));

  it('needs judging closed and at least one award', async () => {
    H().judgingStatus = 'open';
    await award(P_GRAND, S_A);
    let r = await reveal();
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('JUDGING_NOT_CLOSED');
    H().judgingStatus = 'closed';
    db.hackathonAward = [];
    r = await reveal();
    expect(r.body.error.code).toBe('NO_AWARDS');
    await award(P_GRAND, S_A);
    r = await reveal();
    expect(r.status).toBe(200);
    expect(r.body.hackathon.resultsRevealedAt).toBeTruthy();
    const first = H().resultsRevealedAt;
    expect((await reveal()).status).toBe(200); // idempotent, keeps the first time
    expect(H().resultsRevealedAt).toBe(first);
  });

  it('un-reveal only while no award is paid', async () => {
    await award(P_GRAND, S_A);
    await reveal();
    expect((await unreveal()).status).toBe(200);
    expect(H().resultsRevealedAt).toBeNull();
    await reveal();
    await api().patch(`${base}/awards/${awardIdFor(P_GRAND, S_A)}/payout`).set('Authorization', auth('host')).send({ status: 'paid' });
    const r = await unreveal();
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PAYOUT_RECORDED');
    expect(H().resultsRevealedAt).toBeTruthy();
  });

  it("judging can't reopen while results are revealed", async () => {
    await award(P_GRAND, S_A);
    await reveal();
    const r = await api().post(`${base}/judging`).set('Authorization', auth('host')).send({ status: 'open' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RESULTS_REVEALED');
    expect(H().judgingStatus).toBe('closed');
    await unreveal();
    expect((await api().post(`${base}/judging`).set('Authorization', auth('host')).send({ status: 'open' })).status).toBe(200);
  });
});

// ------------------------------------------------------------------ public winners

describe('public winners', () => {
  it('nothing before the reveal (and the awards table is not queried)', async () => {
    await award(P_GRAND, S_A);
    mockPrisma.hackathonAward.findMany.mockClear();
    const r = await api().get(base);
    expect(r.body.hackathon.resultsRevealedAt).toBeNull();
    expect(r.body.hackathon.winners).toEqual([]);
    expect(mockPrisma.hackathonAward.findMany).not.toHaveBeenCalled();
  });

  it('after the reveal: prize / project / team / track only; no payout or private data', async () => {
    await award(P_GRAND, S_A);
    await award(P_DEFI, S_A);
    await award(P_HM, S_B);
    await api().patch(`${base}/awards/${awardIdFor(P_GRAND, S_A)}/payout`).set('Authorization', auth('host'))
      .send({ status: 'paid', recipientWallet: '0xSECRETWALLET', payoutReference: '0xSECRETTX', payoutNotes: 'SECRET NOTE' });
    await api().post(`${base}/reveal`).set('Authorization', auth('host'));
    for (const who of [null, 'rando', 'alice'] as const) {
      const req = api().get(base);
      const r = who ? await req.set('Authorization', auth(who)) : await req;
      expect(r.status).toBe(200);
      const w = r.body.hackathon.winners;
      expect(w.map((x: Row) => x.prizeName)).toEqual(['Grand prize', 'Best DeFi', 'Honorable mention']);
      expect(w[1]).toMatchObject({ trackName: 'DeFi', projectName: 'Slice Router', teamName: 'Crust Coders', place: 1 });
      const json = JSON.stringify(r.body);
      for (const secret of ['0xSECRETWALLET', '0xSECRETTX', 'SECRET NOTE', 'alice@example.com', 'u-a', 'payoutStatus', 'recipient', 'secret-repo', 'PRIVATE', 'Judge Judy', 'judge1@secret']) {
        expect(json, secret).not.toContain(secret);
      }
    }
  });

  it('an awarded project cannot be disqualified (409), so it never silently drops off the winners list', async () => {
    await award(P_GRAND, S_A);
    const r = await api().patch(`${base}/submissions/${S_A}`).set('Authorization', auth('host')).send({ action: 'disqualify', reason: 'late' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('HAS_AWARDS');
    expect(db.hackathonSubmission.find((s) => s.id === S_A)!.status).toBe('submitted');
  });
});

// ------------------------------------------------------------------ team view (/me)

describe('team results on /me', () => {
  const me = (who: keyof typeof USERS) => api().get(`${base}/me`).set('Authorization', auth(who));

  it('null before the reveal', async () => {
    await award(P_GRAND, S_A);
    const r = await me('alice');
    expect(r.body.results).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain('Great demo');
  });

  it('after the reveal: own feedback (active judges, text only) + own awards; wallet only for the recipient', async () => {
    await award(P_GRAND, S_A); // recipient = captain alice
    await api().patch(`${base}/awards/${awardIdFor(P_GRAND, S_A)}/payout`).set('Authorization', auth('host'))
      .send({ status: 'paid', recipientWallet: '0xALICEWALLET', payoutReference: '0xTX', payoutNotes: 'HOST ONLY NOTE' });
    await api().post(`${base}/reveal`).set('Authorization', auth('host'));

    const alice = (await me('alice')).body.results;
    expect(alice.feedback).toEqual(['Great demo, ship it.']);
    expect(alice.awards).toHaveLength(1);
    expect(alice.awards[0]).toMatchObject({ prizeName: 'Grand prize', payoutStatus: 'paid', isRecipient: true, recipientWallet: '0xALICEWALLET', payoutReference: '0xTX' });

    const bobRes = await me('bob');
    const bob = bobRes.body.results;
    expect(bob.feedback).toEqual(['Great demo, ship it.']);
    expect(bob.awards[0]).toMatchObject({ isRecipient: false, recipientWallet: null, payoutReference: null, paidAt: null, recipientName: 'Alice' });

    for (const body of [JSON.stringify(alice), JSON.stringify(bobRes.body)]) {
      for (const secret of ['REMOVED JUDGE FEEDBACK', 'PRIVATE', 'Judge Judy', 'judge1@secret', 'j1', 'HOST ONLY NOTE', '"total"', 'criterionScores']) {
        expect(body, secret).not.toContain(secret);
      }
    }
    expect(JSON.stringify(bobRes.body)).not.toContain('0xALICEWALLET');

    // Team B: no feedback written, no award -> empty, and never team A's.
    const carol = (await me('carol')).body.results;
    expect(carol).toEqual({ revealedAt: expect.any(String), awards: [], feedback: [] });
  });

  it("a winner can't withdraw", async () => {
    await award(P_GRAND, S_A);
    const r = await api().post(`${base}/teams/77777777-7777-4777-8777-00000000000a/submission/withdraw`).set('Authorization', auth('alice'));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('HAS_AWARDS');
    expect(db.hackathonSubmission.find((s) => s.id === S_A)!.status).toBe('submitted');
  });
});

// ------------------------------------------------------------------ security-review follow-ups

/** Raw SQL statements issued so far, in order. */
const rawSql = () => mockPrisma.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?')) as string[];
const isHkLock = (s: string, mode: string) => s.includes('FROM hackathons') && s.includes(mode);

describe('locks around award-sensitive writes', () => {
  it('disqualify: checks awards and writes under the hackathon row lock (inside one transaction)', async () => {
    mockPrisma.$queryRaw.mockClear();
    mockPrisma.$transaction.mockClear();
    mockPrisma.hackathonAward.count.mockClear();
    const r = await api().patch(`${base}/submissions/${S_B}`).set('Authorization', auth('host')).send({ action: 'disqualify', reason: 'late' });
    expect(r.status).toBe(200);
    expect(rawSql().some((s) => isHkLock(s, 'FOR UPDATE'))).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // The lock comes before the award count and the update.
    const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[0];
    expect(mockPrisma.hackathonAward.count.mock.invocationCallOrder[0]).toBeGreaterThan(lockOrder);
    expect(mockPrisma.hackathonSubmission.update.mock.invocationCallOrder[0]).toBeGreaterThan(lockOrder);
    expect(db.hackathonSubmission.find((s) => s.id === S_B)!.status).toBe('disqualified');
  });

  it('disqualify re-reads the project inside the lock (a project gone meanwhile is a 404)', async () => {
    const r = await api().patch(`${base}/submissions/${crypto.randomUUID()}`).set('Authorization', auth('host')).send({ action: 'disqualify', reason: 'x' });
    expect(r.status).toBe(404);
  });

  it('withdraw: FOR SHARE on the hackathon row before the team lock and the award count', async () => {
    mockPrisma.$queryRaw.mockClear();
    const r = await api().post(`${base}/teams/77777777-7777-4777-8777-00000000000b/submission/withdraw`).set('Authorization', auth('carol'));
    expect(r.status).toBe(200);
    const sqls = rawSql();
    const share = sqls.findIndex((s) => isHkLock(s, 'FOR SHARE'));
    const team = sqls.findIndex((s) => s.includes('FROM hackathon_teams') && s.includes('FOR UPDATE'));
    expect(share).toBeGreaterThanOrEqual(0);
    expect(team).toBeGreaterThan(share);
  });

  it('prize edit: PRIZE_AWARDED check and the update run under the hackathon row lock', async () => {
    await award(P_HM, S_A);
    mockPrisma.$queryRaw.mockClear();
    mockPrisma.hackathonPrize.updateMany.mockClear();
    const r = await api().patch(`${base}/prizes/${P_HM}`).set('Authorization', auth('host')).send({ quantity: 2 });
    expect(r.status).toBe(200);
    expect(rawSql().some((s) => isHkLock(s, 'FOR UPDATE'))).toBe(true);
    expect(mockPrisma.hackathonPrize.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(mockPrisma.$queryRaw.mock.invocationCallOrder[0]);
    const bad = await api().patch(`${base}/prizes/${P_HM}`).set('Authorization', auth('host')).send({ quantity: 0 });
    expect(bad.status).toBe(400); // validation still first
  });
});

describe('payout recipient must be on the team for pending / paid', () => {
  const patch = (id: string, body: Row) => api().patch(`${base}/awards/${id}/payout`).set('Authorization', auth('host')).send(body);

  it('recipient who left the team: 409 RECIPIENT_NOT_MEMBER; picking a current member fixes it', async () => {
    await award(P_GRAND, S_A); // recipient = captain alice
    const id = awardIdFor(P_GRAND, S_A);
    db.hackathonTeamMember = db.hackathonTeamMember.filter((m) => m.id !== M_ALICE); // alice left
    const gone = await api().get(`${base}/awards`).set('Authorization', auth('host'));
    expect(gone.body.awards[0]).toMatchObject({ recipient: { name: 'Alice' }, recipientMemberId: null }); // UI shows "left the team"
    for (const status of ['pending', 'paid']) {
      const r = await patch(id, { status });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('RECIPIENT_NOT_MEMBER');
      expect(r.body.error.message).toMatch(/no longer on the winning team/);
    }
    expect(db.hackathonAward[0].payoutStatus).toBe('unpaid');
    // Other edits still work, and so does not_applicable.
    expect((await patch(id, { payoutNotes: 'chasing a new wallet' })).status).toBe(200);
    expect((await patch(id, { status: 'not_applicable' })).status).toBe(200);
    // Switching recipient in the same request is enough.
    const ok = await patch(id, { status: 'paid', recipientMemberId: M_BOB });
    expect(ok.status).toBe(200);
    expect(db.hackathonAward[0]).toMatchObject({ payoutStatus: 'paid', recipientUserId: 'u-b' });
  });

  it('no recipient at all: 409 with a "pick a recipient" message', async () => {
    await award(P_GRAND, S_A);
    const id = awardIdFor(P_GRAND, S_A);
    await patch(id, { recipientMemberId: null });
    const r = await patch(id, { status: 'pending' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RECIPIENT_NOT_MEMBER');
    expect(r.body.error.message).toMatch(/Pick a recipient/);
  });

  it('a payout already pending can still be edited after the recipient leaves (only the move is gated)', async () => {
    await award(P_GRAND, S_A);
    const id = awardIdFor(P_GRAND, S_A);
    expect((await patch(id, { status: 'pending' })).status).toBe(200);
    db.hackathonTeamMember = db.hackathonTeamMember.filter((m) => m.id !== M_ALICE);
    expect((await patch(id, { payoutReference: 'ref-9' })).status).toBe(200);
    expect((await patch(id, { status: 'paid' })).status).toBe(409);
  });
});

// ------------------------------------------------------------------ track edits on awarded projects

describe('track edits on a project holding a track prize', () => {
  const TEAM_A = '77777777-7777-4777-8777-00000000000a';
  const save = (who: keyof typeof USERS, trackIds: string[], extra: Row = {}) =>
    api().put(`${base}/teams/${TEAM_A}/submission`).set('Authorization', auth(who)).send({ trackIds, ...extra });
  const tracksOf = (sid: string) => db.hackathonSubmissionTrack.filter((t) => t.submissionId === sid).map((t) => t.trackId).sort();

  beforeEach(() => {
    // createMany / deleteMany for submission tracks (not in the base fake).
    mockPrisma.hackathonSubmissionTrack.deleteMany = vi.fn(async ({ where }: Row) => {
      const before = db.hackathonSubmissionTrack.length;
      db.hackathonSubmissionTrack = db.hackathonSubmissionTrack.filter((t) => t.submissionId !== where.submissionId);
      return { count: before - db.hackathonSubmissionTrack.length };
    });
    mockPrisma.hackathonSubmissionTrack.createMany = vi.fn(async ({ data }: Row) => { db.hackathonSubmissionTrack.push(...data); return { count: data.length }; });
  });

  it('participant: removing the awarded track is a 409 HAS_AWARDS and nothing changes', async () => {
    await award(P_DEFI, S_A); // DeFi track prize
    const r = await save('alice', [T2]);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('HAS_AWARDS');
    expect(r.body.error.message).toMatch(/remove the award first/);
    expect(tracksOf(S_A)).toEqual([T1]);
    // Nor can other fields sneak through in the same rejected save.
    expect(db.hackathonSubmission.find((s) => s.id === S_A)!.name).toBe('Slice Router');
  });

  it('participant: edits that keep every awarded track are fine (add a track, other fields)', async () => {
    await award(P_DEFI, S_A);
    const r = await save('alice', [T1, T2], { tagline: 'Now in two tracks' });
    expect(r.status).toBe(200);
    expect(tracksOf(S_A)).toEqual([T1, T2].sort());
    expect((await api().put(`${base}/teams/${TEAM_A}/submission`).set('Authorization', auth('alice')).send({ tagline: 'No track change' })).status).toBe(200);
  });

  it('an overall prize never pins tracks', async () => {
    await award(P_GRAND, S_A);
    expect((await save('alice', [T2])).status).toBe(200);
    expect(tracksOf(S_A)).toEqual([T2]);
  });

  it('host gets the same rule until the award is deleted', async () => {
    await award(P_DEFI, S_A);
    const r = await save('host', [T2]);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('HAS_AWARDS');
    expect((await api().delete(`${base}/awards/${awardIdFor(P_DEFI, S_A)}`).set('Authorization', auth('host'))).status).toBe(200);
    expect((await save('host', [T2])).status).toBe(200);
    expect(tracksOf(S_A)).toEqual([T2]);
  });

  it('the track write locks the hackathon row (FOR SHARE) before the team row', async () => {
    await award(P_DEFI, S_A);
    mockPrisma.$queryRaw.mockClear();
    await save('alice', [T1, T2]);
    const sqls = mockPrisma.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?'));
    const share = sqls.findIndex((s: string) => s.includes('FROM hackathons') && s.includes('FOR SHARE'));
    const team = sqls.findIndex((s: string) => s.includes('FROM hackathon_teams') && s.includes('FOR UPDATE'));
    expect(share).toBeGreaterThanOrEqual(0);
    expect(team).toBeGreaterThan(share);
  });
});

// ------------------------------------------------------------------ prize edits + CSV

describe('awarded prizes and the awards CSV', () => {
  it("an awarded prize can't change track or drop below its awarded count", async () => {
    await award(P_HM, S_A);
    await award(P_HM, S_B);
    const q = await api().patch(`${base}/prizes/${P_HM}`).set('Authorization', auth('host')).send({ quantity: 1 });
    expect(q.status).toBe(409);
    expect(q.body.error.code).toBe('PRIZE_AWARDED');
    const t = await api().patch(`${base}/prizes/${P_HM}`).set('Authorization', auth('host')).send({ trackId: T1 });
    expect(t.status).toBe(409);
    expect((await api().patch(`${base}/prizes/${P_HM}`).set('Authorization', auth('host')).send({ quantity: 3 })).status).toBe(200);
  });

  it('CSV: host gets payout columns, formula leads escaped', async () => {
    db.hackathonSubmission.find((s) => s.id === S_A)!.name = '=cmd|calc';
    await award(P_GRAND, S_A);
    await api().patch(`${base}/awards/${awardIdFor(P_GRAND, S_A)}/payout`).set('Authorization', auth('host')).send({ status: 'pending', recipientWallet: '@wallet', payoutNotes: 'a, "b"' });
    const r = await api().get(`${base}/export.csv?kind=awards`).set('Authorization', auth('host'));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toContain('hackathon-awards.csv');
    const [header, line] = r.text.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('Prize,Track,Amount,Place,Project,Team,Recipient,Recipient email,Wallet / handle,Payout status,Reference / tx hash,Paid at,Notes,Awarded at');
    expect(line).toContain(`'=cmd|calc`);
    expect(line).toContain(`'@wallet`);
    expect(line).toContain('"a, ""b"""');
    expect(line).toContain('alice@example.com');
    expect(line).toContain(',Pending,');
  });
});
