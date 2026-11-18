import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

/**
 * sec-edge-functions: the authenticated replacements for the anon-callable `ai-call-status` /
 * `ai-call-recording` edge functions, and the signed Bland webhook.
 */
const PARTY_ID = '11111111-1111-4111-8111-111111111111';

const m = vi.hoisted(() => ({ calls: [] as any[], editors: new Set<string>() }));

vi.mock('../config/database.js', () => ({
  prisma: {
    aIPhoneCall: {
      update: async ({ where, data }: any) => Object.assign(m.calls.find((c) => c.id === where.id), data),
      findUnique: async ({ where }: any) =>
        m.calls.find((c) => (where.id ? c.id === where.id : c.callId === where.callId)) ?? null,
    },
    order: { create: async () => ({ id: 'order_1' }) },
  },
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ error: 'No token provided' });
    req.userId = req.headers['x-user-id'];
    req.userEmail = req.headers['x-user-email'];
    next();
  },
}));
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: async (_p: string, userId?: string) => !!userId && m.editors.has(userId),
}));

import router from './ai-phone.routes.js';
import { errorHandler } from '../middleware/error.js';

const owner = { 'x-user-id': 'host1' };
const cohost = { 'x-user-id': 'co1' };
const stranger = { 'x-user-id': 'bad1' };

function app() {
  const a = express();
  a.use('/api/ai-phone/webhook', express.raw({ type: () => true }));
  a.use(express.json());
  a.use('/api/ai-phone', router);
  a.use(errorHandler);
  return a;
}

let blandDetails: any;
beforeEach(() => {
  m.calls = [
    { id: 'call_1', callId: 'bland_1', userId: 'host1', partyId: PARTY_ID, status: 'initiated', orderItems: '[]', pizzeriaName: 'S', fulfillmentType: 'pickup' },
  ];
  m.editors = new Set(['co1']);
  blandDetails = { status: 'completed', concatenated_transcript: 'hi', metadata: { aiPhoneCallId: 'call_1' } };
  process.env.BLAND_API_KEY = 'bland-test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/recording')) return new Response('AUDIO', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    return new Response(JSON.stringify(blandDetails), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.BLAND_WEBHOOK_SECRET;
});

describe('GET /api/ai-phone/calls/:ref/live', () => {
  it('401 without login, 403 for a stranger (Bland never called)', async () => {
    expect((await request(app()).get('/api/ai-phone/calls/bland_1/live')).status).toBe(401);
    expect((await request(app()).get('/api/ai-phone/calls/bland_1/live').set(stranger)).status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('owner (by Bland id) and party editor (by our id) get the status, card numbers masked', async () => {
    blandDetails.concatenated_transcript = 'my card is 4242 4242 4242 4242 thanks';
    const a = await request(app()).get('/api/ai-phone/calls/bland_1/live').set(owner);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ status: 'completed', recordingAvailable: true });
    expect(a.body.transcript).not.toContain('4242');
    const b = await request(app()).get('/api/ai-phone/calls/call_1/live').set(cohost);
    expect(b.status).toBe(200);
  });

  it('withholds transcript and recording for a call that carried a card', async () => {
    blandDetails = { status: 'completed', concatenated_transcript: 'code 739', metadata: { hasPaymentCard: true } };
    const res = await request(app()).get('/api/ai-phone/calls/call_1/live').set(owner);
    expect(res.body.transcript).toBe('');
    expect(res.body.recordingAvailable).toBe(false);
    expect((await request(app()).get('/api/ai-phone/calls/call_1/recording').set(owner)).status).toBe(404);
  });

  it('503 when BLAND_API_KEY is unset', async () => {
    delete process.env.BLAND_API_KEY;
    const res = await request(app()).get('/api/ai-phone/calls/call_1/live').set(owner);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BLAND_NOT_CONFIGURED');
  });

  it('404 for an unknown call', async () => {
    expect((await request(app()).get('/api/ai-phone/calls/nope/live').set(owner)).status).toBe(404);
  });
});

describe('GET /api/ai-phone/calls/:ref/recording', () => {
  it('403 for a stranger, audio for the owner', async () => {
    expect((await request(app()).get('/api/ai-phone/calls/call_1/recording').set(stranger)).status).toBe(403);
    const res = await request(app()).get('/api/ai-phone/calls/call_1/recording').set(owner);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('POST /api/ai-phone/webhook', () => {
  const SECRET = 'webhook-secret-for-tests-0123456789abcdef';
  const payload = (over: any = {}) =>
    JSON.stringify({ call_id: 'bland_1', status: 'completed', completed: true, analysis: { order_confirmed: true, order_total: '$1' }, metadata: {}, ...over });

  it('rejects an unsigned webhook and leaves the call untouched', async () => {
    process.env.BLAND_WEBHOOK_SECRET = SECRET;
    const res = await request(app()).post('/api/ai-phone/webhook').set('Content-Type', 'application/json').send(payload());
    expect(res.status).toBe(401);
    expect(m.calls[0].status).toBe('initiated');
  });

  it('accepts a signed webhook; strips transcript and recording of a card call', async () => {
    process.env.BLAND_WEBHOOK_SECRET = SECRET;
    const body = payload({
      recording_url: 'https://bland.example.org/rec.mp3',
      concatenated_transcript: 'Card 4000 0099 9000 0001 code 739',
      metadata: { hasPaymentCard: true },
    });
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const res = await request(app())
      .post('/api/ai-phone/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    expect(m.calls[0].status).toBe('completed');
    expect(m.calls[0].transcript).toBeNull();
    expect(m.calls[0].recordingUrl).toBeNull();
  });
});
