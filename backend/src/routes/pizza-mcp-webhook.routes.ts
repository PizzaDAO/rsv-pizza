import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { prisma } from '../config/database.js';
import { verifyWebhook } from '../lib/webhookSignature.js';
import { applyOrderUpdate } from '../services/pizzaOrderSync.js';
import { notifyHostOfOrder } from '../services/pizzaOrderNotify.js';
import type { OpopOrder } from '../services/pizzaMcp.client.js';

/**
 * basil-14648: POST /api/pizza-mcp/webhook — pizza-mcp -> RSV `order.updated`.
 *
 * MUST be mounted BEFORE the global express.json() (see index.ts): the HMAC covers the raw
 * bytes, and a re-serialized body would never match.
 *
 *  - Fails closed: no PIZZA_MCP_WEBHOOK_SECRET -> 503; bad/missing signature or a timestamp more
 *    than 5 minutes off -> 401 (lib/webhookSignature.ts is pizza-mcp's own verifier, copied).
 *  - Dedupes on Webhook-Id in the same transaction as the upsert: a handler that fails leaves no
 *    id behind, so pizza-mcp's retry is processed; a replay answers 200 and changes nothing.
 *  - Out-of-order events are ignored by services/pizzaOrderSync.ts.
 *  - Unknown event types and orders we cannot attribute are acknowledged (2xx) so they are not retried.
 */
const router = Router();

function secrets(): string[] {
  return (process.env.PIZZA_MCP_WEBHOOK_SECRET || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

router.post(
  '/webhook',
  express.raw({ type: () => true, limit: '512kb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const keys = secrets();
      if (keys.length === 0) return res.status(503).json({ error: 'webhook not configured' });
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'expected a raw body' });
      const raw = req.body.toString('utf8');

      const verdict = verifyWebhook(keys, req.headers, raw);
      if (!verdict.ok) return res.status(401).json({ error: verdict.reason });

      let payload: {
        type?: string;
        created_at?: string;
        client_ref?: { party_id?: unknown; rsvp_user_id?: unknown } | null;
        order?: OpopOrder;
      } | null;
      try {
        payload = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'invalid json' });
      }
      // a signed `null`, array or scalar is acknowledged, not a 500 (pizza-mcp would retry it for hours)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return res.sendStatus(200);
      const order = payload.order;
      if (
        payload.type !== 'order.updated' ||
        !order ||
        typeof order !== 'object' ||
        typeof order.id !== 'string' ||
        typeof order.status !== 'string'
      ) {
        return res.sendStatus(200);
      }
      const eventAt = payload.created_at ? new Date(payload.created_at) : null;

      // One transaction: the Webhook-Id marker and the order update commit together or not at all.
      // createMany + skipDuplicates (not a thrown P2002) tells us "already processed" without
      // aborting the transaction, and keeps a unique violation on pizza_orders from being mistaken
      // for a replay.
      const result = await prisma.$transaction(async (tx) => {
        const marker = await tx.pizzaWebhookEvent.createMany({ data: [{ id: verdict.id }], skipDuplicates: true });
        if (marker.count === 0) return null;
        return applyOrderUpdate(tx, order, {
          eventAt: eventAt && !Number.isNaN(eventAt.getTime()) ? eventAt : null,
          clientRef: payload.client_ref ?? null,
        });
      });

      // Awaited (bounded) so a serverless instance is not frozen mid-send; well inside
      // pizza-mcp's 5 s response deadline.
      if (result?.draftCreated && result.row) await notifyHostOfOrder(result.row);
      return res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
