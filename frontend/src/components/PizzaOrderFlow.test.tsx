import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PizzaOrderFlow } from './PizzaOrderFlow';
import type { PizzaOrderView, PizzaShop } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ config: vi.fn(), orders: vi.fn(), order: vi.fn(), build: vi.fn(), place: vi.fn(), handoffs: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return {
    ...actual,
    getPizzaOrderConfig: mocks.config,
    getPizzaOrders: mocks.orders,
    getPizzaOrder: mocks.order,
    buildPizzaCart: mocks.build,
    placePizzaOrder: mocks.place,
    getPizzaHandoffs: mocks.handoffs,
  };
});
vi.mock('../contexts/PizzaContext', () => ({
  usePizza: () => ({ party: { id: 'p1', hostName: 'Sam', date: null }, recommendations: [] }),
}));
const shop = { id: 'pzl_1', name: "Sal's", tier: 'listing' } as PizzaShop;
vi.mock('./ShopPicker', () => ({
  ShopPicker: ({ onSelect, uncallable }: { onSelect: (s: PizzaShop) => void; uncallable?: ReadonlySet<string> }) => (
    <div>
      <button onClick={() => onSelect(shop)}>Pick Sal's</button>
      {uncallable?.has(shop.id) && <span>Sal's marked call-it-yourself</span>}
    </div>
  ),
}));
vi.mock('./CartReview', () => ({
  CartReview: ({ onBuild, onApprove, error, approveError, approveNotice }: { onBuild: (iso: string) => void; onApprove: (i: unknown) => void; error: string | null; approveError?: string | null; approveNotice?: React.ReactNode }) => (
    <div>
      <button onClick={() => onBuild('2026-11-01T18:00:00Z')}>Build</button>
      <button onClick={() => onApprove({ substitution: 'exact', contact: { name: 'S', phone: '+16175550123' } })}>Approve</button>
      {error && <p>{error}</p>}
      {approveError && <p data-testid="approve-error">{approveError}</p>}
      {approveNotice}
    </div>
  ),
}));

const row = (over: Partial<PizzaOrderView> = {}): PizzaOrderView => ({
  id: '1', opopOrderId: 'ord_1', tier: 'listing', shopId: 'pzl_1', shopName: "Sal's", status: 'canceled', paymentStatus: null,
  ceilingCents: 5000, confirmedTotalCents: null, readyAtText: null, summary: null, payoutDocumentId: null, call: null,
  nextAction: null, isMine: true, ...over,
});
const cfg = (over: Record<string, unknown> = {}) => ({ enabled: true, capCents: 25000, remainingCapCents: 25000, blockedReason: null, location: null, ...over });
const flow = () => render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
const capError = (over: Record<string, unknown> = {}) =>
  Object.assign(new Error('There is no reimbursement budget left'), { code: 'CAP_EXHAUSTED', data: { existingOrderId: 'ord_held', existingStatus: 'needs_review', ...over } });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.config.mockResolvedValue(cfg());
  mocks.orders.mockResolvedValue({ orders: [] });
  mocks.handoffs.mockResolvedValue({ handoffs: [] });
});

describe('PizzaOrderFlow: stays inert', () => {
  it('a party not in the pilot sees only the fallback and loads no orders', async () => {
    mocks.config.mockResolvedValue({ enabled: false, capCents: null, remainingCapCents: null, blockedReason: null, location: null });
    flow();
    expect(await screen.findByText('fallback')).toBeTruthy();
    expect(screen.queryByText('AI Ordering')).toBeNull();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});

describe('PizzaOrderFlow: resume after a reload', () => {
  it('reopens a releasable order, days later', async () => {
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'needs_review', releasable: true })] });
    flow();
    expect(await screen.findByText('I checked: nothing was ordered, release it')).toBeTruthy();
  });

  it('reopens a confirmed order with no receipt yet', async () => {
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'confirmed_by_shop' })] });
    flow();
    expect(await screen.findByText('I uploaded the receipt')).toBeTruthy();
  });

  it('reopens them for a co-host too', async () => {
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'unreachable', releasable: true, isMine: false })] });
    flow();
    expect(await screen.findByText('I checked: nothing was ordered, release it')).toBeTruthy();
    expect(screen.getByText('Placed by another host of this party.')).toBeTruthy();
  });

  it("does not reopen another host's live order, a covered confirmed order or a released one", async () => {
    mocks.orders.mockResolvedValue({
      orders: [
        row({ status: 'calling', isMine: false }),
        row({ status: 'confirmed_by_shop', receiptCovered: true }),
        row({ status: 'needs_review', released: true }),
      ],
    });
    flow();
    expect(await screen.findByText("Pick Sal's")).toBeTruthy();
  });

  it("prefers the host's own live order", async () => {
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'needs_review', releasable: true }), row({ status: 'calling', shopName: 'Luigi' })] });
    flow();
    expect(await screen.findByText('Calling Luigi')).toBeTruthy();
  });
});

describe('PizzaOrderFlow: reaching the existing order', () => {
  const toCart = async () => {
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    return screen.findByText('Build');
  };

  it('ORDER_IN_PROGRESS: View it opens exactly the order the server named', async () => {
    mocks.place.mockRejectedValue(Object.assign(new Error('busy'), { code: 'ORDER_IN_PROGRESS', data: { existingOrderId: 'ord_named' } }));
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    vi.spyOn(window, 'open').mockReturnValue(null);
    mocks.order.mockResolvedValue({ order: row({ opopOrderId: 'ord_named', status: 'confirmed_by_shop', shopName: 'Named' }), stale: false });
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText('Place a second order anyway')).toBeTruthy();
    await userEvent.click(screen.getByText('View that order'));
    expect(mocks.order).toHaveBeenCalledWith('p1', 'ord_named');
    expect(await screen.findByText('Named confirmed')).toBeTruthy();
  });

  it('ORDER_IN_PROGRESS on an ended order says it may exist, not that it is in progress', async () => {
    mocks.place.mockRejectedValue(Object.assign(new Error('busy'), { code: 'ORDER_IN_PROGRESS', data: { existingOrderId: 'ord_named', existingStatus: 'canceled' } }));
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText(/may exist at the shop/)).toBeTruthy();
    expect(screen.queryByText(/in progress or confirmed/)).toBeNull();
  });

  it('CAP_EXHAUSTED on building a cart leads to the held order, with no second-order offer', async () => {
    mocks.build.mockRejectedValue(capError());
    mocks.order.mockResolvedValue({ order: row({ opopOrderId: 'ord_held', status: 'needs_review', releasable: true }), stale: false });
    await userEvent.click(await toCart());
    expect(await screen.findByText(/holding the rest of this party's budget/)).toBeTruthy();
    expect(screen.queryByText('Place a second order anyway')).toBeNull();
    await userEvent.click(screen.getByText('View that order'));
    expect(mocks.order).toHaveBeenCalledWith('p1', 'ord_held');
    expect(await screen.findByText('I checked: nothing was ordered, release it')).toBeTruthy();
  });

  it('CAP_EXHAUSTED on placing leads to the held order as well', async () => {
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    mocks.place.mockRejectedValue(capError());
    vi.spyOn(window, 'open').mockReturnValue(null);
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText('View that order')).toBeTruthy();
  });

  it('CAP_EXHAUSTED with no order behind it stays a plain error', async () => {
    mocks.build.mockRejectedValue(Object.assign(new Error('No budget left'), { code: 'CAP_EXHAUSTED' }));
    await userEvent.click(await toCart());
    expect(await screen.findByText('No budget left')).toBeTruthy();
    expect(screen.queryByText('View that order')).toBeNull();
  });

  it('a budget already spent on load links to the held order, even one the list would not reopen', async () => {
    mocks.config.mockResolvedValue(cfg({ remainingCapCents: null, blockedReason: 'CAP_EXHAUSTED', heldOrderId: 'ord_held' }));
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'calling', isMine: false, opopOrderId: 'ord_held' })] });
    mocks.order.mockResolvedValue({ order: row({ status: 'calling', isMine: false, shopName: 'Held' }), stale: false });
    flow();
    await userEvent.click(await screen.findByText('Open that order'));
    expect(mocks.order).toHaveBeenCalledWith('p1', 'ord_held');
    expect(await screen.findByText('Calling Held')).toBeTruthy();
  });

  it('after releasing the held order, leaving it refreshes the budget notice', async () => {
    mocks.config.mockResolvedValueOnce(cfg({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: 'ord_1' }));
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'needs_review', released: true, releasable: true, blocking: false })] });
    flow();
    await userEvent.click(await screen.findByText('Order from another pizzeria'));
    expect(await screen.findByText("Pick Sal's")).toBeTruthy();
    expect(mocks.config).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(screen.queryByText(/reimbursement budget is used up/)).toBeNull());
  });

  it('CALLS_NOT_AVAILABLE_HERE (possible opt-out) on placing: back to the shop list with the reason, shop marked, nothing pending', async () => {
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    const msg = "We can't call Sal's right now: the shop may have asked not to be called, so calls to it are paused until someone has checked. Nothing was ordered. Pick another pizzeria, or call Sal's yourself.";
    mocks.place.mockRejectedValue(Object.assign(new Error(msg), { code: 'CALLS_NOT_AVAILABLE_HERE', data: { opop: { details: { reasons: ['possible_opt_out'] } }, shopId: 'pzl_1' } }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    // UX audit P1-18: a neutral notice above the list (a status, not a red error)
    expect((await screen.findByText(msg)).closest('[role=status]')).toBeTruthy();
    expect(screen.getByText("Pick Sal's")).toBeTruthy();
    expect(screen.getByText("Sal's marked call-it-yourself")).toBeTruthy();
    // UX audit P1-3: no tab is opened (and none flashes) when placing fails
    expect(open).not.toHaveBeenCalled();
    // no stuck state: no second-order prompt, no order view
    expect(screen.queryByText('Place a second order anyway')).toBeNull();
    expect(screen.queryByText('Build')).toBeNull();
  });

  it('pizza-mcp 1c7113d QUOTE_EXPIRED: the new quote replaces the old one, the reason sits by Approve, and approving again places it', async () => {
    mocks.build.mockResolvedValue({ cart: { id: 'c1', fulfillment: { scheduled_for: '2026-11-01T18:00:00Z' } }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    const msg = "The order changed after it was priced, so nothing was ordered and Sal's wasn't called. We priced it again: check the new estimate and approve again.";
    mocks.place
      .mockRejectedValueOnce(Object.assign(new Error(msg), { code: 'QUOTE_EXPIRED', data: { cart: { id: 'c1' }, quote: { quote_id: 'q2' } } }))
      .mockResolvedValueOnce({ order: row({ status: 'awaiting_approval', opopOrderId: 'ord_new' }), next_action: null });
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    expect((await screen.findByTestId('approve-error')).textContent).toBe(msg);
    expect(mocks.build).toHaveBeenCalledTimes(1); // no rebuild needed
    await userEvent.click(screen.getByText('Approve'));
    expect(mocks.place).toHaveBeenCalledTimes(2);
    expect(mocks.place.mock.calls[1][1]).toMatchObject({ quoteId: 'q2', cartId: 'c1' });
    expect(await screen.findByText("Approve the call to Sal's")).toBeTruthy();
  });

  it('pizza-mcp 1c7113d MENU_GONE: the cart is rebuilt from the recommendations at the same pickup time, and the host is told why', async () => {
    mocks.build.mockResolvedValue({ cart: { id: 'c1', fulfillment: { scheduled_for: '2026-11-01T18:00:00Z' } }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    const msg = "The menu at Sal's changed since this order was built, so nothing was ordered and the shop wasn't called. We're rebuilding the order on the current menu: check it and approve again.";
    mocks.place.mockRejectedValueOnce(Object.assign(new Error(msg), { code: 'MENU_GONE', data: { rebuild: true } }));
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText(msg)).toBeTruthy();
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.build.mock.calls[1][3]).toBe('2026-11-01T18:00:00Z');
    expect(screen.getByText('Approve')).toBeTruthy(); // still on the cart, not stuck
  });

  it('a failed lookup says so wherever the host is', async () => {
    mocks.config.mockResolvedValue(cfg({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: 'ord_held' }));
    mocks.order.mockRejectedValue(new Error('down'));
    flow();
    await userEvent.click(await screen.findByText('Open that order'));
    expect(await screen.findByText("Couldn't load the existing order.")).toBeTruthy();
  });
});

describe('PizzaOrderFlow: UX audit (basil-14648)', () => {
  const toApprove = async () => {
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    await userEvent.click(await screen.findByText('Build'));
  };

  it('P1-3: the approval tab opens only after the order exists; a blocked popup is explained', async () => {
    const placed = row({ status: 'awaiting_approval', nextAction: { type: 'open_url', url: 'https://mcp.example/confirm/c1' } });
    mocks.place.mockResolvedValue({ order: placed, next_action: placed.nextAction });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await toApprove();
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Approve'));
    expect(open).toHaveBeenCalledWith('https://mcp.example/confirm/c1', '_blank');
    expect(await screen.findByText(/Your browser blocked the new tab/)).toBeTruthy();
    expect(screen.getByText('Open the approval page').closest('a')?.getAttribute('href')).toBe('https://mcp.example/confirm/c1');
  });

  it('P1-3: a place error is shown next to Approve, as an alert', async () => {
    mocks.place.mockRejectedValue(Object.assign(new Error('That ceiling is over the budget.'), { code: 'SPEND_LIMIT_EXCEEDED' }));
    await toApprove();
    await userEvent.click(screen.getByText('Approve'));
    expect((await screen.findByTestId('approve-error')).textContent).toBe('That ceiling is over the budget.');
  });

  it('P1-4: "View that order" is the main action; a second order needs a confirm that names both shops', async () => {
    mocks.place.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'ORDER_IN_PROGRESS', data: { existingOrderId: 'ord_0', existingStatus: 'needs_review' } }));
    mocks.order.mockResolvedValue({ order: row({ opopOrderId: 'ord_0', status: 'needs_review', shopName: 'Luigi' }), stale: false });
    await toApprove();
    await userEvent.click(screen.getByText('Approve'));
    expect((await screen.findByText('View that order')).className).toMatch(/btn-primary/);
    await userEvent.click(screen.getByText('Place a second order anyway'));
    expect(mocks.place).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/Place a second order at Sal's\? If Luigi already has your first order, you'll get \(and pay for\) both\./);
    mocks.place.mockResolvedValue({ order: row({ status: 'awaiting_approval' }), next_action: null });
    await userEvent.click(screen.getByText('Yes, place a second order'));
    expect(mocks.place).toHaveBeenCalledTimes(2);
    expect(mocks.place.mock.calls[1][1]).toMatchObject({ allowAnother: true });
  });

  it('P1-4: no second order while the first is still being approved or called', async () => {
    mocks.place.mockRejectedValue(Object.assign(new Error('busy'), { code: 'ORDER_IN_PROGRESS', data: { existingOrderId: 'ord_0', existingStatus: 'calling' } }));
    mocks.order.mockResolvedValue({ order: row({ opopOrderId: 'ord_0', status: 'calling' }), stale: false });
    await toApprove();
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText('View that order')).toBeTruthy();
    expect(screen.queryByText('Place a second order anyway')).toBeNull();
  });

  it('P1-5: inside the pre-gated modal, loading shows a spinner and a load error offers a retry (never "not available")', async () => {
    let fail = true;
    mocks.config.mockImplementation(() => (fail ? Promise.reject(new Error('502')) : Promise.resolve(cfg())));
    render(<PizzaOrderFlow gated fallback={<p>fallback</p>} />);
    expect(screen.getByText('Loading ordering…')).toBeTruthy();
    expect(await screen.findByText("Couldn't load ordering.")).toBeTruthy();
    expect(screen.queryByText('fallback')).toBeNull();
    fail = false;
    await userEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText("Pick Sal's")).toBeTruthy();
  });

  it('P1-6: a blocked party sees why above the list', async () => {
    mocks.config.mockResolvedValue(cfg({ blockedReason: 'NO_REIMBURSEMENT_CAP' }));
    flow();
    expect(await screen.findByText("You can't order here yet: this party has no reimbursement cap. Ask your underboss to set one.")).toBeTruthy();
  });
});

describe('PizzaOrderFlow: "Order online" handoff (basil-14648 P2)', () => {
  const mark = {
    id: 'h1', shopId: 'pzl_9', shopName: 'Regina', provider: 'toast', cartId: null, holdCents: 18000, clickedAt: null,
    orderedAt: '2026-11-09T12:00:00Z', releasedAt: null, marked: true, blocking: true, receiptCovered: false, isMine: true,
  };

  it('resumes a marked online order with no receipt yet, in its own words', async () => {
    mocks.handoffs.mockResolvedValue({ handoffs: [mark] });
    flow();
    expect(await screen.findByText('You said you ordered online at Toast')).toBeTruthy();
    expect(screen.getByText(/\$180\.00 USD of your reimbursement budget is held/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I uploaded the receipt' })).toBeTruthy();
  });

  it('an AI order in progress is resumed first; a covered mark is not resumed', async () => {
    mocks.handoffs.mockResolvedValue({ handoffs: [{ ...mark, receiptCovered: true }] });
    flow();
    expect(await screen.findByText("Pick Sal's")).toBeTruthy();
    expect(screen.queryByText(/You said you ordered/)).toBeNull();
  });

  it('ORDER_IN_PROGRESS naming a handoff: View it opens that mark, not an OPOP order', async () => {
    mocks.place.mockRejectedValue(Object.assign(new Error('busy'), { code: 'ORDER_IN_PROGRESS', data: { existingHandoffId: 'h1', existingStatus: 'host_ordered' } }));
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    vi.spyOn(window, 'open').mockReturnValue(null);
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await userEvent.click(screen.getByText('Approve'));
    mocks.handoffs.mockResolvedValue({ handoffs: [mark] });
    await userEvent.click(await screen.findByText('View that order'));
    expect(mocks.order).not.toHaveBeenCalled();
    expect(await screen.findByText('You said you ordered online at Toast')).toBeTruthy();
  });

  it('a budget held by a mark says so and opens it', async () => {
    mocks.config.mockResolvedValue(cfg({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: null, heldHandoffId: 'h1', heldHandoff: { id: 'h1', shopName: 'Regina', provider: 'toast', isMine: true } }));
    flow();
    expect(await screen.findByText('Your reimbursement budget is held by the order you said you placed online at Toast.')).toBeTruthy();
    mocks.handoffs.mockResolvedValue({ handoffs: [mark] });
    await userEvent.click(screen.getByRole('button', { name: 'Open that order' }));
    expect(await screen.findByText('You said you ordered online at Toast')).toBeTruthy();
  });
});

describe('PizzaOrderFlow: honest copy for a budget held by a mark', () => {
  it.each([
    [{ provider: 'phone', isMine: true }, 'Your reimbursement budget is held by the order you said you placed with Regina by phone.'],
    [{ provider: 'in_person', isMine: true }, 'Your reimbursement budget is held by the order you said you placed at Regina in person.'],
    [{ provider: 'toast', isMine: false }, 'Your reimbursement budget is held by an order another host said they placed with Regina.'],
  ])('%o', async (h, copy) => {
    mocks.config.mockResolvedValue(cfg({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: null, heldHandoffId: 'h1', heldHandoff: { id: 'h1', shopName: 'Regina', ...h } }));
    flow();
    expect(await screen.findByText(copy)).toBeTruthy();
  });

  it('the second-order confirm names the shop of a handoff blocker', async () => {
    mocks.place.mockRejectedValue(Object.assign(new Error('busy'), { code: 'ORDER_IN_PROGRESS', data: { existingHandoffId: 'h1', existingStatus: 'host_ordered', existingShopName: 'Regina' } }));
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    vi.spyOn(window, 'open').mockReturnValue(null);
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await userEvent.click(screen.getByText('Approve'));
    await userEvent.click(await screen.findByText('Place a second order anyway'));
    expect(screen.getByText(/If Regina already has your first order/)).toBeTruthy();
  });
});

describe('PizzaOrderFlow: second review', () => {
  const base = {
    id: 'h9', shopId: 'pzl_9', shopName: 'Regina', provider: 'phone', cartId: null, holdCents: 0, clickedAt: null,
    orderedAt: '2026-11-09T12:00:00Z', marked: true, blocking: true, receiptCovered: false,
  };

  it('a 0-hold mark with no receipt is resumed, with the no-cap copy from GET /handoffs', async () => {
    mocks.handoffs.mockResolvedValue({ handoffs: [{ ...base, releasedAt: null, isMine: true }], budget: { capCents: null, leftCents: 0, noCap: true } });
    flow();
    expect(await screen.findByText('You said you ordered from Regina by phone')).toBeTruthy();
    expect(screen.getByText(/no reimbursement cap yet/)).toBeTruthy();
  });

  it('tells the owner, once per device, that another host released their mark', async () => {
    try { localStorage.removeItem('rsv.handoffReleasedSeen'); } catch { /* none */ }
    const released = { ...base, marked: false, blocking: false, releasedAt: '2026-11-09T13:00:00Z', isMine: true, releasedByOwner: false, releasedByMe: false };
    mocks.handoffs.mockResolvedValue({ handoffs: [released] });
    const { unmount } = flow();
    expect(await screen.findByText(/Another host released the order you marked at Regina/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Another host released/)).toBeNull();
    unmount();
    flow();
    expect(await screen.findByText("Pick Sal's")).toBeTruthy();
    expect(screen.queryByText(/Another host released/)).toBeNull();
  });
});
