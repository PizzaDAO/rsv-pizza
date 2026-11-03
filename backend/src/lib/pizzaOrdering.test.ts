import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));

import { budgetBreakdown, budgetUsedCents, isLaterReceipt } from './pizzaOrdering.js';
import { isBlocking, isCancelable, isSettling, checkingOf, SETTLE_WINDOW_MS } from './pizzaOrderStatus.js';

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
    // pizza-mcp 662d51c: never while the finished call is being checked
    expect(isCancelable({ status: 'calling', lastView: { call: { deferred: { until: 'x' }, checking: { message: 'm' } } } })).toBe(false);
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
