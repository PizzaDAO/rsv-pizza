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

  it('lists deferred calls when the API exposes them and renders fine without', () => {
    const withDeferred = order({ call: { deferred_calls: [{ at: '2026-10-30T22:00:00Z', reason: 'shop closed' }] } });
    const { unmount } = render(<OrderStatus partyId="p" order={withDeferred} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText(/Calls scheduled for later/)).toBeTruthy();
    expect(screen.getByText(/shop closed/)).toBeTruthy();
    unmount();
    render(<OrderStatus partyId="p" order={order()} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.queryByText(/Calls scheduled for later/)).toBeNull();
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
