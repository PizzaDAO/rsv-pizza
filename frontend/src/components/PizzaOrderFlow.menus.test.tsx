import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PizzaOrderFlow } from './PizzaOrderFlow';
import type { CartResponse, PizzaShop } from '../lib/pizzaOrder';

/** basil-14648 P2: the flow offers host menus only when /config says so, and rebuilds the cart after a change. */
const mocks = vi.hoisted(() => ({ config: vi.fn(), build: vi.fn(), changed: { fn: null as null | ((c: 'added' | 'removed') => Promise<boolean> | boolean) } }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return {
    ...actual,
    getPizzaOrderConfig: mocks.config,
    getPizzaOrders: vi.fn(async () => ({ orders: [] })),
    getPizzaHandoffs: vi.fn(async () => ({ handoffs: [] })),
    buildPizzaCart: mocks.build,
  };
});
vi.mock('../contexts/PizzaContext', () => ({
  usePizza: () => ({ party: { id: 'p1', hostName: 'Sam', date: null }, recommendations: [] }),
}));
const listing = { id: 'pzl_1', name: "Sal's", tier: 'listing' } as PizzaShop;
const native = { id: 'pz_1', name: 'Tony', tier: 'native' } as PizzaShop;
vi.mock('./ShopPicker', () => ({
  ShopPicker: ({ onSelect, onUseMenu }: { onSelect: (s: PizzaShop) => void; onUseMenu?: (s: PizzaShop) => void }) => (
    <div>
      <button onClick={() => onSelect(listing)}>Pick Sal's</button>
      <button onClick={() => onSelect(native)}>Pick Tony</button>
      {onUseMenu && <button onClick={() => onUseMenu(listing)}>Menu for Sal's</button>}
    </div>
  ),
}));
vi.mock('./CartReview', () => ({
  CartReview: ({ onBuild, menuSlot }: { onBuild: (iso: string) => void; menuSlot?: React.ReactNode }) => (
    <div>
      <button onClick={() => onBuild('2026-11-14T22:00:00Z')}>Build</button>
      {menuSlot}
    </div>
  ),
}));
vi.mock('./HostMenuUpload', () => ({
  HostMenuUpload: (p: { defaultOpen?: boolean; onChanged: (c: 'added' | 'removed') => Promise<boolean> | boolean }) => {
    mocks.changed.fn = p.onChanged;
    return <p>menu panel{p.defaultOpen ? ' (open)' : ''}</p>;
  },
}));

const cartState = (over: Partial<CartResponse> = {}): CartResponse => ({
  cart: { id: 'cart_1', pizzeria_id: 'pzl_1', version: 1, lines: [], ready_for_quote: true, fulfillment: { scheduled_for: '2026-11-14T22:00:00Z' }, menu: { menu_id: null, provenance: 'generic', as_of: '2026-11-09T00:00:00Z' } },
  quote: null, issues: [], notices: [], dropped: [], recommendationVersion: 'v', capCents: 25000, remainingCapCents: 25000, ...over,
});
const cfg = (over: Record<string, unknown> = {}) => ({ enabled: true, capCents: 25000, remainingCapCents: 25000, blockedReason: null, location: null, ...over });

beforeEach(() => {
  mocks.config.mockReset();
  mocks.build.mockReset();
  mocks.changed.fn = null;
  mocks.build.mockResolvedValue(cartState());
});

describe('PizzaOrderFlow: host menus', () => {
  it('hidden unless /config says hostMenus: no list button, no panel', async () => {
    mocks.config.mockResolvedValue(cfg({ hostMenus: false }));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(screen.queryByText("Menu for Sal's")).toBeNull();
    expect(screen.queryByText(/menu panel/)).toBeNull();
  });

  it('an older backend with no hostMenus field: hidden too', async () => {
    mocks.config.mockResolvedValue(cfg());
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(screen.queryByText(/menu panel/)).toBeNull();
  });

  it('on: offered for a listing shop (open straight away from the list), never for a native one', async () => {
    mocks.config.mockResolvedValue(cfg({ hostMenus: true }));
    const { unmount } = render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Menu for Sal's"));
    expect(screen.getByText('menu panel (open)')).toBeTruthy();
    unmount();
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(screen.getByText('menu panel')).toBeTruthy();
    expect(screen.queryByText('menu panel (open)')).toBeNull();
  });

  it('native shop: no panel', async () => {
    mocks.config.mockResolvedValue(cfg({ hostMenus: true }));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText('Pick Tony'));
    expect(screen.queryByText(/menu panel/)).toBeNull();
  });

  it('a menu added before any cart: nothing rebuilt (the next build uses it)', async () => {
    mocks.config.mockResolvedValue(cfg({ hostMenus: true }));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(await mocks.changed.fn!('added')).toBe(false);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it('a menu added or removed with a cart: a NEW cart is built at the same pickup time', async () => {
    mocks.config.mockResolvedValue(cfg({ hostMenus: true }));
    render(<PizzaOrderFlow fallback={<p>fallback</p>} />);
    await userEvent.click(await screen.findByText("Pick Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
    expect(await mocks.changed.fn!('added')).toBe(true);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.build.mock.calls[1]).toEqual(['p1', 'pzl_1', [], '2026-11-14T22:00:00Z', {}]);
    expect(await mocks.changed.fn!('removed')).toBe(true);
    expect(mocks.build).toHaveBeenCalledTimes(3);
  });
});
