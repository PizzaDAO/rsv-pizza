/**
 * Photo / display / check-in hardening: public photo payloads carry no uploader email or guest
 * id, display feeds only show approved photos, dedup never crosses uploaders, and check-in
 * lookups hide emails from non-hosts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  prisma: {
    party: { findUnique: vi.fn(), findFirst: vi.fn() },
    photo: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(), create: vi.fn() },
    payoutDocument: { findMany: vi.fn(), count: vi.fn() },
    guest: { findFirst: vi.fn(), update: vi.fn() },
    guestAttestation: { findMany: vi.fn(), create: vi.fn() },
    display: { findUnique: vi.fn(), update: vi.fn() },
    slugAlias: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
  canEdit: vi.fn(),
  canAdmin: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-email']) return res.status(401).json({ error: 'unauth' });
    req.userId = req.headers['x-user-id'];
    req.userEmail = req.headers['x-user-email'];
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    if (req.headers['x-user-email']) {
      req.userId = req.headers['x-user-id'];
      req.userEmail = req.headers['x-user-email'];
    }
    next();
  },
  isSuperAdmin: vi.fn(async () => false),
  isPaymentAdmin: vi.fn(async () => false),
  isUnderboss: vi.fn(async () => false),
}));
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: m.canEdit, canUserAccessTab: vi.fn(async () => false) }));
vi.mock('../helpers/underbossScope.js', () => ({ getUnderbossScope: vi.fn(), partyMatchesScope: vi.fn() }));
vi.mock('./scorecard.routes.js', () => ({ autoCompleteScorecardItem: vi.fn() }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('../lib/privateConfig.js', () => ({ getOperationalLimits: vi.fn(async () => ({ photoPerUserPerEvent: 30 })) }));
vi.mock('../lib/hackathon/gallery.js', () => ({ buildDisplayHackathon: vi.fn() }));

import photoRoutes from './photo.routes.js';
import displayRoutes from './display.routes.js';
import checkinRoutes from './checkin.routes.js';
import { errorHandler } from '../middleware/error.js';

const PARTY = '11111111-1111-1111-1111-111111111111';
const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', photoRoutes);
  a.use('/api/display', displayRoutes);
  a.use('/api/checkin', checkinRoutes);
  a.use(errorHandler);
  return a;
};

const photoRow = {
  id: 'p1',
  partyId: PARTY,
  url: 'https://x/p.jpg',
  uploaderName: 'Pat',
  uploaderEmail: 'pat@example.org',
  uploadedBy: 'guest-uuid',
  reviewedBy: 'user-uuid',
  status: 'approved',
  createdAt: new Date(),
  guest: { id: 'guest-uuid', name: 'Pat' },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.canEdit.mockResolvedValue(false);
  m.prisma.party.findUnique.mockResolvedValue({ id: PARTY, photosEnabled: true, photosPublic: true, photoModeration: false, userId: 'u', cancelledAt: null });
});

describe('public photo payloads', () => {
  it('anonymous single-photo response has no email / guest id and only reads approved rows', async () => {
    m.prisma.photo.findFirst.mockResolvedValue(photoRow);
    const r = await request(app()).get(`/api/parties/${PARTY}/photos/p1`);
    expect(r.status).toBe(200);
    expect(r.body.photo.uploaderEmail).toBeNull();
    expect(r.body.photo.uploadedBy).toBeNull();
    expect(r.body.photo.guest).toEqual({ name: 'Pat' });
    expect(JSON.stringify(r.body)).not.toContain('pat@example.org');
    expect(m.prisma.photo.findFirst.mock.calls[0][0].where.status).toBe('approved');
  });

  it('editors keep full rows and can see non-approved photos', async () => {
    m.canEdit.mockResolvedValue(true);
    m.prisma.photo.findFirst.mockResolvedValue(photoRow);
    const r = await request(app()).get(`/api/parties/${PARTY}/photos/p1`).set('x-user-id', 'u1').set('x-user-email', 'host@example.org');
    expect(r.body.photo.uploaderEmail).toBe('pat@example.org');
    expect(m.prisma.photo.findFirst.mock.calls[0][0].where.status).toBeUndefined();
  });

  it('anonymous list strips identity fields', async () => {
    m.prisma.photo.findMany.mockResolvedValue([photoRow]);
    m.prisma.photo.count.mockResolvedValue(1);
    m.prisma.payoutDocument.findMany.mockResolvedValue([]);
    m.prisma.payoutDocument.count.mockResolvedValue(0);
    const r = await request(app()).get(`/api/parties/${PARTY}/photos`);
    expect(r.status).toBe(200);
    const s = JSON.stringify(r.body);
    expect(s).not.toContain('pat@example.org');
    expect(s).not.toContain('guest-uuid');
    expect(s).not.toContain('user-uuid');
    expect(r.body.photos[0].uploaderName).toBe('Pat');
  });
});

describe('photos/stats', () => {
  it('uses one DISTINCT query for tags, parallel counts, and is CDN-cacheable for anonymous', async () => {
    m.prisma.photo.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    m.prisma.$queryRaw.mockResolvedValue([{ tag: 'Pizza' }, { tag: 'Group' }]);
    m.prisma.photo.groupBy.mockResolvedValue([{ uploaderEmail: 'a' }]);
    const r = await request(app()).get(`/api/parties/${PARTY}/photos/stats`);
    expect(r.status).toBe(200);
    expect(r.body.uniqueTags).toEqual(['Pizza', 'Group']);
    expect(r.body.totalPhotos).toBe(3);
    expect(r.headers['cache-control']).toBe('public, s-maxage=30, stale-while-revalidate=300');
    expect(m.prisma.photo.findMany).not.toHaveBeenCalled();
  });
});

describe('photo upload dedup', () => {
  const body = { url: 'https://x/a.jpg', fileName: 'a.jpg', fileSize: 1000, mimeType: 'image/jpeg', uploaderEmail: 'Me@Example.org' };
  it('only dedups against the same uploader + filename, never another uploader', async () => {
    m.prisma.photo.findFirst.mockResolvedValueOnce(null).mockResolvedValue(null);
    m.prisma.photo.count.mockResolvedValue(0);
    m.prisma.photo.create.mockResolvedValue({ id: 'new' });
    await request(app()).post(`/api/parties/${PARTY}/photos`).send(body);
    const where = m.prisma.photo.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ partyId: PARTY, fileSize: 1000, mimeType: 'image/jpeg', fileName: 'a.jpg' });
    expect(where.OR).toEqual([{ uploaderEmail: 'me@example.org' }]);
  });

  it('skips dedup entirely when the uploader is unidentified', async () => {
    m.prisma.photo.findFirst.mockResolvedValue({ id: 'someone-elses' });
    m.prisma.photo.count.mockResolvedValue(0);
    m.prisma.photo.create.mockResolvedValue({ id: 'new' });
    const r = await request(app()).post(`/api/parties/${PARTY}/photos`).send({ ...body, uploaderEmail: undefined });
    expect(r.body.deduped).toBeUndefined();
    expect(m.prisma.photo.create).toHaveBeenCalled();
  });
});

describe('display photo feeds', () => {
  const display = { id: 'd1', partyId: PARTY, slug: 's', isActive: true, contentType: 'photos', contentConfig: {}, password: null };
  beforeEach(() => {
    m.prisma.display.findUnique.mockResolvedValue(display);
    m.prisma.photo.findMany.mockResolvedValue([]);
  });

  it('refresh feed filters to approved and selects public fields only', async () => {
    const r = await request(app()).get(`/api/display/view/${PARTY}/s/photos`);
    expect(r.status).toBe(200);
    const arg = m.prisma.photo.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('approved');
    expect(arg.select.uploaderEmail).toBeUndefined();
    expect(arg.select.uploadedBy).toBeUndefined();
    expect(arg.select.reviewedBy).toBeUndefined();
    expect(arg.select.url).toBe(true);
  });

  it('invalid since is a 400, valid since is applied', async () => {
    expect((await request(app()).get(`/api/display/view/${PARTY}/s/photos?since=garbage`)).status).toBe(400);
    expect(m.prisma.photo.findMany).not.toHaveBeenCalled();
    await request(app()).get(`/api/display/view/${PARTY}/s/photos?since=2026-01-01T00:00:00Z`);
    expect(m.prisma.photo.findMany.mock.calls[0][0].where.createdAt.gt).toBeInstanceOf(Date);
  });

  it('initial display payload also filters approved + public select', async () => {
    m.prisma.display.findUnique.mockResolvedValue({ ...display, party: { id: PARTY } });
    m.prisma.display.update.mockResolvedValue({});
    const r = await request(app()).get(`/api/display/view/${PARTY}/s`);
    expect(r.status).toBe(200);
    const arg = m.prisma.photo.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('approved');
    expect(arg.select.uploaderEmail).toBeUndefined();
  });
});

describe('check-in', () => {
  const party = { id: PARTY, name: 'P', userId: 'host', coHosts: [] };
  beforeEach(() => {
    m.prisma.party.findUnique.mockResolvedValue(party);
    m.prisma.guestAttestation.findMany.mockResolvedValue([
      { attesterKind: 'host_admin', attesterName: 'H', attesterEmail: 'host@example.org', createdAt: new Date() },
    ]);
  });

  it('a checked-in peer does not get the target guest email or attester emails', async () => {
    m.prisma.guest.findFirst
      .mockResolvedValueOnce({ id: 'me', checkedInAt: new Date() }) // caller
      .mockResolvedValueOnce({ id: 'target', name: 'T', email: 'target@example.org', checkedInAt: new Date(), checkedInBy: 'x' });
    const r = await request(app()).get(`/api/checkin/CODE/target`).set('x-user-id', 'u2').set('x-user-email', 'peer@example.org');
    expect(r.status).toBe(200);
    const s = JSON.stringify(r.body);
    expect(s).not.toContain('target@example.org');
    expect(s).not.toContain('host@example.org');
    expect(r.body.guest.name).toBe('T');
  });

  it('the target guest sees their own email but not attester emails', async () => {
    m.prisma.guest.findFirst
      .mockResolvedValueOnce({ id: 'target', checkedInAt: null })
      .mockResolvedValueOnce({ id: 'target', name: 'T', email: 'target@example.org', checkedInAt: null, checkedInBy: null });
    const r = await request(app()).get(`/api/checkin/CODE/target`).set('x-user-id', 'u3').set('x-user-email', 'target@example.org');
    expect(r.body.guest.email).toBe('target@example.org');
    expect(JSON.stringify(r.body)).not.toContain('host@example.org');
  });

  it('hosts still get emails', async () => {
    m.prisma.party.findUnique.mockResolvedValue({ ...party, userId: 'host-id' });
    m.prisma.guest.findFirst.mockResolvedValue({ id: 'target', name: 'T', email: 'target@example.org', checkedInAt: null, checkedInBy: null });
    const r = await request(app()).get(`/api/checkin/CODE/target`).set('x-user-id', 'host-id').set('x-user-email', 'host@example.org');
    expect(r.status).toBe(200);
    expect(r.body.guest.email).toBe('target@example.org');
    expect(r.body.attestations[0].email).toBe('host@example.org');
  });

  it('vouching for a rejected guest is refused and records nothing', async () => {
    m.prisma.guest.findFirst
      .mockResolvedValueOnce({ id: 'me', email: 'peer@example.org', name: 'Me', checkedInAt: new Date() })
      .mockResolvedValueOnce({ id: 'target', approved: false, checkedInAt: null });
    const r = await request(app()).post(`/api/checkin/CODE/vouch`).set('x-user-id', 'u2').set('x-user-email', 'peer@example.org').send({ targetGuestId: 'target' });
    expect(r.status).toBe(400);
    expect(r.body.code ?? r.body.error?.code).toBeDefined();
    expect(m.prisma.guestAttestation.create).not.toHaveBeenCalled();
    expect(m.prisma.guest.update).not.toHaveBeenCalled();
  });
});
