/**
 * basil-14648 P2 (plans/rsv-p2-email-orders.md §7): email orders. pizza-mcp emails the shop one structured order and
 * the shop confirms its total (or declines) through a signed link. rsv brokers it exactly like a call: the same
 * cart, quote (bound to `channel: "email"`), approval code, ceiling, budget hold and webhooks.
 *
 * Two switches, both needed: rsv's own `PIZZA_EMAIL_ORDERS=1` (unset = off: no option, and the routes refuse the
 * channel), and pizza-mcp's answer on the shop itself (`capabilities.email_order` together with an available
 * `ordering.alternatives[channel=email]`). pizza-mcp checks everything again when the order is placed and sent.
 */
import { AppError } from '../middleware/error.js';

export function emailOrdersFlagOn(): boolean {
  return process.env.PIZZA_EMAIL_ORDERS === '1';
}

/** pizza-mcp's `Pizzeria.ordering.alternatives[channel=email]`, as rsv uses it. */
export interface EmailAlternative {
  channel: 'email';
  available: boolean;
  min_lead_hours: number;
  max_lead_days: number;
  min_pizzas: number;
  max_pizzas: number;
  max_total_cents: number;
  reasons: string[];
  message: string;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

/** The shop's email alternative, well formed, or null when pizza-mcp sent none. */
export function emailAlternativeOf(shop: unknown): EmailAlternative | null {
  const alts = (shop as { ordering?: { alternatives?: unknown } } | null | undefined)?.ordering?.alternatives;
  if (!Array.isArray(alts)) return null;
  const a = alts.find((x) => x && typeof x === 'object' && (x as { channel?: unknown }).channel === 'email') as Record<string, unknown> | undefined;
  if (!a) return null;
  const reasons = Array.isArray(a.reasons) ? a.reasons.filter((r): r is string => typeof r === 'string').slice(0, 20) : [];
  return {
    channel: 'email',
    available: a.available === true,
    // the published rules, with pizza-mcp's own defaults when a number is missing
    min_lead_hours: num(a.min_lead_hours, 24),
    max_lead_days: num(a.max_lead_days, 21),
    min_pizzas: num(a.min_pizzas, 8),
    max_pizzas: num(a.max_pizzas, 40),
    max_total_cents: num(a.max_total_cents, 80_000),
    reasons,
    message: typeof a.message === 'string' ? a.message.slice(0, 300) : '',
  };
}

/**
 * Can this shop get an email order from this host now? Both of pizza-mcp's answers must agree: the capability and an
 * available alternative with no reason against it (an unknown reason code means "not available").
 */
export function emailOrderable(shop: unknown): EmailAlternative | null {
  const alt = emailAlternativeOf(shop);
  const cap = (shop as { capabilities?: { email_order?: unknown } } | null | undefined)?.capabilities?.email_order;
  if (!alt || !alt.available || alt.reasons.length > 0 || cap !== true) return null;
  return alt;
}

const H = 3600_000;

/** The order-level rules pizza-mcp publishes (lead time, size), checked before anything is built or placed. */
export function emailOrderProblems(alt: EmailAlternative, o: { pickupAt?: Date | null; pizzas?: number | null }, now = Date.now()): string[] {
  const out: string[] = [];
  if (o.pickupAt !== undefined) {
    const lead = o.pickupAt ? o.pickupAt.getTime() - now : NaN;
    if (!(lead >= alt.min_lead_hours * H) || lead > alt.max_lead_days * 24 * H) out.push('lead_time');
  }
  if (typeof o.pizzas === 'number') {
    if (o.pizzas < alt.min_pizzas) out.push('too_small');
    if (o.pizzas > alt.max_pizzas) out.push('too_large');
  }
  return out;
}

/** Plain words for one of pizza-mcp's email reason codes (an unknown code: pizza-mcp's own message, else generic). */
export function emailReasonText(reason: string | null | undefined, alt?: Pick<EmailAlternative, 'min_lead_hours' | 'max_lead_days' | 'min_pizzas' | 'max_pizzas' | 'max_total_cents'> | null, fallback?: string): string {
  const a = alt ?? { min_lead_hours: 24, max_lead_days: 21, min_pizzas: 8, max_pizzas: 40, max_total_cents: 80_000 };
  switch (reason) {
    case 'lead_time':
      return `the pickup has to be ${a.min_lead_hours} hours to ${a.max_lead_days} days from now`;
    case 'too_small':
      return `email orders are for ${a.min_pizzas} pizzas or more`;
    case 'too_large':
      return `email orders are for at most ${a.max_pizzas} pizzas`;
    case 'over_total_cap':
      return `an email order can't be over $${(a.max_total_cents / 100).toFixed(0)}`;
    case 'disabled':
      return 'email orders are switched off right now';
    case 'not_in_pilot':
    case 'no_shop_email':
      return "this shop doesn't take email orders through us yet";
    case 'do_not_contact':
      return 'the shop asked us not to contact it';
    case 'possible_opt_out':
      return 'the shop may have asked us not to contact it, and our team is checking';
    case 'unverified':
      return 'email orders need a verified account';
    case 'principal_cap':
      return "you've placed the most email orders allowed for now";
    case 'shop_cap':
      return 'this shop already got the most order emails we send it for now';
    case 'monthly_cap':
      return 'email ordering has reached its limit for this month';
    default: {
      const f = (fallback ?? '').trim().replace(/[.!?]+$/, '');
      return f ? f[0].toLowerCase() + f.slice(1) : "we can't email this shop right now";
    }
  }
}

/** One refusal for the host: nothing was ordered and nothing was sent, plus what to do instead. */
export function emailNotAvailable(shopName: string, reasons: string[], opts: { alt?: EmailAlternative | null; fallback?: string; status?: number } = {}): AppError {
  const why = emailReasonText(reasons[0], opts.alt, opts.fallback);
  return new AppError(
    `We can't email ${shopName} this order: ${why}. Nothing was ordered and nothing was sent. Have our AI call instead, or call ${shopName} yourself.`,
    opts.status ?? 409,
    'EMAIL_ORDERS_NOT_AVAILABLE',
    { reasons }
  );
}

/** pizza-mcp's OrderView.channel, as stored in lastView. Absent = phone. */
export function channelOf(row: { lastView?: unknown }): 'email' | 'phone' {
  return (row.lastView as { channel?: unknown } | null | undefined)?.channel === 'email' ? 'email' : 'phone';
}

export interface EmailView {
  sentAt: string | null;
  replyBy: string | null;
  reminderSentAt: string | null;
  shopResponse: {
    decision: 'confirm' | 'decline' | 'optout';
    totalCents: number | null;
    readyOk: boolean | null;
    altTimeText: string | null;
    reference: string | null;
    reason: string | null;
  } | null;
  deferred: { until: string | null; message: string } | null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const iso = (v: unknown) => (typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
/** Shop-entered words (an alternative time, its order number): one short line, shown as data only. */
const shopText = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const one = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return one || null;
};

/** pizza-mcp's OrderView.email (email orders only), the well-formed parts. */
export function emailViewOf(row: { lastView?: unknown }): EmailView | null {
  if (channelOf(row) !== 'email') return null;
  const e = (row.lastView as { email?: Record<string, unknown> | null } | null | undefined)?.email;
  if (!e || typeof e !== 'object') return { sentAt: null, replyBy: null, reminderSentAt: null, shopResponse: null, deferred: null };
  const r = e.shop_response as Record<string, unknown> | null | undefined;
  const decision = r && (r.decision === 'confirm' || r.decision === 'decline' || r.decision === 'optout') ? r.decision : null;
  const d = e.deferred as Record<string, unknown> | null | undefined;
  return {
    sentAt: iso(e.sent_at),
    replyBy: iso(e.reply_by),
    reminderSentAt: iso(e.reminder_sent_at),
    shopResponse:
      r && decision
        ? {
            decision,
            totalCents: typeof r.total_cents === 'number' && Number.isInteger(r.total_cents) && r.total_cents >= 0 ? r.total_cents : null,
            readyOk: typeof r.ready_ok === 'boolean' ? r.ready_ok : null,
            altTimeText: shopText(r.alt_time_text, 80),
            reference: shopText(r.reference, 40),
            reason: shopText(r.reason, 40),
          }
        : null,
    deferred: d && typeof d === 'object' ? { until: iso(d.until), message: typeof d.message === 'string' ? d.message.slice(0, 300) : '' } : null,
  };
}
