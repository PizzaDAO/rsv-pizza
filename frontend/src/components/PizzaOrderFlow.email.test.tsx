/** basil-14648 P2: the flow carries the email channel from the shop step to the cart, the quote and the order. */
import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PizzaOrderFlow } from './PizzaOrderFlow';
import type { PizzaShop } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ config: vi.fn(), orders: vi.fn(), build: vi.fn(), place: vi.fn(), handoffs: vi.fn(), review: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return { ...actual, getPizzaOrderConfig: mocks.config, getPizzaOrders: mocks.orders, buildPizzaCart: mocks.build, placePizzaOrder: mocks.place, getPizzaHandoffs: mocks.handoffs };
});
vi.mock('../contexts/PizzaContext', () => ({ usePizza: () => ({ party: { id: 'p1', hostName: 'Sam', date: null }, recommendations: [] }) }));
const ALT = { channel: 'email', available: true, min_lead_hours: 24, max_lead_days: 21, min_pizzas: 8, max_pizzas: 40, max_total_cents: 80000, reasons: [] };
const shop = { id: 'pzl_1', name: "Sal's", tier: 'listing', ordering: { channel: 'ai_phone', alternatives: [ALT] }, capabilities: { email_order: true } } as unknown as PizzaShop;
vi.mock('./ShopPicker', () => ({
  ShopPicker: ({ onEmail, onSelect }: { onEmail?: (s: PizzaShop) => void; onSelect: (s: PizzaShop) => void }) => (
    <div>
      {onEmail && <button onClick={() => onEmail(shop)}>Email Sal's</button>}
      <button onClick={() => onSelect(shop)}>Call Sal's</button>
    </div>
  ),
}));
vi.mock('./CartReview', () => ({
  CartReview: (p: { onBuild: (iso: string) => void; onApprove: (i: unknown) => void; channel?: string; emailAlt?: unknown; onSwitchChannel?: (c: string) => void; approveError?: string | null }) => {
    mocks.review(p);
    return (
      <div>
        <span>channel {p.channel}</span>
        <button onClick={() => p.onBuild('2026-11-20T18:00:00Z')}>Build</button>
        <button onClick={() => p.onApprove({ ceilingCents: 30000, substitution: 'exact', contact: { name: 'S', phone: '+16175550123' } })}>Approve</button>
        <button onClick={() => p.onSwitchChannel?.('ai_phone')}>Switch</button>
        {p.approveError && <p data-testid="approve-error">{p.approveError}</p>}
      </div>
    );
  },
}));

const last = () => mocks.review.mock.calls[mocks.review.mock.calls.length - 1][0];
const cfg = (over: Record<string, unknown> = {}) => ({ enabled: true, emailOrders: true, capCents: 100000, remainingCapCents: 100000, blockedReason: null, location: null, ...over });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.config.mockResolvedValue(cfg());
  mocks.orders.mockResolvedValue({ orders: [] });
  mocks.handoffs.mockResolvedValue({ handoffs: [] });
  mocks.build.mockResolvedValue({ cart: { id: 'c1' }, quote: { quote_id: 'q1' }, recommendationVersion: 'v', issues: [], notices: [], dropped: [], channel: 'email' });
});

describe('PizzaOrderFlow: email orders', () => {
  it('rsv\'s switch off: the shop list gets no email option', async () => {
    mocks.config.mockResolvedValue(cfg({ emailOrders: false }));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    expect(await screen.findByText("Call Sal's")).toBeTruthy();
    expect(screen.queryByText("Email Sal's")).toBeNull();
  });

  it('email from the shop step: the cart, the quote and the order are all for the email channel', async () => {
    mocks.place.mockResolvedValue({ order: { id: '1', opopOrderId: 'ord_1', shopName: "Sal's", status: 'awaiting_approval', channel: 'email', isMine: true }, next_action: null });
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Email Sal's"));
    expect(screen.getByText('channel email')).toBeTruthy();
    expect(last().emailAlt).toMatchObject({ max_pizzas: 40 });
    await userEvent.click(screen.getByText('Build'));
    expect(mocks.build.mock.calls[0][5]).toBe('email');
    await userEvent.click(screen.getByText('Approve'));
    expect(mocks.place.mock.calls[0][1].policy).toEqual({ ceilingCents: 30000, substitution: 'exact', channel: 'email' });
  });

  it('switching to the call clears the email quote; the next build is a phone cart', async () => {
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Email Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await userEvent.click(screen.getByText('Switch'));
    expect(screen.getByText('channel ai_phone')).toBeTruthy();
    await userEvent.click(screen.getByText('Build'));
    expect(mocks.build.mock.calls[1][5]).toBe('ai_phone');
  });

  it.each([
    [['unverified'], true],
    [[], true],
    [['lead_time'], false],
    [['too_small', 'too_large'], false],
  ])('a refusal at build (%o) takes the email option off the shop: %s', async (reasons, gone) => {
    mocks.build.mockRejectedValueOnce(Object.assign(new Error("We can't email Sal's this order."), { code: 'EMAIL_ORDERS_NOT_AVAILABLE', data: { reasons } }));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Email Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(last().emailAlt == null).toBe(gone));
  });

  it('a refusal about the shop takes the email option off it; one about the order keeps it', async () => {
    const refuse = (reasons: string[]) => Object.assign(new Error("We can't email Sal's this order: x. Nothing was ordered and nothing was sent."), { code: 'EMAIL_ORDERS_NOT_AVAILABLE', data: { reasons } });
    mocks.place.mockRejectedValueOnce(refuse(['lead_time'])).mockRejectedValueOnce(refuse(['do_not_contact']));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Email Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await userEvent.click(screen.getByText('Approve'));
    expect((await screen.findByTestId('approve-error')).textContent).toMatch(/Nothing was ordered and nothing was sent/);
    expect(last().emailAlt).toBeTruthy();
    await userEvent.click(screen.getByText('Approve'));
    await vi.waitFor(() => expect(last().emailAlt).toBeNull());
  });
});
