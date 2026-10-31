import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderStatus } from './OrderStatus';
import type { PizzaOrderView } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ settle: vi.fn(), get: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return { ...actual, getPizzaOrder: mocks.get, settlePizzaOrder: mocks.settle };
});

const order = (over: Partial<PizzaOrderView> = {}): PizzaOrderView => ({
  id: '1', opopOrderId: 'ord_1', tier: 'listing', shopId: 'pzl_x', shopName: "Sal's", status: 'confirmed_by_shop',
  paymentStatus: null, ceilingCents: 21000, confirmedTotalCents: 18740, readyAtText: 'about 6:30', summary: null,
  payoutDocumentId: 'd1', call: null, nextAction: null, isMine: true, ...over,
});
const noop = () => undefined;

describe('OrderStatus', () => {
  it('shows the confirmed total and ready time', () => {
    render(<OrderStatus partyId="p" order={order()} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText("Sal's confirmed")).toBeTruthy();
    expect(screen.getByText(/\$187\.40/)).toBeTruthy();
  });

  it("shows pizza-mcp's call.deferred (until / reason / message) when present and renders fine without", () => {
    const withDeferred = order({ status: 'calling', call: { deferred: { until: '2026-10-30T22:00:00Z', reason: 'outside_window', message: 'Shops are closed until 5pm.' } } });
    const { unmount } = render(<OrderStatus partyId="p" order={withDeferred} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText(/Shops are closed until 5pm\./)).toBeTruthy();
    expect(screen.getByText(/Next try:/)).toBeTruthy();
    unmount();
    render(<OrderStatus partyId="p" order={order({ status: 'calling', call: { deferred: null } })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.queryByText(/Next try:/)).toBeNull();
  });

  it('needs_review is terminal: no polling spinner, call-it-yourself script shown', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review' })} orderScript="read this out" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText(/read this out/)).toBeTruthy();
    expect(screen.getByText('Order from another pizzeria')).toBeTruthy();
  });

  it('an expired approval offers Start over, not a dead link', () => {
    const expired = order({ status: 'awaiting_approval', restartable: true, nextAction: { type: 'none' } });
    render(<OrderStatus partyId="p" order={expired} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('The approval link expired')).toBeTruthy();
    expect(screen.getByText('Start over')).toBeTruthy();
    expect(screen.queryByText('Open the approval page')).toBeNull();
  });

  it('a live order the host placed can be canceled; a co-host cannot', () => {
    const live = order({ status: 'calling', cancelable: true });
    const { unmount } = render(<OrderStatus partyId="p" order={live} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('Cancel this order')).toBeTruthy();
    unmount();
    render(<OrderStatus partyId="p" order={{ ...live, isMine: false }} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.queryByText('Cancel this order')).toBeNull();
  });

  it('offers the approval link only to the placing host', () => {
    const waiting = order({ status: 'awaiting_price_approval', nextAction: { type: 'open_url', url: 'https://api.openpizza.xyz/confirm/c1' } });
    const { unmount } = render(<OrderStatus partyId="p" order={waiting} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('Review the higher price').closest('a')?.getAttribute('href')).toBe('https://api.openpizza.xyz/confirm/c1');
    unmount();
    render(<OrderStatus partyId="p" order={{ ...waiting, isMine: false }} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.queryByText('Review the higher price')).toBeNull();
  });

  it('shows the call-it-yourself script when the shop refused', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'refused' })} orderScript="Hi, I'd like to place an order" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText(/place an order/)).toBeTruthy();
  });

  it('needs_review copy is honest both ways (not "we think the shop confirmed") and a holding one can be released', async () => {
    mocks.settle.mockResolvedValue({ order: order({ status: 'needs_review', released: true }) });
    const onUpdate = vi.fn();
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review', releasable: true })} orderScript="" onUpdate={onUpdate} onDone={noop} />);
    expect(screen.getByText(/could not confirm the order at Sal's/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/nothing was ordered, or that the shop did take it/);
    expect(document.body.textContent).not.toMatch(/We think/);
    await userEvent.click(screen.getByText('Nothing was ordered: release it'));
    expect(mocks.settle).toHaveBeenCalledWith('p', 'ord_1', 'nothing_ordered');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('unreachable says nothing was ordered, without claiming a retry that may not have happened', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'unreachable' })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(document.body.textContent).toMatch(/Nothing was ordered/);
    expect(document.body.textContent).not.toMatch(/after retrying/);
  });

  it('shows an optional reason from pizza-mcp when present', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review', call: { reason: 'The shop quoted $150.00, over your limit.' } })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText(/quoted \$150\.00, over your limit/)).toBeTruthy();
  });

  it('keeps polling a fresh confirmation (settling) and offers "I uploaded the receipt"', async () => {
    vi.useFakeTimers();
    mocks.get.mockResolvedValue({ order: order({ status: 'needs_review' }), stale: false });
    const onUpdate = vi.fn();
    render(<OrderStatus partyId="p" order={order({ settling: true })} orderScript="" onUpdate={onUpdate} onDone={noop} />);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalled();
    expect(screen.getByText('I uploaded the receipt')).toBeTruthy();
    vi.useRealTimers();
  });

  it('an old confirmation is not polled', async () => {
    vi.useFakeTimers();
    mocks.get.mockReset();
    render(<OrderStatus partyId="p" order={order({ settling: false })} orderScript="" onUpdate={noop} onDone={noop} />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.get).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
