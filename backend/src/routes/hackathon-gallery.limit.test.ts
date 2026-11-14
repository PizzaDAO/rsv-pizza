/**
 * PR 7: gallery / project reads on venue Wi-Fi. Authenticated (verified JWT) reads skip the
 * per-IP gallery limiter and get a per-user bucket; anonymous and forged-token reads stay per-IP.
 * The loaders are stubbed (an unknown hackathon answers 200 / 404 without touching a DB).
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const SECRET = 'test-secret-hackathon-gallery-limit-0123456789';
const saved = process.env.JWT_SECRET;
process.env.JWT_SECRET = SECRET;
afterAll(() => {
  if (saved === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = saved;
});

vi.mock('../config/database.js', () => ({ prisma: {} }));
vi.mock('../lib/hackathon/access.js', () => ({ isHackathonHost: vi.fn(async () => false) }));
vi.mock('../lib/hackathon/gallery.js', () => ({
  loadGalleryHackathon: vi.fn(async () => null),
  buildGallery: vi.fn(), buildProject: vi.fn(), galleryMeta: vi.fn(), isGalleryOpen: vi.fn(() => false),
  loadProject: vi.fn(), PUBLIC_STATUS: 'submitted', viewerCanSeeEvent: vi.fn(async () => true), viewerEventAccess: vi.fn(async () => true),
}));

import galleryRoutes from './hackathon-gallery.routes.js';
import { errorHandler } from '../middleware/error.js';

const PARTY = '11111111-1111-4111-8111-111111111111';
const tok = (userId: string) => `Bearer ${jwt.sign({ userId, email: `${userId}@x.com` }, SECRET, { expiresIn: '1h' })}`;

function app() {
  const a = express();
  a.use('/api/parties', galleryRoutes);
  a.use(errorHandler);
  return a;
}

const gallery = (a: express.Express, auth?: string) => {
  const r = request(a).get(`/api/parties/${PARTY}/hackathon/gallery`);
  return auth ? r.set('Authorization', auth) : r;
};

describe('gallery read limiters', () => {
  it('many logged-in voters on one IP are not limited per IP', async () => {
    const a = app();
    for (let i = 0; i < 320; i++) {
      const r = await gallery(a, tok(`voter${i}`));
      expect(r.status, `request ${i + 1}`).toBe(200);
    }
    // project pages share the same pair of limiters
    expect((await request(a).get(`/api/parties/${PARTY}/hackathon/projects/some-project`).set('Authorization', tok('voterX'))).status).toBe(404);
  });

  it('one logged-in user still has a per-user cap (300 / 5 min)', async () => {
    const a = app();
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await gallery(a, tok('greedy'))).status;
    expect(last).toBe(429);
    expect((await gallery(a, tok('someone-else'))).status).toBe(200);
  });

  it('anonymous and forged-token reads stay on the per-IP limiter', async () => {
    const a = app();
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await gallery(a, i % 2 ? 'Bearer forged.token.here' : undefined)).status;
    expect(last).toBe(429);
    // a verified user on the same IP is unaffected
    expect((await gallery(a, tok('real'))).status).toBe(200);
  });
});
