import { describe, it, expect, vi, afterEach } from 'vitest';
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

afterEach(() => vi.restoreAllMocks());

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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByText('Nothing was ordered: release it'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Release the order at Sal's/));
    expect(mocks.settle).toHaveBeenCalledWith('p', 'ord_1', 'nothing_ordered');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('Release asks first, like Cancel: declining settles nothing', async () => {
    mocks.settle.mockClear();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review', releasable: true })} orderScript="" onUpdate={noop} onDone={noop} />);
    await userEvent.click(screen.getByText('Nothing was ordered: release it'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it('needs_review only says "release it below" when the button is there', () => {
    const { unmount } = render(<OrderStatus partyId="p" order={order({ status: 'needs_review', releasable: false })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(document.body.textContent).not.toMatch(/release it below/);
    expect(screen.queryByText('Nothing was ordered: release it')).toBeNull();
    unmount();
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review', releasable: true })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(document.body.textContent).toMatch(/release it below/);
  });

  it('with no outcome, unreachable does not claim nothing was ordered, or a retry that may not have happened', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'unreachable' })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(document.body.textContent).toMatch(/We could not complete the call/);
    expect(document.body.textContent).not.toMatch(/nothing was ordered/i);
    expect(document.body.textContent).not.toMatch(/after retrying/);
  });

  it('shows the released state, with no release button and the way to order again', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review', released: true, releasable: false, blocking: false })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText("Released: nothing ordered at Sal's")).toBeTruthy();
    expect(screen.queryByText('Nothing was ordered: release it')).toBeNull();
    expect(screen.getByText('Order from another pizzeria')).toBeTruthy();
  });

  it('hides "Order from another pizzeria" where the backend would block it', () => {
    const blocked = order({ status: 'unreachable', blocking: true, releasable: true, outcome: { nothing_ordered: false, reason: 'ambiguous_dial', message: 'm' } });
    const { unmount } = render(<OrderStatus partyId="p" order={blocked} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.queryByText('Order from another pizzeria')).toBeNull();
    unmount();
    render(<OrderStatus partyId="p" order={order({ status: 'refused', blocking: false })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('Order from another pizzeria')).toBeTruthy();
  });

  it('a blocking confirmed order still lets the host leave with Done', () => {
    render(<OrderStatus partyId="p" order={order({ blocking: true })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('a co-host can release and can say the receipt is in', () => {
    const { unmount } = render(<OrderStatus partyId="p" order={order({ status: 'needs_review', releasable: true, isMine: false })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('Nothing was ordered: release it')).toBeTruthy();
    unmount();
    render(<OrderStatus partyId="p" order={order({ isMine: false })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('I uploaded the receipt')).toBeTruthy();
  });

  it("a refused 'I uploaded the receipt' shows why", async () => {
    mocks.settle.mockRejectedValueOnce(new Error('Upload the real receipt first.'));
    render(<OrderStatus partyId="p" order={order()} orderScript="" onUpdate={noop} onDone={noop} />);
    await userEvent.click(screen.getByText('I uploaded the receipt'));
    expect(await screen.findByText('Upload the real receipt first.')).toBeTruthy();
  });

  it('an approval_timeout saying "nothing yet" stays open: approval copy, not "Nothing was ordered"', () => {
    const o = order({ status: 'approval_timeout', outcome: { nothing_ordered: true, reason: 'price_approval_timeout', message: 'Nothing is ordered yet.' } });
    render(<OrderStatus partyId="p" order={o} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText('Approval timed out')).toBeTruthy();
    expect(screen.queryByText("Nothing was ordered at Sal's")).toBeNull();
  });

  it("shows pizza-mcp's outcome.message; nothing_ordered true says so and offers no release", () => {
    const o = order({ status: 'unreachable', outcome: { nothing_ordered: true, reason: 'no_answer', message: 'Nobody picked up at Sal\'s.' } });
    render(<OrderStatus partyId="p" order={o} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText("Nothing was ordered at Sal's")).toBeTruthy();
    expect(screen.getByText(/Nobody picked up/)).toBeTruthy();
    expect(screen.queryByText('Nothing was ordered: release it')).toBeNull();
  });

  it('ambiguous_dial warns the host not to order again before checking with the shop', () => {
    const o = order({ status: 'needs_review', releasable: true, outcome: { nothing_ordered: false, reason: 'ambiguous_dial', message: 'We may have reached the shop.' } });
    render(<OrderStatus partyId="p" order={o} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(screen.getByText(/Check with Sal's before ordering again/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/Do NOT order again until you have called Sal's/);
    expect(screen.getByText('Nothing was ordered: release it')).toBeTruthy();
  });

  it('a missing or unknown outcome keeps the cautious copy', () => {
    render(<OrderStatus partyId="p" order={order({ status: 'needs_review', outcome: undefined })} orderScript="" onUpdate={noop} onDone={noop} />);
    expect(document.body.textContent).toMatch(/It may be that nothing was ordered, or that the shop did take it/);
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
