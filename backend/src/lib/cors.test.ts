import { describe, it, expect } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { errorHandler } from '../middleware/error.js';
import {
  isAllowedOrigin,
  isAllowedTaxFormOrigin,
  isTaxFormRequestPublicPath,
  corsOptionsDelegate,
} from './cors.js';

const ALLOWED = ['https://rsv.pizza']; // brand-check-ignore-line

describe('isAllowedOrigin', () => {
  it.each([
    'https://rsv.pizza', // brand-check-ignore-line
    'https://rsvpizza-git-my-branch-pizza-dao.vercel.app',
    'https://rsvpizza-abc123xyz-pizza-dao.vercel.app',
    'https://rsvpizza-team1-git-wl-audit-fixes-pizza-dao.vercel.app',
    'https://rsvpizza-team1-abc123xyz-pizza-dao.vercel.app',
    'https://rsvpizza-monad-git-foo-pizza-dao.vercel.app',
    'https://rsvpizza-monad-abc123xyz-pizza-dao.vercel.app',
    'https://rsvpizza.vercel.app',
  ])('allows %s', (o) => expect(isAllowedOrigin(o, ALLOWED)).toBe(true));

  it.each([
    'https://rsvpizza-evil.vercel.app',
    'https://rsvpizza-git-x-attacker-team.vercel.app',
    'https://rsvpizza.evil.com',
    'https://rsvpizza-pizza-dao.vercel.app.evil.com',
    'http://rsvpizza-git-x-pizza-dao.vercel.app',
    'https://evil-rsvpizza-git-x-pizza-dao.vercel.app',
    'https://rsvpizza-git-x-pizza-dao.vercel.app/',
    'https://other.example',
  ])('rejects %s', (o) => expect(isAllowedOrigin(o, ALLOWED)).toBe(false));
});

const APP = 'https://app.pizzadao.org';
const PREVIEWS = [
  'https://onboarding-git-task-tax-form-native-pizza-dao.vercel.app',
  'https://onboarding-v7lj-git-task-tax-form-native-pizza-dao.vercel.app',
  'https://onboarding-abc123xyz-pizza-dao.vercel.app',
  'https://onboarding-v7lj-abc123xyz-pizza-dao.vercel.app',
];

describe('isTaxFormRequestPublicPath', () => {
  it.each(['/api/tax-form-requests', '/api/tax-form-requests/abc', '/api/tax-form-requests/abc/draft'])(
    'matches %s', (p) => expect(isTaxFormRequestPublicPath(p)).toBe(true));
  it.each(['/api/admin/tax-form-requests', '/api/admin/tax-form-requests/x', '/api/tax-form-requestsx',
    '/api/parties/x', '/x/api/tax-form-requests'])(
    'does not match %s', (p) => expect(isTaxFormRequestPublicPath(p)).toBe(false));
});

describe('isAllowedTaxFormOrigin', () => {
  it.each([APP, ...PREVIEWS, 'https://rsv.pizza'])( // brand-check-ignore-line
    'allows %s', (o) => expect(isAllowedTaxFormOrigin(o, ALLOWED)).toBe(true));
  it.each([
    'https://onboarding-git-x-otherteam.vercel.app',
    'https://app.pizzadao.org.evil.com',
    'https://evil.app.pizzadao.org',
    'http://app.pizzadao.org',
    'https://app.pizzadao.org/',
    'https://onboarding-git-x-pizza-dao.vercel.app.evil.com',
    'https://evil-onboarding-git-x-pizza-dao.vercel.app',
    'https://other.example',
  ])('rejects %s', (o) => expect(isAllowedTaxFormOrigin(o, ALLOWED)).toBe(false));
});

describe('corsOptionsDelegate (supertest)', () => {
  const app = express();
  app.use(cors(corsOptionsDelegate(ALLOWED)));
  app.get('/api/tax-form-requests/:token', (_req, res) =>
    res.status(404).json({ error: { message: 'Invalid link', code: 'INVALID_TOKEN' } }));
  app.get('/api/parties/:id', (_req, res) => res.json({ ok: true }));
  app.get('/api/admin/tax-form-requests', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  it('OPTIONS preflight on tax path allows the app origin without credentials', async () => {
    const res = await request(app)
      .options('/api/tax-form-requests/bogus')
      .set('Origin', APP)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(APP);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('GET on tax path with app origin returns ACAO and 404 INVALID_TOKEN', async () => {
    const res = await request(app).get('/api/tax-form-requests/bogus').set('Origin', APP);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(res.headers['access-control-allow-origin']).toBe(APP);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it.each(PREVIEWS)('preflight on tax path allows preview %s', async (o) => {
    const res = await request(app)
      .options('/api/tax-form-requests/bogus')
      .set('Origin', o)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(o);
  });

  it.each(['/api/parties/x', '/api/admin/tax-form-requests'])('rejects the app origin on %s with 403', async (p) => {
    const pre = await request(app).options(p).set('Origin', APP).set('Access-Control-Request-Method', 'GET');
    expect(pre.status).toBe(403);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    const res = await request(app).get(p).set('Origin', APP);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_FORBIDDEN');
  });

  it('rejects lookalike origins on the tax path', async () => {
    const res = await request(app).get('/api/tax-form-requests/bogus').set('Origin', 'https://app.pizzadao.org.evil.com');
    expect(res.status).toBe(403);
  });

  it('keeps credentials for allowed origins on other paths', async () => {
    const res = await request(app).get('/api/parties/x').set('Origin', 'https://rsv.pizza'); // brand-check-ignore-line
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
