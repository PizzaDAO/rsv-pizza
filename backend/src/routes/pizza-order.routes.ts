import { Router, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { loadPartyForOrdering, OrderingParty } from '../lib/pizzaOrdering.js';
import {
  recommendationsToLines,
  recommendationVersion,
  RecommendationError,
  normalizeDietary,
  OrderLineSpec,
} from '../lib/recommendationToLines.js';
import {
  getPizzaMcpClient,
  orderIdempotencyKey,
  OpopActor,
  OpopCart,
  OpopCartRequest,
  OpopPlaceOrderRequest,
  OpopQuote,
} from '../services/pizzaMcp.client.js';
import { applyOrderUpdate } from '../services/pizzaOrderSync.js';
import { notifyHostOfOrder } from '../services/pizzaOrderNotify.js';

/**
 * basil-14648: AI / OPOP ordering endpoints (plan §10). Mounted on /api/parties.
 *
 * Every route: requireAuth, then the caller must host or co-host the party AND the party must be
 * on the pilot allowlist (lib/pizzaOrdering.ts). Anything else is a 404. rsv.pizza only brokers:
 * prices come from pizza-mcp (quote / the shop's spoken total), approval is the host's emailed
 * code on pizza-mcp's /confirm page, and no card data touches this server.
 */
const router = Router();

const SHOP_ID_RE = /^pzl?_[A-Za-z0-9_.:\-]{1,190}$/;
const OPOP_ID_RE = /^[A-Za-z0-9_\-]{1,100}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESOLVE_CONCURRENCY = 4;

/** Statuses after which nothing more will happen, so a page view need not poll pizza-mcp. */
export const TERMINAL_STATUSES = new Set([
  'confirmed_by_shop',
  'shop_requires_prepay',
  'refused',
  'unreachable',
  'approval_timeout',
  'canceled',
  'completed',
]);

const actorFor = (req: AuthRequest, party: OrderingParty): OpopActor => ({
  userId: req.userId as string,
  email: req.userEmail,
  partyId: party.id,
});

function shopIdParam(v: string): string {
  if (!SHOP_ID_RE.test(v)) throw new AppError('Invalid shop id', 400, 'VALIDATION_FAILED');
  return v;
}
function opopIdParam(v: string): string {
  if (!OPOP_ID_RE.test(v)) throw new AppError('Invalid id', 400, 'VALIDATION_FAILED');
  return v;
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function publicOrder(row: any, forOwner: boolean) {
  return {
    id: row.id,
    opopOrderId: row.opopOrderId,
    partyId: row.partyId,
    tier: row.tier,
    shopId: row.shopId,
    shopName: row.shopName,
    status: row.status,
    paymentStatus: row.paymentStatus,
    ceilingCents: row.ceilingCents,
    confirmedTotalCents: row.confirmedTotalCents,
    readyAt: row.readyAt,
    readyAtText: row.readyAtText,
    summary: row.summary,
    payoutDocumentId: row.payoutDocumentId,
    // call details incl. shop total, changes, and (when the API exposes it) deferred calls
    call: (row.lastView as any)?.call ?? null,
    timeline: (row.lastView as any)?.timeline ?? [],
    // the approval link belongs to the host who placed the order
    nextAction: forOwner ? row.nextAction : null,
    isMine: forOwner,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Config probe: tells the UI whether to render the flow for this party.
// ---------------------------------------------------------------------------
router.get('/:partyId/pizza/config', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party, enabled } = await loadPartyForOrdering(req.params.partyId, req, { requireEnabled: false });
    res.json({
      enabled,
      capCents: enabled ? party.capCents : null,
      location: enabled ? { lat: party.latitude, lng: party.longitude, address: party.address } : null,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Discovery + menu (proxy)
// ---------------------------------------------------------------------------
router.get('/:partyId/pizza/shops', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    let near = typeof req.query.near === 'string' ? req.query.near.trim().slice(0, 120) : '';
    if (!near && party.latitude != null && party.longitude != null) near = `${party.latitude},${party.longitude}`;
    if (!near) throw new AppError('This party has no location. Pass ?near=lat,lng.', 400, 'NEAR_REQUIRED');
    const radius = req.query.radius_km !== undefined ? Number(req.query.radius_km) : undefined;
    if (radius !== undefined && !(radius > 0 && radius <= 50)) {
      throw new AppError('radius_km must be between 0 and 50', 400, 'VALIDATION_FAILED');
    }
    res.json(await getPizzaMcpClient().findShops(actorFor(req, party), { near, radius_km: radius }));
  } catch (e) {
    next(e);
  }
});

router.get('/:partyId/pizza/shops/:shopId/menu', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    res.json(await getPizzaMcpClient().getMenu(actorFor(req, party), shopIdParam(req.params.shopId)));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Cart: build from the party's recommendations, edit, quote
// ---------------------------------------------------------------------------
interface LineIssue {
  ref: string;
  text: string;
  kind: string;
  ask_user: string | null;
  candidates: string[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Quote only a ready cart. `max_total_cents` carries the party's reimbursement cap. */
async function quoteIfReady(actor: OpopActor, cart: OpopCart, party: OrderingParty): Promise<OpopQuote | null> {
  if (!cart.ready_for_quote || cart.lines.length === 0) return null;
  return getPizzaMcpClient().quote(actor, cart.id, party.capCents ? { max_total_cents: party.capCents } : {});
}

router.post('/:partyId/pizza/cart', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const body = isObj(req.body) ? req.body : {};
    const shopId = shopIdParam(String(body.shopId ?? ''));
    const pickupAt = typeof body.pickupAt === 'string' ? new Date(body.pickupAt) : null;
    if (!pickupAt || Number.isNaN(pickupAt.getTime()) || pickupAt.getTime() < Date.now() + 5 * 60_000) {
      throw new AppError('Pick a pickup time at least 5 minutes from now.', 400, 'PICKUP_TIME_REQUIRED');
    }

    let lines: OrderLineSpec[];
    try {
      lines = recommendationsToLines(body.recommendations);
    } catch (e) {
      if (e instanceof RecommendationError) throw new AppError(e.message, 400, e.code);
      throw e;
    }
    const actor = actorFor(req, party);
    const client = getPizzaMcpClient();

    // One resolve call per line (5-15 lines): the same resolver every agent uses, so halves,
    // sizes and dietary text behave identically for every tier.
    const issues: LineIssue[] = [];
    const resolved = await mapLimit(lines, RESOLVE_CONCURRENCY, async (spec) => {
      try {
        const r = await client.resolve(actor, shopId, spec.text);
        if (!r.ready_to_add || r.lines.length !== 1) {
          const amb = r.ambiguities[0];
          issues.push({
            ref: spec.ref,
            text: spec.text,
            kind: amb?.kind ?? (r.unmatched.length ? 'unmatched' : 'ambiguous'),
            ask_user: amb?.ask_user ?? `Which item on this shop's menu matches "${spec.text}"?`,
            candidates: amb?.candidates ?? [],
          });
          return null;
        }
        return { spec, line: r.lines[0].line, itemName: r.lines[0].item_name };
      } catch (e) {
        // A 4xx on one line (unknown item, ...) is a question for the host; transport/auth errors abort.
        if (e instanceof AppError && e.statusCode >= 400 && e.statusCode < 500) {
          issues.push({ ref: spec.ref, text: spec.text, kind: e.code ?? 'ERROR', ask_user: e.message, candidates: [] });
          return null;
        }
        throw e;
      }
    });

    const ops: OpopCartRequest['ops'] = [];
    for (const r of resolved) {
      if (!r) continue;
      ops.push({
        op: 'add_line',
        item_id: r.line.item_id,
        size_id: r.line.size_id ?? null,
        // quantity and dietary needs come from the recommendation, never from the resolver's guess
        quantity: r.spec.quantity,
        options: r.line.options,
        notes: r.line.notes ?? null,
        dietary_firm: Array.from(new Set([...(r.line.dietary_firm ?? []), ...r.spec.dietary_firm])).slice(0, 8),
        label: r.spec.label ?? r.line.label ?? null,
        client_line_ref: r.spec.ref,
      });
    }
    if (ops.length === 0) {
      return res.json({ cart: null, quote: null, issues, recommendationVersion: recommendationVersion(lines), capCents: party.capCents });
    }
    // pickup only in v1; scheduled_for is required for phone orders
    ops.push({ op: 'set_fulfillment', type: 'pickup', scheduled_for: pickupAt.toISOString() });

    const cart = await client.createCart(actor, { pizzeria_id: shopId, ops });
    const quote = issues.length === 0 ? await quoteIfReady(actor, cart, party) : null;
    res.json({
      cart,
      quote,
      issues,
      recommendationVersion: recommendationVersion(lines),
      capCents: party.capCents,
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/:partyId/pizza/cart/:cartId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const cartId = opopIdParam(req.params.cartId);
    const body = isObj(req.body) ? req.body : {};
    if (!Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > 30) {
      throw new AppError('ops must be a list of 1-30 edits', 400, 'VALIDATION_FAILED');
    }
    // Hosts may change or drop lines and move the pickup time. Adding lines or delivery is out of
    // scope for v1 (the AI orders exactly what the host approved; pickup only).
    for (const op of body.ops as unknown[]) {
      if (!isObj(op) || !['update_line', 'remove_line', 'set_fulfillment'].includes(String(op.op))) {
        throw new AppError('Only update_line, remove_line and set_fulfillment edits are allowed', 400, 'VALIDATION_FAILED');
      }
      if (op.op === 'set_fulfillment' && (op.type !== 'pickup' || op.address)) {
        throw new AppError('Pickup only', 400, 'DELIVERY_NOT_SUPPORTED');
      }
    }
    const expected = Number.isInteger(body.expectedVersion) ? (body.expectedVersion as number) : undefined;
    const actor = actorFor(req, party);
    const cart = await getPizzaMcpClient().updateCart(
      actor,
      cartId,
      { cart_id: cartId, expected_version: expected, ops: body.ops as OpopCartRequest['ops'] },
      expected
    );
    res.json({ cart, quote: await quoteIfReady(actor, cart, party), capCents: party.capCents });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Place an order. The host then approves on pizza-mcp's /confirm (or /pay) page.
// ---------------------------------------------------------------------------
router.post('/:partyId/pizza/orders', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const body = isObj(req.body) ? req.body : {};
    const quoteId = opopIdParam(String(body.quoteId ?? ''));
    const cartId = opopIdParam(String(body.cartId ?? ''));
    const shopId = shopIdParam(String(body.shopId ?? ''));
    const recVersion = typeof body.recommendationVersion === 'string' ? body.recommendationVersion.slice(0, 4000) : '';
    if (!recVersion) throw new AppError('recommendationVersion is required', 400, 'VALIDATION_FAILED');
    const attempt = Number.isInteger(body.attempt) && (body.attempt as number) >= 0 && (body.attempt as number) < 10 ? (body.attempt as number) : 0;

    const c = isObj(body.contact) ? body.contact : {};
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, 100) : '';
    const phone = typeof c.phone === 'string' ? c.phone.trim() : '';
    const email = typeof c.email === 'string' && c.email.trim() ? c.email.trim() : req.userEmail;
    if (!name) throw new AppError('Your name is required', 400, 'VALIDATION_FAILED');
    if (!E164_RE.test(phone)) throw new AppError('Phone must be in international format, e.g. +16175550123', 400, 'VALIDATION_FAILED');
    if (email && !EMAIL_RE.test(email)) throw new AppError('Invalid email', 400, 'VALIDATION_FAILED');

    const pol = isObj(body.policy) ? body.policy : {};
    const ceilingCents = Number(pol.ceilingCents);
    const substitution = pol.substitution === 'deals_ok' ? 'deals_ok' : 'exact';
    const minPizzaCount = pol.minPizzaCount === undefined ? undefined : Number(pol.minPizzaCount);
    if (!Number.isInteger(ceilingCents) || ceilingCents <= 0) {
      throw new AppError('A price ceiling is required', 400, 'VALIDATION_FAILED');
    }
    if (minPizzaCount !== undefined && (!Number.isInteger(minPizzaCount) || minPizzaCount < 1 || minPizzaCount > 100)) {
      throw new AppError('minPizzaCount is invalid', 400, 'VALIDATION_FAILED');
    }
    // The party's reimbursement cap is a hard stop, enforced here and again by pizza-mcp.
    if (party.capCents !== null && ceilingCents > party.capCents) {
      throw new AppError(
        `That ceiling is over this party's reimbursement cap of $${(party.capCents / 100).toFixed(2)}. Lower it, or appeal your cap.`,
        422,
        'SPEND_LIMIT_EXCEEDED'
      );
    }

    const actor = actorFor(req, party);
    const client = getPizzaMcpClient();
    // The cart must be this host's and for this shop; its version joins the idempotency key so an
    // edited cart is a new order while a double-click replays.
    const cart = await client.getCart(actor, cartId);
    if (cart.pizzeria_id !== shopId) throw new AppError('Cart does not belong to this shop', 400, 'VALIDATION_FAILED');
    const shop = await client.getShop(actor, shopId);
    const tier = shop.tier === 'native' ? 'native' : 'listing';
    if (tier === 'listing' && shop.ordering?.channel !== 'ai_phone') {
      throw new AppError('We cannot place an automated call to this shop. Use the order script and call them yourself.', 409, 'CALLS_NOT_AVAILABLE_HERE');
    }

    const request: OpopPlaceOrderRequest =
      tier === 'listing'
        ? {
            quote_id: quoteId,
            payment_mode: 'pay_at_pickup',
            contact: { name, phone, ...(email ? { email } : {}) },
            phone_order: {
              price_ceiling_cents: ceilingCents,
              substitution_policy: substitution,
              ...(minPizzaCount ? { min_pizza_count: minPizzaCount } : {}),
              transfer_to_host: pol.transferToHost === true,
            },
            ...(party.capCents ? { max_total_cents: party.capCents } : {}),
            client_ref: { party_id: party.id, rsvp_user_id: req.userId as string },
          }
        : {
            quote_id: quoteId,
            payment_mode: 'checkout_link',
            contact: { name, phone, ...(email ? { email } : {}) },
            ...(party.capCents ? { max_total_cents: party.capCents } : {}),
            client_ref: { party_id: party.id, rsvp_user_id: req.userId as string },
          };

    const key = orderIdempotencyKey(party.id, `${recVersion}#cart${cart.version}`, shopId, attempt);
    const placed = await client.placeOrder(actor, request, key);
    const o = placed.order;

    // Create (or complete the row a fast webhook already made). Never regress its status.
    const row = await prisma.pizzaOrder.upsert({
      where: { opopOrderId: o.id },
      create: {
        partyId: party.id,
        userId: req.userId as string,
        opopOrderId: o.id,
        tier,
        shopId,
        shopName: shop.name,
        status: o.status,
        paymentStatus: o.payment_status ?? null,
        ceilingCents: tier === 'listing' ? ceilingCents : null,
        summary: o.summary ?? null,
        lastView: o as any,
        nextAction: (placed.next_action ?? o.next_action ?? null) as any,
        timelineLen: Array.isArray(o.timeline) ? o.timeline.length : 0,
        lastEventAt: new Date(),
      },
      update: {
        tier,
        shopId,
        shopName: shop.name,
        ceilingCents: tier === 'listing' ? ceilingCents : null,
        ...((placed.next_action ?? o.next_action) ? { nextAction: (placed.next_action ?? o.next_action) as any } : {}),
      },
    });
    res.status(201).json({ order: publicOrder(row, true), next_action: placed.next_action ?? o.next_action ?? null });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
router.get('/:partyId/pizza/orders', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const rows = await prisma.pizzaOrder.findMany({
      where: { partyId: party.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ orders: rows.map((r) => publicOrder(r, r.userId === req.userId)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:partyId/pizza/orders/:orderId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const orderId = opopIdParam(req.params.orderId);
    // scoped to THIS party: an order id from another party is a 404, not a leak
    let row = await prisma.pizzaOrder.findFirst({ where: { opopOrderId: orderId, partyId: party.id } });
    if (!row) throw new AppError('Order not found', 404, 'NOT_FOUND');
    const mine = row.userId === req.userId;
    let stale = false;
    // Poll as a fallback to the webhook, only as the order's own principal (a co-host sees the
    // stored state; we never mint a token in someone else's name).
    if (mine && !TERMINAL_STATUSES.has(row.status)) {
      try {
        const live = await getPizzaMcpClient().getOrder(actorFor(req, party), orderId);
        const result = await prisma.$transaction((tx) => applyOrderUpdate(tx, live, { clientRef: { party_id: party.id, rsvp_user_id: row!.userId } }));
        if (result.row) row = result.row;
        if (result.draftCreated && result.row) {
          void notifyHostOfOrder(result.row);
        }
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        stale = true; // pizza-mcp is down: serve the last known state
      }
    }
    res.json({ order: publicOrder(row, mine), stale });
  } catch (e) {
    next(e);
  }
});

export default router;
