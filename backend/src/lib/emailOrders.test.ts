/** basil-14648 P2: email orders (plans/rsv-p2-email-orders.md §7). Statuses, outcomes, totals and the shop gate. */
import { describe, it, expect } from 'vitest';
import { isBlocking, isCancelable, mayExistAtShop, isTerminal, CANCELABLE_STATUSES } from './pizzaOrderStatus.js';
import { budgetBreakdown } from './pizzaOrdering.js';
import { emailOrderable, emailAlternativeOf, emailOrderProblems, emailViewOf, emailReasonText, channelOf } from './emailOrders.js';
import { confirmedTotalCents } from '../services/pizzaOrderSync.js';

const ALT = { channel: 'email', available: true, min_lead_hours: 24, max_lead_days: 21, min_pizzas: 8, max_pizzas: 40, max_total_cents: 80_000, reasons: [], message: 'ok' };
const shop = (alt: Record<string, unknown> | null = ALT, cap: unknown = true) => ({
  id: 'pzl_osm_n1', name: "Sal's", tier: 'listing', ordering: { channel: 'ai_phone', alternatives: alt ? [alt] : [] }, capabilities: { email_order: cap },
});
const email = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  lastView: { channel: 'email', email: { sent_at: null, reply_by: null, reminder_sent_at: null, shop_response: null, deferred: null }, ...extra },
});
const H = 3600_000;

describe('the shop gate: both of pizza-mcp answers', () => {
  it('needs the capability AND an available alternative with no reasons', () => {
    expect(emailOrderable(shop())).toMatchObject({ max_pizzas: 40, min_lead_hours: 24 });
    expect(emailOrderable(shop(ALT, false))).toBeNull();
    expect(emailOrderable({ ...shop(), capabilities: {} })).toBeNull();
    expect(emailOrderable(shop({ ...ALT, available: false, reasons: ['disabled'] }))).toBeNull();
    // available but a reason (a code rsv does not know): not available
    expect(emailOrderable(shop({ ...ALT, reasons: ['brand_new_reason'] }))).toBeNull();
    expect(emailOrderable(shop(null))).toBeNull();
    expect(emailOrderable({ id: 'x', name: 'y' })).toBeNull();
  });

  it('reads the reasons of an unavailable alternative', () => {
    expect(emailAlternativeOf(shop({ ...ALT, available: false, reasons: ['unverified'] }))).toMatchObject({ available: false, reasons: ['unverified'] });
    expect(emailReasonText('unverified')).toMatch(/verified account/);
    expect(emailReasonText('who_knows', null, 'Some pizza-mcp words.')).toBe('some pizza-mcp words');
    expect(emailReasonText('who_knows')).toMatch(/can't email/);
  });

  it('checks the lead time and the size against the published rules', () => {
    const a = emailOrderable(shop())!;
    const now = Date.now();
    expect(emailOrderProblems(a, { pickupAt: new Date(now + 3 * H) }, now)).toEqual(['lead_time']);
    expect(emailOrderProblems(a, { pickupAt: new Date(now + 25 * H) }, now)).toEqual([]);
    expect(emailOrderProblems(a, { pickupAt: new Date(now + 22 * 24 * H) }, now)).toEqual(['lead_time']);
    expect(emailOrderProblems(a, { pickupAt: null }, now)).toEqual(['lead_time']);
    expect(emailOrderProblems(a, { pizzas: 4 }, now)).toEqual(['too_small']);
    expect(emailOrderProblems(a, { pizzas: 41 }, now)).toEqual(['too_large']);
    expect(emailOrderProblems(a, { pizzas: 40 }, now)).toEqual([]);
  });
});

describe('statuses: sending and awaiting_shop_reply are live, blocking and cancelable', () => {
  it.each(['sending', 'awaiting_shop_reply'])('%s', (status) => {
    const row = email(status);
    expect(CANCELABLE_STATUSES.has(status)).toBe(true);
    expect(isCancelable(row)).toBe(true);
    expect(isTerminal(status)).toBe(false);
    expect(isBlocking(row)).toBe(true);
  });

  it('an unknown non-final status is live (blocking) too', () => {
    expect(isBlocking(email('some_new_live_status'))).toBe(true);
  });

  it('an email price approval can be called off (no shop on the line); a call\'s cannot', () => {
    expect(isCancelable(email('awaiting_price_approval'))).toBe(true);
    expect(isCancelable({ status: 'awaiting_price_approval', lastView: { call: {} } })).toBe(false);
  });

  it('a confirmed email order is cancelable only before its pickup; a confirmed call never', () => {
    const now = Date.now();
    expect(isCancelable({ ...email('confirmed_by_shop'), readyAt: new Date(now + 5 * H) }, now)).toBe(true);
    expect(isCancelable({ ...email('confirmed_by_shop'), readyAt: new Date(now - 60_000) }, now)).toBe(false);
    // unknown pickup: pizza-mcp decides (it refuses after the pickup)
    expect(isCancelable({ ...email('confirmed_by_shop'), readyAt: null }, now)).toBe(true);
    expect(isCancelable({ status: 'confirmed_by_shop', lastView: { call: {} }, readyAt: new Date(now + 5 * H) }, now)).toBe(false);
  });
});

describe('outcomes: only nothing_ordered decides, whatever the reason', () => {
  const ended = (status: string, nothing_ordered: boolean, reason: string) => email(status, { outcome: { nothing_ordered, reason, message: 'm' } });
  it.each([
    ['unreachable', true, 'not_sent'],
    ['refused', true, 'shop_declined'],
    ['refused', true, 'asked_not_to_contact'],
    ['unreachable', false, 'no_response'],
    ['canceled', false, 'canceled'],
    ['unreachable', false, 'send_unconfirmed'],
    ['unreachable', true, 'withdrawn_acknowledged'],
    ['canceled', true, 'withdrawn_acknowledged'],
    // a reason added later reads by the boolean alone
    ['refused', false, 'a_reason_from_the_future'],
  ] as const)('%s / %s / %s', (status, nothing, reason) => {
    const row = ended(status, nothing, reason);
    expect(isBlocking(row)).toBe(!nothing);
    expect(mayExistAtShop(row)).toBe(!nothing);
  });

  it('no_response holds the budget; the acknowledgement (outcome change) frees it', () => {
    const base = { ceilingCents: 30000, confirmedTotalCents: null, createdAt: new Date() };
    const held = { ...ended('unreachable', false, 'no_response'), ...base };
    expect(budgetBreakdown([], [held]).usedCents).toBe(30000);
    const acked = { ...ended('unreachable', true, 'withdrawn_acknowledged'), ...base };
    expect(budgetBreakdown([], [acked]).usedCents).toBe(0);
  });
});

describe('the confirmed total of an email order', () => {
  const view = (status: string, email: Record<string, unknown> | null, total = 0) =>
    ({ id: 'ord_1', status, channel: 'email', totals: { total_cents: total }, email, call: undefined }) as any;
  const resp = (decision: string, total_cents: number | null) => ({
    sent_at: '2026-11-10T10:00:00.000Z', reply_by: null, reminder_sent_at: null, deferred: null,
    shop_response: { decision, total_cents, ready_ok: true, alt_time_text: null, reference: null, reason: null },
  });

  it('comes from email.shop_response.total_cents, else totals.total_cents; never call.shop_total_cents', () => {
    expect(confirmedTotalCents(view('confirmed_by_shop', resp('confirm', 41250), 41250), 'listing')).toBe(41250);
    expect(confirmedTotalCents(view('confirmed_by_shop', resp('confirm', null), 39900), 'listing')).toBe(39900);
    // the over-ceiling total holds while the host decides (like a call's quoted total)
    expect(confirmedTotalCents(view('awaiting_price_approval', resp('confirm', 52000), 52000), 'listing')).toBe(52000);
    // no answer yet: totals is 0, which is not a total
    expect(confirmedTotalCents(view('awaiting_shop_reply', { ...resp('confirm', null), shop_response: null }, 0), 'listing')).toBeNull();
    expect(confirmedTotalCents(view('refused', resp('decline', null)), 'listing')).toBeNull();
  });
});

describe('the email view rsv passes to the browser', () => {
  it('keeps the well-formed parts and cleans the shop\'s words', () => {
    const v = emailViewOf({
      lastView: {
        channel: 'email',
        email: {
          sent_at: '2026-11-10T14:10:00.000Z', reply_by: '2026-11-12T14:10:00.000Z', reminder_sent_at: 'yesterday',
          shop_response: { decision: 'decline', total_cents: null, ready_ok: null, alt_time_text: 'Sun\n6pm\u0000 works', reference: null, reason: 'cant_make_time' },
          deferred: null,
        },
      },
    });
    expect(v).toEqual({
      sentAt: '2026-11-10T14:10:00.000Z', replyBy: '2026-11-12T14:10:00.000Z', reminderSentAt: null,
      shopResponse: { decision: 'decline', totalCents: null, readyOk: null, altTimeText: 'Sun 6pm works', reference: null, reason: 'cant_make_time' },
      deferred: null,
    });
    // bidi overrides, isolates and zero-width characters can't reorder or hide what the host reads
    const evil = emailViewOf({
      lastView: { channel: 'email', email: { shop_response: { decision: 'decline', alt_time_text: 'Sun \u202Eevif\u202C at \u2066six\u2069\u200B pm\u2028ok\uFEFF', reference: 'A\u200D-\u061C17' } } },
    });
    expect(evil!.shopResponse).toMatchObject({ altTimeText: 'Sun evif at six pm ok', reference: 'A-17' });
    expect(emailViewOf({ lastView: { call: {} } })).toBeNull();
    expect(channelOf({ lastView: { channel: 'email' } })).toBe('email');
    expect(channelOf({ lastView: null })).toBe('phone');
  });
});
