import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PizzaOrderFlow } from './PizzaOrderFlow';
import type { PizzaOrderView, PizzaShop } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ config: vi.fn(), orders: vi.fn(), order: vi.fn(), build: vi.fn(), place: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return {
    ...actual,
    getPizzaOrderConfig: mocks.config,
    getPizzaOrders: mocks.orders,
    getPizzaOrder: mocks.order,
    buildPizzaCart: mocks.build,
    placePizzaOrder: mocks.place,
  };
});
vi.mock('../contexts/PizzaContext', () => ({
  usePizza: () => ({ party: { id: 'p1', hostName: 'Sam', date: null }, recommendations: [] }),
}));
const shop = { id: 'pzl_1', name: "Sal's", tier: 'listing' } as PizzaShop;
vi.mock('./ShopPicker', () => ({
  ShopPicker: ({ onSelect }: { onSelect: (s: PizzaShop) => void }) => <button onClick={() => onSelect(shop)}>Pick Sal's</button>,
}));
vi.mock('./CartReview', () => ({
  CartReview: ({ onBuild, onApprove, error }: { onBuild: (iso: string) => void; onApprove: (i: unknown) => void; error: string | null }) => (
    <div>
      <button onClick={() => onBuild('2026-11-01T18:00:00Z')}>Build</button>
      <button onClick={() => onApprove({ substitution: 'exact', contact: { name: 'S', phone: '+16175550123' } })}>Approve</button>
      {error && <p>{error}</p>}
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
    expect(await screen.findByText('Nothing was ordered: release it')).toBeTruthy();
  });

  it('reopens a confirmed order with no receipt yet', async () => {
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'confirmed_by_shop' })] });
    flow();
    expect(await screen.findByText('I uploaded the receipt')).toBeTruthy();
  });

  it('reopens them for a co-host too', async () => {
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'unreachable', releasable: true, isMine: false })] });
    flow();
    expect(await screen.findByText('Nothing was ordered: release it')).toBeTruthy();
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
    await userEvent.click(screen.getByText('View it'));
    expect(mocks.order).toHaveBeenCalledWith('p1', 'ord_named');
    expect(await screen.findByText('Named confirmed')).toBeTruthy();
  });

  it('CAP_EXHAUSTED on building a cart leads to the held order, with no second-order offer', async () => {
    mocks.build.mockRejectedValue(capError());
    mocks.order.mockResolvedValue({ order: row({ opopOrderId: 'ord_held', status: 'needs_review', releasable: true }), stale: false });
    await userEvent.click(await toCart());
    expect(await screen.findByText(/holding the rest of this party's budget/)).toBeTruthy();
    expect(screen.queryByText('Place a second order anyway')).toBeNull();
    await userEvent.click(screen.getByText('View it'));
    expect(mocks.order).toHaveBeenCalledWith('p1', 'ord_held');
    expect(await screen.findByText('Nothing was ordered: release it')).toBeTruthy();
  });

  it('CAP_EXHAUSTED on placing leads to the held order as well', async () => {
    mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [] });
    mocks.place.mockRejectedValue(capError());
    vi.spyOn(window, 'open').mockReturnValue(null);
    await userEvent.click(await toCart());
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText('View it')).toBeTruthy();
  });

  it('CAP_EXHAUSTED with no order behind it stays a plain error', async () => {
    mocks.build.mockRejectedValue(Object.assign(new Error('No budget left'), { code: 'CAP_EXHAUSTED' }));
    await userEvent.click(await toCart());
    expect(await screen.findByText('No budget left')).toBeTruthy();
    expect(screen.queryByText('View it')).toBeNull();
  });

  it('a budget already spent on load links to the held order, even one the list would not reopen', async () => {
    mocks.config.mockResolvedValue(cfg({ remainingCapCents: null, blockedReason: 'CAP_EXHAUSTED', heldOrderId: 'ord_held' }));
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'calling', isMine: false, opopOrderId: 'ord_held' })] });
    mocks.order.mockResolvedValue({ order: row({ status: 'calling', isMine: false, shopName: 'Held' }), stale: false });
    flow();
    await userEvent.click(await screen.findByText('View the order holding it'));
    expect(mocks.order).toHaveBeenCalledWith('p1', 'ord_held');
    expect(await screen.findByText('Calling Held')).toBeTruthy();
  });

  it('after releasing the held order, leaving it refreshes the budget notice', async () => {
    mocks.config.mockResolvedValueOnce(cfg({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: 'ord_1' }));
    mocks.orders.mockResolvedValue({ orders: [row({ status: 'needs_review', released: false, releasable: true, blocking: false })] });
    flow();
    await userEvent.click(await screen.findByText('Order from another pizzeria'));
    expect(await screen.findByText("Pick Sal's")).toBeTruthy();
    expect(mocks.config).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(screen.queryByText(/No reimbursement budget is left/)).toBeNull());
  });

  it('a failed lookup says so wherever the host is', async () => {
    mocks.config.mockResolvedValue(cfg({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: 'ord_held' }));
    mocks.order.mockRejectedValue(new Error('down'));
    flow();
    await userEvent.click(await screen.findByText('View the order holding it'));
    expect(await screen.findByText('Could not load the existing order.')).toBeTruthy();
  });
});
