import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { isDeployedEnv } from '../config/secrets.js';

/**
 * Verifies Bland AI webhooks (POST /api/ai-phone/webhook).
 *
 * Bland signs each webhook with HMAC-SHA256 (hex) of the request body, keyed with the account's
 * webhook signing secret, in the `X-Webhook-Signature` header. The secret lives in
 * BLAND_WEBHOOK_SECRET.
 *
 * sec-edge-functions: this used to call next() when the signature was missing, when it had the
 * wrong length (timingSafeEqual throws) and — always — when the secret was unset, so anyone could
 * POST a forged payload and rewrite call/order status. It now fails closed:
 *   - secret unset: 503 in deployed environments (logged once); allowed only in local dev/tests;
 *   - signature missing / malformed / wrong: 401.
 *
 * The HMAC is checked against the raw bytes (index.ts mounts express.raw for this path before the
 * global JSON parser). Bland's own sample signs JSON.stringify(body), so a match against the
 * re-serialized body is accepted as well. On success req.body is the parsed JSON object.
 */

let warnedUnset = false;

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function readSignature(req: Request): string | null {
  const raw = req.headers['x-webhook-signature'] ?? req.headers['x-bland-signature'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'string') return null;
  const sig = value.trim().replace(/^sha256=/i, '').toLowerCase();
  return HEX_SHA256.test(sig) ? sig : null;
}

function hmacHex(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time compare of two hex strings; false (never throws) on length mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export const verifyBlandWebhook = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.BLAND_WEBHOOK_SECRET?.trim();

  if (!secret) {
    if (isDeployedEnv()) {
      if (!warnedUnset) {
        console.error('BLAND_WEBHOOK_SECRET is not set: rejecting all Bland webhooks');
        warnedUnset = true;
      }
      return res.status(503).json({ error: 'Webhook not configured' });
    }
    if (!warnedUnset) {
      console.warn('BLAND_WEBHOOK_SECRET not set - accepting Bland webhooks unverified (local dev only)');
      warnedUnset = true;
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }
    return next();
  }

  const signature = readSignature(req);
  if (!signature) {
    return res.status(401).json({ error: 'Missing or malformed webhook signature' });
  }

  let parsed: unknown;
  let valid = false;
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body;
    valid = safeEqualHex(signature, hmacHex(secret, raw));
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(valid ? 400 : 401).json({ error: valid ? 'Invalid JSON' : 'Invalid webhook signature' });
    }
    if (!valid) valid = safeEqualHex(signature, hmacHex(secret, JSON.stringify(parsed)));
  } else {
    parsed = req.body;
    valid = safeEqualHex(signature, hmacHex(secret, JSON.stringify(req.body ?? {})));
  }

  if (!valid) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  req.body = parsed;
  next();
};

/** Tests only. */
export function resetWebhookAuthWarningForTests(): void {
  warnedUnset = false;
}
