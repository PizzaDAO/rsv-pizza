/**
 * Photo booth routes: public read shape (flag, cancelled, unknown party), host-only write
 * (401 / 403 / 200 / reset / 410 / 413) and that updatedBy never leaks. Prisma and party access are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';

const JWT_SECRET = 'test-secret-booth-routes-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  partyBooth: { upsert: vi.fn() },
  appConfig: { findMany: vi.fn() },
}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const canEdit = vi.hoisted(() => vi.fn());
const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: canEdit,
  canUserAccessTab: canTab,
}));

import boothRoutes, { boothJsonBody } from './booth.routes.js';
import { errorHandler } from '../middleware/error.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.use('/api/parties/:partyId/booth', boothJsonBody);
  a.use(express.json());
  a.use('/api/parties', boothRoutes);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const auth = () => `Bearer ${jwt.sign({ userId: 'u-host', email: 'host@example.com' }, JWT_SECRET, { expiresIn: '1h' })}`;

function flag(v: 0 | 1 | null) {
  mockPrisma.appConfig.findMany.mockResolvedValue(v === null ? [] : [{ key: 'booth.enabled', value: JSON.stringify(v) }]);
}

function party(over: Record<string, unknown> = {}) {
  return { id: PARTY, cancelledAt: null, booth: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  canEdit.mockResolvedValue(false);
  canTab.mockResolvedValue(true);
  flag(1);
  mockPrisma.party.findUnique.mockResolvedValue(party());
});

describe('GET /api/parties/:id/booth', () => {
  it('anon: 200, enabled with no row, null config, public cache', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY}/booth`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, hostEnabled: true, globalEnabled: true, config: null, canEdit: false });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('flag 0 (or no setting row) -> enabled false', async () => {
    flag(0);
    expect((await request(app()).get(`/api/parties/${PARTY}/booth`)).body.enabled).toBe(false);
    flag(null);
    expect((await request(app()).get(`/api/parties/${PARTY}/booth`)).body.enabled).toBe(false);
  });

  it('flag read failure -> enabled false', async () => {
    mockPrisma.appConfig.findMany.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await request(app()).get(`/api/parties/${PARTY}/booth`)).body.enabled).toBe(false);
  });

  it('host toggled off -> enabled false', async () => {
    mockPrisma.party.findUnique.mockResolvedValue(party({ booth: { enabled: false, config: null, updatedAt: new Date() } }));
    const res = await request(app()).get(`/api/parties/${PARTY}/booth`);
    expect(res.body).toMatchObject({ enabled: false, hostEnabled: false });
  });

  it('cancelled party -> enabled false', async () => {
    mockPrisma.party.findUnique.mockResolvedValue(party({ cancelledAt: new Date() }));
    expect((await request(app()).get(`/api/parties/${PARTY}/booth`)).body.enabled).toBe(false);
  });

  it('unknown party -> 404; non-uuid -> 404', async () => {
    mockPrisma.party.findUnique.mockResolvedValue(null);
    expect((await request(app()).get(`/api/parties/${PARTY}/booth`)).status).toBe(404);
    expect((await request(app()).get('/api/parties/not-a-uuid/booth')).status).toBe(404);
  });

  it('returns the stored config, never updatedBy, and no-store when authed', async () => {
    mockPrisma.party.findUnique.mockResolvedValue(
      party({ booth: { enabled: true, config: { title: 'T' }, updatedAt: new Date('2027-01-01T00:00:00Z'), updatedBy: 'u-secret' } }),
    );
    canEdit.mockResolvedValue(true);
    const res = await request(app()).get(`/api/parties/${PARTY}/booth`).set('Authorization', auth());
    expect(res.body.config).toEqual({ title: 'T' });
    expect(res.body.canEdit).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('u-secret');
    expect(res.body).not.toHaveProperty('updatedBy');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('PUT /api/parties/:id/booth', () => {
  beforeEach(() => {
    mockPrisma.partyBooth.upsert.mockImplementation(async ({ create }: any) => ({
      enabled: create.enabled,
      config: create.config ?? null,
      updatedAt: new Date('2027-01-01T00:00:00Z'),
    }));
  });

  it('anon -> 401 and nothing written', async () => {
    const res = await request(app()).put(`/api/parties/${PARTY}/booth`).send({ enabled: false });
    expect(res.status).toBe(401);
    expect(mockPrisma.partyBooth.upsert).not.toHaveBeenCalled();
  });

  it('non-editor -> 403', async () => {
    canEdit.mockResolvedValue(false);
    const res = await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ enabled: false });
    expect(res.status).toBe(403);
    expect(mockPrisma.partyBooth.upsert).not.toHaveBeenCalled();
  });

  it('co-host without the booth tab -> 403', async () => {
    canEdit.mockResolvedValue(true);
    canTab.mockResolvedValue(false);
    const res = await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it('editor -> 200 with an upsert recording updatedBy', async () => {
    canEdit.mockResolvedValue(true);
    const res = await request(app())
      .put(`/api/parties/${PARTY}/booth`)
      .set('Authorization', auth())
      .send({ enabled: false, config: { title: 'Hi', credit: false, junk: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.hostEnabled).toBe(false);
    expect(res.body.canEdit).toBe(true);
    const arg = mockPrisma.partyBooth.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ partyId: PARTY });
    expect(arg.update.updatedBy).toBe('u-host');
    expect(arg.update.config).toMatchObject({ title: 'Hi', credit: true, version: 1 });
    expect(arg.update.config.junk).toBeUndefined();
    expect(res.body).not.toHaveProperty('updatedBy');
  });

  it('config: null resets (DbNull) without touching enabled', async () => {
    canEdit.mockResolvedValue(true);
    const res = await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ config: null });
    expect(res.status).toBe(200);
    const arg = mockPrisma.partyBooth.upsert.mock.calls[0][0];
    expect('config' in arg.update).toBe(true);
    expect(arg.update.config).toBe(Prisma.DbNull);
    expect('enabled' in arg.update).toBe(false);
  });

  it('omitted config leaves it alone', async () => {
    canEdit.mockResolvedValue(true);
    await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ enabled: true });
    const arg = mockPrisma.partyBooth.upsert.mock.calls[0][0];
    expect('config' in arg.update).toBe(false);
  });

  it('rejects a non-boolean enabled and a non-object config', async () => {
    canEdit.mockResolvedValue(true);
    expect((await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ enabled: 'yes' })).status).toBe(400);
    expect((await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ config: 'x' })).status).toBe(400);
  });

  it('cancelled party -> 410', async () => {
    canEdit.mockResolvedValue(true);
    mockPrisma.party.findUnique.mockResolvedValue(party({ cancelledAt: new Date() }));
    const res = await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send({ enabled: false });
    expect(res.status).toBe(410);
  });

  it('body over 2 MB -> 413 at the route-level parser', async () => {
    canEdit.mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const big = { config: { title: 'x'.repeat(2.2 * 1024 * 1024) } };
    const res = await request(app()).put(`/api/parties/${PARTY}/booth`).set('Authorization', auth()).send(big);
    expect(res.status).toBe(413);
    expect(mockPrisma.partyBooth.upsert).not.toHaveBeenCalled();
  });

  it('config between 1.8 and 2 MB -> 413 from the sanitizer', async () => {
    canEdit.mockResolvedValue(true);
    const res = await request(app())
      .put(`/api/parties/${PARTY}/booth`)
      .set('Authorization', auth())
      .send({ config: { words: { a: { text: 'x'.repeat(1.9 * 1024 * 1024) } } } });
    expect(res.status).toBe(413);
  });
});
