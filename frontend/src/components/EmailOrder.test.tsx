/** basil-14648 P2: email orders in the browser (plans/rsv-p2-email-orders.md §7). Copy, gating and the cart step. */
import '../i18n';
import i18n from 'i18next';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopPicker } from './ShopPicker';
import { CartReview } from './CartReview';
import { OrderStatus } from './OrderStatus';
import {
  emailOrderable, emailUnavailableNote, emailPickupProblem, defaultEmailPickupLocal, emailStatusInfo, zonedLocalToIso,
  type CartResponse, type EmailAlternative, type PizzaOrderView, type PizzaShop, type StatusInfo,
} from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ shops: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return { ...actual, getPizzaShops: mocks.shops, getPizzaOrder: mocks.get, cancelPizzaOrder: mocks.cancel };
});

const H = 3600_000;
const ALT: EmailAlternative = { channel: 'email', available: true, min_lead_hours: 24, max_lead_days: 21, min_pizzas: 8, max_pizzas: 40, max_total_cents: 80000, reasons: [], message: 'ok' };
const shop = (over: Partial<PizzaShop> = {}, alt: EmailAlternative | null = ALT, cap = true): PizzaShop => ({
  id: 'pzl_1', name: "Sal's", tier: 'listing', capability_summary: '',
  ordering: { channel: 'ai_phone', call_countries_ok: true, reasons: [], ...(alt ? { alternatives: [alt] } : {}) },
  capabilities: { email_order: cap },
  address: { line1: '1 Main St', city: 'Boston' }, phone: '+16175550101', distance_km: 1, open_now: true, ...over,
});
const t = i18n.getFixedT('en', 'host') as unknown as (k: string, o?: Record<string, unknown>) => string;
const all = (s: StatusInfo | null) => (s ? [s.title, s.detail, ...(s.steps ?? []), s.caution ?? ''].join(' ') : '');

beforeEach(() => {
  mocks.shops.mockReset();
  mocks.get.mockReset();
  mocks.cancel.mockReset();
});

describe('which shops offer "Email the order"', () => {
  it('needs rsv\'s switch, the capability and an available alternative with no reasons', () => {
    expect(emailOrderable(shop(), true)).toBe(ALT);
    expect(emailOrderable(shop(), false)).toBeNull();
    expect(emailOrderable(shop({}, ALT, false), true)).toBeNull();
    expect(emailOrderable(shop({}, { ...ALT, available: false, reasons: ['disabled'] }), true)).toBeNull();
    expect(emailOrderable(shop({}, { ...ALT, reasons: ['some_future_code'] }), true)).toBeNull();
    expect(emailOrderable(shop({}, null), true)).toBeNull();
  });

  it('says why only when it is about the shop, not "not in the pilot"', () => {
    expect(emailUnavailableNote(shop({}, { ...ALT, available: false, reasons: ['not_in_pilot'], message: 'Pilot only.' }), true)).toBeNull();
    expect(emailUnavailableNote(shop({}, { ...ALT, available: false, reasons: ['disabled'] }), true)).toBeNull();
    expect(emailUnavailableNote(shop({}, { ...ALT, available: false, reasons: ['unverified'], message: 'Email orders need a verified account.' }), true)).toBe('email orders need a verified account');
    expect(emailUnavailableNote(shop({}, { ...ALT, available: false, reasons: ['do_not_contact'], message: '' }), true)).toMatch(/can't email/);
    expect(emailUnavailableNote(shop({}, { ...ALT, available: false, reasons: ['unverified'], message: 'x' }), false)).toBeNull();
  });

  it('the shop list shows the option with its lead time and size, and the reason where it is not open', async () => {
    const onEmail = vi.fn();
    mocks.shops.mockResolvedValue({
      pizzerias: [
        shop(),
        shop({ id: 'pzl_2', name: "Luigi's" }, { ...ALT, available: false, reasons: ['do_not_contact'], message: 'This shop asked not to be contacted by Open Pizza.' }),
        shop({ id: 'pzl_3', name: 'Regina' }, { ...ALT, available: false, reasons: ['not_in_pilot'], message: 'Pilot only.' }),
      ],
    });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} emailOrders onEmail={onEmail} />);
    const btn = await screen.findByRole('button', { name: "Email the order to Sal's" });
    expect(btn.className).toMatch(/min-h-\[44px\]/);
    const help = document.getElementById(btn.getAttribute('aria-describedby')!)!;
    expect(help.textContent).toMatch(/Pickup 24 hours to 21 days ahead, 8 to 40 pizzas/);
    expect(screen.getAllByRole('button', { name: /Email the order to/ })).toHaveLength(1);
    expect(screen.getByText('Email order not available: this shop asked not to be contacted by Open Pizza.')).toBeTruthy();
    expect(screen.queryByText(/Pilot only/)).toBeNull();
    await userEvent.click(btn);
    expect(onEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 'pzl_1' }));
  });

  it('rsv\'s switch off: no option and no notes', async () => {
    mocks.shops.mockResolvedValue({ pizzerias: [shop(), shop({ id: 'pzl_2' }, { ...ALT, available: false, reasons: ['unverified'], message: 'x' })] });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} emailOrders={false} onEmail={vi.fn()} />);
    await screen.findAllByText("Sal's");
    expect(screen.queryByText('Email the order')).toBeNull();
    expect(screen.queryByText(/Email order not available/)).toBeNull();
  });
});

describe('the pickup time of an email order', () => {
  it('must be 24 hours to 21 days ahead; the default is the first allowed time (or 45 minutes before a far party)', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(emailPickupProblem(new Date(now + 3 * H).toISOString(), ALT, now)).toBe('too_soon');
    expect(emailPickupProblem(new Date(now + 30 * H).toISOString(), ALT, now)).toBeNull();
    expect(emailPickupProblem(new Date(now + 22 * 24 * H).toISOString(), ALT, now)).toBe('too_late');
    const d = defaultEmailPickupLocal(null, ALT, new Date(now), 'UTC');
    expect(Date.parse(zonedLocalToIso(d, 'UTC')!) - now).toBeGreaterThanOrEqual(25 * H);
    expect(defaultEmailPickupLocal('2026-11-15T19:00:00Z', ALT, new Date(now), 'UTC')).toBe('2026-11-15T18:15');
  });
});

const cart = (qty = 12): CartResponse => ({
  cart: { id: 'cart_1', pizzeria_id: 'pzl_1', version: 1, lines: [{ id: 'l1', item_name: 'Pie', size_name: 'L', quantity: qty, summary: `${qty} large pepperoni` }], ready_for_quote: true },
  quote: { quote_id: 'q1', read_back: '', total_display: '$300.00', totals: { total_cents: 0 }, price_ceiling_cents: 90000, estimate: { low_cents: 25000, expected_cents: 30000, high_cents: 36000, confidence: 'medium' } },
  issues: [], notices: [], dropped: [], recommendationVersion: 'v', capCents: 200000, remainingCapCents: 150000, channel: 'email',
});
const reviewProps = (over: Partial<React.ComponentProps<typeof CartReview>> = {}) => ({
  shop: shop(), cartState: cart(), building: false, error: null, defaultName: 'Sam', partyDate: null, timeZone: 'UTC',
  onBuild: vi.fn(), onDecide: vi.fn(), onApprove: vi.fn(), placing: false, onBack: vi.fn(), channel: 'email' as const, emailAlt: ALT,
  onSwitchChannel: vi.fn(), callable: true, ...over,
});

describe('the cart step of an email order', () => {
  it('explains the email, caps the limit at the email cap, has no party deal, and approves as an email', async () => {
    const onApprove = vi.fn();
    render(<CartReview {...reviewProps({ onApprove })} />);
    expect(screen.getByText(/We'll email Sal's this order\. Nothing is ordered until they confirm their total with tax/)).toBeTruthy();
    expect(screen.getByText(/pickup 24 hours to 21 days from now, 8 to 40 pizzas, up to \$800\.00/)).toBeTruthy();
    expect(screen.getByText(/Never shown to Sal's\. Up to \$800\.00/)).toBeTruthy();
    expect(screen.queryByText('Allow a party deal')).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Your mobile number/), '(617) 555-0123');
    await userEvent.click(screen.getByRole('button', { name: "Approve the email to Sal's" }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ ceilingCents: 80000, substitution: 'exact' }));
    expect(screen.getByText(/We don't email Sal's until you do/)).toBeTruthy();
  });

  it('a pickup inside the lead time is an inline error; Build waits for a valid time', async () => {
    const onBuild = vi.fn();
    render(<CartReview {...reviewProps({ cartState: null, onBuild })} />);
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // the default already fits the rules
    expect(screen.queryByRole('alert')).toBeNull();
    const soon = new Date(Date.now() + 2 * H).toISOString().slice(0, 16);
    await userEvent.clear(input);
    await userEvent.type(input, soon);
    expect((await screen.findByRole('alert')).textContent).toBe('Pick a pickup time at least 24 hours from now.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const build = screen.getByRole('button', { name: /Build order/ }) as HTMLButtonElement;
    expect(build.disabled).toBe(true);
  });

  it('too few pizzas for an email: says so and points to the call', () => {
    render(<CartReview {...reviewProps({ cartState: cart(4) })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Email orders are for 8 pizzas or more\. This order has 4: have our AI call instead\./);
    expect((screen.getByRole('button', { name: "Approve the email to Sal's" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches between the call and the email', async () => {
    const onSwitchChannel = vi.fn();
    const { rerender } = render(<CartReview {...reviewProps({ onSwitchChannel })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Have our AI call instead' }));
    expect(onSwitchChannel).toHaveBeenCalledWith('ai_phone');
    rerender(<CartReview {...reviewProps({ onSwitchChannel, channel: 'ai_phone', cartState: { ...cart(), channel: 'ai_phone' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Email the order instead' }));
    expect(onSwitchChannel).toHaveBeenLastCalledWith('email');
    // no email option when the shop can't get one
    rerender(<CartReview {...reviewProps({ onSwitchChannel, channel: 'ai_phone', emailAlt: null })} />);
    expect(screen.queryByRole('button', { name: 'Email the order instead' })).toBeNull();
  });
});

const order = (over: Partial<PizzaOrderView> = {}): PizzaOrderView => ({
  id: '1', opopOrderId: 'ord_1', tier: 'listing', shopId: 'pzl_1', shopName: "Sal's", status: 'awaiting_shop_reply', paymentStatus: null,
  ceilingCents: 40000, confirmedTotalCents: null, readyAtText: null, readyAt: '2026-11-22T23:30:00.000Z', summary: null, payoutDocumentId: null,
  call: null, nextAction: null, isMine: true, channel: 'email',
  email: { sentAt: '2026-11-18T19:10:00.000Z', replyBy: '2026-11-20T19:10:00.000Z', reminderSentAt: null, shopResponse: null, deferred: null },
  ...over,
});
const tz = { timeZone: 'America/New_York' };
const ORDERED = /\b(ordered|placed)\b/i;

describe('truthful copy for every email state', () => {
  it('approval, sending and scheduled say nothing is sent or ordered yet', () => {
    const a = emailStatusInfo(order({ status: 'awaiting_approval', email: null }), t, Date.now(), tz)!;
    expect(a.title).toBe("Approve the email to Sal's");
    expect(a.detail).toMatch(/We don't email Sal's until you do/);
    expect(emailStatusInfo(order({ status: 'awaiting_approval', isMine: false }), t)!.title).toBe("Waiting for approval of the email to Sal's");
    expect(all(emailStatusInfo(order({ status: 'sending', email: { ...order().email!, sentAt: null } }), t))).toMatch(/Nothing is ordered until they confirm/);
    const sched = emailStatusInfo(order({ status: 'sending', email: { ...order().email!, sentAt: null, deferred: { until: '2026-11-19T13:00:00.000Z', message: 'm' } } }), t, Date.now(), tz)!;
    expect(sched.title).toBe("The email to Sal's is scheduled");
    expect(sched.detail).toMatch(/It goes out Thu, Nov 19, 8:00 AM EST/);
  });

  it('waiting for the reply: when we emailed, the reply-by time, the reminder, and no "ordered"', () => {
    const w = emailStatusInfo(order(), t, Date.now(), tz)!;
    expect(w.title).toBe("Waiting for Sal's to confirm");
    expect(w.detail).toBe("We emailed Sal's the order Wed, Nov 18, 2:10 PM EST. They have until Fri, Nov 20, 2:10 PM EST to confirm their total. Nothing is ordered until they do; we'll email you when they answer.");
    const r = emailStatusInfo(order({ email: { ...order().email!, reminderSentAt: '2026-11-19T19:10:00.000Z' } }), t, Date.now(), tz)!;
    expect(r.detail).toMatch(/We sent them a reminder Thu, Nov 19, 2:10 PM EST\./);
    expect(w.title.replace("Sal's", '')).not.toMatch(ORDERED);
  });

  it('price approval: the shop\'s total, the limit, the one-tap link and the deadline', () => {
    const p = emailStatusInfo(order({ status: 'awaiting_price_approval', confirmedTotalCents: 45000, nextAction: { type: 'open_url', url: 'https://x/confirm/c', expires_at: '2026-11-21T19:10:00.000Z' } }), t, Date.now(), tz)!;
    expect(p.title).toBe("Sal's says $450.00 with tax");
    expect(p.detail).toMatch(/over your \$400\.00 limit\. Approve or decline with the one-tap link in the email we sent you\. Sal's won't start the order until you approve\./);
    expect(p.detail).toMatch(/Answer by Sat, Nov 21, 2:10 PM EST/);
    expect(p.tone).toBe('action');
  });

  it('confirmed: the total, the ready time and the shop\'s order number', () => {
    const c = emailStatusInfo(order({
      status: 'confirmed_by_shop', confirmedTotalCents: 41250,
      email: { ...order().email!, shopResponse: { decision: 'confirm', totalCents: 41250, readyOk: true, altTimeText: null, reference: 'A-17', reason: null } },
    }), t, Date.now(), tz)!;
    expect(c.title).toBe("Sal's confirmed");
    expect(c.detail).toMatch(/^Total \$412\.50 with tax\. Ready Sun, Nov 22, 6:30 PM EST\. Their order number: A-17\. Pay at pickup/);
    expect(c.tone).toBe('success');
  });

  it('declined: nothing ordered, pizza-mcp\'s words, and the shop\'s other time as data', () => {
    const d = emailStatusInfo(order({
      status: 'refused', outcome: { nothing_ordered: true, reason: 'shop_declined', message: "The shop said it can't take this order, so nothing was ordered." },
      email: { ...order().email!, shopResponse: { decision: 'decline', totalCents: null, readyOk: null, altTimeText: 'Sunday at 6', reference: null, reason: 'cant_make_time' } },
    }), t)!;
    expect(d.title).toBe("Sal's declined the order");
    expect(d.detail).toMatch(/They suggested instead: “Sunday at 6”/);
    expect(d.steps).toBeUndefined();
  });

  it('no reply, and withdrawn: may exist, check with the shop (by the boolean, whatever the reason)', () => {
    const msg = 'The shop never confirmed the order. We told it the order is withdrawn, but it has not acknowledged that yet, so an order may exist: check with the shop before ordering elsewhere.';
    const n = emailStatusInfo(order({ status: 'unreachable', releasable: true, outcome: { nothing_ordered: false, reason: 'no_response', message: msg } }), t, Date.now(), tz)!;
    expect(n.title).toBe("Sal's never confirmed");
    expect(n.detail).toBe(msg);
    expect(n.steps![0]).toBe("Call Sal's and ask whether they have the order we emailed them for pickup Sun, Nov 22, 6:30 PM EST.");
    expect(n.steps![2]).toMatch(/release it below/);
    expect(n.callShop).toBe(true);
    const w = emailStatusInfo(order({ status: 'canceled', outcome: { nothing_ordered: false, reason: 'some_new_reason', message: 'm' } }), t)!;
    expect(w.title).toBe("Canceled: Sal's may still have the order");
    // the shop acknowledged: the same order now says nothing was ordered
    const ack = emailStatusInfo(order({ status: 'unreachable', outcome: { nothing_ordered: true, reason: 'withdrawn_acknowledged', message: 'The shop confirmed it got our message that the order is off, so nothing was ordered.' } }), t)!;
    expect(ack.title).toBe("Nothing was ordered at Sal's");
    // an ended email order with no outcome is treated as "may exist"
    expect(emailStatusInfo(order({ status: 'unreachable', outcome: null }), t)!.detail).toMatch(/can't tell whether Sal's has this order/);
  });

  it('a phone order is not an email order', () => {
    expect(emailStatusInfo(order({ channel: 'phone' }), t)).toBeNull();
    expect(emailStatusInfo(order({ channel: undefined }), t)).toBeNull();
  });
});

describe('the email order card', () => {
  it('announces the state in a live region, with a clock (not a spinner) while the shop has days to reply', () => {
    render(<OrderStatus partyId="p" order={order({ cancelable: true })} orderScript="" timeZone="America/New_York" onUpdate={vi.fn()} onDone={vi.fn()} />);
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toMatch(/Waiting for Sal's to confirm/);
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('withdrawing after the email went out says the shop is told and the budget holds until it acknowledges', async () => {
    const canceled = order({ status: 'canceled', outcome: { nothing_ordered: false, reason: 'canceled', message: 'You canceled after we emailed the shop.' } });
    mocks.cancel.mockResolvedValue({ order: canceled });
    const onUpdate = vi.fn();
    render(<OrderStatus partyId="p" order={order({ cancelable: true })} orderScript="" onUpdate={onUpdate} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw the order' }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Withdraw the order from Sal's\? We email them that it's withdrawn\./);
    await userEvent.click(screen.getByText('Yes, cancel it'));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(canceled));
  });

  it('a confirmed email order can be canceled before pickup, with the shop told', async () => {
    render(<OrderStatus partyId="p" order={order({ status: 'confirmed_by_shop', cancelable: true, confirmedTotalCents: 30000 })} orderScript="" onUpdate={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: "Cancel the order with Sal's" }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Cancel the confirmed order at Sal's\? We email them the cancellation\./);
  });
});
