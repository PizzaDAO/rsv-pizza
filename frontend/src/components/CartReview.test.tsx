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
});
