/**
 * Hackathon PR 6: public gallery + project pages + the `hackathon` TV display.
 *   - visibility matrix: gallery_visibility (hidden / after_deadline / after_reveal) x phase
 *     (before the deadline / after the deadline / after the reveal) x viewer (anon / own team /
 *     other team / host), for the list and the project page;
 *   - excluded statuses (draft, disqualified, withdrawn) never reach the public;
 *   - no PII (emails, user / guest ids, invite codes, scores, payout data, hidden members);
 *   - signed URL scoping (only shown projects, only paths under the project's own prefix);
 *   - event visibility (pre-launch hidden, password events);
 *   - display config validation + the display hackathon block.
 * Prisma is a small in-memory fake (just the queries these routes make).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-hackathon-gallery-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: canEdit, canUserAccessTab: canTab }));
const eventHidden = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../helpers/eventVisibility.js', () => ({ isEventHiddenFrom: eventHidden }));
const guestsByEmail = vi.hoisted(() => vi.fn(async () => [] as Array<{ id: string; approved: boolean | null }>));
vi.mock('../lib/hackathon/eligibility.js', () => ({ findGuestsByEmail: guestsByEmail }));
const signer = vi.hoisted(() => vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}?token=t`]))));
vi.mock('../lib/hackathon/media.js', async (orig) => ({ ...(await orig<typeof import('../lib/hackathon/media.js')>()), signImagePaths: signer }));

import galleryRoutes from './hackathon-gallery.routes.js';
import displayRoutes from './display.routes.js';
import { errorHandler } from '../middleware/error.js';
import { _resetSignedUrlCache } from '../lib/hackathon/signedUrlCache.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', galleryRoutes);
  a.use('/api/parties', displayRoutes);
  a.use('/api/display', displayRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const HID = '22222222-2222-4222-8222-222222222222';
const OTHER_HID = '88888888-8888-4888-8888-888888888888';
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '33333333-3333-4333-8333-444444444444';
const P_GRAND = '44444444-4444-4444-8444-000000000001';
const P_TRACK = '44444444-4444-4444-8444-000000000002';
const sid = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const tid = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`;
const S_PUB = sid(1); // submitted, team 1 (alice + hidden member + nameless member)
const S_PUB2 = sid(2); // submitted, team 2 (carol)
const S_DRAFT = sid(3); // team 3 (bob)
const S_DQ = sid(4); // team 4
const S_WD = sid(5); // team 5
const IMG = (s: string, n: number, h = HID) => `${h}/${s}/aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}.png`;

type Row = Record<string, any>;
let db: Record<string, Row[]>;
let hackathon: Row | null;
let party: Row;

const USERS: Record<string, { id: string; email: string }> = {
  host: { id: 'u-host', email: 'host@example.com' },
  alice: { id: 'u-alice', email: 'alice@example.com' },
  bob: { id: 'u-bob', email: 'bob@example.com' },
  carol: { id: 'u-carol', email: 'carol@example.com' },
  rando: { id: 'u-rando', email: 'rando@example.com' },
};
const auth = (who: keyof typeof USERS) => `Bearer ${jwt.sign({ userId: USERS[who].id, email: USERS[who].email }, JWT_SECRET, { expiresIn: '1h' })}`;

const PAST = new Date(Date.now() - 3600_000);
const FUTURE = new Date(Date.now() + 86400_000);

function baseHackathon(over: Row = {}): Row {
  return {
    id: HID, partyId: PARTY, rules: null, submissionsOpenAt: null, submissionDeadline: PAST,
    teamMinSize: 1, teamMaxSize: 5, maxTracksPerSubmission: 2, eligibility: 'registered', blindJudging: false,
    judgingStatus: 'closed', publishedAt: new Date('2026-01-01T00:00:00Z'), galleryVisibility: 'after_reveal',
    resultsRevealedAt: new Date(), disabledAt: null,
    tracks: [
      { id: T1, hackathonId: HID, name: 'DeFi', description: 'Money', sponsorName: 'Acme', sortOrder: 0 },
      { id: T2, hackathonId: HID, name: 'Gaming', description: null, sponsorName: null, sortOrder: 1 },
    ],
    prizes: [
      { id: P_GRAND, hackathonId: HID, trackId: null, name: 'Grand Prize', amountText: '$5,000', quantity: 1, sortOrder: 0 },
      { id: P_TRACK, hackathonId: HID, trackId: T2, name: 'Best Game', amountText: null, amountValue: '500', currency: 'MON', quantity: 2, sortOrder: 1 },
    ],
    ...over,
  };
}

function sub(id: string, team: string, status: string, over: Row = {}): Row {
  return {
    id, hackathonId: HID, teamId: team, name: `Project ${id.slice(-1)}`, slug: `project-${id.slice(-1)}`,
    tagline: 'Tag', description: 'Desc', repoUrl: 'https://github.com/x/y', demoVideoUrl: 'https://youtu.be/abc',
    deckUrl: null, liveUrl: 'javascript:alert(1)', coverPath: IMG(id, 1), screenshotPaths: [IMG(id, 2)],
    status, submittedAt: status === 'draft' ? null : new Date('2026-01-02T00:00:00Z'), tableNumber: 'A1',
    disqualifiedReason: status === 'disqualified' ? 'Plagiarism (secret reason)' : null, ...over,
  };
}

function seed() {
  hackathon = baseHackathon();
  party = { id: PARTY, eventType: null, eventTags: [], date: null, region: null, city: null, password: null };
  db = {
    submission: [
      sub(S_PUB, tid(1), 'submitted', { name: 'Zeta Swap', slug: 'zeta-swap', screenshotPaths: [IMG(S_PUB, 2), IMG(S_PUB, 3, OTHER_HID), `${HID}/${S_PUB}/tmp/aaaaaaaa-aaaa-4aaa-8aaa-000000000009.png`] }),
      sub(S_PUB2, tid(2), 'submitted', { name: 'Alpha Game', slug: 'alpha-game', coverPath: IMG(S_DRAFT, 1) /* not its own prefix */ }),
      sub(S_DRAFT, tid(3), 'draft', { name: 'Draft Thing', slug: 'draft-thing' }),
      sub(S_DQ, tid(4), 'disqualified', { name: 'Cheater', slug: 'cheater' }),
      sub(S_WD, tid(5), 'withdrawn', { name: 'Quitter', slug: 'quitter' }),
    ],
    subTrack: [
      { submissionId: S_PUB, trackId: T1 },
      { submissionId: S_PUB2, trackId: T2 },
    ],
    team: [1, 2, 3, 4, 5].map((n) => ({ id: tid(n), hackathonId: HID, name: `Team ${n}`, inviteCode: `INVITE${n}SECRET` })),
    member: [
      { id: 'm1', teamId: tid(1), hackathonId: HID, userId: 'u-alice', guestId: 'g-alice', role: 'captain', showOnGallery: true, joinedAt: new Date(1) },
      { id: 'm2', teamId: tid(1), hackathonId: HID, userId: 'u-hidden', guestId: null, role: 'member', showOnGallery: false, joinedAt: new Date(2) },
      { id: 'm3', teamId: tid(1), hackathonId: HID, userId: 'u-noname', guestId: null, role: 'member', showOnGallery: true, joinedAt: new Date(3) },
      { id: 'm4', teamId: tid(2), hackathonId: HID, userId: 'u-carol', guestId: null, role: 'captain', showOnGallery: true, joinedAt: new Date(4) },
      { id: 'm5', teamId: tid(3), hackathonId: HID, userId: 'u-bob', guestId: null, role: 'captain', showOnGallery: true, joinedAt: new Date(5) },
    ],
    user: [
      { id: 'u-alice', name: 'Alice Liddell', email: 'alice@example.com', profilePictureUrl: 'https://cdn.example/alice.png' },
      { id: 'u-hidden', name: 'Secret Sam', email: 'sam@example.com', profilePictureUrl: null },
      { id: 'u-noname', name: null, email: 'noname@example.com', profilePictureUrl: null },
      { id: 'u-carol', name: 'Carol', email: 'carol@example.com', profilePictureUrl: 'javascript:alert(1)' },
      { id: 'u-bob', name: 'Bob', email: 'bob@example.com', profilePictureUrl: null },
    ],
    guest: [{ id: 'g-alice', name: 'Alice Guest', email: 'alice@example.com' }],
    award: [
      { id: 'a1', hackathonId: HID, prizeId: P_TRACK, submissionId: S_PUB2, place: 1, payoutStatus: 'paid', recipientWallet: '0xWALLETSECRET', payoutReference: 'TXSECRET' },
      { id: 'a2', hackathonId: HID, prizeId: P_GRAND, submissionId: S_PUB, place: 1, payoutStatus: 'unpaid', recipientWallet: null, payoutReference: null },
      { id: 'a3', hackathonId: HID, prizeId: P_GRAND, submissionId: S_DQ, place: 2, payoutStatus: 'unpaid' },
    ],
    display: [],
  };
}

function shapeSub(s: Row): Row {
  const team = db.team.find((t) => t.id === s.teamId)!;
  return {
    ...s,
    tracks: db.subTrack.filter((t) => t.submissionId === s.id).map((t) => ({ trackId: t.trackId })),
    // The fake returns emails + ids too: the serializers must drop them.
    team: {
      ...team,
      members: db.member.filter((m) => m.teamId === team.id).map((m) => ({
        ...m,
        user: db.user.find((u) => u.id === m.userId) ?? null,
        guest: db.guest.find((g) => g.id === m.guestId) ?? null,
      })),
    },
  };
}

function installPrisma() {
  for (const k of Object.keys(mockPrisma)) delete mockPrisma[k];
  mockPrisma.hackathon = {
    findUnique: vi.fn(async ({ where }: any) => (hackathon && where.partyId === PARTY ? hackathon : null)),
  };
  mockPrisma.party = { findUnique: vi.fn(async () => party) };
  mockPrisma.hackathonSubmission = {
    findMany: vi.fn(async ({ where, take }: any) =>
      db.submission.filter((s) => s.hackathonId === where.hackathonId && (!where.status || s.status === where.status)).slice(0, take).map(shapeSub)),
    findUnique: vi.fn(async ({ where }: any) => {
      const s = db.submission.find((x) => x.hackathonId === where.hackathonId_slug.hackathonId && x.slug === where.hackathonId_slug.slug);
      return s ? shapeSub(s) : null;
    }),
  };
  mockPrisma.hackathonTeamMember = {
    findUnique: vi.fn(async ({ where }: any) => {
      const m = db.member.find((x) => x.hackathonId === where.hackathonId_userId.hackathonId && x.userId === where.hackathonId_userId.userId);
      return m ? { teamId: m.teamId } : null;
    }),
  };
  mockPrisma.hackathonAward = {
    findMany: vi.fn(async ({ where }: any) =>
      db.award.filter((a) => a.hackathonId === where.hackathonId && where.submissionId.in.includes(a.submissionId)).map((a) => ({
        ...a,
        prize: hackathon!.prizes.find((p: Row) => p.id === a.prizeId),
        // AWARD_INCLUDE shape (PR 5); recipient email present to prove it never leaks.
        submission: (() => { const x = db.submission.find((y) => y.id === a.submissionId)!; return { id: x.id, name: x.name, slug: x.slug, tagline: x.tagline, status: x.status, team: { id: x.teamId, name: db.team.find((t) => t.id === x.teamId)!.name } }; })(),
        recipient: { id: 'u-alice', name: 'Alice', email: 'alice@example.com' },
      }))),
  };
  mockPrisma.display = {
    findUnique: vi.fn(async ({ where }: any) => {
      const d = db.display.find((x) => x.partyId === where.partyId_slug.partyId && x.slug === where.partyId_slug.slug);
      return d ? { ...d, party: { id: PARTY, name: 'Hack Night', date: null, address: null, venueName: null, eventImageUrl: null, inviteCode: 'abc', customUrl: null } } : null;
    }),
    findFirst: vi.fn(async ({ where }: any) => db.display.find((x) => x.id === where.id && x.partyId === where.partyId) ?? null),
    create: vi.fn(async ({ data }: any) => { const d = { id: `d${db.display.length + 1}`, isActive: true, ...data }; db.display.push(d); return d; }),
    update: vi.fn(async ({ where, data }: any) => { const d = db.display.find((x) => x.id === where.id)!; Object.assign(d, data.viewCount ? {} : data); return d; }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSignedUrlCache();
  seed();
  installPrisma();
  canEdit.mockImplementation(async (_p: string, _u?: string, email?: string) => email === 'host@example.com');
  canTab.mockImplementation(async (_p: string, email?: string) => email === 'host@example.com');
  eventHidden.mockResolvedValue(false);
  guestsByEmail.mockResolvedValue([]);
});

const PII = ['@example.com', 'u-alice', 'u-carol', 'u-bob', 'g-alice', 'm1', 'INVITE', 'SECRET', 'Secret Sam', 'Plagiarism', 'payout', 'Wallet', 'Cheater', 'Quitter', 'Draft Thing', 'javascript:'];
function expectNoPii(body: unknown, allow: string[] = []) {
  const s = JSON.stringify(body);
  for (const p of PII) if (!allow.includes(p)) expect(s, `leaked ${p}`).not.toContain(p);
}

// ------------------------------------------------------------------ visibility matrix

type Phase = 'before' | 'after_deadline' | 'after_reveal';
const PHASES: Record<Phase, Row> = {
  before: { submissionDeadline: FUTURE, resultsRevealedAt: null },
  after_deadline: { submissionDeadline: PAST, resultsRevealedAt: null },
  after_reveal: { submissionDeadline: PAST, resultsRevealedAt: new Date() },
};
const open = (vis: string, phase: Phase) =>
  vis === 'after_deadline' ? phase !== 'before' : vis === 'after_reveal' ? phase === 'after_reveal' : false;

describe('visibility matrix', () => {
  for (const vis of ['hidden', 'after_deadline', 'after_reveal']) {
    for (const phase of Object.keys(PHASES) as Phase[]) {
      const isOpen = open(vis, phase);
      describe(`${vis} / ${phase} (open=${isOpen})`, () => {
        beforeEach(() => { hackathon = baseHackathon({ galleryVisibility: vis, ...PHASES[phase] }); });

        it('anonymous', async () => {
          const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
          expect(g.status).toBe(200);
          expect(g.body.available).toBe(isOpen);
          expect(g.body.preview).toBe(false);
          expect(g.body.projects.length).toBe(isOpen ? 2 : 0);
          expect(g.headers['cache-control']).toBe('private, max-age=60');
          const p = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`);
          expect(p.status).toBe(isOpen ? 200 : 404);
          if (isOpen) expect(p.body.preview).toBe(false);
          expectNoPii(g.body);
          if (isOpen) expectNoPii(p.body);
        });

        it('own team: list like the public, own project page always (preview until open)', async () => {
          const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('alice'));
          expect(g.body.available).toBe(isOpen);
          expect(g.body.projects.length).toBe(isOpen ? 2 : 0);
          const p = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`).set('Authorization', auth('alice'));
          expect(p.status).toBe(200);
          expect(p.body.preview).toBe(!isOpen);
          expect(p.body.project.status).toBe(isOpen ? undefined : 'submitted');
          // ...but never another team's project before the gallery opens
          const other = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/alpha-game`).set('Authorization', auth('alice'));
          expect(other.status).toBe(isOpen ? 200 : 404);
        });

        it('host: always a preview of what the public will see', async () => {
          const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('host'));
          expect(g.body.available).toBe(true);
          expect(g.body.preview).toBe(!isOpen);
          expect(g.body.projects.map((x: Row) => x.slug).sort()).toEqual(['alpha-game', 'zeta-swap']);
          expect(g.headers['cache-control']).toBe('private, no-store');
          const p = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`).set('Authorization', auth('host'));
          expect(p.status).toBe(200);
          expect(p.body.preview).toBe(!isOpen);
        });
      });
    }
  }

  it('unpublished or disabled: nothing for the public, even after the reveal', async () => {
    for (const over of [{ publishedAt: null }, { disabledAt: new Date() }]) {
      hackathon = baseHackathon(over);
      const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
      expect(g.body.available).toBe(false);
      expect(g.body.projects).toEqual([]);
      expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`)).status).toBe(404);
    }
  });

  it('after_deadline with no deadline set waits for the reveal', async () => {
    hackathon = baseHackathon({ galleryVisibility: 'after_deadline', submissionDeadline: null, resultsRevealedAt: null });
    const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    expect(g.body.available).toBe(false);
    expect(g.body.opensAfter).toBe('reveal');
  });

  it('no hackathon at all: available false, 404 for projects', async () => {
    hackathon = null;
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`)).body.available).toBe(false);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`)).status).toBe(404);
  });

  it('bad ids / slugs 404 without touching the DB', async () => {
    expect((await request(app()).get(`/api/parties/not-a-uuid/hackathon/gallery`)).status).toBe(404);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/Bad_Slug`)).status).toBe(404);
    expect(mockPrisma.hackathon.findUnique).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ statuses + PII

describe('excluded statuses', () => {
  it('drafts, disqualified and withdrawn projects never reach the public (list, page, winners)', async () => {
    const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    expect(g.body.projects.map((p: Row) => p.slug).sort()).toEqual(['alpha-game', 'zeta-swap']);
    for (const slug of ['draft-thing', 'cheater', 'quitter']) {
      expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/${slug}`)).status).toBe(404);
      expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/${slug}`).set('Authorization', auth('rando'))).status).toBe(404);
    }
    // The submissions query itself filters on status.
    expect(mockPrisma.hackathonSubmission.findMany.mock.calls[0][0].where).toEqual({ hackathonId: HID, status: 'submitted' });
    // The DQ'd project's award (a3) is not shown anywhere.
    expectNoPii(g.body);
  });

  it("a team sees its own draft as a preview, other teams' drafts 404; the host sees any status", async () => {
    const own = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/draft-thing`).set('Authorization', auth('bob'));
    expect(own.status).toBe(200);
    expect(own.body.preview).toBe(true);
    expect(own.body.project.status).toBe('draft');
    expect(own.body.project.awards).toEqual([]);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/draft-thing`).set('Authorization', auth('alice'))).status).toBe(404);
    const host = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/cheater`).set('Authorization', auth('host'));
    expect(host.status).toBe(200);
    expect(host.body.project.status).toBe('disqualified');
    expect(JSON.stringify(host.body)).not.toContain('Plagiarism');
  });
});

describe('no PII + project shape', () => {
  it('project page: allowlisted fields, members by display name only (show_on_gallery, no email fallback)', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`);
    expect(res.status).toBe(200);
    const p = res.body.project;
    expect(Object.keys(p).sort()).toEqual(['awards', 'cover', 'description', 'links', 'members', 'name', 'screenshots', 'slug', 'submittedAt', 'tableNumber', 'tagline', 'teamName', 'trackIds']);
    expect(p.members).toEqual([{ name: 'Alice Liddell', avatarUrl: 'https://cdn.example/alice.png' }]);
    // javascript: link dropped on read even if it somehow got stored
    expect(p.links).toEqual({ repoUrl: 'https://github.com/x/y', demoVideoUrl: 'https://youtu.be/abc', deckUrl: null, liveUrl: null });
    expect(p.awards).toEqual([{ prizeName: 'Grand Prize', prizeAmount: '$5,000', trackName: null, place: 1, multi: false }]);
    expectNoPii(res.body);
    // No submission ids either (they only appear inside the signed storage URLs' paths).
    const { cover: _c, screenshots: _s, ...rest } = p;
    expect(JSON.stringify(rest)).not.toContain(S_PUB);
  });

  it('gallery cards: winners first, badges after reveal only, unsafe avatars dropped', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    expect(res.body.projects.map((p: Row) => p.slug)).toEqual(['zeta-swap', 'alpha-game']); // Grand Prize (sort 0) first
    expect(res.body.projects[1].awards).toEqual([{ prizeName: 'Best Game', prizeAmount: '500 MON', trackName: 'Gaming', place: 1, multi: true }]);
    expect(Object.keys(res.body.projects[0]).sort()).toEqual(['awards', 'cover', 'name', 'slug', 'tableNumber', 'tagline', 'teamName', 'trackIds']);
    expect(res.body.tracks.map((t: Row) => t.name)).toEqual(['DeFi', 'Gaming']);

    hackathon = baseHackathon({ galleryVisibility: 'after_deadline', resultsRevealedAt: null });
    const before = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    expect(before.body.available).toBe(true);
    expect(before.body.projects.every((p: Row) => p.awards.length === 0)).toBe(true);
    expect(mockPrisma.hackathonAward.findMany).toHaveBeenCalledTimes(1); // not queried before the reveal
  });
});

// ------------------------------------------------------------------ event visibility

describe('event visibility', () => {
  it('pre-launch hidden events: nothing for the public, preview for the host', async () => {
    eventHidden.mockResolvedValue(true);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`)).body.available).toBe(false);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`)).status).toBe(404);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('host'))).body.available).toBe(true);
  });

  it('password events: only logged-in, non-declined guests', async () => {
    party.password = 'hunter2';
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`)).body.available).toBe(false);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('rando'))).body.available).toBe(false);
    guestsByEmail.mockResolvedValue([{ id: 'g', approved: false }]);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('rando'))).body.available).toBe(false);
    guestsByEmail.mockResolvedValue([{ id: 'g', approved: null }]);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('rando'))).body.available).toBe(true);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`).set('Authorization', auth('rando'))).status).toBe(200);
  });
});

// ------------------------------------------------------------------ signed URLs

describe('signed URL scoping', () => {
  it('signs only covers of shown projects under their own prefix; the page signs its own screenshots only', async () => {
    const g = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    const signed = signer.mock.calls.flatMap((c) => c[0] as string[]);
    expect(signed).toEqual([IMG(S_PUB, 1)]); // alpha-game's cover points at another project's prefix: not signed
    expect(g.body.projects.find((p: Row) => p.slug === 'alpha-game').cover).toBeNull();
    expect(g.body.projects.find((p: Row) => p.slug === 'zeta-swap').cover).toBe(`https://signed.example/${IMG(S_PUB, 1)}?token=t`);
    for (const s of [S_DRAFT, S_DQ, S_WD]) expect(signed.join(' ')).not.toContain(s);

    signer.mockClear();
    const p = await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`);
    // Cover came from the cache; the foreign-prefix and tmp screenshots are never signed.
    expect(signer.mock.calls.flatMap((c) => c[0] as string[])).toEqual([IMG(S_PUB, 2)]);
    expect(p.body.project.screenshots).toEqual([`https://signed.example/${IMG(S_PUB, 2)}?token=t`]);
  });

  it('closed gallery: nothing is signed for the public', async () => {
    hackathon = baseHackathon({ resultsRevealedAt: null });
    await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`);
    expect(signer).not.toHaveBeenCalled();
  });

  it('reuses signed URLs across requests (same URL, one storage call)', async () => {
    await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    expect(signer).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------ displays

async function createDisplay(body: Row, who: keyof typeof USERS = 'host') {
  return request(app()).post(`/api/parties/${PARTY}/displays`).set('Authorization', auth(who)).send(body);
}

describe('hackathon display', () => {
  it('config validation: modes, defaults, unknown keys dropped, screen metadata kept', async () => {
    const ok = await createDisplay({ name: 'Main TV', contentType: 'hackathon', contentConfig: { mode: 'gallery', evil: '<script>', _resolution: '1920x1080' } });
    expect(ok.status).toBe(201);
    expect(ok.body.display.contentConfig).toEqual({ mode: 'gallery', showQr: true, _resolution: '1920x1080' });
    const dflt = await createDisplay({ name: 'TV 2', contentType: 'hackathon' });
    expect(dflt.body.display.contentConfig).toEqual({ mode: 'auto', showQr: true });
    for (const contentConfig of [{ mode: 'leaderboard' }, { mode: 3 }, { showQr: 'yes' }]) {
      const bad = await createDisplay({ name: 'Bad', contentType: 'hackathon', contentConfig });
      expect(bad.status).toBe(400);
      expect(bad.body.error?.code ?? bad.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await createDisplay({ name: 'Nope', contentType: 'leaderboard' })).status).toBe(400);
  });

  it('needs the Hackathon app enabled', async () => {
    hackathon = null;
    const res = await createDisplay({ name: 'Main TV', contentType: 'hackathon' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('HACKATHON_NOT_ENABLED');
    hackathon = baseHackathon({ disabledAt: new Date() });
    expect((await createDisplay({ name: 'Main TV', contentType: 'hackathon' })).status).toBe(400);
  });

  it('PATCH re-validates when switching to hackathon or changing its config', async () => {
    const d = await createDisplay({ name: 'QR', contentType: 'qr_code', contentConfig: { size: 'large' } });
    const id = d.body.display.id;
    const sw = await request(app()).patch(`/api/parties/${PARTY}/displays/${id}`).set('Authorization', auth('host')).send({ contentType: 'hackathon' });
    expect(sw.status).toBe(200);
    expect(sw.body.display.contentConfig).toEqual({ mode: 'auto', showQr: true });
    const bad = await request(app()).patch(`/api/parties/${PARTY}/displays/${id}`).set('Authorization', auth('host')).send({ contentConfig: { mode: 'nope' } });
    expect(bad.status).toBe(400);
  });

  it('non-hosts cannot create displays', async () => {
    expect((await createDisplay({ name: 'TV', contentType: 'hackathon' }, 'rando')).status).toBe(403);
  });

  it('viewer + refresh: public data only; winners after reveal; countdown-only for a password event without a display password', async () => {
    await createDisplay({ name: 'Main TV', contentType: 'hackathon', contentConfig: { mode: 'auto' } });
    const v = await request(app()).get(`/api/display/view/${PARTY}/main-tv`);
    expect(v.status).toBe(200);
    const hk = v.body.hackathon;
    expect(hk.galleryOpen).toBe(true);
    expect(hk.projects.map((p: Row) => p.slug)).toEqual(['zeta-swap', 'alpha-game']);
    expect(hk.winners.map((w: Row) => [w.prizeName, w.projectSlug])).toEqual([['Grand Prize', 'zeta-swap'], ['Best Game', 'alpha-game']]);
    expectNoPii(v.body);

    const r = await request(app()).get(`/api/display/view/${PARTY}/main-tv/hackathon`);
    expect(r.status).toBe(200);
    expect(r.body.hackathon.winners).toHaveLength(2);

    party.password = 'hunter2';
    const locked = (await request(app()).get(`/api/display/view/${PARTY}/main-tv/hackathon`)).body.hackathon;
    expect(locked.galleryOpen).toBe(false);
    expect(locked.projects).toEqual([]);
    expect(locked.winners).toEqual([]);
    expect(locked.submissionDeadline).toBeTruthy();
  });

  it('gallery hidden but results revealed: winners without covers, no project grid', async () => {
    hackathon = baseHackathon({ galleryVisibility: 'hidden' });
    await createDisplay({ name: 'Main TV', contentType: 'hackathon' });
    const hk = (await request(app()).get(`/api/display/view/${PARTY}/main-tv/hackathon`)).body.hackathon;
    expect(hk.galleryOpen).toBe(false);
    expect(hk.projects).toEqual([]);
    expect(hk.winners).toHaveLength(2);
    expect(hk.winners.every((w: Row) => w.cover === null)).toBe(true);
  });

  it('before the reveal / unpublished: no winners; unpublished = null block', async () => {
    hackathon = baseHackathon({ resultsRevealedAt: null, submissionDeadline: FUTURE });
    await createDisplay({ name: 'Main TV', contentType: 'hackathon' });
    const hk = (await request(app()).get(`/api/display/view/${PARTY}/main-tv/hackathon`)).body.hackathon;
    expect(hk).toMatchObject({ galleryOpen: false, projects: [], winners: [], resultsRevealedAt: null });
    hackathon = baseHackathon({ publishedAt: null });
    expect((await request(app()).get(`/api/display/view/${PARTY}/main-tv/hackathon`)).body.hackathon).toBeNull();
  });

  it('refresh endpoint: 404 for other display types and bad ids, 401 without the display password', async () => {
    await createDisplay({ name: 'QR', contentType: 'qr_code' });
    expect((await request(app()).get(`/api/display/view/${PARTY}/qr/hackathon`)).status).toBe(404);
    expect((await request(app()).get(`/api/display/view/nope/qr/hackathon`)).status).toBe(404);
    await createDisplay({ name: 'Locked', contentType: 'hackathon', password: 'pw' });
    expect((await request(app()).get(`/api/display/view/${PARTY}/locked/hackathon`)).status).toBe(401);
    expect((await request(app()).get(`/api/display/view/${PARTY}/locked/hackathon?password=pw`)).status).toBe(200);
  });
});

// ------------------------------------------------------------------ review follow-ups

describe('review follow-ups', () => {
  it('display with a closed gallery after the reveal: winners without covers and nothing signed', async () => {
    hackathon = baseHackathon({ galleryVisibility: 'hidden' });
    await createDisplay({ name: 'Main TV', contentType: 'hackathon' });
    const hk = (await request(app()).get(`/api/display/view/${PARTY}/main-tv/hackathon`)).body.hackathon;
    expect(hk.winners).toHaveLength(2);
    expect(hk.projects).toEqual([]);
    expect(signer).not.toHaveBeenCalled();
  });

  it('locked display (password event, no display password): countdown target only, no tracks; a display password unlocks it', async () => {
    party.password = 'hunter2';
    await createDisplay({ name: 'Open TV', contentType: 'hackathon' });
    const locked = (await request(app()).get(`/api/display/view/${PARTY}/open-tv/hackathon`)).body.hackathon;
    expect(locked).toEqual({
      locked: true, submissionsOpenAt: null, submissionDeadline: PAST.toISOString(), resultsRevealedAt: null,
      galleryOpen: false, tracks: [], projects: [], winners: [],
    });
    expect(JSON.stringify(locked)).not.toContain('DeFi');
    expect(signer).not.toHaveBeenCalled();

    await createDisplay({ name: 'Locked TV', contentType: 'hackathon', password: 'tvpw' });
    const viewer = await request(app()).get(`/api/display/view/${PARTY}/locked-tv?password=tvpw`);
    expect(viewer.status).toBe(200);
    expect(viewer.body.hackathon.locked).toBe(false);
    expect(viewer.body.hackathon.tracks).toHaveLength(2);
    expect((await request(app()).get(`/api/display/view/${PARTY}/locked-tv`)).status).toBe(401);
    expect((await request(app()).get(`/api/display/view/${PARTY}/locked-tv?password=nope`)).status).toBe(401);
  });

  it("gallery reason: 'login' for a password event the viewer can't see; nothing for pre-launch hidden events", async () => {
    party.password = 'hunter2';
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`)).body.reason).toBe('login');
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`).set('Authorization', auth('rando'))).body.reason).toBe('login');
    party.password = null;
    eventHidden.mockResolvedValue(true);
    const hidden = await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`);
    expect(hidden.body.available).toBe(false);
    expect(hidden.body.reason).toBeNull();
  });

  it('Vary: Authorization on gallery and project responses', async () => {
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/gallery`)).headers.vary).toMatch(/Authorization/);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/zeta-swap`)).headers.vary).toMatch(/Authorization/);
    expect((await request(app()).get(`/api/parties/${PARTY}/hackathon/projects/nope`)).headers.vary).toMatch(/Authorization/);
  });
});
