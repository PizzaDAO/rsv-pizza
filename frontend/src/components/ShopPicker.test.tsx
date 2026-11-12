import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopPicker } from './ShopPicker';
import { AiOrderDialog } from './AiOrderDialog';
import type { PizzaShop } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ shops: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return { ...actual, getPizzaShops: mocks.shops };
});

const s = (over: Partial<PizzaShop>): PizzaShop => ({
  id: 'pzl_1', name: "Sal's", tier: 'listing', capability_summary: '', ordering: { channel: 'ai_phone', call_countries_ok: true, reasons: [] },
  address: { line1: '1 Main St', city: 'Boston' }, phone: '+16175550101', distance_km: 1, open_now: true, ...over,
});

beforeEach(() => mocks.shops.mockReset());

describe('ShopPicker (UX audit)', () => {
  it('P2-13: a load error offers a retry', async () => {
    mocks.shops.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce({ pizzerias: [s({})] });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't load pizzerias: 502/);
    await userEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText("Sal's")).toBeTruthy();
  });

  it('P2-13: an empty list says whether the party needs an address', async () => {
    mocks.shops.mockResolvedValue({ pizzerias: [] });
    const { unmount } = render(<ShopPicker partyId="p" onSelect={vi.fn()} hasLocation={false} />);
    expect(await screen.findByText('Add a venue address to find pizzerias near your party.')).toBeTruthy();
    unmount();
    render(<ShopPicker partyId="p" onSelect={vi.fn()} />);
    expect(await screen.findByText("We didn't find any pizzerias near the venue.")).toBeTruthy();
  });

  it('P1-6/P2-11/P2-12: Order is disabled while blocked; call-it-yourself shows a readable phone; open now is shown', async () => {
    const onLoaded = vi.fn();
    mocks.shops.mockResolvedValue({ pizzerias: [s({}), s({ id: 'pzl_2', name: 'Regina', ordering: { channel: 'handoff', call_countries_ok: true, reasons: [] }, phone: '+16175550102', open_now: false })] });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} orderDisabled onLoaded={onLoaded} />);
    expect(((await screen.findByRole('button', { name: "Order from Sal's" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('(617) 555-0102').closest('a')?.getAttribute('href')).toBe('tel:+16175550102');
    expect(screen.getAllByText('Open now')).toHaveLength(1);
    expect(onLoaded).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'pzl_2' })]));
  });
});

describe('AiOrderDialog (UX audit P2-21)', () => {
  it('is a labelled modal dialog with a labelled close button, and Escape closes it', async () => {
    const onClose = vi.fn();
    render(<AiOrderDialog onClose={onClose}><button>inside</button></AiOrderDialog>);
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('Order pizza with AI');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
