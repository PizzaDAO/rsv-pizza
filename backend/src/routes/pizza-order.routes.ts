import { Router, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { loadPartyForOrdering, remainingCapCents, OrderingParty } from '../lib/pizzaOrdering.js';
import {
  recommendationsToLines,
  recommendationVersion,
  RecommendationError,
  MAX_PIZZAS_PER_ORDER,
  OrderLineSpec,
} from '../lib/recommendationToLines.js';
import { menuFacts, fitLine } from '../lib/menuFit.js';
import { isTerminal, isBlocking, isRestartable, isSettling, needsReviewHolds, CANCELABLE_STATUSES } from '../lib/pizzaOrderStatus.js';
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
 * on the pilot allowlist (lib/pizzaOrdering.ts). Anything else is a 404. This server only brokers:
 * prices come from pizza-mcp (quote / the shop's spoken total), approval is the host's emailed
 * code on pizza-mcp's /confirm page, and no card data touches this server.
 */
const router = Router();

const SHOP_ID_RE = /^pzl?_[A-Za-z0-9_.:\-]{1,190}$/;
const OPOP_ID_RE = /^[A-Za-z0-9_\-]{1,100}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const RESOLVE_CONCURRENCY = 4;

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
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function publicOrder(row: any, forOwner: boolean) {
  const view = (row.lastView ?? null) as any;
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
    // call details incl. shop total, changes and (when pizza-mcp provides it) `deferred`
    call: view?.call ?? null,
    timeline: view?.timeline ?? [],
    // the approval link belongs to the host who placed the order
    nextAction: forOwner ? row.nextAction : null,
    isMine: forOwner,
    restartable: isRestartable(row),
    // keep polling a fresh confirmation: the post-call check can still downgrade it
    settling: isSettling(row),
    // a needs_review that holds budget (it reached a confirmation / total) can be released by the host
    releasable: !row.releasedAt && isTerminal(row.status) && row.status !== 'confirmed_by_shop' && row.status !== 'completed' && row.status !== 'canceled' && isBlocking(row),
    released: !!row.releasedAt,
    receiptCovered: !!row.receiptCoveredAt,
    cancelable: forOwner && CANCELABLE_STATUSES.has(row.status) && !isRestartable(row),
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
    if (!enabled) return res.json({ enabled: false, capCents: null, remainingCapCents: null, blockedReason: null, location: null });
    let remaining: number | null = null;
    let blockedReason: string | null = null;
    try {
      remaining = await remainingCapCents(party);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      blockedReason = e.code ?? 'BLOCKED';
    }
    res.json({
      enabled: true,
      capCents: party.capCents,
      remainingCapCents: remaining,
      blockedReason,
      location: { lat: party.latitude, lng: party.longitude, address: party.address },
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
type Decision = 'omit_toppings' | 'drop_line';

interface LineIssue {
  ref: string;
  /** What the host sees: the pizza, never an id. */
  label: string;
  kind: 'topping_unavailable' | 'unresolved';
  ask_user: string;
  unmatched: string[];
  choices: Array<{ id: Decision; label: string }>;
}

const lineLabel = (s: OrderLineSpec) => s.label || `${s.quantity} x ${s.diameter ? `${s.diameter}" ` : ''}${s.style || 'pizza'}`.trim();
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

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

async function recordQuote(cartId: string, quoteId: string) {
  await prisma.pizzaCart.update({ where: { opopCartId: cartId }, data: { quoteIds: { push: quoteId } } });
}

/** Quote only a ready cart. `max_total_cents` is what the party may still spend, not the whole cap. */
async function quoteIfReady(actor: OpopActor, cart: OpopCart, remainingCents: number): Promise<OpopQuote | null> {
  if (!cart.ready_for_quote || cart.lines.length === 0) return null;
  const q = await getPizzaMcpClient().quote(actor, cart.id, { max_total_cents: remainingCents });
  await recordQuote(cart.id, q.quote_id);
  return q;
}

/** The cart row binds an OPOP cart to the party, host and shop that built it. */
async function ownedCartRow(cartId: string, party: OrderingParty, req: AuthRequest) {
  const row = await prisma.pizzaCart.findUnique({ where: { opopCartId: cartId } });
  if (!row || row.partyId !== party.id || row.userId !== req.userId) throw new AppError('Cart not found', 404, 'NOT_FOUND');
  return row;
}

router.post('/:partyId/pizza/cart', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const remaining = await remainingCapCents(party);
    const body = isObj(req.body) ? req.body : {};
    const shopId = shopIdParam(String(body.shopId ?? ''));
    const pickupAt = typeof body.pickupAt === 'string' ? new Date(body.pickupAt) : null;
    if (!pickupAt || Number.isNaN(pickupAt.getTime()) || pickupAt.getTime() < Date.now() + 5 * 60_000) {
      throw new AppError('Pick a pickup time at least 5 minutes from now.', 400, 'PICKUP_TIME_REQUIRED');
    }
    const decisions: Record<string, Decision> = {};
    if (isObj(body.decisions)) {
      for (const [k, v] of Object.entries(body.decisions)) {
        if (v === 'omit_toppings' || v === 'drop_line') decisions[k] = v;
      }
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
    const facts = menuFacts(await client.getMenu(actor, shopId));

    const issues: LineIssue[] = [];
    const notices: string[] = [];
    const dropped: Array<{ ref: string; label: string }> = [];

    // One resolve call per line (5-15 lines): the same resolver every agent uses.
    const resolved = await mapLimit(lines, RESOLVE_CONCURRENCY, async (spec) => {
      const decision = decisions[spec.ref];
      if (decision === 'drop_line') {
        dropped.push({ ref: spec.ref, label: lineLabel(spec) });
        return null;
      }
      const fit = fitLine(spec, facts, { omit: decision === 'omit_toppings' });
      if (fit.unmatched.length && decision !== 'omit_toppings') {
        issues.push({
          ref: spec.ref,
          label: lineLabel(spec),
          kind: 'topping_unavailable',
          ask_user: `This shop doesn't list ${list(fit.unmatched)}.`,
          unmatched: fit.unmatched,
          choices: [
            { id: 'omit_toppings', label: `Leave off ${list(fit.unmatched)}` },
            { id: 'drop_line', label: spec.quantity > 1 ? `Skip these ${spec.quantity} pizzas` : 'Skip this pizza' },
          ],
        });
        return null;
      }
      if (fit.unmatched.length) notices.push(`${lineLabel(spec)}: leaving off ${list(fit.unmatched)}.`);
      notices.push(...fit.notices);
      try {
        const r = await client.resolve(actor, shopId, fit.spec.text);
        if (!r.ready_to_add || r.lines.length !== 1) {
          issues.push({
            ref: spec.ref,
            label: lineLabel(spec),
            kind: 'unresolved',
            ask_user: `We couldn't match "${lineLabel(spec)}" to this shop's menu.`,
            unmatched: [],
            choices: [{ id: 'drop_line', label: spec.quantity > 1 ? `Skip these ${spec.quantity} pizzas` : 'Skip this pizza' }],
          });
          return null;
        }
        return { spec: fit.spec, line: r.lines[0].line };
      } catch (e) {
        // A 4xx on one line (unknown item, ...) is a question for the host; transport/auth errors abort.
        if (e instanceof AppError && e.statusCode >= 400 && e.statusCode < 500) {
          issues.push({
            ref: spec.ref,
            label: lineLabel(spec),
            kind: 'unresolved',
            ask_user: `We couldn't match "${lineLabel(spec)}" to this shop's menu.`,
            unmatched: [],
            choices: [{ id: 'drop_line', label: 'Skip this pizza' }],
          });
          return null;
        }
        throw e;
      }
    });

    const recVersion = recommendationVersion(lines);
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
    const common = { issues, notices, dropped, recommendationVersion: recVersion, capCents: party.capCents, remainingCapCents: remaining };
    if (ops.length === 0) return res.json({ cart: null, quote: null, ...common });
    // pickup only in v1; scheduled_for is required for phone orders
    ops.push({ op: 'set_fulfillment', type: 'pickup', scheduled_for: pickupAt.toISOString() });

    const cart = await client.createCart(actor, { pizzeria_id: shopId, ops });
    await prisma.pizzaCart.create({
      data: { partyId: party.id, userId: req.userId as string, opopCartId: cart.id, shopId, recommendationVersion: recVersion, quoteIds: [] },
    });
    // No quote while a question is open: a partial order must be an explicit choice, never a surprise.
    const quote = issues.length === 0 ? await quoteIfReady(actor, cart, remaining) : null;
    res.json({ cart, quote, ...common });
  } catch (e) {
    next(e);
  }
});

router.patch('/:partyId/pizza/cart/:cartId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const remaining = await remainingCapCents(party);
    const cartId = opopIdParam(req.params.cartId);
    await ownedCartRow(cartId, party, req);
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
    const actor = actorFor(req, party);
    const client = getPizzaMcpClient();
    // The 30-pizza phone-order limit applies to edits too: simulate them first.
    const current = await client.getCart(actor, cartId);
    const qty = new Map(current.lines.map((l) => [l.id, l.quantity]));
    for (const op of body.ops as Array<Record<string, unknown>>) {
      if (op.op === 'remove_line') qty.delete(String(op.line_id));
      else if (op.op === 'update_line' && qty.has(String(op.line_id)) && op.quantity !== undefined) {
        const n = Number(op.quantity);
        if (!Number.isInteger(n) || n < 1 || n > 100) throw new AppError('Invalid quantity', 400, 'VALIDATION_FAILED');
        qty.set(String(op.line_id), n);
      }
    }
    const total = [...qty.values()].reduce((a, b) => a + b, 0);
    if (total > MAX_PIZZAS_PER_ORDER) {
      throw new AppError(
        `${total} pizzas is too many for an automated order (max ${MAX_PIZZAS_PER_ORDER}). Call the shop yourself.`,
        400,
        'TOO_MANY_PIZZAS'
      );
    }
    const expected = Number.isInteger(body.expectedVersion) ? (body.expectedVersion as number) : undefined;
    const cart = await client.updateCart(
      actor,
      cartId,
      { cart_id: cartId, expected_version: expected, ops: body.ops as OpopCartRequest['ops'] },
      expected
    );
    res.json({ cart, quote: await quoteIfReady(actor, cart, remaining), capCents: party.capCents, remainingCapCents: remaining });
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

    const c = isObj(body.contact) ? body.contact : {};
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, 100) : '';
    const phone = typeof c.phone === 'string' ? c.phone.trim() : '';
    // The approval code goes to this address: it is the signed-in host's own email, never a
    // value the browser supplies.
    const email = req.userEmail;
    if (!name) throw new AppError('Your name is required', 400, 'VALIDATION_FAILED');
    if (!E164_RE.test(phone)) throw new AppError('Phone must be in international format, e.g. +16175550123', 400, 'VALIDATION_FAILED');

    const pol = isObj(body.policy) ? body.policy : {};
    const substitution = pol.substitution === 'deals_ok' ? 'deals_ok' : 'exact';
    const minPizzaCount = pol.minPizzaCount === undefined ? undefined : Number(pol.minPizzaCount);
    if (minPizzaCount !== undefined && (!Number.isInteger(minPizzaCount) || minPizzaCount < 1 || minPizzaCount > 100)) {
      throw new AppError('minPizzaCount is invalid', 400, 'VALIDATION_FAILED');
    }

    // The cart, its quote and its shop must belong together and to this host + party.
    const cartRow = await ownedCartRow(cartId, party, req);
    if (cartRow.shopId !== shopId) throw new AppError('Cart does not belong to this shop', 400, 'CART_MISMATCH');
    if (!cartRow.quoteIds.includes(quoteId)) throw new AppError('That quote does not belong to this cart. Review the order again.', 400, 'QUOTE_MISMATCH');

    // One live or confirmed order per party, whoever placed it, unless the host says "another".
    const existing = await prisma.pizzaOrder.findMany({ where: { partyId: party.id } });
    const same = existing.find((o: any) => o.quoteId === quoteId && isBlocking(o));
    if (same) return res.status(200).json({ order: publicOrder(same, same.userId === req.userId), next_action: same.nextAction ?? null, replayed: true });
    const blockers = existing.filter((o: any) => isBlocking(o));
    if (blockers.length && body.allowAnother !== true) {
      throw new AppError(
        'This party already has an order in progress or confirmed. Cancel it, or confirm that you want a second order.',
        409,
        'ORDER_IN_PROGRESS',
        { existingOrderId: blockers[0].opopOrderId, existingStatus: blockers[0].status }
      );
    }

    const remaining = await remainingCapCents(party);
    const actor = actorFor(req, party);
    const client = getPizzaMcpClient();
    const cart = await client.getCart(actor, cartId);
    if (cart.pizzeria_id !== cartRow.shopId) throw new AppError('Cart does not belong to this shop', 400, 'CART_MISMATCH');
    const shop = await client.getShop(actor, cartRow.shopId);
    const tier = shop.tier === 'native' ? 'native' : 'listing';
    if (tier === 'listing' && shop.ordering?.channel !== 'ai_phone') {
      throw new AppError('We cannot place an automated call to this shop. Use the order script and call them yourself.', 409, 'CALLS_NOT_AVAILABLE_HERE');
    }

    const ceilingCents = Number(pol.ceilingCents);
    if (tier === 'listing') {
      if (!Number.isInteger(ceilingCents) || ceilingCents <= 0) throw new AppError('A price ceiling is required', 400, 'VALIDATION_FAILED');
      // The remaining budget is a hard stop, enforced here and again by pizza-mcp.
      if (ceilingCents > remaining) {
        throw new AppError(
          `That ceiling is over what is left of this party's reimbursement budget ($${(remaining / 100).toFixed(2)}). Lower it, or appeal your cap.`,
          422,
          'SPEND_LIMIT_EXCEEDED'
        );
      }
    }

    const contact = { name, phone, ...(email ? { email } : {}) };
    const client_ref = { party_id: party.id, rsvp_user_id: req.userId as string };
    const request: OpopPlaceOrderRequest =
      tier === 'listing'
        ? {
            quote_id: quoteId,
            payment_mode: 'pay_at_pickup',
            contact,
            phone_order: {
              price_ceiling_cents: ceilingCents,
              substitution_policy: substitution,
              ...(minPizzaCount ? { min_pizza_count: minPizzaCount } : {}),
              transfer_to_host: pol.transferToHost === true,
            },
            max_total_cents: remaining,
            client_ref,
          }
        : { quote_id: quoteId, payment_mode: 'checkout_link', contact, max_total_cents: remaining, client_ref };

    // Key = sha256(party + what was ordered + shop), plus a server-derived attempt number (earlier
    // rows for the same order) and the request itself: replaying the SAME request is idempotent, a
    // rebuilt cart or a deliberate second order gets a fresh key. The client cannot choose it.
    const recKey = sha(cartRow.recommendationVersion);
    const attempt = existing.filter((o: any) => o.recKey === recKey && o.shopId === shopId).length;
    const key = orderIdempotencyKey(party.id, `${cartRow.recommendationVersion}#${sha(JSON.stringify(request))}`, shopId, attempt);
    const placed = await client.placeOrder(actor, request, key);
    const o = placed.order;

    // Trust the order, not the request: re-derive the shop's tier and name from where it really went.
    const finalShop = o.pizzeria_id && o.pizzeria_id !== shop.id ? await client.getShop(actor, o.pizzeria_id) : shop;
    const finalTier = finalShop.tier === 'native' ? 'native' : 'listing';
    const na = placed.next_action ?? o.next_action ?? null;
    const row = await prisma.pizzaOrder.upsert({
      where: { opopOrderId: o.id },
      create: {
        partyId: party.id,
        userId: req.userId as string,
        opopOrderId: o.id,
        tier: finalTier,
        shopId: o.pizzeria_id || finalShop.id,
        shopName: finalShop.name,
        status: o.status,
        paymentStatus: o.payment_status ?? null,
        ceilingCents: finalTier === 'listing' ? ceilingCents : null,
        recKey,
        quoteId,
        summary: o.summary ?? null,
        lastView: o as any,
        nextAction: na as any,
        timelineLen: Array.isArray(o.timeline) ? o.timeline.length : 0,
        lastEventAt: new Date(),
      },
      update: {
        tier: finalTier,
        shopId: o.pizzeria_id || finalShop.id,
        shopName: finalShop.name,
        ceilingCents: finalTier === 'listing' ? ceilingCents : null,
        recKey,
        quoteId,
        ...(na ? { nextAction: na as any } : {}),
      },
    });
    res.status(201).json({ order: publicOrder(row, true), next_action: na });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Status, cancel
// ---------------------------------------------------------------------------
router.get('/:partyId/pizza/orders', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const rows = await prisma.pizzaOrder.findMany({
      where: { partyId: party.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ orders: rows.map((r: any) => publicOrder(r, r.userId === req.userId)) });
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
    if (mine && (!isTerminal(row.status) || isSettling(row))) {
      try {
        const live = await getPizzaMcpClient().getOrder(actorFor(req, party), orderId);
        const result = await prisma.$transaction((tx) => applyOrderUpdate(tx, live, { clientRef: { party_id: party.id, rsvp_user_id: row!.userId } }));
        if (result.row) row = result.row;
        if (result.draftCreated && result.row) await notifyHostOfOrder(result.row);
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

router.post('/:partyId/pizza/orders/:orderId/cancel', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const orderId = opopIdParam(req.params.orderId);
    const row = await prisma.pizzaOrder.findFirst({ where: { opopOrderId: orderId, partyId: party.id } });
    if (!row) throw new AppError('Order not found', 404, 'NOT_FOUND');
    // pizza-mcp orders belong to the principal that placed them; only that host can cancel.
    if (row.userId !== req.userId) throw new AppError('Only the host who placed this order can cancel it.', 403, 'NOT_ORDER_OWNER');
    if (!CANCELABLE_STATUSES.has(row.status)) {
      throw new AppError('This order can no longer be canceled here. Call the shop.', 409, 'CANCEL_NOT_ALLOWED');
    }
    const view = await getPizzaMcpClient().cancelOrder(actorFor(req, party), orderId);
    const result = await prisma.$transaction((tx) => applyOrderUpdate(tx, view, { clientRef: { party_id: party.id, rsvp_user_id: row.userId } }));
    res.json({ order: publicOrder(result.row ?? row, true) });
  } catch (e) {
    next(e);
  }
});

/**
 * Tell us what really happened, so the budget is not held (or counted twice) for ever.
 *  - nothing_ordered: the shop did not take the order (needs_review / refused / unreachable / ...):
 *    releases the budget and unblocks a new order.
 *  - receipt_uploaded: the real receipt for a confirmed order is uploaded: count it once.
 * Any host or edit-enabled co-host of the party may do this (the budget is the party's).
 */
router.post('/:partyId/pizza/orders/:orderId/settle', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const orderId = opopIdParam(req.params.orderId);
    const body = isObj(req.body) ? req.body : {};
    const row = await prisma.pizzaOrder.findFirst({ where: { opopOrderId: orderId, partyId: party.id } });
    if (!row) throw new AppError('Order not found', 404, 'NOT_FOUND');
    if (body.action === 'nothing_ordered') {
      if (!isTerminal(row.status) || row.status === 'confirmed_by_shop' || row.status === 'completed') {
        throw new AppError('Only an order that did not go through can be released. Cancel a live order; a confirmed one needs its receipt.', 409, 'SETTLE_NOT_ALLOWED');
      }
      const updated = await prisma.pizzaOrder.update({ where: { id: row.id }, data: { releasedAt: new Date() } });
      return res.json({ order: publicOrder(updated, updated.userId === req.userId) });
    }
    if (body.action === 'receipt_uploaded') {
      if (!['confirmed_by_shop', 'needs_review', 'completed'].includes(row.status)) {
        throw new AppError('Only a confirmed order has a receipt to match.', 409, 'SETTLE_NOT_ALLOWED');
      }
      const updated = await prisma.pizzaOrder.update({ where: { id: row.id }, data: { receiptCoveredAt: new Date() } });
      return res.json({ order: publicOrder(updated, updated.userId === req.userId) });
    }
    throw new AppError('action must be nothing_ordered or receipt_uploaded', 400, 'VALIDATION_FAILED');
  } catch (e) {
    next(e);
  }
});

export default router;
