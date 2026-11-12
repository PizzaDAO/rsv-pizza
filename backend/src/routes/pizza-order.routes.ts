import { Router, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import {
  loadPartyForOrdering, remainingCapCents, partyReceipts, isLaterReceipt, budgetBreakdown, OrderingParty,
  partyHandoffOrders, handoffAsBudgetOrder, holderData, budgetLeft,
} from '../lib/pizzaOrdering.js';
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
  OPOP_ORDERING_PROVIDERS,
  OpopOrderingProvider,
  HostMenuInput,
} from '../services/pizzaMcp.client.js';
import { hostMenusFlagOn } from '../lib/hostMenus.js';
import { emailOrdersFlagOn, emailOrderable, emailAlternativeOf, emailOrderProblems, emailNotAvailable, channelOf, emailViewOf, EmailAlternative } from '../lib/emailOrders.js';
import { checkMenuUpload, checkMenuUrl } from '../lib/uploadSniff.js';
import { drainRequest, readMenuUpload } from '../lib/menuUpload.js';
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
    // basil-14648 P2: how the order is placed (phone = a call), and for an email order what the shop has seen and
    // answered (sent, reply-by, reminder, its answer). Never the shop's address: pizza-mcp does not send it.
    channel: channelOf(row),
    email: emailViewOf(row),
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
    if (!enabled) return res.json({ enabled: false, hostMenus: false, emailOrders: false, capCents: null, remainingCapCents: null, blockedReason: null, location: null });
    let remaining: number | null = null;
    let blockedReason: string | null = null;
    let heldOrderId: string | null = null;
    let heldHandoffId: string | null = null;
    try {
      remaining = await remainingCapCents(party);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      blockedReason = e.code ?? 'BLOCKED';
      heldOrderId = typeof e.data?.existingOrderId === 'string' ? e.data.existingOrderId : null;
      heldHandoffId = typeof e.data?.existingHandoffId === 'string' ? e.data.existingHandoffId : null;
    }
    // basil-14648 P2: how the holding mark was placed and by whom, for honest copy
    let heldHandoff: { id: string; shopName: string; provider: string; isMine: boolean } | null = null;
    if (heldHandoffId) {
      const h = await prisma.pizzaHandoff.findFirst({ where: { id: heldHandoffId, partyId: party.id } });
      if (h) heldHandoff = { id: h.id, shopName: h.shopName, provider: h.provider, isMine: h.userId === req.userId };
    }
    // basil-14648 P2: rsv's switch for "Use this shop's real menu". Whether a shop takes one is pizza-mcp's
    // `capabilities.host_menu_upload` on that shop (the UI hides the feature per shop).
    const hostMenus = hostMenusFlagOn();
    res.json({
      enabled: true,
      hostMenus,
      // basil-14648 P2: rsv's switch for "Email the order". Per shop it also needs pizza-mcp's
      // `capabilities.email_order` and an available `ordering.alternatives[email]` (the UI checks both).
      emailOrders: emailOrdersFlagOn(),
      capCents: party.capCents,
      remainingCapCents: remaining,
      blockedReason,
      // the order to open when it is an order that uses up the budget
      heldOrderId,
      // basil-14648 P2: or the host's own "I ordered it" mark (an "Order online" handoff) that holds it
      heldHandoffId,
      heldHandoff,
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

/**
 * basil-14648 P2: every successful quote of a cart refreshes the numbers its handoffs keep (the cart may have
 * changed since): not-yet-marked rows and released ones (a new mark copies them). A standing mark keeps the numbers
 * its hold was set from.
 */
async function rememberQuoteOnHandoffs(cartId: string, q: OpopQuote) {
  const estimate = q.estimate?.expected_cents ?? q.totals?.total_cents ?? q.price_ceiling_cents ?? null;
  const data = { quoteId: q.quote_id, quoteCeilingCents: q.price_ceiling_cents ?? null, estimateCents: estimate };
  await prisma.pizzaHandoff.updateMany({ where: { opopCartId: cartId, orderedAt: null }, data });
  await prisma.pizzaHandoff.updateMany({ where: { opopCartId: cartId, releasedAt: { not: null } }, data });
}

type Channel = 'ai_phone' | 'email';

/**
 * Quote only a ready cart. `max_total_cents` is what the party may still spend, not the whole cap. An email order's
 * quote is bound to `channel: "email"` (pizza-mcp caps its ceiling at the email limit, and only `email_order` can
 * place it).
 */
async function quoteIfReady(actor: OpopActor, cart: OpopCart, remainingCents: number, channel: Channel = 'ai_phone'): Promise<OpopQuote | null> {
  if (!cart.ready_for_quote || cart.lines.length === 0) return null;
  const q = await getPizzaMcpClient().quote(actor, cart.id, { max_total_cents: remainingCents, ...(channel === 'email' ? { channel } : {}) });
  await recordQuote(cart.id, q.quote_id);
  await rememberQuoteOnHandoffs(cart.id, q);
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
async function requoteAfterExpiry(actor: OpopActor, cartId: string, shopName: string, remainingCents: number, channel: Channel = 'ai_phone'): Promise<never> {
  const client = getPizzaMcpClient();
  let cart: OpopCart;
  let quote: OpopQuote | null;
  try {
    cart = await client.getCart(actor, cartId);
    if (hasMenuGone(cart)) throw menuGone(shopName);
    quote = await quoteIfReady(actor, cart, remainingCents, channel);
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

/** The channel a request asks for. `email` only behind rsv's switch: off, it is refused, never silently a call. */
function channelParam(v: unknown): Channel {
  if (v === undefined || v === null || v === '' || v === 'ai_phone') return 'ai_phone';
  if (v !== 'email') throw new AppError('channel must be ai_phone or email', 400, 'VALIDATION_FAILED');
  if (!emailOrdersFlagOn()) throw new AppError('Email orders are not available yet.', 404, 'FEATURE_DISABLED');
  return 'email';
}

/** The shop's email alternative when this host may email it now; else EMAIL_ORDERS_NOT_AVAILABLE with pizza-mcp's reasons. */
async function emailAltFor(actor: OpopActor, shopId: string): Promise<{ alt: EmailAlternative; shopName: string }> {
  const shop = await getPizzaMcpClient().getShop(actor, shopId);
  const alt = emailOrderable(shop);
  if (!alt) {
    const seen = emailAlternativeOf(shop);
    const reasons = seen?.reasons.length ? seen.reasons : ['not_available'];
    throw emailNotAvailable(shop.name, reasons, { alt: seen, fallback: seen?.message });
  }
  return { alt, shopName: shop.name };
}

/**
 * pizza-mcp's EMAIL_ORDERS_NOT_AVAILABLE (`details.reasons` are codes; an unknown one reads as "can't email"), in
 * the host's words. Nothing was created or sent there. Anything else passes through.
 */
function rethrowEmailRefusal(e: unknown, shopName: string, alt: EmailAlternative | null) {
  if (!(e instanceof AppError) || e.code !== 'EMAIL_ORDERS_NOT_AVAILABLE') return;
  const reasons = ((e.data as { opop?: { details?: { reasons?: unknown } } } | undefined)?.opop?.details?.reasons ?? []) as unknown[];
  const codes = reasons.filter((r): r is string => typeof r === 'string').slice(0, 20);
  throw emailNotAvailable(shopName, codes.length ? codes : ['not_available'], { alt, fallback: e.message, status: e.statusCode });
}

/** Lead time and size against the shop's published email rules: a plain 400 before anything is built or sent. */
function assertEmailFits(alt: EmailAlternative, shopName: string, o: { pickupAt?: Date | null; pizzas?: number | null }) {
  const problems = emailOrderProblems(alt, o);
  if (problems.length) throw emailNotAvailable(shopName, problems, { alt, status: 400 });
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
    const channel = channelParam(body.channel);
    const pickupAt = typeof body.pickupAt === 'string' ? new Date(body.pickupAt) : null;
    if (!pickupAt || Number.isNaN(pickupAt.getTime()) || pickupAt.getTime() < Date.now() + 5 * 60_000) {
      throw new AppError('Pick a pickup time at least 5 minutes from now.', 400, 'PICKUP_TIME_REQUIRED');
    }
    const actor = actorFor(req, party);
    // basil-14648 P2: an email order is checked against the shop's published rules first (pizza-mcp checks again)
    const email = channel === 'email' ? await emailAltFor(actor, shopId) : null;
    if (email) assertEmailFits(email.alt, email.shopName, { pickupAt });
    const decisions: Record<string, Decision> = {};
    if (isObj(body.decisions)) {
      for (const [k, v] of Object.entries(body.decisions)) {
        if (v === 'omit_toppings' || v === 'drop_line') decisions[k] = v;
      }
    }

    let lines: OrderLineSpec[];
    try {
      // a call takes up to 30 pizzas; an email order up to the shop's published maximum
      lines = recommendationsToLines(body.recommendations, email ? { maxPizzas: email.alt.max_pizzas } : {});
    } catch (e) {
      if (e instanceof RecommendationError) throw new AppError(e.message, 400, e.code);
      throw e;
    }
    if (email) assertEmailFits(email.alt, email.shopName, { pizzas: lines.reduce((a, l) => a + l.quantity, 0) });
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
    const common = { issues, notices, dropped, recommendationVersion: recVersion, capCents: party.capCents, remainingCapCents: remaining, channel };
    if (ops.length === 0) return res.json({ cart: null, quote: null, ...common });
    // pickup only in v1; scheduled_for is required for phone orders
    ops.push({ op: 'set_fulfillment', type: 'pickup', scheduled_for: pickupAt.toISOString() });

    const cart = await client.createCart(actor, { pizzeria_id: shopId, ops });
    await prisma.pizzaCart.create({
      data: { partyId: party.id, userId: req.userId as string, opopCartId: cart.id, shopId, recommendationVersion: recVersion, quoteIds: [] },
    });
    // No quote while a question is open: a partial order must be an explicit choice, never a surprise.
    let quote: OpopQuote | null = null;
    try {
      quote = issues.length === 0 ? await quoteIfReady(actor, cart, remaining, channel) : null;
    } catch (e) {
      if (email) rethrowEmailRefusal(e, email.shopName, email.alt);
      throw e;
    }
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
    const channel = channelParam(body.channel);
    const current = await client.getCart(actor, cartId);
    const email = channel === 'email' ? await emailAltFor(actor, current.pizzeria_id) : null;
    const maxPizzas = email ? email.alt.max_pizzas : MAX_PIZZAS_PER_ORDER;
    // The 30-pizza phone-order limit (an email order: the shop's own) applies to edits too: simulate them first.
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
    if (total > maxPizzas) {
      throw new AppError(
        `${total} pizzas is too many for an automated order (max ${maxPizzas}). Call the shop yourself.`,
        400,
        'TOO_MANY_PIZZAS'
      );
    }
    if (email) assertEmailFits(email.alt, email.shopName, { pizzas: total });
    // a new pickup time must still fit the email lead time
    if (email) {
      for (const op of body.ops as Array<Record<string, unknown>>) {
        if (op.op === 'set_fulfillment' && typeof op.scheduled_for === 'string') {
          assertEmailFits(email.alt, email.shopName, { pickupAt: new Date(op.scheduled_for) });
        }
      }
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
    res.json({ cart, quote: await quoteIfReady(actor, cart, remaining, channel), capCents: party.capCents, remainingCapCents: remaining, channel });
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
    // basil-14648 P2: `email` = we email the shop the order instead of calling it (needs rsv's switch)
    const channel = channelParam(pol.channel);
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
    // basil-14648 P2: a host's "I ordered it online" mark counts like a confirmed order here
    const blockers = [...existing.filter((o: any) => isBlocking(o)), ...(await partyHandoffOrders(party.id))];
    if (blockers.length && body.allowAnother !== true) {
      throw new AppError(
        'This party already has an order in progress, confirmed, or that may exist at the shop. Settle it, or confirm that you want a second order.',
        409,
        'ORDER_IN_PROGRESS',
        holderData(blockers[0])
      );
    }

    const remaining = await remainingCapCents(party);
    const actor = actorFor(req, party);
    const client = getPizzaMcpClient();
    const cart = await client.getCart(actor, cartId);
    if (cart.pizzeria_id !== cartRow.shopId) throw new AppError('Cart does not belong to this shop', 400, 'CART_MISMATCH');
    const shop = await client.getShop(actor, cartRow.shopId);
    const tier = shop.tier === 'native' ? 'native' : 'listing';
    if (channel === 'email' && tier !== 'listing') throw new AppError('This shop takes orders online: there is nothing to email.', 409, 'NOT_A_LISTING');
    if (tier === 'listing' && channel === 'ai_phone' && shop.ordering?.channel !== 'ai_phone') {
      throw new AppError('We cannot place an automated call to this shop. Use the order script and call them yourself.', 409, 'CALLS_NOT_AVAILABLE_HERE');
    }
    // basil-14648 P2: the email channel needs both of pizza-mcp's answers on the shop, and its published rules
    let emailAlt: EmailAlternative | null = null;
    let pickupAt: Date | null = null;
    if (channel === 'email') {
      emailAlt = emailOrderable(shop);
      if (!emailAlt) {
        const seen = emailAlternativeOf(shop);
        throw emailNotAvailable(shop.name, seen?.reasons.length ? seen.reasons : ['not_available'], { alt: seen, fallback: seen?.message });
      }
      const when = (cart as { fulfillment?: { scheduled_for?: string | null } }).fulfillment?.scheduled_for;
      pickupAt = typeof when === 'string' && !Number.isNaN(Date.parse(when)) ? new Date(when) : null;
      assertEmailFits(emailAlt, shop.name, { pickupAt, pizzas: cart.lines.reduce((a, l) => a + l.quantity, 0) });
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
      if (emailAlt && ceilingCents > emailAlt.max_total_cents) {
        throw new AppError(
          `An email order can't be over $${(emailAlt.max_total_cents / 100).toFixed(2)}. Lower your limit.`,
          422,
          'SPEND_LIMIT_EXCEEDED'
        );
      }
    }

    const contact = { name, phone, ...(email ? { email } : {}) };
    const partyName = partyLabel(party.name);
    const client_ref = { party_id: party.id, rsvp_user_id: req.userId as string };
    const request: OpopPlaceOrderRequest =
      tier === 'listing' && channel === 'email'
        ? {
            quote_id: quoteId,
            payment_mode: 'pay_at_pickup',
            contact,
            // email orders are all as ordered: the shop confirms the order or declines it. The ceiling is never shown
            // to the shop; over it, the host is asked again (the one-tap price email).
            email_order: {
              price_ceiling_cents: ceilingCents,
              substitution_policy: 'exact',
              ...(partyName ? { party_name: partyName } : {}),
            },
            max_total_cents: remaining,
            client_ref,
          }
        : tier === 'listing'
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
      if (e instanceof AppError && e.code === 'QUOTE_EXPIRED') await requoteAfterExpiry(actor, cartId, shop.name, remaining, channel);
      // basil-14648 P2: pizza-mcp would not email this shop this order. Nothing was created or sent: say why and offer
      // the call (or the host's own phone call). `details.reasons` are codes; an unknown one reads as "can't email".
      rethrowEmailRefusal(e, shop.name, emailAlt);
      // an email quote placed as a call (or the reverse), or the order out of pizza-mcp's bounds: price it again for
      // the right channel when that is what pizza-mcp asks, else a plain 400 in pizza-mcp's words
      if (e instanceof AppError && e.code === 'VALIDATION_FAILED' && channel === 'email') {
        const opop = (e.data as { opop?: { path?: unknown; suggestions?: Array<{ action?: unknown }> } } | undefined)?.opop;
        if (opop?.suggestions?.some((x) => x?.action === 'requote')) await requoteAfterExpiry(actor, cartId, shop.name, remaining, channel);
        throw new AppError(`${e.message.trim().replace(/[.!?]*$/, '.')} Nothing was ordered and nothing was sent.`, 400, 'VALIDATION_FAILED', { path: typeof opop?.path === 'string' ? opop.path : null });
      }
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
        // basil-14648 P2: an email order's pickup (the shop confirms it, or declines): its cancel ends there
        ...(pickupAt ? { readyAt: pickupAt } : {}),
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
        ...(pickupAt ? { readyAt: pickupAt } : {}),
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
    // a receipt that matched by itself: the host has nothing left to do on that order (handoff marks share the receipts)
    const { covered } = budgetBreakdown(await partyReceipts(party.id), [...rows, ...(await partyHandoffOrders(party.id))]);
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
    // an order that moved on meanwhile (a call started, an email order's pickup passed) is pizza-mcp's 409, as it said it
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

// ---------------------------------------------------------------------------
// basil-14648 P2: "Order online" handoff (plans/rsv-p2-order-online-handoff.md). The host orders on the shop's own
// site (Toast, Square Online, ...), by phone or in person, with the checklist. We record the click and the host's
// own "I ordered it" mark in pizza_handoffs (never pizza_orders: the OPOP sync must not poll it) and forward
// aggregate counts to pizza-mcp. No amount, order number or screenshot of the external order is stored.
// ---------------------------------------------------------------------------
const HANDOFF_PROVIDERS: ReadonlySet<string> = new Set([...OPOP_ORDERING_PROVIDERS, 'phone', 'in_person']);
const isOpopProvider = (p: string): p is OpopOrderingProvider => (OPOP_ORDERING_PROVIDERS as readonly string[]).includes(p);
/** Open (unreleased) rows per party: released ones do not count. */
const MAX_OPEN_HANDOFFS_PER_PARTY = 100;

/** A display name from the browser: one line, at most 120 characters (React escapes it; never used in a query). */
function shopNameParam(v: unknown): string {
  const one = (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!one) throw new AppError('shopName is required', 400, 'VALIDATION_FAILED');
  return one;
}

function publicHandoff(h: any, viewerId: string | undefined, opts: { receiptMatched?: boolean } = {}) {
  const marked = !!h.orderedAt && !h.releasedAt;
  const forOwner = h.userId === viewerId;
  return {
    id: h.id,
    shopId: h.shopId,
    shopName: h.shopName,
    provider: h.provider,
    cartId: forOwner ? h.opopCartId : null,
    holdCents: marked ? h.holdCents : 0,
    // pizza-mcp's estimate for the checklist's cart (null when there was none)
    estimateCents: h.estimateCents ?? null,
    // the mark holds less than the order's estimate: what was left of the budget did not cover it
    overBudget: marked && h.estimateCents != null && h.holdCents < h.estimateCents,
    // no cart or no quote/estimate was ever captured: we don't know the amount, so the mark holds the rest of the
    // budget until a receipt replaces it (or the host takes it back)
    holdsRest: marked && (!h.opopCartId || (h.quoteCeilingCents == null && h.estimateCents == null)),
    clickedAt: h.clickedAt,
    orderedAt: h.orderedAt,
    releasedAt: h.releasedAt,
    // who took it back: the host who marked it ("I didn't order after all") or a co-host who checked
    releasedByOwner: !!h.releasedAt && h.releasedBy === h.userId,
    releasedByMe: !!h.releasedAt && !!viewerId && h.releasedBy === viewerId,
    // the host's own mark: holds hold_cents and blocks a second order until released
    marked,
    blocking: marked,
    // ONLY when budgetBreakdown really consumed a receipt for it (never from receipt_covered_at alone: that receipt
    // may have gone to another order, and a mark that holds 0 owes nothing without any receipt)
    receiptCovered: marked && opts.receiptMatched === true,
    isMine: forOwner,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

/** Fire-and-forget aggregate count on pizza-mcp: only for a cart this host owns and a real ordering-link provider. */
function forwardHandoff(actor: OpopActor, row: { opopCartId: string | null; provider: string }, event: 'opened' | 'marked_ordered' | 'unmarked') {
  if (!row.opopCartId || !isOpopProvider(row.provider)) return;
  getPizzaMcpClient()
    .recordHandoff(actor, row.opopCartId, { provider: row.provider, event })
    .catch((e) => console.warn('[pizza-handoff] pizza-mcp count failed', (e as Error)?.message));
}

/**
 * The party's marks a real receipt was consumed for (budgetBreakdown.receiptMatched), over every order and standing
 * mark. `override` replaces one row first: "what if this receipt pairing were saved?".
 */
async function receiptMatchedHandoffs(partyId: string, override?: { id: string } & Record<string, unknown>): Promise<Set<string>> {
  const [receipts, orders, standing] = await Promise.all([
    partyReceipts(partyId),
    prisma.pizzaOrder.findMany({ where: { partyId } }),
    prisma.pizzaHandoff.findMany({ where: { partyId, orderedAt: { not: null }, releasedAt: null }, orderBy: { orderedAt: 'desc' } }),
  ]);
  const rows = standing.map((r) => (override && r.id === override.id ? { ...r, ...override } : r));
  const marks = rows.map((r) => handoffAsBudgetOrder(r as any)).filter((o): o is NonNullable<typeof o> => o !== null);
  const { receiptMatched } = budgetBreakdown(receipts, [...orders, ...marks]);
  return new Set(receiptMatched.map((o: any) => o.handoffId).filter(Boolean));
}

/** A handoff for the browser, with receiptCovered computed from real receipt consumption. */
async function handoffView(row: any, viewerId: string | undefined) {
  const marked = !!row.orderedAt && !row.releasedAt;
  const matched = marked ? (await receiptMatchedHandoffs(row.partyId)).has(row.id) : false;
  return publicHandoff(row, viewerId, { receiptMatched: matched });
}

async function handoffRow(handoffId: string, party: OrderingParty) {
  if (!/^[0-9a-f-]{36}$/i.test(handoffId)) throw new AppError('Not found', 404, 'NOT_FOUND');
  const row = await prisma.pizzaHandoff.findFirst({ where: { id: handoffId, partyId: party.id } });
  if (!row) throw new AppError('Not found', 404, 'NOT_FOUND');
  return row;
}

type CartQuote =
  | { ok: true; quoteId: string; ceilingCents: number | null; estimateCents: number | null }
  | { ok: false; overBudget: true; estimateCents: number | null }
  | { ok: false; overBudget: false };

/**
 * Quote the checklist's cart with what is left of the budget (no cap when nothing is left: the estimate is still
 * pizza-mcp's). Never throws a pizza-mcp 4xx/5xx: a failed quote (pickup time passed, cart expired, service down)
 * is `{ok:false}` and the caller falls back to the row's last known numbers.
 */
async function quoteCart(actor: OpopActor, cartId: string, leftCents: number): Promise<CartQuote> {
  try {
    const q = await getPizzaMcpClient().quote(actor, cartId, leftCents > 0 ? { max_total_cents: leftCents } : {});
    await recordQuote(cartId, q.quote_id);
    await rememberQuoteOnHandoffs(cartId, q);
    const estimate = q.estimate?.expected_cents ?? q.totals?.total_cents ?? null;
    return { ok: true, quoteId: q.quote_id, ceilingCents: q.price_ceiling_cents ?? null, estimateCents: estimate ?? q.price_ceiling_cents ?? null };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === 'SPEND_LIMIT_EXCEEDED') {
      const d = (e.data as { opop?: { details?: { expected_cents?: unknown } } } | undefined)?.opop?.details;
      return { ok: false, overBudget: true, estimateCents: typeof d?.expected_cents === 'number' ? d.expected_cents : null };
    }
    return { ok: false, overBudget: false };
  }
}

router.get('/:partyId/pizza/handoffs', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    // the latest 20, plus every mark still standing (the one that holds the budget is never cut off)
    const [recent, standing] = await Promise.all([
      prisma.pizzaHandoff.findMany({ where: { partyId: party.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.pizzaHandoff.findMany({ where: { partyId: party.id, orderedAt: { not: null }, releasedAt: null }, orderBy: { createdAt: 'desc' } }),
    ]);
    const byId = new Map([...standing, ...recent].map((r) => [r.id, r]));
    const rows = [...byId.values()].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
    // only a receipt actually consumed counts as "your receipt counts for it": a mark that holds 0 is not covered
    const matchedIds = await receiptMatchedHandoffs(party.id);
    const budget = await budgetLeft(party);
    res.json({
      handoffs: rows.map((r) => publicHandoff(r, req.userId, { receiptMatched: matchedIds.has(r.id) })),
      // the same budget state the mark answered with, so the copy after a reload matches (USD cents)
      budget: { capCents: budget.capCents, leftCents: Math.max(0, budget.leftCents), noCap: budget.capCents === null },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * The host opened the shop's ordering page (`opened`, default true), or is about to mark an order placed some
 * other way (`opened: false`, provider = what the host said: an online provider, `phone` or `in_person`).
 * Reuses the host's open row for the same shop and cart. Holds and blocks nothing. With a cart, the row keeps
 * pizza-mcp's estimate for it, the fallback hold if the mark later cannot re-quote.
 */
router.post('/:partyId/pizza/handoffs', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const body = isObj(req.body) ? req.body : {};
    const shopId = shopIdParam(String(body.shopId ?? ''));
    const shopName = shopNameParam(body.shopName);
    const provider = String(body.provider ?? '');
    if (!HANDOFF_PROVIDERS.has(provider)) throw new AppError('Unknown provider', 400, 'VALIDATION_FAILED');
    const opened = body.opened !== false;
    if (opened && !isOpopProvider(provider)) throw new AppError('Only an ordering page can be opened', 400, 'VALIDATION_FAILED');
    let cartId: string | null = null;
    let lastQuoteId: string | null = null;
    if (body.cartId !== undefined && body.cartId !== null && body.cartId !== '') {
      cartId = opopIdParam(String(body.cartId));
      const cartRow = await ownedCartRow(cartId, party, req);
      if (cartRow.shopId !== shopId) throw new AppError('Cart does not belong to this shop', 400, 'CART_MISMATCH');
      lastQuoteId = cartRow.quoteIds[cartRow.quoteIds.length - 1] ?? null;
    }
    const userId = req.userId as string;
    const open = await prisma.pizzaHandoff.findFirst({
      where: { partyId: party.id, userId, shopId, opopCartId: cartId, releasedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    let row;
    if (open) {
      // a marked row keeps its provider: the host already said how they ordered. A click sets the provider.
      row = await prisma.pizzaHandoff.update({
        where: { id: open.id },
        data: { ...(opened ? { clickedAt: new Date() } : {}), ...(open.orderedAt ? {} : { provider, shopName }) },
      });
    } else {
      if ((await prisma.pizzaHandoff.count({ where: { partyId: party.id, releasedAt: null } })) >= MAX_OPEN_HANDOFFS_PER_PARTY) {
        throw new AppError('Too many open online-order records for this party.', 429, 'TOO_MANY_HANDOFFS');
      }
      // a new row on a cart starts from the numbers of the cart's LATEST quote, when another row kept them
      const known = cartId && lastQuoteId
        ? await prisma.pizzaHandoff.findFirst({ where: { partyId: party.id, opopCartId: cartId, quoteId: lastQuoteId }, orderBy: { updatedAt: 'desc' } })
        : null;
      row = await prisma.pizzaHandoff.create({
        data: {
          partyId: party.id, userId, shopId, shopName, provider, opopCartId: cartId, clickedAt: opened ? new Date() : null,
          ...(known ? { quoteId: known.quoteId, quoteCeilingCents: known.quoteCeilingCents, estimateCents: known.estimateCents } : {}),
        },
      });
    }
    const actor = actorFor(req, party);
    if (cartId && row.estimateCents == null && !row.orderedAt) {
      const q = await quoteCart(actor, cartId, Math.max(0, (await budgetLeft(party)).leftCents));
      if (q.ok || q.overBudget) {
        row = await prisma.pizzaHandoff.update({
          where: { id: row.id },
          data: q.ok
            ? { quoteId: q.quoteId, quoteCeilingCents: q.ceilingCents, estimateCents: q.estimateCents }
            : { estimateCents: q.estimateCents },
        });
      }
    }
    if (opened) forwardHandoff(actor, row, 'opened');
    res.status(open ? 200 : 201).json({ handoff: await handoffView(row, req.userId) });
  } catch (e) {
    next(e);
  }
});

/**
 * What a host says about a handoff:
 *  - ordered: "I placed this order". A fact, so it is ALWAYS recorded once the host confirms (a second order needs
 *    `allowAnother`: 409 ORDER_IN_PROGRESS otherwise). It blocks a second order and holds the quote's price
 *    ceiling, re-quoted here with what is left of the budget, so the hold never comes from the browser. When the
 *    re-quote fails (pickup time passed, cart expired) it holds the last ceiling rsv saw for the cart, else its
 *    estimate. With no cart, or no quote/estimate ever captured, the amount is unknown: it holds the REST of the
 *    budget (`holdsRest`) until a receipt replaces it or the host takes it back. Always clamped to what is left,
 *    which may be 0 (no budget left, no cap, or the estimate over it: `overBudget` / `budget.noCap` say so).
 *    Only the host who built the checklist can mark it.
 *  - unmark: "I didn't order after all". Only the host who marked it; frees it at once.
 *  - release: a co-host who checked that nothing was ordered frees it; recorded as theirs (released_by).
 *  - receipt_uploaded: one receipt uploaded AFTER the mark replaces the hold (any host). A receipt uploaded before
 *    the mark is never matched to it (it may be another order's): 409 RECEIPT_BEFORE_MARK explains.
 */
router.post('/:partyId/pizza/handoffs/:handoffId/mark', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const row = await handoffRow(req.params.handoffId, party);
    const body = isObj(req.body) ? req.body : {};
    const mine = row.userId === req.userId;
    const marked = !!row.orderedAt && !row.releasedAt;

    if (body.action === 'ordered') {
      if (!mine) throw new AppError('Only the host who built this checklist can mark it ordered.', 403, 'NOT_HANDOFF_OWNER');
      if (marked) return res.json({ handoff: await handoffView(row, req.userId), replayed: true });
      // a released row is never re-marked (its numbers are stale): a new mark gets a new row, as the UI does
      if (row.releasedAt) {
        throw new AppError('This order was taken back. Mark the order again from the checklist.', 409, 'HANDOFF_RELEASED');
      }
      const orders = await prisma.pizzaOrder.findMany({ where: { partyId: party.id } });
      const blockers = [
        ...orders.filter((o: any) => isBlocking(o)),
        ...(await partyHandoffOrders(party.id)).filter((h) => h.handoffId !== row.id),
      ];
      if (blockers.length && body.allowAnother !== true) {
        throw new AppError(
          'This party already has an order in progress, confirmed, or that may exist at the shop. Confirm that this is a second order.',
          409,
          'ORDER_IN_PROGRESS',
          holderData(blockers[0])
        );
      }
      const budget = await budgetLeft(party);
      const left = Math.max(0, budget.leftCents);
      // unknown amount (no cart, or no quote/estimate ever captured): hold the rest of the budget
      let holdCents = left;
      let estimateCents: number | null = row.estimateCents;
      let quoteCeilingCents: number | null = row.quoteCeilingCents;
      let quoteId: string | null = row.quoteId;
      if (row.opopCartId) {
        await ownedCartRow(row.opopCartId, party, req);
        const q = await quoteCart(actorFor(req, party), row.opopCartId, left);
        if (q.ok) {
          quoteId = q.quoteId;
          quoteCeilingCents = q.ceilingCents;
          estimateCents = q.estimateCents;
          holdCents = q.ceilingCents ?? q.estimateCents ?? left;
        } else if (q.overBudget) {
          // the low estimate is over what is left: hold all of it (the mark still counts as the party's order)
          estimateCents = q.estimateCents ?? estimateCents;
          holdCents = left;
        } else {
          // no fresh quote: the last ceiling we saw for the cart, else its estimate; with neither, the rest
          holdCents = quoteCeilingCents ?? estimateCents ?? left;
        }
      }
      holdCents = Math.max(0, Math.min(Math.round(holdCents), left));
      const updated = await prisma.pizzaHandoff.update({
        where: { id: row.id },
        data: { orderedAt: new Date(), releasedAt: null, releasedBy: null, receiptCoveredAt: null, holdCents, estimateCents, quoteCeilingCents, quoteId },
      });
      forwardHandoff(actorFor(req, party), updated, 'marked_ordered');
      return res.json({
        handoff: await handoffView(updated, req.userId),
        // the party's budget in USD cents (reimbursement caps are in USD); noCap = no reimbursement cap set
        budget: { capCents: budget.capCents, leftCents: left, noCap: budget.capCents === null },
      });
    }

    if (body.action === 'unmark' || body.action === 'release') {
      if (!marked) throw new AppError('This order is not marked as placed.', 409, 'HANDOFF_NOT_MARKED');
      if (body.action === 'unmark' && !mine) {
        throw new AppError('Only the host who marked this order can take it back. If you checked with the shop, release it instead.', 403, 'NOT_HANDOFF_OWNER');
      }
      const updated = await prisma.pizzaHandoff.update({ where: { id: row.id }, data: { releasedAt: new Date(), releasedBy: req.userId as string } });
      if (mine) forwardHandoff(actorFor(req, party), updated, 'unmarked');
      return res.json({ handoff: publicHandoff(updated, req.userId) });
    }

    if (body.action === 'receipt_uploaded') {
      if (!marked) throw new AppError('This order is not marked as placed.', 409, 'HANDOFF_NOT_MARKED');
      const receipts = await partyReceipts(party.id);
      if (!receipts.some((r) => isLaterReceipt(r, { createdAt: row.orderedAt }))) {
        // Safer choice: a receipt from before the mark is never matched to it (it could be another order's). The
        // hold stays; it only over-counts, never under-counts, until an underboss reviews the receipts.
        const since = new Date(row.clickedAt ?? row.createdAt).getTime() - 24 * 3600_000;
        if (receipts.some((r) => new Date(r.createdAt).getTime() >= since && !isLaterReceipt(r, { createdAt: row.orderedAt }))) {
          throw new AppError(
            "The only receipts we found were uploaded before you marked this order, so we can't match one to it automatically. A receipt still counts as a receipt; your underboss matches it when they review. Next time, mark the order first, then upload the receipt.",
            409,
            'RECEIPT_BEFORE_MARK'
          );
        }
        throw new AppError('We could not find a receipt uploaded after you marked this order. Upload the real receipt first.', 409, 'NO_RECEIPT_FOUND');
      }
      // only save the pairing if a receipt would really be consumed for THIS mark (not already taken by another order)
      const now = new Date();
      if (!(await receiptMatchedHandoffs(party.id, { id: row.id, receiptCoveredAt: now })).has(row.id)) {
        throw new AppError(
          "The receipts uploaded after you marked this order already count for other orders. Upload this order's own receipt, then tap again.",
          409,
          'RECEIPT_TAKEN'
        );
      }
      const updated = await prisma.pizzaHandoff.update({ where: { id: row.id }, data: { receiptCoveredAt: now } });
      return res.json({ handoff: await handoffView(updated, req.userId) });
    }
    throw new AppError('action must be ordered, unmark, release or receipt_uploaded', 400, 'VALIDATION_FAILED');
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// basil-14648 P2: the host's own menu for a listing shop (plans/rsv-p2-host-menus.md). Photos (up to 3) or one PDF,
// or a link, passed through to pizza-mcp with THIS host's own token: the menu is private to them there and only
// changes their new carts (a co-host's carts keep the shop's usual menu). rsv checks the type (magic bytes) and the
// sizes before forwarding and keeps nothing: no file, no link, no menu. Behind PIZZA_HOST_MENUS=1.
// ---------------------------------------------------------------------------

/** The gates every host-menu route shares: the party (host or co-host, pilot), rsv's switch, a listing shop. */
async function hostMenuParty(req: AuthRequest) {
  const { party } = await loadPartyForOrdering(req.params.partyId, req);
  if (!hostMenusFlagOn()) throw new AppError('Adding a menu is not available yet.', 404, 'FEATURE_DISABLED');
  const shopId = shopIdParam(req.params.shopId);
  if (!shopId.startsWith('pzl_')) throw new AppError('This shop has its own online menu, so there is nothing to add.', 409, 'NOT_A_LISTING');
  return { party, shopId, actor: actorFor(req, party) };
}

router.post('/:partyId/pizza/shops/:shopId/menu/host', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shopId, actor } = await hostMenuParty(req);
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    let input: HostMenuInput;
    if (type.startsWith('multipart/form-data')) {
      const check = checkMenuUpload(await readMenuUpload(req, res));
      if (!check.ok) throw new AppError(check.message, check.status, check.code);
      input = { kind: 'files', files: check.files };
    } else if (type.startsWith('application/json')) {
      const body = isObj(req.body) ? req.body : {};
      const url = checkMenuUrl(body.url);
      if (!url.ok) throw new AppError(url.message, 400, 'URL_NOT_ALLOWED');
      input = { kind: 'url', url: url.url };
    } else {
      throw new AppError('Send the menu as photos, a PDF, or a link.', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const r = await getPizzaMcpClient().submitHostMenu(actor, shopId, input);
    // only what the browser shows: the counts, the date, and the id (the menu itself stays on pizza-mcp)
    res.status(201).json({
      menuId: r.menu_id,
      provenance: r.menu.provenance,
      asOf: r.menu.as_of,
      summary: {
        pizzaItems: r.summary.pizza_items,
        pricedItems: r.summary.priced_items,
        priceRangeCents: r.summary.price_range_cents ?? null,
      },
    });
  } catch (e) {
    // a refusal before (or while) the upload was read: drain it first, so the browser gets this answer
    await drainRequest(req, res);
    next(e);
  }
});

router.delete('/:partyId/pizza/shops/:shopId/menu/host', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shopId, actor } = await hostMenuParty(req);
    const r = await getPizzaMcpClient().deleteHostMenu(actor, shopId);
    res.json({ expired: r.expired });
  } catch (e) {
    next(e);
  }
});

// Host-entered ordering links (pizza-mcp keeps them per host: other hosts never see them).
router.post('/:partyId/pizza/shops/:shopId/links', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    const shopId = shopIdParam(req.params.shopId);
    const body = isObj(req.body) ? req.body : {};
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url || url.length > 600) throw new AppError('Paste the shop\'s ordering link (https).', 400, 'VALIDATION_FAILED');
    res.status(201).json({ link: await getPizzaMcpClient().addOrderingLink(actorFor(req, party), shopId, url) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:partyId/pizza/shops/:shopId/links/:linkId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { party } = await loadPartyForOrdering(req.params.partyId, req);
    await getPizzaMcpClient().deleteOrderingLink(actorFor(req, party), shopIdParam(req.params.shopId), opopIdParam(req.params.linkId));
    // 200 with a body (not pizza-mcp's 204): the frontend's apiRequest always parses JSON
    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

export default router;
