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
  it.each(['needs_review', 'unreachable', 'refused', 'canceled'])('pizza-mcp faf6855: judge_unavailable on %s says an order may exist and a check is pending, without alarm', (status) => {
    const message = 'The shop seems to have answered, but we could not check the call recording automatically. An order may exist at the shop: please check with it before ordering again.';
    const s = statusInfo({ ...base, status, releasable: true, outcome: { nothing_ordered: false, reason: 'judge_unavailable', message } });
    expect(s.title).toBe("Check with Sal's before ordering again");
    expect(s.tone).toBe('warn');
    expect(s.detail.startsWith(message)).toBe(true);
    expect(s.detail).toMatch(/waiting for a person on our team to read it/);
    expect(s.detail).toMatch(/call Sal's to find out whether they took the order/);
    expect(s.detail).toMatch(/release it below/);
    expect(s.detail).not.toMatch(/nothing was ordered\./i);
    expect(`${s.title} ${s.detail}`).not.toMatch(/\bNOT\b|error|failed|problem|went wrong/);
    expect(statusInfo({ ...base, status, releasable: false, outcome: { nothing_ordered: false, reason: 'judge_unavailable', message } }).detail).not.toMatch(/release/);
  });
  it.each(['needs_review', 'unreachable'])('pizza-mcp e62620e: call_check_timeout (nothing_ordered false) on %s says an order may exist and to check with the shop, never that nothing was ordered', (status) => {
    const message = 'We did not call the shop again: our automatic check of the earlier call did not finish in time. The shop may have heard your order on that call, so an order may exist: please check with it before ordering again.';
    const s = statusInfo({ ...base, status, releasable: true, outcome: { nothing_ordered: false, reason: 'call_check_timeout', message } });
    expect(s.title).toBe("Check with Sal's before ordering again");
    expect(s.tone).toBe('warn');
    expect(s.detail.startsWith(message)).toBe(true);
    expect(s.detail).toMatch(/Do NOT order again until you have called Sal's/);
    expect(s.detail).toMatch(/release it below/);
    expect(`${s.title} ${s.detail}`).not.toMatch(/nothing was ordered at|confirmed|paused until someone/i);
    expect(statusInfo({ ...base, status, releasable: false, outcome: { nothing_ordered: false, reason: 'call_check_timeout', message } }).detail).not.toMatch(/release/);
  });
  it('pizza-mcp e62620e: call_check_timeout with nothing_ordered true (every call shows no order) reads as nothing ordered, with its own message', () => {
    const message = 'We did not call the shop again: our automatic check of the earlier call did not finish in time. Nothing was ordered on that call.';
    const s = statusInfo({ ...base, status: 'needs_review', outcome: { nothing_ordered: true, reason: 'call_check_timeout', message } });
    expect(s.title).toBe("Nothing was ordered at Sal's");
    expect(s.detail).toBe(message);
  });
  it('pizza-mcp 4cbebfe: a late check that confirms the order changes only the message (same reason, nothing_ordered false); the host sees the latest message and still no "nothing ordered"', () => {
    const early = 'We did not call the shop again because our automatic check of the earlier call did not finish in time. The shop may have heard your order on that call, so an order may exist: please check with it before ordering again.';
    const late = 'We did not call the shop again because our automatic check of the earlier call did not finish in time. The check has since finished: the shop most likely took your order on that call. Please check with the shop, and pick the order up.';
    const at = (message: string) => statusInfo({ ...base, status: 'needs_review', releasable: true, outcome: { nothing_ordered: false, reason: 'call_check_timeout', message } });
    expect(at(early).detail.startsWith(early)).toBe(true);
    const s = at(late);
    expect(s.title).toBe(at(early).title);
    expect(s.detail.startsWith(late)).toBe(true);
    expect(s.detail).not.toContain(early);
    expect(`${s.title} ${s.detail}`).not.toMatch(/nothing was ordered at|safe to order again/i);
  });
  it('pizza-mcp 4353198: call_check_timeout messages for an unended call or a check that could not tell stay held, with no "nothing ordered"', () => {
    const at = (message: string) => statusInfo({ ...base, status: 'needs_review', releasable: true, outcome: { nothing_ordered: false, reason: 'call_check_timeout', message } });
    for (const message of [
      'We did not call the shop again because we could not confirm in time that the earlier call had ended. Our automatic check of that call did finish, but could not tell whether the shop took your order, so an order may exist: please check with it before ordering again.',
      'We did not call the shop again because we could not confirm in time that the earlier call had ended. Our automatic check found no order in the part of the call we have, but the call may have gone on after it, so an order may exist: please check with the shop before ordering again.',
      'We did not call the shop again because our automatic check of the earlier call did not finish in time. The check has since finished and found no order in the part of the call we have, but we could not confirm that the call had ended, so it may have gone on: please check with the shop before ordering again.',
    ]) {
      const s = at(message);
      expect(s.title).toBe("Check with Sal's before ordering again");
      expect(s.detail.startsWith(message)).toBe(true);
      expect(`${s.title} ${s.detail}`).not.toMatch(/nothing was ordered at|safe to order again/i);
    }
  });
  it('pizza-mcp 5320d6a: AI-ended reasons are false ("not finished checking" / "could not confirm") until the gate: may exist, never "order elsewhere"', () => {
    const cases: Array<[string, string, string]> = [
      ['needs_review', 'cant_fulfill', "The shop said it can't make this order."],
      ['needs_review', 'over_limit', "The shop's total was above the most you can approve."],
      ['unreachable', 'shop_closed', 'The shop said it is closed.'],
      ['unreachable', 'wrong_number', 'The call seemed to reach the wrong number.'],
      ['refused', 'refused_ai', 'The shop said it does not take orders from an AI caller.'],
      ['refused', 'asked_not_to_call', 'The shop asked not to be called again, and we will not call it again.'],
      ['shop_requires_prepay', 'requires_prepay', 'The shop wants payment up front, and we never give card details by phone.'],
      ['canceled', 'host_declined', 'You declined the new total, and we told the shop.'],
      ['needs_review', 'transfer_to_host', 'The call was passed to a person at the shop.'],
    ];
    for (const [status, reason, said] of cases) {
      for (const tail of [
        'We have not finished checking the call to confirm that nothing was ordered, so an order may exist at the shop: please check with it before ordering again.',
        'But our check of the call could not confirm that nothing was ordered, so an order may exist at the shop: please check with it before ordering again.',
      ]) {
        const message = `${said} ${tail}`;
        const s = statusInfo({ ...base, status: status as PizzaOrderView['status'], releasable: true, outcome: { nothing_ordered: false, reason, message } });
        expect(s.title).toBe("Check with Sal's before ordering again");
        expect(s.detail.startsWith(message)).toBe(true);
        expect(s.detail).toMatch(/Do NOT order again/);
        expect(`${s.title} ${s.detail}`).not.toMatch(/nothing was ordered at|safe to order again|order elsewhere|another pizzeria/i);
      }
      // after the gate closes the call: the new message replaces the old one and the host is told nothing was ordered
      const closed = `${said.replace(/\.$/, '')}, so nothing was ordered.`;
      const t = statusInfo({ ...base, status: status as PizzaOrderView['status'], outcome: { nothing_ordered: true, reason, message: closed } });
      expect(t.title).toBe("Nothing was ordered at Sal's");
      expect(t.detail).toBe(closed);
    }
  });
  it('pizza-mcp e62620e: price_approval_timeout is nothing_ordered false: approval_timeout offers the callback and cancel, and never says nothing is ordered', () => {
    const message = 'The shop asked about a higher total and we could not reach you in time. We told the shop we would call back, but it heard the order and may have started it: approve to have us call back, or check with the shop.';
    const s = statusInfo({ ...base, status: 'approval_timeout', outcome: { nothing_ordered: false, reason: 'price_approval_timeout', message } });
    expect(s.title).toBe('Approval timed out');
    expect(s.tone).toBe('warn');
    expect(s.detail.startsWith(message)).toBe(true);
    expect(s.detail).toMatch(/Open the approval page to have us call Sal's back, or cancel to stop the callback/);
    expect(s.detail).toMatch(/does not undo anything the shop may already have/);
    expect(`${s.title} ${s.detail}`).not.toMatch(/nothing (was|is) ordered|release it/i);
  });
  it('pizza-mcp e62620e: canceled after an approval timeout (outcome_unclear, nothing_ordered false) says check with the shop and offers release, never nothing ordered', () => {
    const message = 'An order may exist at the shop.';
    const s = statusInfo({ ...base, status: 'canceled', releasable: true, outcome: { nothing_ordered: false, reason: 'outcome_unclear', message } });
    expect(s.title).toBe("Check with Sal's before ordering again");
    expect(s.detail.startsWith(message)).toBe(true);
    expect(s.detail).toMatch(/release it below/);
    expect(`${s.title} ${s.detail}`).not.toMatch(/nothing was ordered at/i);
  });
  it('a host is never told an order may exist and that nothing was ordered together: every outcome x status', () => {
    const statuses = ['needs_review', 'unreachable', 'canceled', 'refused', 'shop_requires_prepay', 'approval_timeout'];
    const reasons = ['call_check_timeout', 'price_approval_timeout', 'outcome_unclear', 'judge_unavailable', 'pending_operator_review', 'a_new_reason'];
    for (const status of statuses) for (const reason of reasons) for (const no of [true, false]) {
      const message = no ? 'Nothing was ordered.' : 'An order may exist at the shop: check with it.';
      const s = statusInfo({ ...base, status, releasable: !no, outcome: { nothing_ordered: no, reason, message } });
      const text = `${s.title} ${s.detail}`;
      if (no) expect(text).not.toMatch(/may exist|check with|before ordering again/i);
      else expect(text).not.toMatch(/nothing was ordered at|nothing is ordered yet|^Nothing was ordered/i);
    }
  });
  it('pizza-mcp 41b81d7: a call_check_pending deferral reads as waiting to call back, never Calling, Checking or confirmed, even with call.checking set', () => {
    const msg = 'An earlier call to the shop is still being checked; we will call as soon as that check is done.';
    const call = { deferred: { until: '2026-11-01T12:05:00Z', reason: 'call_check_pending', message: msg }, checking: { message: 'The call ended and the result is being checked.' } };
    const long = [{ at: new Date(Date.now() - 50 * 60_000).toISOString(), status: 'calling' }];
    const s = statusInfo({ ...base, status: 'calling', call, timeline: long });
    expect(s.title).toBe("Waiting to call Sal's back");
    expect(s.detail.startsWith(msg)).toBe(true);
    expect(s.detail).toMatch(/30 minutes/);
    expect(s.detail).toMatch(/cancel/);
    expect(s.tone).toBe('info');
    expect(`${s.title} ${s.detail}`).not.toMatch(/Calling Sal|Checking the call|confirmed|Pay at pickup|receipt/i);
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

describe('pizza-mcp 662d51c', () => {
  const base = { shopName: "Sal's", confirmedTotalCents: null, readyAtText: null, call: null };

  it('pizza-mcp 662d51c: calling + call.checking is "being checked", never confirmed, and beats the long-call copy', () => {
    const msg = 'The call ended and the result is being checked.';
    const long = [{ at: new Date(Date.now() - 50 * 60_000).toISOString(), status: 'calling' }];
    const s = statusInfo({ ...base, status: 'calling', call: { checking: { message: msg } }, timeline: long });
    expect(s.title).toBe("Checking the call with Sal's");
    expect(s.detail.startsWith(msg)).toBe(true);
    expect(s.detail).toMatch(/not confirmed until this check is done/);
    expect(s.tone).toBe('info');
    expect(`${s.title} ${s.detail}`).not.toMatch(/confirmed\b(?! until)|Pay at pickup|receipt/i);
    expect(statusInfo({ ...base, status: 'calling', call: { checking: null } }).title).toBe("Calling Sal's");
  });

  it('pizza-mcp 662d51c: outcome pending_operator_review (nothing_ordered true) reads as nothing ordered, with its message', () => {
    const message = 'We did not call the shop: an earlier call to it could not be checked automatically, so calls to it are paused until someone has reviewed that call. Nothing was ordered.';
    const s = statusInfo({ ...base, status: 'unreachable', outcome: { nothing_ordered: true, reason: 'pending_operator_review', message } });
    expect(s).toEqual({ title: "Nothing was ordered at Sal's", detail: message, tone: 'warn' });
    expect(s.detail).not.toMatch(/asked not to|opt/i);
  });

  it('a confirmed phone total says it includes tax (pizza-mcp 662d51c confirms only a total with tax)', () => {
    expect(statusInfo({ ...base, status: 'confirmed_by_shop', confirmedTotalCents: 3765 }).detail).toMatch(/^Total \$37\.65 with tax\./);
  });
});
