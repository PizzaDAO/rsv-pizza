import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderStatus } from './OrderStatus';
import type { PizzaOrderView } from '../lib/pizzaOrder';

vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return { ...actual, getPizzaOrder: vi.fn() };
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
});
