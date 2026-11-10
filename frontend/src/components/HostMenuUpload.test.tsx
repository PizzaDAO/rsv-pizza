import '../i18n';
import i18n from 'i18next';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostMenuUpload } from './HostMenuUpload';
import { MenuFileError, hostMenuErrorKey, prepareMenuFiles } from '../lib/pizzaOrder';
import type { HostMenuResult } from '../lib/pizzaOrder';

const mocks = vi.hoisted(() => ({ files: vi.fn(), url: vi.fn(), del: vi.fn() }));
vi.mock('../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../lib/pizzaOrder')>('../lib/pizzaOrder');
  return { ...actual, submitHostMenuFiles: mocks.files, submitHostMenuUrl: mocks.url, deleteHostMenu: mocks.del };
});

const shop = { id: 'pzl_osm_n1', name: "Sal's" };
const result: HostMenuResult = {
  menuId: 'lm_1', provenance: 'host_provided', asOf: '2026-11-09T15:00:00Z',
  summary: { pizzaItems: 14, pricedItems: 12, priceRangeCents: [1200, 2600] },
};
const apiError = (code: string) => Object.assign(new Error(`raw ${code} detail`), { code });
const jpg = (name = 'menu.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], name, { type: 'image/jpeg' });

function setup(over: Partial<React.ComponentProps<typeof HostMenuUpload>> = {}) {
  const onChanged = vi.fn(async () => true);
  const prepare = vi.fn(async (f: File[]) => f as Blob[]);
  const utils = render(<HostMenuUpload partyId="p1" shop={shop} onChanged={onChanged} prepare={prepare} timeZone="America/New_York" {...over} />);
  return { ...utils, onChanged, prepare };
}

async function chooseAndRead(files: File[]) {
  await userEvent.click(screen.getByRole('button', { name: "Use this shop's real menu" }));
  await userEvent.upload(screen.getByLabelText('Menu photos or PDF'), files);
  await userEvent.click(screen.getByRole('button', { name: 'Read the menu' }));
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe('HostMenuUpload', () => {
  it('offers the menu in plain words, private to the host, with 44px controls', () => {
    setup();
    expect(screen.getByText('Get a closer estimate')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Use this shop's real menu" })).toBeTruthy();
    expect(screen.getByText(/menu from Sal's, and we'll estimate from its real prices.*Only you see it/)).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/min-h-\[44px\]/);
  });

  it('opening the panel moves focus into it; photos are prepared (downscaled), sent, and the honest result is announced; the cart is rebuilt', async () => {
    let resolve!: (r: HostMenuResult) => void;
    mocks.files.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { onChanged, prepare } = setup();
    await userEvent.click(screen.getByRole('button', { name: "Use this shop's real menu" }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Photo or PDF' }));
    expect(screen.getByRole('button', { name: 'Photo or PDF' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.upload(screen.getByLabelText('Menu photos or PDF'), [jpg('p1.jpg'), jpg('p2.jpg')]);
    expect(screen.getByText('2 files chosen: p1.jpg, p2.jpg')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Read the menu' }));
    expect(prepare).toHaveBeenCalledWith([expect.any(File), expect.any(File)]);
    expect(mocks.files).toHaveBeenCalledWith('p1', 'pzl_osm_n1', expect.any(Array));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Reading the menu… this can take up to a minute.'));
    resolve(result);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('added'));
    expect(screen.getByText('Estimate from your menu (Nov 9)')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Read 14 pizzas, 12 with prices ($12.00 to $26.00).');
    expect(screen.getByRole('button', { name: 'Remove my menu' })).toBeTruthy();
  });

  it('no cart yet: says the next build uses the menu', async () => {
    mocks.files.mockResolvedValue({ ...result, summary: { ...result.summary, priceRangeCents: null } });
    setup({ onChanged: vi.fn(async () => false) });
    await chooseAndRead([jpg()]);
    expect(await screen.findByText(/Read 14 pizzas, 12 with prices\. Build your order and we'll use it\./)).toBeTruthy();
  });

  it('while the cart is rebuilt, says so', async () => {
    mocks.files.mockResolvedValue(result);
    const { rerender, onChanged, prepare } = setup();
    await chooseAndRead([jpg()]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    rerender(<HostMenuUpload partyId="p1" shop={shop} onChanged={onChanged} prepare={prepare} rebuilding />);
    expect(screen.getByRole('status').textContent).toMatch(/Updating your order with this menu/);
  });

  it('MENU_UNREADABLE: plain copy with a next step, as an alert; the chosen files are kept to try again; never the raw detail', async () => {
    mocks.files.mockRejectedValue(apiError('MENU_UNREADABLE'));
    const { onChanged } = setup();
    await chooseAndRead([jpg()]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("We couldn't read prices from that. Try a clearer, closer photo of the pizza section, or a link to the menu.");
    expect(document.body.textContent).not.toMatch(/raw MENU_UNREADABLE/);
    expect(screen.getByText('1 file chosen: menu.jpg')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Read the menu' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a file problem found before sending (too large after downscale) is said without sending anything', async () => {
    const prepare = vi.fn(async () => {
      throw new MenuFileError('MENU_TOO_LARGE');
    });
    setup({ prepare });
    await chooseAndRead([jpg()]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/up to 3 photos, or one PDF of at most 10 pages, 4 MB in total/);
    expect(mocks.files).not.toHaveBeenCalled();
  });

  it('a link: checked, sent as a link; a bad one is caught here', async () => {
    mocks.url.mockResolvedValue(result);
    const { onChanged } = setup({ defaultOpen: true });
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByLabelText('Link to the menu');
    await userEvent.type(input, 'sals menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read the menu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Paste a link that starts with https://');
    expect(mocks.url).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, 'https://sals.example/menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read the menu' }));
    expect(mocks.url).toHaveBeenCalledWith('p1', 'pzl_osm_n1', 'https://sals.example/menu');
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('added'));
  });

  it('a menu from an earlier visit (the cart is on it): shown with its date; removing asks first, then rebuilds', async () => {
    mocks.del.mockResolvedValue({ expired: 1 });
    const { onChanged } = setup({ cartMenu: { menu_id: 'lm_0', provenance: 'host_provided', as_of: '2026-11-02T15:00:00Z' } });
    expect(screen.getByText('Estimate from your menu (Nov 2)')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove my menu' }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Stop using your menu for Sal's\? Your order goes back to typical prices\./);
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect(mocks.del).toHaveBeenCalledWith('p1', 'pzl_osm_n1');
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('removed'));
    expect(screen.getAllByText('Removed. New estimates use typical prices again.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Estimate from your menu/)).toBeNull();
  });

  it('a failed removal says so and keeps the menu', async () => {
    mocks.del.mockRejectedValue(apiError('PIZZA_MCP_UNAVAILABLE'));
    const { onChanged } = setup({ cartMenu: { menu_id: 'lm_0', provenance: 'host_provided', as_of: '2026-11-02T15:00:00Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Remove my menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't remove your menu just now. Try again in a minute.");
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('Estimate from your menu (Nov 2)')).toBeTruthy();
  });

  it('a generic cart shows the offer, not "your menu"', () => {
    setup({ cartMenu: { menu_id: null, provenance: 'generic', as_of: '2026-11-09T15:00:00Z' } });
    expect(screen.queryByText(/Estimate from your menu/)).toBeNull();
    expect(screen.getByRole('button', { name: "Use this shop's real menu" })).toBeTruthy();
  });
});

describe('every host-menu problem has its own plain copy', () => {
  const codes = [
    'MENU_UNREADABLE', 'MENU_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'URL_NOT_ALLOWED', 'MENU_CURRENCY_MISMATCH', 'RATE_LIMITED',
    'EXTRACTION_BUDGET_EXHAUSTED', 'EXTRACTION_UNAVAILABLE', 'FEATURE_DISABLED', 'NOT_A_LISTING', 'NO_FILES',
    'PIZZA_MCP_UNAVAILABLE', 'TIMEOUT', 'PIZZA_MCP_AUTH', 'INSUFFICIENT_SCOPE', undefined,
  ];
  it.each(codes)('%s', (code) => {
    const key = hostMenuErrorKey(code);
    const text = i18n.t(key, { ns: 'host' });
    expect(text).not.toBe(key);
    expect(text.length).toBeGreaterThan(20);
    // a next step or a way to keep going, never a dead end
    expect(text).toMatch(/Try|Check|Use|Choose|still|nothing to add/);
  });
});

describe('prepareMenuFiles', () => {
  const realCreate = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  afterEach(() => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = realCreate;
    vi.restoreAllMocks();
  });
  const pdf = (size = 10) => new File([new Uint8Array(size)], 'm.pdf', { type: 'application/pdf' });

  it('limits: no files, 4 photos, a PDF with a photo, other types, more than 4 MB', async () => {
    await expect(prepareMenuFiles([])).rejects.toMatchObject({ code: 'NO_FILES' });
    await expect(prepareMenuFiles([jpg(), jpg(), jpg(), jpg()])).rejects.toMatchObject({ code: 'MENU_TOO_LARGE' });
    await expect(prepareMenuFiles([pdf(), jpg()])).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    await expect(prepareMenuFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    await expect(prepareMenuFiles([pdf(4 * 1024 * 1024 + 1)])).rejects.toMatchObject({ code: 'MENU_TOO_LARGE' });
    expect(await prepareMenuFiles([pdf()])).toHaveLength(1);
  });

  it('a photo is redrawn at most 2000 px on its longest side, as JPEG 0.8', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }));
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob([new Uint8Array(5)], { type: 'image/jpeg' }));
    });
    const [out] = await prepareMenuFiles([new File([new Uint8Array(9)], 'IMG_1.HEIC', { type: 'image/heic' })]);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8);
    expect(out.type).toBe('image/jpeg');
    expect((out as File).name).toBe('IMG_1.jpg');
  });

  it('a photo this browser cannot draw: sent as is only when it is a JPEG, PNG or WebP', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => {
      throw new Error('decode');
    });
    const f = jpg();
    expect(await prepareMenuFiles([f])).toEqual([f]);
    await expect(prepareMenuFiles([new File([new Uint8Array(3)], 'x.heic', { type: 'image/heic' })])).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});
