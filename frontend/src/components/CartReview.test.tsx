import '../i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartReview } from './CartReview';
import type { CartResponse, PizzaShop } from '../lib/pizzaOrder';

const shop = (tier: 'native' | 'listing'): PizzaShop => ({
  id: tier === 'native' ? 'pz_abc' : 'pzl_osm_n1', name: "Sal's", tier, capability_summary: '',
  ordering: { channel: tier === 'native' ? 'api' : 'ai_phone', call_countries_ok: true, reasons: [] },
  address: {}, phone: null, distance_km: 1, open_now: true,
});
const base: CartResponse = {
  cart: { id: 'cart_1', pizzeria_id: 'pzl_osm_n1', version: 1, lines: [], ready_for_quote: true },
  quote: { quote_id: 'q1', read_back: '10 large pepperoni', total_display: '$180.00', totals: { total_cents: 18000 }, price_ceiling_cents: 21000, estimate: { low_cents: 15000, expected_cents: 18000, high_cents: 21000, confidence: 'medium' } },
  issues: [], notices: [], dropped: [], recommendationVersion: 'v', capCents: 25000, remainingCapCents: 20000,
};
const props = (over: Partial<React.ComponentProps<typeof CartReview>> = {}) => ({
  shop: shop('listing'), cartState: base, building: false, error: null, defaultName: 'Sam', partyDate: null,
  onBuild: vi.fn(), onDecide: vi.fn(), onApprove: vi.fn(), placing: false, onBack: vi.fn(), ...over,
});

describe('CartReview', () => {
  it('shows an unmatched topping as a question with buttons, keeps going, and never prints ids', async () => {
    const onDecide = vi.fn();
    const state: CartResponse = {
      ...base, quote: null,
      issues: [{ ref: 'rec-2', label: '3 x 16" Detroit', kind: 'topping_unavailable', ask_user: "This shop doesn't list Jalapeños.", unmatched: ['Jalapeños'], choices: [{ id: 'omit_toppings', label: 'Leave off Jalapeños' }, { id: 'drop_line', label: 'Skip these 3 pizzas' }] }],
    };
    render(<CartReview {...props({ cartState: state, onDecide })} />);
    expect(screen.getByText(/doesn't list Jalapeños/)).toBeTruthy();
    await userEvent.click(screen.getByText('Leave off Jalapeños'));
    expect(onDecide).toHaveBeenCalledWith(expect.any(String), 'rec-2', 'omit_toppings');
    expect(document.body.textContent).not.toMatch(/gen-|pzl_|candidates/);
  });

  it('lists size changes and skipped pizzas before approval', () => {
    render(<CartReview {...props({ cartState: { ...base, notices: ['This shop has no 18" pizza; ordering the 16" instead.'], dropped: [{ ref: 'r', label: '2 x Detroit' }] } })} />);
    expect(screen.getByText(/ordering the 16" instead/)).toBeTruthy();
    expect(screen.getByText(/Skipping 2 x Detroit/)).toBeTruthy();
  });

  it('a native shop has no ceiling to enter and approves without one', async () => {
    const onApprove = vi.fn();
    render(<CartReview {...props({ shop: shop('native'), onApprove, cartState: { ...base, quote: { ...base.quote!, price_ceiling_cents: undefined } } })} />);
    expect(screen.queryByPlaceholderText(/Most the AI may accept/)).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Your mobile number/), '(617) 555-0123');
    await userEvent.click(screen.getByText('Continue to payment'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove.mock.calls[0][0]).not.toHaveProperty('ceilingCents');
    expect(onApprove.mock.calls[0][0].contact.phone).toBe('+16175550123');
  });

  it('a phone order caps the ceiling at the remaining budget, not the whole cap', async () => {
    render(<CartReview {...props({ cartState: { ...base, remainingCapCents: 9000 } })} />);
    expect((screen.getByPlaceholderText(/Most the AI may accept/) as HTMLInputElement).value).toBe('90.00');
    expect(screen.getByText(/\$90\.00 of your reimbursement budget is left/)).toBeTruthy();
  });

  it('says when nothing is left to order', () => {
    render(<CartReview {...props({ cartState: { ...base, cart: null, quote: null } })} />);
    expect(screen.getByText(/Nothing is left to order/)).toBeTruthy();
  });

  it('P0-1: says the code comes by email from Open Pizza, with the 10-minute window', () => {
    render(<CartReview {...props()} />);
    expect(screen.getByText("Next: a new tab opens. We'll email you a 6-digit code from Open Pizza; enter it there within 10 minutes. We don't call Sal's until you do.")).toBeTruthy();
  });

  it('P1-10: the inputs are labelled text fields, and a disabled Approve says what is missing', async () => {
    render(<CartReview {...props()} />);
    expect((screen.getByLabelText('Most you\'ll pay (USD)') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Pickup name') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Your mobile number') as HTMLInputElement).type).toBe('tel');
    expect((screen.getByText('Approve and have the AI call') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Add your mobile number to continue.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Your mobile number'), '6175550123');
    expect(screen.queryByText('Add your mobile number to continue.')).toBeNull();
    expect((screen.getByText('Approve and have the AI call') as HTMLButtonElement).disabled).toBe(false);
  });

  it('P1-9: the pickup time is on the party clock and labelled with its zone', async () => {
    const onBuild = vi.fn();
    render(<CartReview {...props({ cartState: null, onBuild, timeZone: 'Europe/Lisbon', city: 'Lisbon', partyDate: '2099-11-14T20:00:00Z' })} />);
    expect(screen.getByText(/Pickup at Sal's · Lisbon time \(Europe\/Lisbon\)/)).toBeTruthy();
    expect((screen.getByLabelText('Pickup time') as HTMLInputElement).value).toBe('2099-11-14T19:15');
    await userEvent.click(screen.getByText('Build order from recommendations'));
    expect(onBuild).toHaveBeenCalledWith('2099-11-14T19:15:00.000Z');
  });

  it('P1-11/P2-15: lists the cart lines (not the raw read-back) and drops the confidence jargon', () => {
    const cartState = { ...base, cart: { ...base.cart!, lines: [{ id: 'l1', item_name: 'Pepperoni', size_name: 'Large', quantity: 4, summary: '4x Large (16") Pepperoni' }] }, quote: { ...base.quote!, read_back: 'For pickup around 2026-11-14T22:15:00.000Z. ESTIMATE only' } };
    render(<CartReview {...props({ cartState })} />);
    expect(screen.getByText('4x Large (16") Pepperoni').tagName).toBe('LI');
    expect(document.body.textContent).not.toMatch(/ESTIMATE|T22:15|confidence/);
  });

  it('P1-3: an approve error sits next to the button as an alert', () => {
    render(<CartReview {...props({ approveError: 'That ceiling is over the budget.' })} />);
    expect(screen.getByRole('alert').textContent).toBe('That ceiling is over the budget.');
  });

  it('P1-8: offers to call the shop when nothing is left to order', () => {
    render(<CartReview {...props({ shop: { ...shop('listing'), phone: '+16175550101' }, cartState: { ...base, cart: null, quote: null } })} />);
    expect(screen.getByText("Call Sal's · (617) 555-0101").closest('a')?.getAttribute('href')).toBe('tel:+16175550101');
  });
});
