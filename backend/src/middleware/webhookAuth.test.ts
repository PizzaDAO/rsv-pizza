import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { verifyBlandWebhook, safeEqualHex, resetWebhookAuthWarningForTests } from './webhookAuth.js';

const SECRET = 'test-bland-webhook-secret-0123456789abcdef';

function app() {
  const a = express();
  a.use('/hook', express.raw({ type: () => true }));
  a.use(express.json());
  a.post('/hook', verifyBlandWebhook, (req, res) => res.json({ ok: true, body: req.body }));
  return a;
}

const body = JSON.stringify({ call_id: 'c1', status: 'completed', completed: true });
const sign = (payload: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

describe('verifyBlandWebhook', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    resetWebhookAuthWarningForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.BLAND_WEBHOOK_SECRET = SECRET;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('rejects an unsigned webhook with 401', async () => {
    const res = await request(app()).post('/hook').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong signature with 401', async () => {
    const res = await request(app())
      .post('/hook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sign(body, 'other-secret'))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a short / malformed signature with 401 (no length-mismatch bypass)', async () => {
    for (const sig of ['abc', 'zz'.repeat(32), sign(body) + '00']) {
      const res = await request(app())
        .post('/hook')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', sig)
        .send(body);
      expect(res.status).toBe(401);
    }
  });

  it('rejects a valid signature over a different body', async () => {
    const res = await request(app())
      .post('/hook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sign(body))
      .send(JSON.stringify({ call_id: 'c1', status: 'completed', completed: true, analysis: { order_confirmed: true } }));
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature over the raw body and parses it', async () => {
    const res = await request(app())
      .post('/hook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual(JSON.parse(body));
  });

  it('accepts the legacy x-bland-signature header and a sha256= prefix', async () => {
    const res = await request(app())
      .post('/hook')
      .set('Content-Type', 'application/json')
      .set('x-bland-signature', `sha256=${sign(body).toUpperCase()}`)
      .send(body);
    expect(res.status).toBe(200);
  });

  it('fails closed (503) when the secret is unset in a deployed environment', async () => {
    delete process.env.BLAND_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    const res = await request(app()).post('/hook').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(503);
    const res2 = await request(app()).post('/hook').set('Content-Type', 'application/json').send(body);
    expect(res2.status).toBe(503);
    expect((console.error as any).mock.calls.length).toBe(1); // logged once
  });

  it('fails closed on Vercel preview too', async () => {
    delete process.env.BLAND_WEBHOOK_SECRET;
    process.env.VERCEL_ENV = 'preview';
    const res = await request(app()).post('/hook').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(503);
  });

  it('allows unsigned webhooks only in local dev with no secret', async () => {
    delete process.env.BLAND_WEBHOOK_SECRET;
    const res = await request(app()).post('/hook').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(200);
    expect(res.body.body.call_id).toBe('c1');
  });
});

describe('safeEqualHex', () => {
  it('is false (never throws) on length mismatch', () => {
    expect(safeEqualHex('ab', 'abcd')).toBe(false);
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
  });
});
