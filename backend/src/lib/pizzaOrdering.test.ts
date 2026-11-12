import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));

import { budgetBreakdown, budgetUsedCents, isLaterReceipt, handoffAsBudgetOrder, holderData, HOST_ORDERED } from './pizzaOrdering.js';
import { isBlocking, isCancelable, isSettling, checkingOf, deferredOf, SETTLE_WINDOW_MS } from './pizzaOrderStatus.js';

const ORDERED = new Date('2026-11-01T12:00:00Z');
const before = new Date('2026-11-01T11:00:00Z');
const after = new Date('2026-11-01T20:00:00Z');
const later = (cents: number) => ({ cents, createdAt: after });
const older = (cents: number) => ({ cents, createdAt: before });
const confirmed = (over: Record<string, unknown> = {}) => ({ status: 'confirmed_by_shop', createdAt: ORDERED, ceilingCents: 20000, confirmedTotalCents: 15000, ...over });
const oc = (nothing_ordered: boolean, reason: string) => ({ outcome: { nothing_ordered, reason, message: 'm' } });

describe('isBlocking and outcome.nothing_ordered', () => {
  const timeout = { status: 'approval_timeout', ceilingCents: 15000, confirmedTotalCents: 18000, nextAction: { type: 'open_url', url: 'x' }, lastView: oc(true, 'price_approval_timeout') };

  it('a live approval_timeout blocks and holds budget, whatever the outcome says', () => {
    expect(isBlocking(timeout)).toBe(true);
    expect(budgetUsedCents([], [timeout])).toBe(18000);
  });

  it.each(['needs_review', 'refused', 'unreachable', 'canceled', 'shop_requires_prepay'])('a terminal %s with nothing_ordered true is free', (status) => {
    expect(isBlocking({ status, confirmedTotalCents: 4000, ceilingCents: 5000, lastView: oc(true, 'no_answer') })).toBe(false);
  });

  it.each(['awaiting_approval', 'calling', 'awaiting_price_approval', 'held'])('a live %s is not freed by nothing_ordered true', (status) => {
    expect(isBlocking({ status, nextAction: { type: 'open_url' }, lastView: oc(true, 'not_dialed') })).toBe(true);
  });

  it.each(['needs_review', 'refused', 'unreachable', 'canceled', 'shop_requires_prepay'])('a terminal %s with nothing_ordered false blocks and holds its ceiling, for any reason', (status) => {
    for (const reason of ['outcome_unclear', 'price_approval_dropped', 'possible_opt_out', 'brand_new_reason']) {
      const row = { status, ceilingCents: 5000, lastView: oc(false, reason) };
      expect(isBlocking(row)).toBe(true);
      expect(budgetUsedCents([], [row])).toBe(5000);
    }
  });

  it('an approval_timeout blocks for either nothing_ordered', () => {
    expect(isBlocking({ ...timeout, lastView: oc(false, 'price_approval_dropped') })).toBe(true);
  });

  it('confirmed never turns free, whatever an outcome says', () => {
    expect(isBlocking(confirmed({ lastView: oc(true, 'no_answer') }))).toBe(true);
  });

  it('a later receipt offsets an ended order that may exist; one pizza-mcp is sure about never takes it', () => {
    const canceled = { status: 'canceled', createdAt: ORDERED, ceilingCents: 5000, confirmedTotalCents: 4000, lastView: oc(false, 'outcome_unclear') };
    expect(budgetUsedCents([later(4000)], [canceled])).toBe(4000);
    expect(budgetUsedCents([later(4000)], [{ ...canceled, lastView: oc(true, 'canceled') }])).toBe(4000);
    expect(budgetUsedCents([], [canceled])).toBe(4000);
  });

  it('a release still frees a blocking order', () => {
    expect(isBlocking({ status: 'needs_review', releasedAt: ORDERED, lastView: oc(false, 'needs_review') })).toBe(false);
  });
});

describe('budget: which receipts can count for an order', () => {
  it('an old receipt does not mask an unpaid order', () => {
    expect(budgetUsedCents([older(15000)], [confirmed()])).toBe(30000);
  });

  it('a receipt uploaded after the order matches it, once', () => {
    expect(budgetUsedCents([later(15000)], [confirmed()])).toBe(15000);
    expect(budgetUsedCents([later(15000)], [confirmed(), confirmed()])).toBe(30000);
  });

  it('a receipt from the same instant, or an order with no date, never matches', () => {
    expect(isLaterReceipt({ createdAt: ORDERED }, { createdAt: ORDERED })).toBe(false);
    expect(isLaterReceipt({ createdAt: after }, {})).toBe(false);
  });

  it('accepts ISO strings as well as dates', () => {
    expect(isLaterReceipt({ createdAt: after.toISOString() }, { createdAt: ORDERED.toISOString() })).toBe(true);
  });
});

describe('budget: the unverified "I uploaded the receipt" click', () => {
  const covered = (over: Record<string, unknown> = {}) => confirmed({ receiptCoveredAt: after, ...over });

  it('frees nothing with no receipt, or only an older one', () => {
    expect(budgetUsedCents([], [covered()])).toBe(15000);
    expect(budgetUsedCents([older(15000)], [covered()])).toBe(30000);
  });

  it('can never bring the total below the confirmed order', () => {
    expect(budgetUsedCents([later(100)], [covered()])).toBe(15000);
    expect(budgetUsedCents([later(5000), later(5000)], [covered()])).toBe(15000);
  });

  it('a receipt larger than the order counts at its own amount', () => {
    expect(budgetUsedCents([later(18000)], [covered()])).toBe(18000);
  });

  it('one receipt cannot pay for two orders', () => {
    expect(budgetUsedCents([later(15000)], [covered(), covered()])).toBe(30000);
  });

  it('an exact match keeps its receipt from a covered order that did not match', () => {
    const small = covered({ confirmedTotalCents: 4000 });
    const exact = confirmed({ confirmedTotalCents: 15000 });
    expect(budgetUsedCents([later(15000)], [small, exact])).toBe(15000 + 4000);
  });
});

describe('budget: the shop gave no total', () => {
  const noTotal = (over: Record<string, unknown> = {}) => confirmed({ confirmedTotalCents: null, ...over });

  it('covered: the real receipt replaces the ceiling hold', () => {
    expect(budgetUsedCents([later(15000)], [noTotal({ receiptCoveredAt: after })])).toBe(15000);
  });

  it('covered with no later receipt keeps the ceiling held', () => {
    expect(budgetUsedCents([], [noTotal({ receiptCoveredAt: after })])).toBe(20000);
    expect(budgetUsedCents([older(15000)], [noTotal({ receiptCoveredAt: after })])).toBe(35000);
  });

  it('not covered: nothing to match on, so the hold stands', () => {
    expect(budgetUsedCents([later(15000)], [noTotal()])).toBe(35000);
  });
});

describe('budgetBreakdown', () => {
  it('names what still holds budget and what is covered', () => {
    const a = confirmed({ opopOrderId: 'a' });
    const b = confirmed({ opopOrderId: 'b', confirmedTotalCents: 9000 });
    const { held, covered, usedCents } = budgetBreakdown([later(15000)], [a, b]);
    expect(held).toEqual([b]);
    expect(covered).toEqual([a]);
    expect(usedCents).toBe(24000);
  });
});

describe('isCancelable', () => {
  it('needs a deferred dial for a calling order', () => {
    expect(isCancelable({ status: 'calling', lastView: { call: { deferred: { until: 'x' } } } })).toBe(true);
    expect(isCancelable({ status: 'calling', lastView: { call: { deferred: null } } })).toBe(false);
    expect(isCancelable({ status: 'calling', lastView: { call: {} } })).toBe(false);
    expect(isCancelable({ status: 'calling' })).toBe(false);
    expect(isCancelable({ status: 'confirmed_by_shop', lastView: { call: { deferred: { until: 'x' } } } })).toBe(false);
    // pizza-mcp 662d51c: never while the finished call is being checked and no dial is owed
    expect(isCancelable({ status: 'calling', lastView: { call: { checking: { message: 'm' } } } })).toBe(false);
    // pizza-mcp 41b81d7: a deferral (call_check_pending) beats the check: cancelOrder allows a pending dial, and
    // checking does not hide it
    const both = { status: 'calling', lastView: { call: { deferred: { until: 'x', reason: 'call_check_pending', message: 'm' }, checking: { message: 'c' } } } };
    expect(isCancelable(both)).toBe(true);
    expect(checkingOf(both)).toBeNull();
    expect(deferredOf(both)).toEqual({ reason: 'call_check_pending', message: 'm', until: 'x' });
    expect(deferredOf({ status: 'unreachable', lastView: both.lastView })).toBeNull();
    expect(checkingOf({ status: 'calling', lastView: { call: { checking: { message: 'm' } } } })).toEqual({ message: 'm' });
    expect(checkingOf({ status: 'calling', lastView: { call: { checking: {} } } })).toEqual({ message: 'The call ended and the result is being checked.' });
    expect(checkingOf({ status: 'confirmed_by_shop', lastView: { call: { checking: { message: 'm' } } } })).toBeNull();
    expect(checkingOf({ status: 'calling', lastView: { call: { checking: null } } })).toBeNull();
  });
});

describe('isSettling', () => {
  it('counts from confirmedAt and ends exactly at the window', () => {
    const at = ORDERED.getTime();
    const row = { status: 'confirmed_by_shop', confirmedAt: ORDERED };
    expect(isSettling(row, at + SETTLE_WINDOW_MS - 1)).toBe(true);
    expect(isSettling(row, at + SETTLE_WINDOW_MS)).toBe(false);
    expect(isSettling({ status: 'confirmed_by_shop', confirmedAt: null }, at)).toBe(false);
    expect(isSettling({ status: 'needs_review', confirmedAt: ORDERED }, at)).toBe(false);
  });
});

describe('basil-14648 P2: a marked "Order online" handoff in the budget', () => {
  const handoff = (over: Record<string, unknown> = {}) => ({
    id: 'h1', holdCents: 21000, orderedAt: ORDERED, releasedAt: null, receiptCoveredAt: null, ...over,
  });
  const asOrder = (over: Record<string, unknown> = {}) => handoffAsBudgetOrder(handoff(over) as any)!;

  it('a click alone (no mark) is not a budget order: it holds and blocks nothing', () => {
    expect(handoffAsBudgetOrder(handoff({ orderedAt: null }) as any)).toBeNull();
  });

  it('a mark holds hold_cents and blocks, like a confirmed order with no shop total', () => {
    const o = asOrder();
    expect(o).toMatchObject({ handoffId: 'h1', status: HOST_ORDERED, ceilingCents: 21000, confirmedTotalCents: null });
    expect(isBlocking(o)).toBe(true);
    expect(budgetUsedCents([], [o])).toBe(21000);
  });

  it('a later receipt replaces the hold once the host says it is uploaded', () => {
    expect(budgetUsedCents([later(18000)], [asOrder()])).toBe(18000 + 21000); // not paired yet: counted on top
    const covered = asOrder({ receiptCoveredAt: after });
    const r = budgetBreakdown([later(18000)], [covered]);
    expect(r.usedCents).toBe(18000);
    expect(r.covered).toEqual([covered]);
  });

  it('one later receipt replaces the hold even when it is bigger or smaller (no shop total to match)', () => {
    expect(budgetUsedCents([later(30000)], [asOrder({ receiptCoveredAt: after })])).toBe(30000);
    expect(budgetUsedCents([later(5000)], [asOrder({ receiptCoveredAt: after })])).toBe(5000);
  });

  it('an earlier receipt does not cover it, and an unread receipt (0 cents) offsets nothing', () => {
    expect(budgetUsedCents([older(18000)], [asOrder({ receiptCoveredAt: after })])).toBe(18000 + 21000);
    expect(budgetUsedCents([later(0)], [asOrder({ receiptCoveredAt: after })])).toBe(21000);
  });

  it('release frees it at once', () => {
    expect(handoffAsBudgetOrder(handoff({ releasedAt: after }) as any)).toBeNull();
  });

  it('a mark with no cart holds 0 and still blocks', () => {
    const o = asOrder({ holdCents: 0 });
    expect(isBlocking(o)).toBe(true);
    expect(budgetUsedCents([], [o])).toBe(0);
  });

  it('two holders share receipts: each later receipt covers one of them', () => {
    const ai = confirmed({ receiptCoveredAt: after, confirmedTotalCents: null, ceilingCents: 10000 });
    const h = asOrder({ receiptCoveredAt: after });
    expect(budgetUsedCents([later(9000), later(19000)], [ai, h])).toBe(28000);
  });

  it('holderData names the handoff, never a fake OPOP order id', () => {
    expect(holderData(asOrder())).toEqual({ existingHandoffId: 'h1', existingStatus: HOST_ORDERED });
    expect(holderData({ opopOrderId: 'ord_1', status: 'calling' })).toEqual({ existingOrderId: 'ord_1', existingStatus: 'calling' });
  });
});

describe('basil-14648 P2 review: covered vs receiptMatched', () => {
  const h = (over: Record<string, unknown> = {}) =>
    handoffAsBudgetOrder({ id: 'h1', holdCents: 0, orderedAt: ORDERED, releasedAt: null, receiptCoveredAt: null, ...over } as any)!;

  it('a mark that holds 0 is "covered" (nothing owed) but never receiptMatched', () => {
    const r = budgetBreakdown([], [h()]);
    expect(r.covered).toHaveLength(1);
    expect(r.receiptMatched).toEqual([]);
  });

  it('receiptMatched only when a receipt is actually consumed', () => {
    const o = h({ holdCents: 5000, receiptCoveredAt: after });
    expect(budgetBreakdown([later(4000)], [o]).receiptMatched).toEqual([o]);
    expect(budgetBreakdown([older(4000)], [o]).receiptMatched).toEqual([]);
    const ai = confirmed({ confirmedTotalCents: 15000 });
    expect(budgetBreakdown([later(15000)], [ai]).receiptMatched).toEqual([ai]); // exact total match
  });
});
