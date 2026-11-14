/**
 * Hackathon PR 3 (teams + submissions + host moderation): authz matrix, IDOR, deadline,
 * team size, one-team-per-user, slugs, upload signing scope/limits, CSV escaping and
 * response-shape privacy. Prisma is an in-memory fake (just enough of the query API these
 * routes use); storage and party-access helpers are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET = 'test-secret-hackathon-participant-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: canEdit, canUserAccessTab: canTab }));
vi.mock('../helpers/eventVisibility.js', () => ({ isEventHiddenFrom: vi.fn(async () => false) }));

const media = vi.hoisted(() => ({
  createImageUploadUrl: vi.fn(),
  finalizeImage: vi.fn(),
  removeImages: vi.fn(async () => undefined),
  signImagePaths: vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}?t=1`]))),
}));
vi.mock('../lib/hackathon/media.js', async (orig) => ({ ...(await orig<typeof import('../lib/hackathon/media.js')>()), ...media }));

import hackathonPublicRoutes from './hackathon-public.routes.js';
import participantRoutes, { attachUserLimiter, teamJoinLimiter, teamWriteLimiter, uploadUserLimiter } from './hackathon-participant.routes.js';
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
  a.use('/api/parties', participantRoutes);
  a.use('/api/parties', hackathonRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const HID = '22222222-2222-4222-8222-222222222222';
const TRACK = '33333333-3333-4333-8333-333333333333';
const TRACK2 = '33333333-3333-4333-8333-444444444444';
const OTHER_PARTY = '99999999-9999-4999-8999-999999999999';
const OTHER_HID = '88888888-8888-4888-8888-888888888888';
const OTHER_TRACK = '77777777-7777-4777-8777-777777777777';

// ------------------------------------------------------------------ in-memory fake prisma

type Row = Record<string, any>;
let db: Record<string, Row[]>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === 'NOT') {
      if (matches(row, cond)) return false;
      continue;
    }
    if (k === 'submissions' && cond?.some) {
      if (!db.hackathonSubmission.some((s) => s.teamId === row.id && matches(s, cond.some))) return false;
      continue;
    }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('startsWith' in cond && !(typeof v === 'string' && v.startsWith(cond.startsWith))) return false;
      if ('equals' in cond) {
        const a = cond.mode === 'insensitive' ? String(v ?? '').toLowerCase() : v;
        const b = cond.mode === 'insensitive' ? String(cond.equals).toLowerCase() : cond.equals;
        if (a !== b) return false;
      }
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function withInclude(table: string, row: Row, include: Row | undefined): Row {
  if (!include) return { ...row };
  const out: Row = { ...row };
  if (table === 'hackathonTeam') {
    if (include.members) {
      out.members = db.hackathonTeamMember
        .filter((m) => m.teamId === row.id)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((m) => ({ ...m, user: db.user.find((u) => u.id === m.userId) ?? null, guest: db.guest.find((x) => x.id === m.guestId) ?? null }));
    }
    if (include.submissions) {
      out.submissions = db.hackathonSubmission
        .filter((s) => s.teamId === row.id)
        .map((s) => ({ ...s, tracks: db.hackathonSubmissionTrack.filter((t) => t.submissionId === s.id).map((t) => ({ trackId: t.trackId })) }));
    }
  }
  if (table === 'hackathon') {
    for (const k of ['tracks', 'prizes', 'criteria', 'judges']) out[k] = [];
    out.tracks = db.hackathonTrack.filter((t) => t.hackathonId === row.id);
  }
  return out;
}

let seq = 0;
const nextTime = () => new Date(Date.UTC(2027, 0, 1) + ++seq * 1000);

function fakeModel(table: string, defaults: () => Row = () => ({})) {
  const rows = () => db[table];
  return {
    findUnique: vi.fn(async ({ where, include }: Row) => {
      const r = rows().find((x) => matches(x, where));
      return r ? withInclude(table, r, include) : null;
    }),
    findFirst: vi.fn(async ({ where, include }: Row = {}) => {
      const r = rows().find((x) => matches(x, where));
      return r ? withInclude(table, r, include) : null;
    }),
    findMany: vi.fn(async ({ where, include, take }: Row = {}) =>
      rows().filter((x) => matches(x, where)).slice(0, take ?? 1e9).map((r) => withInclude(table, r, include))),
    count: vi.fn(async ({ where }: Row = {}) => rows().filter((x) => matches(x, where)).length),
    create: vi.fn(async ({ data }: Row) => {
      const row = { id: crypto.randomUUID(), ...defaults(), ...data };
      checkUnique(table, row);
      rows().push(row);
      return { ...row };
    }),
    createMany: vi.fn(async ({ data }: Row) => {
      for (const d of data) rows().push({ ...defaults(), ...d });
      return { count: data.length };
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(r, data, { updatedAt: nextTime() });
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const rs = rows().filter((x) => matches(x, where));
      for (const r of rs) Object.assign(r, data);
      return { count: rs.length };
    }),
    delete: vi.fn(async ({ where }: Row) => {
      const i = rows().findIndex((x) => matches(x, where));
      if (i < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      const [r] = rows().splice(i, 1);
      if (table === 'hackathonTeam') db.hackathonTeamMember = db.hackathonTeamMember.filter((m) => m.teamId !== r.id);
      if (table === 'hackathonSubmission') db.hackathonSubmissionTrack = db.hackathonSubmissionTrack.filter((t) => t.submissionId !== r.id);
      return r;
    }),
    deleteMany: vi.fn(async ({ where }: Row) => {
      const before = rows().length;
      db[table] = rows().filter((x) => !matches(x, where));
      return { count: before - db[table].length };
    }),
    aggregate: vi.fn(async () => ({ _max: { sortOrder: null } })),
  };
}

function p2002(target: string) {
  return Object.assign(new Error('Unique constraint'), { code: 'P2002', meta: { target: [target] } });
}

function checkUnique(table: string, row: Row) {
  if (table === 'hackathonTeamMember' && db.hackathonTeamMember.some((m) => m.hackathonId === row.hackathonId && m.userId === row.userId)) throw p2002('user_id');
  if (table === 'hackathonTeamMember' && row.role === 'captain' && db.hackathonTeamMember.some((m) => m.teamId === row.teamId && m.role === 'captain')) throw p2002('team_id');
  if (table === 'hackathonTeam' && db.hackathonTeam.some((t) => t.inviteCode === row.inviteCode)) throw p2002('invite_code');
  if (table === 'hackathonSubmission') {
    if (db.hackathonSubmission.some((s) => s.teamId === row.teamId)) throw p2002('team_id');
    if (db.hackathonSubmission.some((s) => s.hackathonId === row.hackathonId && s.slug === row.slug)) throw p2002('slug');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug)) throw new Error('slug CHECK violated');
  }
}

const USERS: Record<string, { id: string; email: string; name: string }> = {
  host: { id: 'u-host', email: 'host@example.com', name: 'Hosty' },
  cohost: { id: 'u-co', email: 'cohost@example.com', name: 'Co Host' },
  alice: { id: 'u-a', email: 'alice@example.com', name: 'Alice' },
  bob: { id: 'u-b', email: 'bob@example.com', name: 'Bob' },
  carol: { id: 'u-c', email: 'carol@example.com', name: 'Carol' },
  dave: { id: 'u-d', email: 'dave@example.com', name: 'Dave' },
  rejected: { id: 'u-r', email: 'rejected@example.com', name: 'Rej' },
  pending: { id: 'u-p', email: 'pending@example.com', name: 'Pen' },
  waitlisted: { id: 'u-w', email: 'wait@example.com', name: 'Wait' },
  judge: { id: 'u-j', email: 'judge@example.com', name: 'Judge' },
  rando: { id: 'u-x', email: 'rando@example.com', name: 'Rando' },
};
const auth = (who: keyof typeof USERS) => `Bearer ${jwt.sign({ userId: USERS[who].id, email: USERS[who].email }, JWT_SECRET, { expiresIn: '1h' })}`;

function hackathonRow(over: Row = {}): Row {
  return {
    id: HID, partyId: PARTY, rules: null, publishedAt: new Date('2027-01-01'), disabledAt: null, eligibility: 'registered',
    submissionsOpenAt: null, submissionDeadline: new Date(Date.now() + 86400_000), teamMinSize: 1, teamMaxSize: 3,
    maxTracksPerSubmission: 1, blindJudging: false, judgingStatus: 'not_started', galleryVisibility: 'after_reveal',
    resultsRevealedAt: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function seed() {
  seq = 0;
  const guest = (who: keyof typeof USERS, over: Row = {}) => ({ id: `g-${who}`, partyId: PARTY, email: USERS[who].email.toUpperCase(), name: `${USERS[who].name} (rsvp)`, approved: true, status: 'CONFIRMED', checkedInAt: null, ...over });
  db = {
    hackathon: [hackathonRow(), hackathonRow({ id: OTHER_HID, partyId: OTHER_PARTY })],
    party: [{ id: PARTY, requireApproval: true, eventType: null, eventTags: [], date: null, region: null, city: null, password: null }],
    guest: [
      guest('alice'), guest('bob'), guest('carol'), guest('dave'), guest('cohost'), guest('judge'),
      guest('rejected', { approved: false }), guest('pending', { approved: null }), guest('waitlisted', { status: 'WAITLISTED' }),
      // Same email as alice but at another party: never counts here.
      { id: 'g-other', partyId: OTHER_PARTY, email: 'rando@example.com', approved: true, status: 'CONFIRMED', checkedInAt: null },
    ],
    user: Object.values(USERS).map((u) => ({ id: u.id, email: u.email, name: u.name, profilePictureUrl: null })),
    hackathonJudge: [{ id: 'j1', hackathonId: HID, email: 'judge@example.com', status: 'active' }],
    hackathonTrack: [
      { id: TRACK, hackathonId: HID, name: 'DeFi' },
      { id: TRACK2, hackathonId: HID, name: 'Consumer' },
      { id: OTHER_TRACK, hackathonId: OTHER_HID, name: 'Elsewhere' },
    ],
    hackathonTeam: [],
    hackathonTeamMember: [],
    hackathonSubmission: [],
    hackathonSubmissionTrack: [],
    hackathonAward: [],
    hackathonScore: [],
  };
}

function setHackathon(over: Row) {
  Object.assign(db.hackathon[0], over);
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  mockPrisma.hackathon = fakeModel('hackathon');
  mockPrisma.party = fakeModel('party');
  mockPrisma.guest = fakeModel('guest');
  mockPrisma.user = fakeModel('user');
  mockPrisma.hackathonJudge = fakeModel('hackathonJudge');
  mockPrisma.hackathonTrack = fakeModel('hackathonTrack');
  mockPrisma.hackathonTeam = fakeModel('hackathonTeam', () => ({ createdAt: nextTime(), updatedAt: nextTime() }));
  mockPrisma.hackathonTeamMember = fakeModel('hackathonTeamMember', () => ({ joinedAt: nextTime(), showOnGallery: true, role: 'member', guestId: null }));
  mockPrisma.hackathonSubmission = fakeModel('hackathonSubmission', () => ({
    tagline: null, description: null, repoUrl: null, demoVideoUrl: null, deckUrl: null, liveUrl: null, coverPath: null,
    screenshotPaths: [], status: 'draft', submittedAt: null, disqualifiedReason: null, tableNumber: null, createdAt: nextTime(), updatedAt: nextTime(),
  }));
  mockPrisma.hackathonSubmissionTrack = fakeModel('hackathonSubmissionTrack', () => ({ createdAt: new Date() }));
  mockPrisma.hackathonAward = fakeModel('hackathonAward');
  mockPrisma.hackathonScore = fakeModel('hackathonScore');
  mockPrisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
  mockPrisma.$queryRaw = vi.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM hackathons') && sql.includes('FOR SHARE')) return db.hackathon.filter((h) => h.id === vals[0]).map((h) => ({ id: h.id }));
    if (sql.includes('FOR UPDATE')) {
      const [teamId, hackathonId] = vals;
      return db.hackathonTeam.filter((t) => t.id === teamId && t.hackathonId === hackathonId).map((t) => ({ id: t.id }));
    }
    if (sql.includes('FROM guests')) {
      // Mirrors `lower(email) = lower($)`: exact, case-insensitive, no wildcards.
      const [partyId, email] = vals;
      return db.guest
        .filter((g) => g.partyId === partyId && String(g.email ?? '').toLowerCase() === String(email).toLowerCase())
        .map((g) => ({ id: g.id, approved: g.approved, status: g.status, checked_in_at: g.checkedInAt }));
    }
    throw new Error('unexpected raw query: ' + sql);
  });
  mockPrisma.$executeRaw = vi.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
    const sql = strings.join('?');
    if (sql.includes('array_append')) {
      const [path, id, max] = vals;
      const s = db.hackathonSubmission.find((x) => x.id === id);
      if (!s || s.screenshotPaths.length >= max) return 0;
      s.screenshotPaths = [...s.screenshotPaths, path];
      return 1;
    }
    if (sql.includes('array_remove')) {
      const [path, id] = vals;
      const s = db.hackathonSubmission.find((x) => x.id === id);
      if (!s) return 0;
      s.screenshotPaths = s.screenshotPaths.filter((p: string) => p !== path);
      return 1;
    }
    throw new Error('unexpected raw SQL: ' + sql);
  });

  canEdit.mockImplementation(async (_p: string, _u?: string, email?: string) => email === 'host@example.com' || email === 'cohost@example.com');
  canTab.mockImplementation(async (_p: string, email?: string) => email === 'host@example.com');

  media.createImageUploadUrl.mockImplementation(async (h: string, s: string, ext: string) => ({ path: `${h}/${s}/tmp/${crypto.randomUUID()}.${ext}`, token: 'upload-token' }));
  media.finalizeImage.mockImplementation(async (_tmp: string, h: string, s: string) => `${h}/${s}/${crypto.randomUUID()}.png`);

  for (const l of [teamJoinLimiter, teamWriteLimiter, uploadUserLimiter, attachUserLimiter]) {
    for (const u of Object.values(USERS)) l.resetKey(u.id);
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) l.resetKey(ip);
  }
});

const base = `/api/parties/${PARTY}/hackathon`;
const api = () => request(app());

async function createTeam(who: keyof typeof USERS = 'alice', name = 'Pizza Builders') {
  const res = await api().post(`${base}/teams`).set('Authorization', auth(who)).send({ name });
  expect(res.status).toBe(201);
  return res.body.team;
}

async function joinTeam(who: keyof typeof USERS, code: string) {
  return api().post(`${base}/teams/join`).set('Authorization', auth(who)).send({ code });
}

// ------------------------------------------------------------------ eligibility + /me

describe('GET /me + eligibility matrix', () => {
  it.each([
    ['alice', true, null],
    ['cohost', true, null], // co-hosts can join (§16 Q6) when they RSVP'd
    ['judge', false, 'judge'],
    ['rejected', false, 'declined'],
    ['pending', false, 'pending_approval'],
    ['waitlisted', false, 'waitlisted'],
    ['rando', false, 'no_rsvp'], // guest of ANOTHER party only
  ] as const)('%s -> eligible %s (%s)', async (who, eligible, reason) => {
    const res = await api().get(`${base}/me`).set('Authorization', auth(who));
    expect(res.status).toBe(200);
    expect(res.body.eligibility).toEqual({ eligible, reason });
    expect(res.body.team).toBeNull();
  });

  it('anonymous: login reason, nothing else', async () => {
    const res = await api().get(`${base}/me`);
    expect(res.body).toMatchObject({ loggedIn: false, eligibility: { eligible: false, reason: 'login' }, team: null });
  });

  it('unpublished / disabled: not_available for participants', async () => {
    setHackathon({ publishedAt: null });
    expect((await api().get(`${base}/me`).set('Authorization', auth('alice'))).body.eligibility.reason).toBe('not_available');
    setHackathon({ publishedAt: new Date(), disabledAt: new Date() });
    expect((await api().get(`${base}/me`).set('Authorization', auth('alice'))).body.eligibility.reason).toBe('not_available');
  });

  it('checked_in mode', async () => {
    setHackathon({ eligibility: 'checked_in' });
    expect((await api().get(`${base}/me`).set('Authorization', auth('alice'))).body.eligibility.reason).toBe('not_checked_in');
    db.guest.find((g) => g.id === 'g-alice')!.checkedInAt = new Date();
    expect((await api().get(`${base}/me`).set('Authorization', auth('alice'))).body.eligibility.eligible).toBe(true);
  });

  it('ineligible callers cannot create or join (403 NOT_ELIGIBLE), nothing written', async () => {
    const team = await createTeam('alice');
    for (const who of ['judge', 'rejected', 'pending', 'waitlisted', 'rando'] as const) {
      const c = await api().post(`${base}/teams`).set('Authorization', auth(who)).send({ name: 'X' });
      expect(c.status).toBe(403);
      expect(c.body.error.code).toBe('NOT_ELIGIBLE');
      const j = await joinTeam(who, team.inviteCode);
      expect(j.status).toBe(403);
    }
    expect(db.hackathonTeam).toHaveLength(1);
    expect(db.hackathonTeamMember).toHaveLength(1);
  });

  it('anonymous writes are 401', async () => {
    expect((await api().post(`${base}/teams`).send({ name: 'X' })).status).toBe(401);
    expect((await api().post(`${base}/teams/join`).send({ code: 'abcdefgh23' })).status).toBe(401);
  });

  it('/me returns my team with members (names only) and my draft', async () => {
    const team = await createTeam('alice');
    await joinTeam('bob', team.inviteCode);
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('bob')).send({ name: 'Slice' });
    const me = await api().get(`${base}/me`).set('Authorization', auth('bob'));
    expect(me.body.team.members.map((m: Row) => [m.name, m.role, m.isMe])).toEqual([['Alice', 'captain', false], ['Bob', 'member', true]]);
    expect(me.body.team.submission.status).toBe('draft');
    const body = JSON.stringify(me.body);
    for (const s of ['alice@example.com', 'bob@example.com', 'u-a', 'u-b', 'g-alice', 'g-bob']) expect(body).not.toContain(s);
  });
});

// ------------------------------------------------------------------ teams

describe('teams', () => {
  it('create makes the caller captain with a 10-char invite code and stores the guest id', async () => {
    const team = await createTeam('alice');
    expect(team.inviteCode).toMatch(/^[a-z2-7]{10}$/);
    expect(team.members).toEqual([expect.objectContaining({ name: 'Alice', role: 'captain', isMe: true })]);
    expect(db.hackathonTeamMember[0]).toMatchObject({ userId: 'u-a', guestId: 'g-alice', role: 'captain', hackathonId: HID });
  });

  it('one team per user: second create / join is 409', async () => {
    const t1 = await createTeam('alice');
    const t2 = await createTeam('carol', 'Other');
    const again = await api().post(`${base}/teams`).set('Authorization', auth('alice')).send({ name: 'Again' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ON_TEAM');
    const join = await joinTeam('alice', t2.inviteCode);
    expect(join.status).toBe(409);
    expect((await joinTeam('alice', t1.inviteCode)).body.error.code).toBe('ALREADY_ON_TEAM');
  });

  it('join by code (case-insensitive); bad code never reveals a team', async () => {
    const team = await createTeam('alice', 'Secret Name');
    const ok = await joinTeam('bob', team.inviteCode.toUpperCase());
    expect(ok.status).toBe(201);
    expect(ok.body.team.memberCount).toBe(2);
    for (const code of ['zzzzzzzzzz', 'short', '', null]) {
      const bad = await joinTeam('carol', code as any);
      expect(bad.status).toBe(404);
      expect(bad.body.error.code).toBe('INVALID_CODE');
      expect(JSON.stringify(bad.body)).not.toContain('Secret Name');
    }
  });

  it('a code from another hackathon does not work here (IDOR)', async () => {
    db.hackathonTeam.push({ id: crypto.randomUUID(), hackathonId: OTHER_HID, name: 'Elsewhere', inviteCode: 'otherhack2', createdAt: new Date() });
    const res = await joinTeam('bob', 'otherhack2');
    expect(res.status).toBe(404);
  });

  it('team max size enforced under the row lock', async () => {
    const team = await createTeam('alice'); // max 3
    expect((await joinTeam('bob', team.inviteCode)).status).toBe(201);
    expect((await joinTeam('carol', team.inviteCode)).status).toBe(201);
    const full = await joinTeam('dave', team.inviteCode);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('TEAM_FULL');
    // The count happened inside a transaction that first locked the team row.
    const raw = mockPrisma.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?'));
    expect(raw.some((s: string) => s.includes('FOR UPDATE'))).toBe(true);
  });

  it('team min size blocks submit', async () => {
    setHackathon({ teamMinSize: 2 });
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    const res = await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEAM_TOO_SMALL');
    await joinTeam('bob', team.inviteCode);
    expect((await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'))).status).toBe(200);
  });

  it('captain can rename + remove members + regenerate the code; members cannot', async () => {
    const team = await createTeam('alice');
    await joinTeam('bob', team.inviteCode);
    const bobId = db.hackathonTeamMember.find((m) => m.userId === 'u-b')!.id;
    const aliceId = db.hackathonTeamMember.find((m) => m.userId === 'u-a')!.id;

    expect((await api().patch(`${base}/teams/${team.id}`).set('Authorization', auth('bob')).send({ name: 'Mine' })).status).toBe(403);
    expect((await api().delete(`${base}/teams/${team.id}/members/${aliceId}`).set('Authorization', auth('bob'))).status).toBe(403);
    expect((await api().post(`${base}/teams/${team.id}/regenerate-code`).set('Authorization', auth('bob'))).status).toBe(403);

    const renamed = await api().patch(`${base}/teams/${team.id}`).set('Authorization', auth('alice')).send({ name: 'New Name' });
    expect(renamed.body.team.name).toBe('New Name');
    const regen = await api().post(`${base}/teams/${team.id}/regenerate-code`).set('Authorization', auth('alice'));
    expect(regen.body.team.inviteCode).not.toBe(team.inviteCode);
    expect((await joinTeam('carol', team.inviteCode)).status).toBe(404); // old code dead

    const removed = await api().delete(`${base}/teams/${team.id}/members/${bobId}`).set('Authorization', auth('alice'));
    expect(removed.status).toBe(200);
    expect(removed.body.team.memberCount).toBe(1);
    expect((await api().delete(`${base}/teams/${team.id}/members/${aliceId}`).set('Authorization', auth('alice'))).body.error.code).toBe('USE_LEAVE');
  });

  it('captain leaving passes the role on; last member leaving deletes team + draft', async () => {
    const team = await createTeam('alice');
    await joinTeam('bob', team.inviteCode);
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App' });
    expect((await api().post(`${base}/teams/${team.id}/leave`).set('Authorization', auth('alice'))).body).toEqual({ team: null });
    expect(db.hackathonTeamMember).toEqual([expect.objectContaining({ userId: 'u-b', role: 'captain' })]);
    expect((await api().post(`${base}/teams/${team.id}/leave`).set('Authorization', auth('bob'))).status).toBe(200);
    expect(db.hackathonTeam).toHaveLength(0);
    expect(db.hackathonSubmission).toHaveLength(0);
  });

  it('last member cannot leave a submitted project', async () => {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    const res = await api().post(`${base}/teams/${team.id}/leave`).set('Authorization', auth('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEAM_HAS_SUBMISSION');
  });

  it('other team / other hackathon / non-member: 404 on every team route (IDOR)', async () => {
    const mine = await createTeam('alice');
    const theirs = await createTeam('carol', 'Theirs');
    const foreignTeam = crypto.randomUUID();
    db.hackathonTeam.push({ id: foreignTeam, hackathonId: OTHER_HID, name: 'X', inviteCode: 'foreignxx2', createdAt: new Date() });
    db.hackathonTeamMember.push({ id: crypto.randomUUID(), teamId: foreignTeam, hackathonId: OTHER_HID, userId: 'u-a', role: 'captain', joinedAt: new Date() });

    const routes: Array<[string, string, Row?]> = [
      ['post', 'leave'], ['patch', '', { name: 'x' }], ['post', 'regenerate-code'],
      ['put', 'submission', { name: 'x' }], ['post', 'submission/submit'], ['post', 'submission/withdraw'],
      ['post', 'submission/upload-url', { mimeType: 'image/png', fileSize: 10 }], ['post', 'submission/images', { path: 'x' }],
      ['delete', 'submission/images', { path: 'x' }],
    ];
    for (const [m, sfx, body] of routes) {
      // alice on carol's team
      const r1 = await (api() as any)[m](`${base}/teams/${theirs.id}${sfx ? '/' + sfx : ''}`).set('Authorization', auth('alice')).send(body ?? {});
      expect([m, sfx, r1.status]).toEqual([m, sfx, 404]);
      // alice's own team in ANOTHER hackathon, addressed through this party
      const r2 = await (api() as any)[m](`${base}/teams/${foreignTeam}${sfx ? '/' + sfx : ''}`).set('Authorization', auth('alice')).send(body ?? {});
      expect(r2.status).toBe(404);
      // a non-member (rando)
      const r3 = await (api() as any)[m](`${base}/teams/${mine.id}${sfx ? '/' + sfx : ''}`).set('Authorization', auth('rando')).send(body ?? {});
      expect(r3.status).toBe(404);
    }
    // carol's team via the OTHER party's URL: 404 too.
    const r4 = await api().put(`/api/parties/${OTHER_PARTY}/hackathon/teams/${theirs.id}/submission`).set('Authorization', auth('carol')).send({ name: 'x' });
    expect(r4.status).toBe(404);
    expect(db.hackathonSubmission).toHaveLength(0);
  });

  it('host (hackathon tab) can act on any team; co-host without the tab cannot', async () => {
    const team = await createTeam('alice');
    await joinTeam('bob', team.inviteCode);
    const bobId = db.hackathonTeamMember.find((m) => m.userId === 'u-b')!.id;
    const hostRename = await api().patch(`${base}/teams/${team.id}`).set('Authorization', auth('host')).send({ name: 'Host Fixed' });
    expect(hostRename.status).toBe(200);
    expect(hostRename.body.team.members[0].email).toBe('alice@example.com'); // host shape
    expect((await api().patch(`${base}/teams/${team.id}`).set('Authorization', auth('cohost')).send({ name: 'Nope' })).status).toBe(404);
    expect((await api().delete(`${base}/teams/${team.id}/members/${bobId}`).set('Authorization', auth('host'))).status).toBe(200);
  });

  it('teams cannot form while unpublished, even for hosts', async () => {
    setHackathon({ publishedAt: null });
    expect((await api().post(`${base}/teams`).set('Authorization', auth('alice')).send({ name: 'X' })).status).toBe(404);
  });
});

// ------------------------------------------------------------------ submissions

describe('submissions', () => {
  it('draft -> submitted -> withdrawn -> submitted; tracks and links validated', async () => {
    const team = await createTeam('alice');
    const put = await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice'))
      .send({ name: 'My App!', tagline: 'Fast', repoUrl: 'http://github.com/a/b', trackIds: [TRACK] });
    expect(put.status).toBe(201);
    const s = put.body.team.submission;
    expect(s).toMatchObject({ name: 'My App!', slug: 'my-app', status: 'draft', repoUrl: 'https://github.com/a/b', trackIds: [TRACK] });
    expect(db.hackathonSubmissionTrack[0]).toMatchObject({ hackathonId: HID, trackId: TRACK });

    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ liveUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ trackIds: [TRACK, TRACK2] })).body.error.code).toBe('TOO_MANY_TRACKS');
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ trackIds: [OTHER_TRACK] })).status).toBe(400);
    setHackathon({ maxTracksPerSubmission: 2 });
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ trackIds: [TRACK, TRACK2] })).status).toBe(200);

    const sub = await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    expect(sub.body.team.submission.status).toBe('submitted');
    expect(sub.body.team.submission.submittedAt).toBeTruthy();
    const wd = await api().post(`${base}/teams/${team.id}/submission/withdraw`).set('Authorization', auth('alice'));
    expect(wd.body.team.submission.status).toBe('withdrawn');
    expect((await api().post(`${base}/teams/${team.id}/submission/withdraw`).set('Authorization', auth('alice'))).status).toBe(409);
    expect((await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'))).body.team.submission.status).toBe('submitted');
  });

  it('a track is required to submit when tracks exist', async () => {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App' });
    const res = await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    expect(res.body.error.code).toBe('TRACK_REQUIRED');
  });

  it('slug collisions get -2, -3; slug follows the name until first submit', async () => {
    const t1 = await createTeam('alice', 'A');
    const t2 = await createTeam('bob', 'B');
    const t3 = await createTeam('carol', 'C');
    const s1 = await api().put(`${base}/teams/${t1.id}/submission`).set('Authorization', auth('alice')).send({ name: 'Pizza Bot' });
    const s2 = await api().put(`${base}/teams/${t2.id}/submission`).set('Authorization', auth('bob')).send({ name: 'pizza  bot' });
    const s3 = await api().put(`${base}/teams/${t3.id}/submission`).set('Authorization', auth('carol')).send({ name: 'PIZZA-BOT' });
    expect([s1, s2, s3].map((r) => r.body.team.submission.slug)).toEqual(['pizza-bot', 'pizza-bot-2', 'pizza-bot-3']);
    const renamed = await api().put(`${base}/teams/${t1.id}/submission`).set('Authorization', auth('alice')).send({ name: 'Other', trackIds: [TRACK] });
    expect(renamed.body.team.submission.slug).toBe('other');
    await api().post(`${base}/teams/${t1.id}/submission/submit`).set('Authorization', auth('alice'));
    const after = await api().put(`${base}/teams/${t1.id}/submission`).set('Authorization', auth('alice')).send({ name: 'Third' });
    expect(after.body.team.submission.slug).toBe('other');
  });

  it('deadline: participants are read-only after it; hosts still can edit; extending reopens', async () => {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    setHackathon({ submissionDeadline: new Date(Date.now() - 1000) });
    for (const [m, sfx, body] of [
      ['put', 'submission', { name: 'Late' }], ['post', 'submission/submit'], ['post', 'submission/withdraw'],
      ['post', 'submission/upload-url', { mimeType: 'image/png', fileSize: 10 }], ['post', 'leave'], ['patch', '', { name: 'x' }],
    ] as Array<[string, string, Row?]>) {
      const r = await (api() as any)[m](`${base}/teams/${team.id}${sfx ? '/' + sfx : ''}`).set('Authorization', auth('alice')).send(body ?? {});
      expect([sfx, r.status, r.body.error?.code]).toEqual([sfx, 409, 'DEADLINE_PASSED']);
    }
    expect((await api().post(`${base}/teams`).set('Authorization', auth('bob')).send({ name: 'B' })).body.error.code).toBe('DEADLINE_PASSED');
    expect((await joinTeam('bob', team.inviteCode)).body.error.code).toBe('DEADLINE_PASSED');
    expect(db.hackathonSubmission[0].name).toBe('App');

    const host = await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('host')).send({ name: 'Host Edit' });
    expect(host.status).toBe(200);
    setHackathon({ submissionDeadline: new Date(Date.now() + 60_000) });
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'Back' })).status).toBe(200);
  });

  it('submit is blocked before submissions open', async () => {
    setHackathon({ submissionsOpenAt: new Date(Date.now() + 3600_000) });
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    expect((await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'))).body.error.code).toBe('NOT_OPEN_YET');
  });

  it('disqualified projects are read-only for the team until the host restores', async () => {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    const sid = db.hackathonSubmission[0].id;
    const dq = await api().patch(`${base}/submissions/${sid}`).set('Authorization', auth('host')).send({ action: 'disqualify', reason: 'Built before the event' });
    expect(dq.body.team.submission).toMatchObject({ status: 'disqualified', disqualifiedReason: 'Built before the event' });
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'x' })).body.error.code).toBe('DISQUALIFIED');
    const me = await api().get(`${base}/me`).set('Authorization', auth('alice'));
    expect(me.body.team.submission.disqualifiedReason).toBe('Built before the event');
    const restore = await api().patch(`${base}/submissions/${sid}`).set('Authorization', auth('host')).send({ action: 'restore' });
    expect(restore.body.team.submission).toMatchObject({ status: 'submitted', disqualifiedReason: null });
  });
});

// ------------------------------------------------------------------ uploads

describe('image uploads', () => {
  async function teamWithDraft() {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App' });
    return { team, sid: db.hackathonSubmission[0].id as string };
  }

  it('signs only under {hackathonId}/{submissionId}/tmp; checks type + size; needs a draft', async () => {
    const team = await createTeam('alice');
    const noDraft = await api().post(`${base}/teams/${team.id}/submission/upload-url`).set('Authorization', auth('alice')).send({ mimeType: 'image/png', fileSize: 100 });
    expect(noDraft.body.error.code).toBe('NO_SUBMISSION');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App' });
    const sid = db.hackathonSubmission[0].id;
    const ok = await api().post(`${base}/teams/${team.id}/submission/upload-url`).set('Authorization', auth('alice')).send({ mimeType: 'image/png', fileSize: 100 });
    expect(ok.status).toBe(200);
    expect(ok.body.path.startsWith(`${HID}/${sid}/tmp/`)).toBe(true);
    expect(media.createImageUploadUrl).toHaveBeenCalledWith(HID, sid, 'png');
    for (const body of [{ mimeType: 'image/svg+xml', fileSize: 100 }, { mimeType: 'application/pdf', fileSize: 100 }, { mimeType: 'image/png', fileSize: 11 * 1024 * 1024 }, { mimeType: 'image/png' }]) {
      const bad = await api().post(`${base}/teams/${team.id}/submission/upload-url`).set('Authorization', auth('alice')).send(body);
      expect(bad.status).toBeGreaterThanOrEqual(400);
    }
    expect(media.createImageUploadUrl).toHaveBeenCalledTimes(1);
  });

  it('attach accepts only this submission\'s tmp paths; max 6 screenshots; cover replaces', async () => {
    const { team, sid } = await teamWithDraft();
    const otherSid = crypto.randomUUID();
    const u = () => crypto.randomUUID();
    for (const path of [`${OTHER_HID}/${sid}/tmp/${u()}.png`, `${HID}/${otherSid}/tmp/${u()}.png`, `${HID}/${sid}/${u()}.png`, '../etc/passwd', `${HID}/${sid}/tmp/${u()}.svg`]) {
      const r = await api().post(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path });
      expect(r.body.error.code).toBe('BAD_PATH');
    }
    expect(media.finalizeImage).not.toHaveBeenCalled();
    for (let i = 0; i < 6; i++) {
      const r = await api().post(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: `${HID}/${sid}/tmp/${u()}.png` });
      expect(r.status).toBe(200);
    }
    const seventh = await api().post(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: `${HID}/${sid}/tmp/${u()}.png` });
    expect(seventh.body.error.code).toBe('LIMIT_REACHED');
    const urlCap = await api().post(`${base}/teams/${team.id}/submission/upload-url`).set('Authorization', auth('alice')).send({ mimeType: 'image/png', fileSize: 1 });
    expect(urlCap.body.error.code).toBe('LIMIT_REACHED');
    expect(db.hackathonSubmission[0].screenshotPaths).toHaveLength(6);

    const cover1 = await api().post(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: `${HID}/${sid}/tmp/${u()}.png`, kind: 'cover' });
    const firstCover = cover1.body.team.submission.cover.path;
    expect(cover1.body.team.submission.cover.url).toContain('https://signed.example/');
    await api().post(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: `${HID}/${sid}/tmp/${u()}.png`, kind: 'cover' });
    expect(media.removeImages).toHaveBeenCalledWith([firstCover]);

    // remove: only this submission's own stored paths
    const shot = db.hackathonSubmission[0].screenshotPaths[0];
    expect((await api().delete(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: `${HID}/${otherSid}/${u()}.png` })).status).toBe(404);
    const del = await api().delete(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: shot });
    expect(del.status).toBe(200);
    expect(del.body.team.submission.screenshots).toHaveLength(5);
  });

  it('upload-url is rate limited (30/hr per user)', async () => {
    const { team } = await teamWithDraft();
    let last = 200;
    for (let i = 0; i < 31; i++) {
      last = (await api().post(`${base}/teams/${team.id}/submission/upload-url`).set('Authorization', auth('alice')).send({ mimeType: 'image/png', fileSize: 1 })).status;
    }
    expect(last).toBe(429);
  });

  it('team create/join is rate limited (10/hr per user)', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await joinTeam('bob', 'zzzzzzzzzz')).status;
    expect(last).toBe(429);
  });
});

// ------------------------------------------------------------------ host list, moderation, CSV

describe('host Teams & Submissions', () => {
  async function seedProjects() {
    const t1 = await createTeam('alice', '=cmd|calc');
    await joinTeam('bob', t1.inviteCode);
    await api().put(`${base}/teams/${t1.id}/submission`).set('Authorization', auth('alice')).send({ name: '+Evil', tagline: '@SUM(1)', description: 'line1\nline2, "quoted"', trackIds: [TRACK] });
    await api().post(`${base}/teams/${t1.id}/submission/submit`).set('Authorization', auth('alice'));
    await createTeam('carol', 'No Project Yet');
    return t1;
  }

  it.each([
    ['anonymous', undefined, 401],
    ['logged-in non-host', 'rando', 403],
    ['approved guest', 'alice', 403],
    ['judge', 'judge', 403],
    ['co-host without the tab', 'cohost', 403],
  ] as const)('%s cannot list, moderate or export', async (_l, who, status) => {
    await seedProjects();
    const sid = db.hackathonSubmission[0].id;
    const withAuth = (r: request.Test) => (who ? r.set('Authorization', auth(who)) : r);
    expect((await withAuth(api().get(`${base}/submissions`))).status).toBe(status);
    expect((await withAuth(api().patch(`${base}/submissions/${sid}`)).send({ action: 'disqualify', reason: 'x' })).status).toBe(status);
    expect((await withAuth(api().get(`${base}/export.csv`))).status).toBe(status);
    expect(db.hackathonSubmission[0].status).toBe('submitted');
  });

  it('host list: every team, members with emails, drafts included, counts', async () => {
    await seedProjects();
    const res = await api().get(`${base}/submissions`).set('Authorization', auth('host'));
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ teams: 2, submitted: 1 });
    expect(res.body.teams[0].members.map((m: Row) => m.email)).toEqual(['alice@example.com', 'bob@example.com']);
    expect(res.body.teams[1].submission).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('u-a');
  });

  it('moderation: submission ids from another hackathon are 404', async () => {
    await seedProjects();
    const foreign = crypto.randomUUID();
    db.hackathonSubmission.push({ id: foreign, hackathonId: OTHER_HID, teamId: crypto.randomUUID(), name: 'x', slug: 'x', status: 'submitted', screenshotPaths: [] });
    const res = await api().patch(`${base}/submissions/${foreign}`).set('Authorization', auth('host')).send({ action: 'disqualify', reason: 'x' });
    expect(res.status).toBe(404);
    expect(db.hackathonSubmission.find((s) => s.id === foreign)!.status).toBe('submitted');
    expect((await api().patch(`${base}/submissions/not-a-uuid`).set('Authorization', auth('host')).send({ action: 'restore' })).status).toBe(404);
  });

  it('CSV export escapes formula lead-ins and quotes', async () => {
    await seedProjects();
    const res = await api().get(`${base}/export.csv`).set('Authorization', auth('host'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text;
    expect(text).toContain("'+Evil");
    expect(text).toContain("'=cmd|calc");
    expect(text).toContain("'@SUM(1)");
    expect(text).toContain('"line1\nline2, ""quoted"""');
    expect(text).not.toMatch(/(^|,)=cmd/m);
    expect(text).toContain('DeFi');
    const members = await api().get(`${base}/export.csv?kind=members`).set('Authorization', auth('host'));
    expect(members.text).toContain('bob@example.com');
    expect(members.text.split('\r\n').filter(Boolean)).toHaveLength(1 + 3);
  });
});

// ------------------------------------------------------------------ public read privacy

describe('public GET /hackathon never exposes teams or projects', () => {
  it('anonymous + logged-in guests get no drafts, emails, invite codes or unrevealed projects', async () => {
    const t1 = await createTeam('alice', 'Hidden Team');
    await api().put(`${base}/teams/${t1.id}/submission`).set('Authorization', auth('alice')).send({ name: 'Secret Draft', repoUrl: 'https://github.com/secret/repo' });
    for (const who of [undefined, 'bob', 'alice'] as const) {
      const r = api().get(base);
      const res = await (who ? r.set('Authorization', auth(who)) : r);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      for (const s of ['Hidden Team', 'Secret Draft', 'github.com/secret', t1.inviteCode, 'alice@example.com', 'u-a']) {
        expect(body).not.toContain(s);
      }
    }
  });
});

// ------------------------------------------------------------------ review fixes

describe('review fixes', () => {
  it('a host who is ON the team gets participant rules (deadline, captain, disqualified lock)', async () => {
    // Make the host an approved guest so they can join a team like anyone else.
    db.guest.push({ id: 'g-host', partyId: PARTY, email: 'host@example.com', approved: true, status: 'CONFIRMED', checkedInAt: null });
    const team = await createTeam('alice');
    expect((await joinTeam('host', team.inviteCode)).status).toBe(201);
    // Not captain: can't rename even though they host.
    const rename = await api().patch(`${base}/teams/${team.id}`).set('Authorization', auth('host')).send({ name: 'Mine' });
    expect(rename.status).toBe(403);
    expect(rename.body.error.code).toBe('NOT_CAPTAIN');
    // Member shape (no emails), not the host shape.
    const save = await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('host')).send({ name: 'App', trackIds: [TRACK] });
    expect(save.status).toBe(201);
    expect(JSON.stringify(save.body)).not.toContain('alice@example.com');
    // Disqualified lock applies to them as a member.
    const sid = db.hackathonSubmission[0].id;
    db.hackathonSubmission[0].status = 'disqualified';
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('host')).send({ name: 'x' })).body.error.code).toBe('DISQUALIFIED');
    db.hackathonSubmission[0].status = 'draft';
    // Deadline applies too.
    setHackathon({ submissionDeadline: new Date(Date.now() - 1000) });
    expect((await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('host')).send({ name: 'Late' })).body.error.code).toBe('DEADLINE_PASSED');
    // ...but they can still moderate through the host routes.
    expect((await api().patch(`${base}/submissions/${sid}`).set('Authorization', auth('host')).send({ tableNumber: 'A1' })).status).toBe(200);
  });

  it('submissionsOpenAt applies to a host-member', async () => {
    db.guest.push({ id: 'g-host', partyId: PARTY, email: 'host@example.com', approved: true, status: 'CONFIRMED', checkedInAt: null });
    setHackathon({ submissionsOpenAt: new Date(Date.now() + 3600_000) });
    const team = await createTeam('host');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('host')).send({ name: 'App', trackIds: [TRACK] });
    expect((await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('host'))).body.error.code).toBe('NOT_OPEN_YET');
  });

  it('a member who lost eligibility stays listed but cannot write; can still leave', async () => {
    const team = await createTeam('alice');
    await joinTeam('bob', team.inviteCode);
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    db.guest.find((g) => g.id === 'g-bob')!.approved = false; // host declined Bob after he joined
    for (const [m, sfx, body] of [
      ['put', 'submission', { name: 'x' }], ['post', 'submission/submit'],
      ['post', 'submission/upload-url', { mimeType: 'image/png', fileSize: 1 }],
    ] as Array<[string, string, Row?]>) {
      const r = await (api() as any)[m](`${base}/teams/${team.id}/${sfx}`).set('Authorization', auth('bob')).send(body ?? {});
      expect([sfx, r.status, r.body.error?.code]).toEqual([sfx, 403, 'NOT_ELIGIBLE']);
      expect(r.body.error.message).toMatch(/wasn't approved/);
    }
    expect(db.hackathonSubmission[0].name).toBe('App');
    const me = await api().get(`${base}/me`).set('Authorization', auth('alice'));
    expect(me.body.team.members.map((m: Row) => m.name)).toContain('Bob');
    expect((await api().post(`${base}/teams/${team.id}/leave`).set('Authorization', auth('bob'))).status).toBe(200);
  });

  it('a member who became a judge cannot write', async () => {
    const team = await createTeam('alice');
    db.hackathonJudge.push({ id: 'j2', hackathonId: HID, email: 'alice@example.com', status: 'active' });
    const r = await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Judges/);
  });

  it('email match is exact (no ILIKE wildcards): a_b@ does not match a.b@', async () => {
    db.guest.push({ id: 'g-dot', partyId: PARTY, email: 'A.B@example.com', approved: true, status: 'CONFIRMED', checkedInAt: null });
    db.user.push({ id: 'u-us', email: 'a_b@example.com', name: 'Under', profilePictureUrl: null }, { id: 'u-dot', email: 'a.b@example.com', name: 'Dot', profilePictureUrl: null });
    const tok = (id: string, email: string) => `Bearer ${jwt.sign({ userId: id, email }, JWT_SECRET, { expiresIn: '1h' })}`;
    const under = await api().get(`${base}/me`).set('Authorization', tok('u-us', 'a_b@example.com'));
    expect(under.body.eligibility).toEqual({ eligible: false, reason: 'no_rsvp' });
    const pct = await api().get(`${base}/me`).set('Authorization', tok('u-us', '%@example.com'));
    expect(pct.body.eligibility.reason).toBe('no_rsvp');
    const dot = await api().get(`${base}/me`).set('Authorization', tok('u-dot', 'a.b@EXAMPLE.com'));
    expect(dot.body.eligibility.eligible).toBe(true);
    const guestQueries = mockPrisma.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?')).filter((s: string) => s.includes('FROM guests'));
    expect(guestQueries.length).toBeGreaterThan(0);
    for (const s of guestQueries) {
      expect(s).toContain('lower(email) = lower(');
      expect(s).not.toMatch(/ILIKE/i);
    }
  });

  it('team deleted under the lock: join / submit / save answer 404, not 500', async () => {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    // Simulate the last member's leave committing between our pre-checks and our lock.
    const realRaw = mockPrisma.$queryRaw.getMockImplementation()!;
    mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...vals: any[]) =>
      strings.join('?').includes('FOR UPDATE') ? [] : realRaw(strings, ...vals));
    const join = await joinTeam('bob', team.inviteCode);
    expect(join.status).toBe(404);
    const submit = await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    expect(submit.status).toBe(404);
    const save = await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'x' });
    expect(save.status).toBe(404);
    expect(db.hackathonSubmission[0].status).toBe('draft');
    expect(db.hackathonTeamMember).toHaveLength(1);
  });

  it('submit and save take the team lock', async () => {
    const team = await createTeam('alice');
    mockPrisma.$queryRaw.mockClear();
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App', trackIds: [TRACK] });
    await api().post(`${base}/teams/${team.id}/submission/submit`).set('Authorization', auth('alice'));
    const locks = mockPrisma.$queryRaw.mock.calls.filter((c: any[]) => c[0].join('?').includes('FOR UPDATE'));
    expect(locks).toHaveLength(2);
  });

  it('regenerate-code respects the deadline for participants, not for hosts', async () => {
    const team = await createTeam('alice');
    setHackathon({ submissionDeadline: new Date(Date.now() - 1000) });
    expect((await api().post(`${base}/teams/${team.id}/regenerate-code`).set('Authorization', auth('alice'))).body.error.code).toBe('DEADLINE_PASSED');
    expect((await api().post(`${base}/teams/${team.id}/regenerate-code`).set('Authorization', auth('host'))).status).toBe(200);
  });

  it('restore returns the exact pre-disqualification status; withdrawn cannot be disqualified', async () => {
    const t1 = await createTeam('alice', 'A');
    const t2 = await createTeam('bob', 'B');
    await api().put(`${base}/teams/${t1.id}/submission`).set('Authorization', auth('alice')).send({ name: 'Draft One' });
    await api().put(`${base}/teams/${t2.id}/submission`).set('Authorization', auth('bob')).send({ name: 'Sub Two', trackIds: [TRACK] });
    await api().post(`${base}/teams/${t2.id}/submission/submit`).set('Authorization', auth('bob'));
    const [draft, sub] = db.hackathonSubmission;
    const mod = (id: string, body: Row) => api().patch(`${base}/submissions/${id}`).set('Authorization', auth('host')).send(body);

    await mod(draft.id, { action: 'disqualify', reason: 'spam' });
    expect((await mod(draft.id, { action: 'restore' })).body.team.submission.status).toBe('draft');
    await mod(sub.id, { action: 'disqualify', reason: 'copied' });
    expect((await mod(sub.id, { action: 'disqualify', reason: 'copied, confirmed' })).body.team.submission.disqualifiedReason).toBe('copied, confirmed');
    expect((await mod(sub.id, { action: 'restore' })).body.team.submission.status).toBe('submitted');

    await api().post(`${base}/teams/${t2.id}/submission/withdraw`).set('Authorization', auth('bob'));
    const dqWithdrawn = await mod(sub.id, { action: 'disqualify', reason: 'x' });
    expect(dqWithdrawn.status).toBe(409);
    expect(dqWithdrawn.body.error.code).toBe('WITHDRAWN');
    expect(db.hackathonSubmission[1].status).toBe('withdrawn');
  });

  it('attach has its own limiter, separate from upload-url', async () => {
    const team = await createTeam('alice');
    await api().put(`${base}/teams/${team.id}/submission`).set('Authorization', auth('alice')).send({ name: 'App' });
    for (let i = 0; i < 30; i++) {
      await api().post(`${base}/teams/${team.id}/submission/upload-url`).set('Authorization', auth('alice')).send({ mimeType: 'image/png', fileSize: 1 });
    }
    // upload-url quota is spent, attach still works.
    const sid = db.hackathonSubmission[0].id;
    const r = await api().post(`${base}/teams/${team.id}/submission/images`).set('Authorization', auth('alice')).send({ path: `${HID}/${sid}/tmp/${crypto.randomUUID()}.png`, kind: 'cover' });
    expect(r.status).toBe(200);
  });
});
