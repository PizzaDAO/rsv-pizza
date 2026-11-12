import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PizzaOrderFlow } from './PizzaOrderFlow';
import type { CartResponse, MenuProvenance, PizzaShop } from '../lib/pizzaOrder';
import type { MenuRebuild } from './HostMenuUpload';

/**
 * basil-14648 P2: the flow offers host menus only when /config says so AND the shop says it takes one, locks the
 * cart step while a read runs, and rebuilds the cart after a change, never for a different shop or after Approve.
 */
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  build: vi.fn(),
  place: vi.fn(),
  changed: null as null | ((c: 'added' | 'removed') => Promise<MenuRebuild> | MenuRebuild),
  busy: null as null | ((b: boolean) => void),
}));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return {
    ...actual,
    getPizzaOrderConfig: mocks.config,
    getPizzaOrders: vi.fn(async () => ({ orders: [] })),
    getPizzaHandoffs: vi.fn(async () => ({ handoffs: [] })),
    buildPizzaCart: mocks.build,
    placePizzaOrder: mocks.place,
  };
});
vi.mock('../contexts/PizzaContext', () => ({
  usePizza: () => ({ party: { id: 'p1', hostName: 'Sam', date: null }, recommendations: [] }),
}));
const takes = { host_menu_upload: true };
const sals = { id: 'pzl_1', name: "Sal's", tier: 'listing', capabilities: takes } as PizzaShop;
const luigis = { id: 'pzl_2', name: "Luigi's", tier: 'listing', capabilities: takes } as PizzaShop;
const noMenus = { id: 'pzl_3', name: 'Corner', tier: 'listing', capabilities: { host_menu_upload: false } } as PizzaShop;
const native = { id: 'pz_1', name: 'Tony', tier: 'native' } as PizzaShop;
vi.mock('./ShopPicker', () => ({
  ShopPicker: ({ onSelect, onUseMenu }: { onSelect: (s: PizzaShop) => void; onUseMenu?: (s: PizzaShop) => void }) => (
    <div>
      {[sals, luigis, noMenus, native].map((s) => (
        <button key={s.id} onClick={() => onSelect(s)}>Pick {s.name}</button>
      ))}
      {onUseMenu && <button onClick={() => onUseMenu(sals)}>Menu for Sal's</button>}
    </div>
  ),
}));
vi.mock('./CartReview', () => ({
  CartReview: ({ onBuild, onBack, onApprove, menuSlot, locked }: { onBuild: (iso: string) => void; onBack: () => void; onApprove: (i: unknown) => void; menuSlot?: React.ReactNode; locked?: boolean }) => (
    <div>
      <button onClick={() => onBuild('2026-11-14T22:00:00Z')}>Build</button>
      <button onClick={onBack}>Back</button>
      <button onClick={() => onApprove({ substitution: 'exact', contact: { name: 'S', phone: '+16175550123' } })}>Approve</button>
      <p>{locked ? 'locked' : 'unlocked'}</p>
      {menuSlot}
    </div>
  ),
}));
vi.mock('./OrderStatus', () => ({ OrderStatus: () => <p>order status</p> }));
vi.mock('./HostMenuUpload', () => ({
  HostMenuUpload: (p: { defaultOpen?: boolean; onChanged: typeof mocks.changed; onBusyChange?: (b: boolean) => void }) => {
    mocks.changed = p.onChanged;
    mocks.busy = p.onBusyChange ?? null;
    return <p>menu panel{p.defaultOpen ? ' (open)' : ''}</p>;
  },
}));

const cartState = (shopId = 'pzl_1', provenance: MenuProvenance = 'generic', id = 'cart_1'): CartResponse => ({
  cart: { id, pizzeria_id: shopId, version: 1, lines: [], ready_for_quote: true, fulfillment: { scheduled_for: '2026-11-14T22:00:00Z' }, menu: { menu_id: null, provenance, as_of: '2026-11-09T00:00:00Z' } },
  quote: { quote_id: 'q1', read_back: '', total_display: '$1', totals: { total_cents: 100 }, price_ceiling_cents: 2000 },
  issues: [], notices: [], dropped: [], recommendationVersion: 'v', capCents: 25000, remainingCapCents: 25000,
});
const cfg = (over: Record<string, unknown> = {}) => ({ enabled: true, capCents: 25000, remainingCapCents: 25000, blockedReason: null, location: null, ...over });
const flow = () => render(<PizzaOrderFlow fallback={<p>fallback</p>} />);

beforeEach(() => {
  mocks.config.mockReset();
  mocks.build.mockReset();
  mocks.place.mockReset();
  mocks.changed = null;
  mocks.busy = null;
  mocks.build.mockImplementation(async (_p: string, shopId: string) => cartState(shopId));
  mocks.config.mockResolvedValue(cfg({ hostMenus: true }));
});

describe('PizzaOrderFlow: host menus, where they are offered', () => {
  it('hidden unless /config says hostMenus: no list button, no panel', async () => {
    mocks.config.mockResolvedValue(cfg({ hostMenus: false }));
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(screen.queryByText("Menu for Sal's")).toBeNull();
    expect(screen.queryByText(/menu panel/)).toBeNull();
  });

  it('an older backend with no hostMenus field: hidden too', async () => {
    mocks.config.mockResolvedValue(cfg());
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(screen.queryByText(/menu panel/)).toBeNull();
  });

  it('per shop: only where pizza-mcp says the shop takes a menu (never a native shop)', async () => {
    const { unmount } = flow();
    await userEvent.click(await screen.findByText('Pick Corner'));
    expect(screen.queryByText(/menu panel/)).toBeNull();
    unmount();
    flow();
    await userEvent.click(await screen.findByText('Pick Tony'));
    expect(screen.queryByText(/menu panel/)).toBeNull();
  });

  it('on: offered for a shop that takes one (open straight away from the list)', async () => {
    const { unmount } = flow();
    await userEvent.click(await screen.findByText("Menu for Sal's"));
    expect(screen.getByText('menu panel (open)')).toBeTruthy();
    unmount();
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    expect(screen.getByText('menu panel')).toBeTruthy();
  });

  it('only on generic or extracted menus (or the host\'s own); not on an observed one', async () => {
    mocks.build.mockResolvedValueOnce(cartState('pzl_1', 'observed'));
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await waitFor(() => expect(screen.queryByText(/menu panel/)).toBeNull());
  });
});

describe('PizzaOrderFlow: host menus, rebuilding', () => {
  async function onSalsWithCart() {
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    await userEvent.click(screen.getByText('Build'));
    await waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
  }

  it('a menu added before any cart: nothing rebuilt (the next build uses it)', async () => {
    flow();
    await userEvent.click(await screen.findByText("Pick Sal's"));
    act(() => mocks.busy!(true));
    expect(await mocks.changed!('added')).toBe('no_cart');
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it('a menu added or removed with a cart: a NEW cart is built at the same pickup time', async () => {
    await onSalsWithCart();
    act(() => mocks.busy!(true));
    expect(await act(() => mocks.changed!('added'))).toBe('rebuilt');
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.build.mock.calls[1]).toEqual(['p1', 'pzl_1', [], '2026-11-14T22:00:00Z', {}, 'ai_phone']);
    act(() => mocks.busy!(false));
    act(() => mocks.busy!(true));
    expect(await act(() => mocks.changed!('removed'))).toBe('rebuilt');
    expect(mocks.build).toHaveBeenCalledTimes(3);
  });

  it('a failed rebuild is reported as failed', async () => {
    await onSalsWithCart();
    mocks.build.mockRejectedValueOnce(new Error('down'));
    act(() => mocks.busy!(true));
    expect(await act(() => mocks.changed!('added'))).toBe('failed');
  });

  it('while a read runs, the cart step is locked (Back, Build, Approve), and unlocked after', async () => {
    await onSalsWithCart();
    expect(screen.getByText('unlocked')).toBeTruthy();
    act(() => mocks.busy!(true));
    expect(screen.getByText('locked')).toBeTruthy();
    act(() => mocks.busy!(false));
    expect(screen.getByText('unlocked')).toBeTruthy();
  });

  it('a late result after the host went to another shop rebuilds nothing (never lands on that shop)', async () => {
    await onSalsWithCart();
    act(() => mocks.busy!(true));
    const late = mocks.changed!;
    await userEvent.click(screen.getByText('Back'));
    await userEvent.click(await screen.findByText("Pick Luigi's"));
    await userEvent.click(screen.getByText('Build'));
    await waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(2));
    expect(mocks.build.mock.calls[1][1]).toBe('pzl_2');
    expect(await act(() => late('added'))).toBe('stale');
    expect(mocks.build).toHaveBeenCalledTimes(2);
  });

  it('a late result after Approve rebuilds nothing', async () => {
    mocks.place.mockResolvedValue({ order: { id: '1', opopOrderId: 'ord_1', tier: 'listing', shopId: 'pzl_1', shopName: "Sal's", status: 'awaiting_approval', isMine: true }, next_action: null });
    await onSalsWithCart();
    act(() => mocks.busy!(true));
    const late = mocks.changed!;
    await userEvent.click(screen.getByText('Approve'));
    expect(await screen.findByText('order status')).toBeTruthy();
    expect(await act(() => late('added'))).toBe('stale');
    expect(mocks.build).toHaveBeenCalledTimes(1);
  });
});
