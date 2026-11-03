import { describe, it, expect } from 'vitest';
import type { PizzaRecommendation } from '../types';
import { shopBadge, toE164, statusInfo, defaultPickupLocal, isTerminalStatus, toRecommendationPayload, formatCents, orderToResume, PizzaOrderView } from './pizzaOrder';

describe('shopBadge', () => {
  it('maps the ordering channel to the plan badges', () => {
    expect(shopBadge({ tier: 'native', ordering: { channel: 'api', call_countries_ok: true, reasons: [] } })).toMatchObject({ label: 'Orders instantly', orderable: true });
    expect(shopBadge({ tier: 'listing', ordering: { channel: 'ai_phone', call_countries_ok: true, reasons: [] } })).toMatchObject({ label: 'AI calls for you, pay at pickup', orderable: true });
    expect(shopBadge({ tier: 'listing', ordering: { channel: 'handoff', call_countries_ok: false, reasons: [] } })).toMatchObject({ label: 'Call it yourself', orderable: false });
  });
  it('is not orderable when the channel is unknown on a listing', () => {
    expect(shopBadge({ tier: 'listing' }).orderable).toBe(false);
  });
});

describe('toE164', () => {
  it('normalises US numbers and passes through valid E.164', () => {
    expect(toE164('(617) 555-0123')).toBe('+16175550123');
    expect(toE164('1 617 555 0123')).toBe('+16175550123');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
  });
  it('rejects junk', () => {
    expect(toE164('555-0123')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('statusInfo', () => {
  it('uses the shop total and ready time when confirmed', () => {
    const s = statusInfo({ status: 'confirmed_by_shop', shopName: "Sal's", confirmedTotalCents: 18740, readyAtText: 'about 6:30', call: null });
    expect(s.tone).toBe('success');
    expect(s.detail).toContain('$187.40');
    expect(s.detail).toContain('about 6:30');
  });
  it('asks for action on a higher quote', () => {
    expect(statusInfo({ status: 'awaiting_price_approval', shopName: "Sal's", confirmedTotalCents: null, readyAtText: null, call: { shop_total_cents: 24000 } })).toMatchObject({ tone: 'action' });
  });
  const base = { shopName: "Sal's", confirmedTotalCents: null, readyAtText: null, call: null };
  it('a released order says so, whatever its status or outcome', () => {
    const s = statusInfo({ ...base, status: 'needs_review', released: true, outcome: { nothing_ordered: false, reason: 'needs_review', message: 'check' } });
    expect(s.title).toBe("A host released the order at Sal's");
    expect(s.title).not.toMatch(/nothing ordered/i);
    expect(s.detail).toMatch(/A host said/);
  });
  it.each(['needs_review', 'refused', 'unreachable', 'canceled', 'shop_requires_prepay', 'approval_timeout'])('%s never says nothing was ordered, or to order again, unless nothing_ordered is true', (status) => {
    for (const outcome of [undefined, null, { nothing_ordered: false, reason: 'whatever_new', message: 'An order may exist.' }]) {
      const s = statusInfo({ ...base, status, outcome });
      expect(s.title).not.toMatch(/^nothing was ordered/i);
      expect(`${s.title} ${s.detail}`).not.toMatch(/\border (it )?yourself\b|call (the shop|them) yourself|^nothing was ordered|\. nothing was ordered/i);
    }
  });
  it('pizza-mcp 9ad5364: a quarantined number never dialed (not_dialed, nothing_ordered true) reads as nothing ordered', () => {
    const s = statusInfo({ ...base, status: 'unreachable', outcome: { nothing_ordered: true, reason: 'not_dialed', message: 'We did not call the shop: phone ordering is not available for it right now.' } });
    expect(s.title).toBe("Nothing was ordered at Sal's");
    expect(s.detail).toBe('We did not call the shop: phone ordering is not available for it right now.');
  });
  it('pizza-mcp 9ad5364: possible_opt_out on needs_review shows its message and says to check before ordering again', () => {
    const message = "The shop may have said not to call, but we can't tell for sure, so we are not calling it until someone has checked. We don't know whether an order exists at the shop: please check with it before ordering again.";
    const s = statusInfo({ ...base, status: 'needs_review', releasable: true, outcome: { nothing_ordered: false, reason: 'possible_opt_out', message } });
    expect(s.title).toBe("Check with Sal's before ordering again");
    expect(s.detail.startsWith(message)).toBe(true);
    expect(s.detail).toMatch(/release it below/);
  });
  it('an order waiting on approval says what to do if the approval page refuses the call', () => {
    expect(statusInfo({ ...base, status: 'awaiting_approval' }).detail).toMatch(/cancel this order and pick another pizzeria/);
  });
  it('approval_timeout never reads as final, whichever way nothing_ordered points', () => {
    const open = statusInfo({ ...base, status: 'approval_timeout', outcome: { nothing_ordered: true, reason: 'price_approval_timeout', message: 'Nothing is ordered yet; approve to have us call back.' } });
    expect(open.title).toBe('Approval timed out');
    expect(open.detail).toMatch(/Nothing is ordered yet.*Open the approval page/);
    const none = statusInfo({ ...base, status: 'approval_timeout' });
    expect(none.detail).not.toMatch(/told we would call back/);
  });
  it('a calling order stays plain "calling" for ten minutes, then says it is waiting, up to the hour', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    const at = (min: number) => ({ ...base, status: 'calling', timeline: [{ at: new Date(now - 90 * 60_000).toISOString(), status: 'awaiting_approval' }, { at: new Date(now - min * 60_000).toISOString(), status: 'calling' }] });
    expect(statusInfo(at(9), now).title).toBe("Calling Sal's");
    expect(statusInfo(at(9), now).detail).toMatch(/up to an hour/);
    for (const min of [11, 59]) {
      const s = statusInfo(at(min), now);
      expect(s).toMatchObject({ title: "Still waiting on our call to Sal's", tone: 'info' });
      expect(s.detail).toMatch(/do not order again/);
    }
  });
  it('a bad or missing timeline falls back to the plain copy', () => {
    expect(statusInfo({ ...base, status: 'calling', timeline: [{ at: 'soon', status: 'calling' }] }).title).toBe("Calling Sal's");
    expect(statusInfo({ ...base, status: 'calling' }).title).toBe("Calling Sal's");
  });
  it('a deferred dial is never "Calling", however old, and a transient with no message still explains itself', () => {
    const call = { deferred: { until: 'x', reason: 'transient', message: null } };
    const s = statusInfo({ ...base, status: 'calling', call, timeline: [{ at: '2020-01-01T00:00:00Z', status: 'calling' }] });
    expect(s.title).toBe("Our call to Sal's is delayed");
    expect(s.detail).toMatch(/temporary problem/);
    expect(statusInfo({ ...base, status: 'calling', call: { deferred: { reason: 'outside_call_window', message: 'Closed.' } } })).toMatchObject({ title: "Our call to Sal's is scheduled", detail: 'Closed.' });
  });
  it('a real outcome on unreachable still says nothing was ordered; no outcome does not', () => {
    expect(statusInfo({ ...base, status: 'unreachable', outcome: { nothing_ordered: true, reason: 'no_answer', message: 'm' } }).title).toBe("Nothing was ordered at Sal's");
    const none = statusInfo({ ...base, status: 'unreachable' });
    expect(`${none.title} ${none.detail}`).not.toMatch(/nothing was ordered/i);
  });
  it('knows terminal statuses', () => {
    expect(isTerminalStatus('confirmed_by_shop')).toBe(true);
    expect(isTerminalStatus('calling')).toBe(false);
  });
});

describe('orderToResume', () => {
  const row = (over: Partial<PizzaOrderView>) => ({ opopOrderId: 'o', status: 'canceled', isMine: false, ...over }) as PizzaOrderView;
  it('reopens a canceled or unreachable order a host still has to settle, for any host', () => {
    const c = row({ status: 'canceled', releasable: true });
    const u = row({ status: 'unreachable', releasable: true });
    expect(orderToResume([c])).toBe(c);
    expect(orderToResume([u])).toBe(u);
  });
  it('keeps polling the host\'s stuck call and a transient deferral', () => {
    const c = row({ status: 'calling', isMine: true });
    expect(orderToResume([row({ status: 'unreachable', releasable: true }), c])).toBe(c);
  });
  it('does not reopen an order whose receipt is in, or one that is free', () => {
    expect(orderToResume([row({ releasable: true, receiptCovered: true }), row({ status: 'unreachable' }), row({ released: true })])).toBeUndefined();
  });
});

describe('defaultPickupLocal', () => {
  it('is 45 min before a party that is far enough away, else 2h from now', () => {
    const now = new Date('2026-11-01T10:00:00');
    expect(defaultPickupLocal('2026-11-01T18:00:00', now)).toBe('2026-11-01T17:15');
    expect(defaultPickupLocal('2026-11-01T11:00:00', now)).toBe('2026-11-01T12:00');
    expect(defaultPickupLocal(null, now)).toBe('2026-11-01T12:00');
  });
});

describe('toRecommendationPayload', () => {
  it('sends only the facts the backend needs (no guest data)', () => {
    const out = toRecommendationPayload([
      { id: 'r1', quantity: 2, size: { diameter: 16, name: 'Large', servings: 4 }, style: { id: 'ny', name: 'New York', description: '' }, toppings: [{ id: 't', name: 'Pepperoni', type: 'meat' }], guestCount: 3, guests: [{ name: 'Secret Guest' }], dietaryRestrictions: ['vegan'] } as unknown as PizzaRecommendation,
    ]);
    expect(JSON.stringify(out)).not.toContain('Secret Guest');
    expect(out[0]).toMatchObject({ id: 'r1', quantity: 2, toppings: [{ name: 'Pepperoni' }], dietaryRestrictions: ['vegan'] });
  });
  it('formats cents', () => expect(formatCents(1050)).toBe('$10.50'));
});
