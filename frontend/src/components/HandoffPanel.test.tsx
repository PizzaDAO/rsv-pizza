import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HandoffPanel } from './HandoffPanel';
import { ShopPicker } from './ShopPicker';
import type { Checklist, PizzaHandoffView, PizzaShop } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ record: vi.fn(), mark: vi.fn(), addLink: vi.fn(), delLink: vi.fn(), shops: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return {
    ...actual,
    recordPizzaHandoff: mocks.record,
    markPizzaHandoff: mocks.mark,
    addShopOrderingLink: mocks.addLink,
    deleteShopOrderingLink: mocks.delLink,
    getPizzaShops: mocks.shops,
  };
});

const shop: Pick<PizzaShop, 'id' | 'name' | 'phone' | 'ordering_links'> = {
  id: 'pzl_1',
  name: "Sal's",
  phone: '+16175550101',
  ordering_links: [
    { id: null, provider: 'website', url: 'https://sals.example/', label: 'x', source: 'place_data' },
    { id: null, provider: 'toast', url: 'https://order.toasttab.com/online/sals', label: 'x', source: 'place_data' },
    { id: null, provider: 'slice', url: 'javascript:alert(1)', label: 'x', source: 'place_data' },
  ],
};
const checklist: Checklist = {
  lines: ['2 x Large (14 in) Pepperoni'],
  text: 'Order for pickup around 6:30 PM\n[ ] 2 x Large (14 in) Pepperoni',
  pizza_count: 2,
  pickup_at: '2026-11-10T23:30:00Z',
  estimate_text: 'about $40 with tax (estimate)',
};
const row = (over: Partial<PizzaHandoffView> = {}): PizzaHandoffView => ({
  id: 'h1', shopId: 'pzl_1', shopName: "Sal's", provider: 'toast', cartId: 'cart_1', holdCents: 0, clickedAt: '2026-11-09T12:00:00Z',
  orderedAt: null, releasedAt: null, marked: false, blocking: false, receiptCovered: false, isMine: true, ...over,
});
const marked = (over: Partial<PizzaHandoffView> = {}) => row({ orderedAt: '2026-11-09T12:05:00Z', marked: true, blocking: true, holdCents: 21000, ...over });

function panel(props: Partial<React.ComponentProps<typeof HandoffPanel>> = {}) {
  const onHandoff = vi.fn();
  const utils = render(
    <HandoffPanel partyId="p1" shop={shop} cartId="cart_1" checklist={checklist} hostName="Sam Weinrott" handoff={null} onHandoff={onHandoff} {...props} />
  );
  return { ...utils, onHandoff };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.record.mockResolvedValue({ handoff: row() });
});

describe('HandoffPanel', () => {
  it('provider links open in a new tab with noopener noreferrer, website last, only http(s) hrefs', () => {
    panel();
    const links = screen.getAllByRole('link');
    const toast = screen.getByRole('link', { name: /Order online at Toast/ });
    expect(toast.getAttribute('target')).toBe('_blank');
    expect(toast.getAttribute('rel')).toBe('noopener noreferrer');
    expect(toast.getAttribute('href')).toBe('https://order.toasttab.com/online/sals');
    expect(screen.queryByRole('link', { name: /Slice/ })).toBeNull(); // javascript: is never rendered
    const names = links.map((l) => l.textContent);
    expect(names.findIndex((n) => /Toast/.test(n!))).toBeLessThan(names.findIndex((n) => /website/.test(n!)));
    expect(screen.getByRole('link', { name: /Call Sal's/ }).getAttribute('href')).toBe('tel:+16175550101');
  });

  it('the click is recorded (with the cart) without blocking the browser navigation', async () => {
    const { onHandoff } = panel();
    const toast = screen.getByRole('link', { name: /Order online at Toast/ });
    let prevented = false;
    toast.addEventListener('click', (e) => {
      prevented = e.defaultPrevented;
      e.preventDefault(); // jsdom cannot navigate; check that WE did not prevent it
    });
    await userEvent.click(toast);
    expect(prevented).toBe(false);
    expect(mocks.record).toHaveBeenCalledWith('p1', { shopId: 'pzl_1', shopName: "Sal's", provider: 'toast', cartId: 'cart_1', opened: true });
    await waitFor(() => expect(onHandoff).toHaveBeenCalled());
  });

  it('shows the checklist with "Name for the order: Sam W." and copies it, announcing "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    panel();
    expect(screen.getByText(/Name for the order: Sam W\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Copy checklist' }));
    expect(writeText).toHaveBeenCalledWith(`Name for the order: Sam W.\n${checklist.text}`);
    expect((await screen.findAllByText('Copied')).length).toBeGreaterThan(0);
  });

  it('when the clipboard fails, selects the checklist and says to copy it by hand', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Copy checklist' }));
    expect(await screen.findByText(/Couldn't copy/)).toBeTruthy();
  });

  it('"I placed this order" needs the checkbox, then marks; a click is never called "ordered"', async () => {
    mocks.mark.mockResolvedValue({ handoff: marked() });
    const { onHandoff } = panel({ handoff: row() });
    expect(screen.queryByText(/You said you ordered/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save: I ordered it' })).toBeNull();
    const box = screen.getByRole('checkbox', { name: "I placed this order with Sal's" });
    expect(box.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save: I ordered it' }));
    expect(mocks.mark).toHaveBeenCalledWith('p1', 'h1', 'ordered', false);
    expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ marked: true }));
    expect(mocks.record).not.toHaveBeenCalled(); // the click row is reused
  });

  it('with no row yet (ordered by phone), creates one without a click, then marks', async () => {
    mocks.mark.mockResolvedValue({ handoff: marked({ provider: 'phone' }) });
    panel({ shop: { ...shop, ordering_links: [] } });
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save: I ordered it' }));
    expect(mocks.record).toHaveBeenCalledWith('p1', { shopId: 'pzl_1', shopName: "Sal's", provider: 'phone', cartId: 'cart_1', opened: false });
    expect(mocks.mark).toHaveBeenCalledWith('p1', 'h1', 'ordered', false);
  });

  it('a second order needs an explicit confirm (ORDER_IN_PROGRESS), then marks with allowAnother', async () => {
    mocks.mark
      .mockRejectedValueOnce(Object.assign(new Error('in progress'), { code: 'ORDER_IN_PROGRESS' }))
      .mockResolvedValueOnce({ handoff: marked() });
    panel({ handoff: row() });
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save: I ordered it' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, this is a second order' }));
    expect(mocks.mark).toHaveBeenLastCalledWith('p1', 'h1', 'ordered', true);
  });

  it('other errors (CAP_EXHAUSTED) show in an alert next to the button', async () => {
    mocks.mark.mockRejectedValue(Object.assign(new Error("What's left of this party's budget doesn't cover it."), { code: 'CAP_EXHAUSTED' }));
    panel({ handoff: row() });
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save: I ordered it' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/doesn't cover it/);
  });

  it('a marked order says "You said you ordered online at Toast", shows the hold, and offers the receipt and "I didn\'t order"', async () => {
    mocks.mark.mockResolvedValueOnce({ handoff: marked({ receiptCovered: true }) });
    panel({ handoff: marked() });
    expect(screen.getByText('You said you ordered online at Toast')).toBeTruthy();
    expect(screen.getByText(/\$210\.00 of your reimbursement budget is held/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'I uploaded the receipt' }));
    expect(mocks.mark).toHaveBeenCalledWith('p1', 'h1', 'receipt_uploaded');
  });

  it('"I didn\'t order after all" confirms first, then unmarks', async () => {
    mocks.mark.mockResolvedValue({ handoff: row({ releasedAt: '2026-11-09T13:00:00Z' }) });
    const { onHandoff } = panel({ handoff: marked() });
    await userEvent.click(screen.getByRole('button', { name: "I didn't order after all" }));
    expect(mocks.mark).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: "Yes, I didn't order" }));
    expect(mocks.mark).toHaveBeenCalledWith('p1', 'h1', 'unmark');
    expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ releasedAt: expect.any(String) }));
  });

  it('adds the shop\'s ordering link (private to the host) and shows pizza-mcp\'s refusal', async () => {
    mocks.addLink
      .mockRejectedValueOnce(Object.assign(new Error("That doesn't look like this shop's ordering page."), { code: 'LINK_NOT_RECOGNIZED' }))
      .mockResolvedValueOnce({ link: { id: 'olk_1', provider: 'chownow', url: 'https://direct.chownow.com/order/1', label: 'x', source: 'host' } });
    mocks.delLink.mockResolvedValue({ deleted: true });
    panel();
    const input = screen.getByRole('textbox', { name: /Paste the shop's ordering link/ });
    await userEvent.type(input, 'https://evil.example/x');
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/doesn't look like/);
    await userEvent.clear(input);
    await userEvent.type(input, 'https://direct.chownow.com/order/1');
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByRole('link', { name: /Order online at ChowNow/ })).toBeTruthy();
    expect(mocks.addLink).toHaveBeenLastCalledWith('p1', 'pzl_1', 'https://direct.chownow.com/order/1');
    await userEvent.click(screen.getByRole('button', { name: 'Remove the ChowNow link' }));
    expect(mocks.delLink).toHaveBeenCalledWith('p1', 'pzl_1', 'olk_1');
    await waitFor(() => expect(screen.queryByRole('link', { name: /ChowNow/ })).toBeNull());
  });

  it('tap targets: every button and link in the panel is at least 44px tall', () => {
    panel();
    for (const el of [...screen.getAllByRole('button'), ...screen.getAllByRole('link'), screen.getByRole('checkbox')]) {
      expect(el.className, el.textContent ?? '').toMatch(/min-h-\[44px\]/);
    }
  });

  it('before a cart exists it says to build the order for a checklist', () => {
    panel({ checklist: null, cartId: null });
    expect(screen.getByText('Build the order above to get a checklist.')).toBeTruthy();
  });
});

describe('ShopPicker: order online', () => {
  const s = (over: Partial<PizzaShop>): PizzaShop => ({
    id: 'pzl_1', name: "Sal's", tier: 'listing', capability_summary: '', ordering: { channel: 'handoff', call_countries_ok: true, reasons: [] },
    address: { line1: '1 Main St' }, phone: '+16175550101', distance_km: 1, open_now: false, ...over,
  });

  it('a handoff shop with a Toast page shows "Order online at Toast" (new tab), a checklist button and the badge', async () => {
    const onChecklist = vi.fn();
    const onOpenLink = vi.fn();
    mocks.shops.mockResolvedValue({
      pizzerias: [s({ ordering_links: [{ id: null, provider: 'toast', url: 'https://order.toasttab.com/online/sals', label: 'x', source: 'place_data' }] })],
    });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} onChecklist={onChecklist} onOpenLink={onOpenLink} />);
    const link = await screen.findByRole('link', { name: /Order online at Toast for Sal's/ });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('Order online yourself')).toBeTruthy();
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onOpenLink).toHaveBeenCalledWith(expect.objectContaining({ id: 'pzl_1' }), expect.objectContaining({ provider: 'toast' }));
    await userEvent.click(screen.getByRole('button', { name: "Build a checklist to order from Sal's yourself" }));
    expect(onChecklist).toHaveBeenCalled();
  });

  it('a callable shop with an online page keeps Order and adds the link as an alternative; no links keeps "Website"', async () => {
    mocks.shops.mockResolvedValue({
      pizzerias: [
        s({ ordering: { channel: 'ai_phone', call_countries_ok: true, reasons: [] }, ordering_links: [{ id: null, provider: 'slice', url: 'https://slicelife.com/restaurants/ma/boston/sals', label: 'x', source: 'place_data' }] }),
        s({ id: 'pzl_2', name: 'Regina', website: 'https://regina.example' }),
      ],
    });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} onChecklist={vi.fn()} />);
    expect(await screen.findByRole('button', { name: "Order from Sal's" })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Order online at Slice for Sal's/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Website/ }).getAttribute('href')).toBe('https://regina.example/');
    expect(screen.getByText('Call it yourself')).toBeTruthy();
  });

  it('a javascript: website is never rendered as a link', async () => {
    mocks.shops.mockResolvedValue({ pizzerias: [s({ website: 'javascript:alert(1)' })] });
    render(<ShopPicker partyId="p" onSelect={vi.fn()} />);
    await screen.findByText("Sal's");
    expect(screen.queryByRole('link', { name: /Website/ })).toBeNull();
  });
});
