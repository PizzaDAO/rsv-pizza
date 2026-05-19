import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';

/**
 * bounce-rate-heuristic: Resend webhook handler.
 *
 * Resend signs webhook deliveries with the Svix signature scheme:
 *   - Header `svix-id`: unique message ID
 *   - Header `svix-timestamp`: unix seconds
 *   - Header `svix-signature`: space-separated list of `v1,<base64-sig>` pairs
 *
 * Signature payload = `${id}.${timestamp}.${raw_body}` (HMAC-SHA256, base64).
 * The signing secret arrives from Resend dashboard as `whsec_<base64>` — we
 * strip the `whsec_` prefix and base64-decode the remainder to get the key.
 *
 * Why we mount `express.raw()` ourselves: the global `express.json()` in
 * `index.ts` reparses the body, which discards the exact bytes Svix signed.
 * We need the raw `Buffer` to verify, then JSON.parse manually.
 *
 * On match we UPDATE `guests.email_status` and `email_status_updated_at` by
 * the captured Resend ID (`email_resend_id`). If no row matches by ID — which
 * is the legacy / pre-backfill case — we fall back to the most-recent guest
 * with that email address and log the fallback for observability.
 *
 * Always returns 200 once signature verifies, even when no guest row matches.
 * Resend retries on non-2xx; we don't want retries for ID/email misses.
 */
const router = Router();

// Map Resend event types onto compact status strings stored on guests. Keep
// the suffix-only convention (everything after `email.`) so the column is
// self-documenting at a glance.
const EVENT_STATUS_MAP: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delivery_delayed',
  'email.failed': 'failed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  // Resend's pre-suppression-list event surfaces as a `bounced` with a
  // `bounce.type: 'Permanent'` in the data payload — we still store as
  // `bounced` here; the backfill script uses `suppressed` for entries that
  // arrived as `last_event: 'bounced'` via the list endpoint.
};

interface ResendWebhookPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    from?: string;
    subject?: string;
    [k: string]: unknown;
  };
}

/**
 * Verify the Svix signature header against the raw body. Returns true when
 * any signature in the header matches; false on any error or mismatch.
 */
function verifySvixSignature(
  rawBody: Buffer,
  msgId: string,
  timestamp: string,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!msgId || !timestamp || !signatureHeader || !secret) return false;

  // Reject stale timestamps (>5 min skew) to prevent replay.
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > 5 * 60) return false;

  // Strip `whsec_` prefix and base64-decode the remainder.
  const keyMaterial = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(keyMaterial, 'base64');
  } catch {
    return false;
  }
  if (keyBytes.length === 0) return false;

  const signedPayload = `${msgId}.${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', keyBytes)
    .update(signedPayload)
    .digest('base64');

  // Header can contain multiple comma/space-separated `v1,<sig>` pairs.
  const sigs = signatureHeader.split(' ').map(s => s.trim()).filter(Boolean);
  for (const entry of sigs) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    try {
      const a = Buffer.from(sig, 'base64');
      const b = Buffer.from(expected, 'base64');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {
      // fall through and try the next sig
    }
  }
  return false;
}

router.post(
  '/',
  // Per-route raw body — bypasses the global `express.json()`.
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        console.error('RESEND_WEBHOOK_SECRET not configured — rejecting webhook');
        return res.status(503).json({ error: 'webhook secret not configured' });
      }

      const rawBody = req.body as Buffer;
      if (!Buffer.isBuffer(rawBody)) {
        return res.status(400).json({ error: 'expected raw body' });
      }

      const msgId = String(req.header('svix-id') || '');
      const timestamp = String(req.header('svix-timestamp') || '');
      const signature = String(req.header('svix-signature') || '');

      if (!verifySvixSignature(rawBody, msgId, timestamp, signature, secret)) {
        return res.status(401).json({ error: 'invalid signature' });
      }

      // Parse only after verifying.
      let payload: ResendWebhookPayload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'invalid json' });
      }

      const eventType = typeof payload.type === 'string' ? payload.type : '';
      const status = EVENT_STATUS_MAP[eventType];
      if (!status) {
        // Unknown event type — ack so Resend doesn't retry. We just don't
        // write anything.
        return res.status(200).json({ ok: true, ignored: eventType });
      }

      const data = payload.data || {};
      const emailId = typeof data.email_id === 'string' ? data.email_id : '';
      const to = Array.isArray(data.to) ? data.to.filter((t): t is string => typeof t === 'string') : [];

      let matchedGuestId: string | null = null;
      let matchedBy: 'id' | 'email' | 'none' = 'none';

      // Preferred path: match by captured Resend ID. Exact, one-to-one.
      if (emailId) {
        const byId = await prisma.guest.findFirst({
          where: { emailResendId: emailId },
          select: { id: true },
        });
        if (byId) {
          matchedGuestId = byId.id;
          matchedBy = 'id';
        }
      }

      // Fallback: match by most-recent guest with that email address. Only
      // used for legacy sends that pre-date the ID-capture change. We log
      // when this fires so we can monitor how long the legacy tail lasts.
      if (!matchedGuestId && to.length > 0) {
        const lowered = to[0].trim().toLowerCase();
        const byEmail = await prisma.guest.findFirst({
          where: { email: lowered },
          orderBy: { submittedAt: 'desc' },
          select: { id: true },
        });
        if (byEmail) {
          matchedGuestId = byEmail.id;
          matchedBy = 'email';
          console.log(
            `resend-webhook: matched ${eventType} for ${lowered} by email fallback (no email_resend_id captured)`,
          );
        }
      }

      if (matchedGuestId) {
        await prisma.guest.update({
          where: { id: matchedGuestId },
          data: {
            emailStatus: status,
            emailStatusUpdatedAt: new Date(),
            // Backfill the ID so future webhooks for the same send hit the
            // fast path. Only set when we matched by email (had no id yet).
            ...(matchedBy === 'email' && emailId ? { emailResendId: emailId } : {}),
          },
        });
      }

      return res.status(200).json({ ok: true, matched: matchedBy });
    } catch (err) {
      // Never 5xx Resend — log and ack. We don't want retries flooding us if
      // there's a transient DB issue.
      console.error('resend-webhook error (acking anyway):', err);
      return res.status(200).json({ ok: false });
    }
  },
);

export default router;
