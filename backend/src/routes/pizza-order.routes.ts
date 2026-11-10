import { Router, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { loadPartyForOrdering, remainingCapCents, partyReceipts, isLaterReceipt, budgetBreakdown, OrderingParty } from '../lib/pizzaOrdering.js';
import {
  recommendationsToLines,
  recommendationVersion,
  RecommendationError,
  MAX_PIZZAS_PER_ORDER,
  OrderLineSpec,
} from '../lib/recommendationToLines.js';
import { menuFacts, fitLine } from '../lib/menuFit.js';
import { isTerminal, isBlocking, isCancelable, isRestartable, isSettling, outcomeOf, mayExistAtShop, checkingOf } from '../lib/pizzaOrderStatus.js';
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
import { withApprovalHold, holdUntilOf } from '../services/pizzaApproval.js';

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
const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** OrderView.shop, only well-formed parts: a tel: link must only ever get an E.164 number. */
function shopOf(view: any): { name: string | null; phone: string | null; phoneDisplay: string | null } | null {
  const s = isObj(view?.shop) ? view.shop : null;
  if (!s) return null;
  const phone = typeof s.phone === 'string' && E164_RE.test(s.phone) ? s.phone : null;
  return { name: strOrNull(s.name), phone, phoneDisplay: phone ? strOrNull(s.phone_display) : null };
}
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function publicOrder(row: any, forOwner: boolean, opts: { receiptMatched?: boolean } = {}) {
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
    // call details incl. shop total, changes and (when pizza-mcp provides it) `deferred`. `attempts` counts dialed
    // calls only (pizza-mcp 9ad5364 leaves out `not_dialed` rows) but is still not shown: the outcome says what happened.
    call: view?.call ?? null,
    timeline: view?.timeline ?? [],
    // the approval link belongs to the host who placed the order
    nextAction: forOwner ? row.nextAction : null,
    // pizza-mcp 64fb2ac: the shop's real hold on a price approval (3 minutes), from the approval page's view. Not
    // `next_action.expires_at` (the link's expiry). Not secret: a co-host sees how long the shop waits too.
    holdUntil: holdUntilOf(row),
    // pizza-mcp 64fb2ac OrderView.shop: the name and number the order was placed with, for the Call button
    shop: shopOf(view),
    isMine: forOwner,
    restartable: isRestartable(row),
    // keep polling a fresh confirmation: the post-call check can still downgrade it
    settling: isSettling(row),
    // pizza-mcp 662d51c: `calling`, the shop agreed and the call is being checked. NOT confirmed: keep polling.
    checking: checkingOf(row),
    // what pizza-mcp says happened (null while in flight / confirmed / unknown): drives the host's copy and the budget
    outcome: outcomeOf(row),
    // an order that may exist (or needs_review that holds budget) and has ended: the host can say nothing was ordered
    releasable: !row.releasedAt && isTerminal(row.status) && row.status !== 'confirmed_by_shop' && row.status !== 'completed' && isBlocking(row),
    released: !!row.releasedAt,
    // the backend would refuse a new order without "place a second order anyway"
    blocking: isBlocking(row),
    receiptCovered: !!row.receiptCoveredAt || opts.receiptMatched === true,
    cancelable: forOwner && isCancelable(row) && !isRestartable(row),
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
    let heldOrderId: string | null = null;
    try {
      remaining = await remainingCapCents(party);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      blockedReason = e.code ?? 'BLOCKED';
      heldOrderId = typeof e.data?.existingOrderId === 'string' ? e.data.existingOrderId : null;
    }
    res.json({
      enabled: true,
      capCents: party.capCents,
      remainingCapCents: remaining,
      blockedReason,
      // the order to open when it is an order that uses up the budget
      heldOrderId,
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

/** The party's name as pizza-mcp's `phone_order.party_name` takes it: one line, at most 80 characters. */
export function partyLabel(name: string | null | undefined): string | null {
  const one = (name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!one) return null;
  // pizza-mcp counts UTF-16 units (zod max 80): cut there, never inside a surrogate pair
  let cut = one.slice(0, 80);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trim() || null;
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

/**
 * pizza-mcp 1c7113d: a cart keeps the menu it was built on, and its quote freezes the lines. Placing then refuses
 * when that menu is gone (MENU_GONE) or anything changed after the quote (QUOTE_EXPIRED). Nothing was ordered and
 * the shop was not called. Never a dead end: an expired quote is priced again here (the host reviews the new
 * estimate and approves again), and a gone menu tells the browser to rebuild the cart from the recommendations.
 */
function menuGone(shopName: string): AppError {
  return new AppError(
    `The menu at ${shopName} changed since this order was built, so nothing was ordered and the shop wasn't called. We're rebuilding the order on the current menu: check it and approve again.`,
    409,
    'MENU_GONE',
    { rebuild: true }
  );
}
const hasMenuGone = (cart: OpopCart) =>
  (cart.issues ?? []).some((i) => i.code === 'MENU_GONE') || (cart as { menu?: { unavailable?: boolean } }).menu?.unavailable === true;

/** The quote went stale between review and place: price the same cart again, or say the menu is gone. */
async function requoteAfterExpiry(actor: OpopActor, cartId: string, shopName: string, remainingCents: number): Promise<never> {
  const client = getPizzaMcpClient();
  let cart: OpopCart;
  let quote: OpopQuote | null;
  try {
    cart = await client.getCart(actor, cartId);
    if (hasMenuGone(cart)) throw menuGone(shopName);
    quote = await quoteIfReady(actor, cart, remainingCents);
  } catch (e) {
    if (e instanceof AppError && (e.code === 'MENU_GONE' || e.code === 'QUOTE_INVALID')) throw menuGone(shopName);
    throw e;
  }
  if (!quote) throw menuGone(shopName);
  throw new AppError(
    `The order changed after it was priced, so nothing was ordered and ${shopName} wasn't called. We priced it again: check the new estimate and approve again.`,
    409,
    'QUOTE_EXPIRED',
    { cart, quote }
  );
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
    // an edit to a cart whose menu is gone cannot be quoted: rebuild it (pizza-mcp 1c7113d)
    if (hasMenuGone(cart)) throw menuGone((await client.getShop(actor, cart.pizzeria_id)).name);
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
        'This party already has an order in progress, confirmed, or that may exist at the shop. Settle it, or confirm that you want a second order.',
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
    const partyName = partyLabel(party.name);
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
              // pizza-mcp 64fb2ac: names the order in the host's emails (subjects too) and on the approval page, never
              // read to the shop. The party's own name, at most 80 characters.
              ...(partyName ? { party_name: partyName } : {}),
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
    let placed: Awaited<ReturnType<typeof client.placeOrder>>;
    try {
      placed = await client.placeOrder(actor, request, key);
    } catch (e) {
      if (e instanceof AppError && e.code === 'MENU_GONE') throw menuGone(shop.name);
      if (e instanceof AppError && e.code === 'QUOTE_EXPIRED') await requoteAfterExpiry(actor, cartId, shop.name, remaining);
      // pizza-mcp refused to call this shop (an opt-out, a number it has paused until an operator checks it, a
      // changed number...). Nothing was created there, so nothing blocks here: say so, and send the host on.
      if (e instanceof AppError && e.code === 'CALLS_NOT_AVAILABLE_HERE') {
        const reasons = ((e.data as { opop?: { details?: { reasons?: unknown } } } | undefined)?.opop?.details?.reasons ?? []) as unknown[];
        const reason = typeof reasons[0] === 'string' ? reasons[0] : null;
        // pizza-mcp 662d51c: `pending_operator_review` is NOT a possible opt-out. An earlier call to this shop could not
        // be checked automatically and waits for a person; nothing suggests the shop asked not to be called. Own words,
        // so the host is not told the shop may have said not to call.
        // UX audit P1-18: one short why, the shop named twice at most (the host already knows which shop).
        const raw =
          reason === 'pending_operator_review'
            ? "an earlier call to it couldn't be checked automatically and is waiting for our team. It's not because of anything the shop said"
            : e.message.trim().replace(/[.!?]+$/, '');
        const why = /^[A-Z][a-z]/.test(raw) ? raw[0].toLowerCase() + raw.slice(1) : raw;
        throw new AppError(
          `We can't call ${shop.name} right now: ${why}. Nothing was ordered. Pick another pizzeria, or call ${shop.name} yourself.`,
          e.statusCode,
          'CALLS_NOT_AVAILABLE_HERE',
          { ...(e.data ?? {}), shopId: shop.id, reason }
        );
      }
      throw e;
    }
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
        // only a webhook's created_at goes here (see pizzaOrderSync): the first event always applies
        lastEventAt: null,
        confirmedAt: o.status === 'confirmed_by_shop' ? new Date() : null,
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
    // a receipt that matched by itself: the host has nothing left to do on that order
    const { covered } = budgetBreakdown(await partyReceipts(party.id), rows);
    res.json({ orders: rows.map((r: any) => publicOrder(r, r.userId === req.userId, { receiptMatched: covered.includes(r) })) });
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
        const client = getPizzaMcpClient();
        // the real hold deadline is read before the transaction: no network call inside it
        const live = await withApprovalHold(client, await client.getOrder(actorFor(req, party), orderId));
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
    if (!isCancelable(row)) {
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
 *  - receipt_uploaded: the real receipt for a confirmed order, or for one that ended but may exist
 *    at the shop, is uploaded: count it once. Needs a
 *    receipt uploaded after the order; what it frees is limited by budgetBreakdown.
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
      // A host who checked with the shop may find that an order that ended unclear was taken after all.
      if (!['confirmed_by_shop', 'needs_review', 'completed'].includes(row.status) && !mayExistAtShop(row)) {
        throw new AppError('Only a confirmed order has a receipt to match.', 409, 'SETTLE_NOT_ALLOWED');
      }
      if (!(await partyReceipts(party.id)).some((r) => isLaterReceipt(r, row))) {
        throw new AppError('We could not find a receipt uploaded after this order. Upload the real receipt first.', 409, 'NO_RECEIPT_FOUND');
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
