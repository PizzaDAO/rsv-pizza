import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ user: { id: 'u1', email: 'brand@example.org' } as any, loading: false }));
const brand = vi.hoisted(() => ({ seriesSlug: 'acme' }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../config/brand', () => ({ BRAND: brand }));
vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/LoginModal', () => ({ LoginModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>login-modal</div> : null) }));
vi.mock('./NotFoundPage', () => ({ NotFoundPage: () => <div>not-found-page</div> }));

const api = vi.hoisted(() => ({
  fetchBrandAdminMe: vi.fn(),
  fetchBrandSettings: vi.fn(),
  saveBrandSettings: vi.fn(),
  fetchBrandHistory: vi.fn(),
  revertBrandSettings: vi.fn(),
  fetchBrandChecklist: vi.fn(),
  addBrandChecklistItem: vi.fn(),
  updateBrandChecklistItem: vi.fn(),
  deleteBrandChecklistItem: vi.fn(),
  fetchBrandEvents: vi.fn(),
  setBrandEventStatus: vi.fn(),
  setBrandOwnAlerts: vi.fn(),
}));
vi.mock('../lib/brandAdminApi', async (orig) => ({ ...(await orig<typeof import('../lib/brandAdminApi')>()), ...api }));
const assetApi = vi.hoisted(() => ({ uploadBrandAsset: vi.fn(), removeBrandAsset: vi.fn() }));
vi.mock('../lib/seriesApi', async (orig) => ({ ...(await orig<typeof import('../lib/seriesApi')>()), ...assetApi }));

import { BrandAdminPage } from './BrandAdminPage';
import { planMove } from '../components/brand-admin/ChecklistPanel';
import { resolveAccessibleSeries, useBrandAdminAccess } from '../lib/brandAdminAccess';

const SID = '11111111-1111-4111-8111-111111111111';
const mkSeries = (over: Record<string, unknown> = {}) => ({
  id: SID, slug: 'acme', name: 'Acme', displayName: 'Acme', brandName: 'Acme Pizza', siteUrl: 'https://acme.example.org',
  actorKind: 'series_admin', role: 'editor', alertsEnabled: true, ...over,
});
const TOKENS = { mode: 'dark', bg: '#0f0f10', surface: '#1c1c1e', text: '#ffffff', textMuted: '#a1a1aa', accent: '#e6212f', onAccent: '#ffffff', border: '#3f3f46', radius: 'soft', fontHeading: 'system', fontBody: 'system' };
const mkSettings = (over: Record<string, unknown> = {}) => ({
  id: SID, slug: 'acme', name: 'Acme', siteUrl: null, requireApproval: true, createFlow: null, configVersion: 1,
  brandName: 'Acme Pizza', displayName: 'Acme', tagline: null, metaDescription: null, supportEmail: null, description: null,
  nameTemplate: null, hideGuests: false, photosEnabled: true, photosPublic: true, eventDate: null, eventStartTime: null,
  eventEndTime: null, emailFromName: null, emailReplyTo: null, themeTokens: { ...TOKENS }, ...over,
});
const ASSETS = { logo: '/cdn/brand-assets/x/logo.png', logoLight: null, favicon: null, og: null, flyerPoster: null, flyerRollup: null };

const renderAt = (url = '/brand-admin') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/brand-admin/:tab?" element={<BrandAdminPage />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1', email: 'brand@example.org' };
  auth.loading = false;
  brand.seriesSlug = 'acme';
  api.fetchBrandAdminMe.mockResolvedValue({ series: [mkSeries()] });
  api.fetchBrandSettings.mockResolvedValue({ settings: mkSettings(), assets: ASSETS });
  api.fetchBrandHistory.mockResolvedValue({ history: [] });
  api.fetchBrandChecklist.mockResolvedValue({ items: [] });
  api.fetchBrandEvents.mockResolvedValue({ events: [] });
});

describe('access hook', () => {
  it('never shows a previous user\'s series after the user changes or signs out', async () => {
    api.fetchBrandAdminMe.mockResolvedValueOnce({ series: [mkSeries()] });
    const { result, rerender } = renderHook(({ on, id }: { on: boolean; id: string | null }) => useBrandAdminAccess(on, id), { initialProps: { on: true, id: 'u1' as string | null } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let release: (v: unknown) => void = () => undefined;
    api.fetchBrandAdminMe.mockReturnValueOnce(new Promise((r) => { release = r; }));
    rerender({ on: true, id: 'u2' });
    expect(result.current.status).toBe('loading');
    release({ series: [] });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', series: [] }));
    rerender({ on: false, id: null });
    expect(result.current.status).toBe('loading');
  });
});

describe('admin gating', () => {
  it('shows a not-found page to a signed-in user who administers nothing, and never loads settings', async () => {
    api.fetchBrandAdminMe.mockResolvedValue({ series: [] });
    renderAt();
    expect(await screen.findByText('not-found-page')).toBeTruthy();
    expect(api.fetchBrandSettings).not.toHaveBeenCalled();
  });

  it('shows not-found when the admin belongs to a different brand than this site', async () => {
    api.fetchBrandAdminMe.mockResolvedValue({ series: [mkSeries({ slug: 'other' })] });
    renderAt();
    expect(await screen.findByText('not-found-page')).toBeTruthy();
  });

  it('on the main (unscoped) site only super-admins get in', async () => {
    brand.seriesSlug = '';
    api.fetchBrandAdminMe.mockResolvedValue({ series: [mkSeries()] });
    renderAt();
    expect(await screen.findByText('not-found-page')).toBeTruthy();
  });

  it('on the main site a super-admin gets a series picker', async () => {
    brand.seriesSlug = '';
    api.fetchBrandAdminMe.mockResolvedValue({ series: [mkSeries({ actorKind: 'super_admin', alertsEnabled: null }), mkSeries({ id: '22222222-2222-4222-8222-222222222222', slug: 'b', brandName: 'B Brand', actorKind: 'super_admin', alertsEnabled: null })] });
    renderAt();
    expect(await screen.findByLabelText('Series')).toBeTruthy();
    expect(screen.getByText(/PizzaDAO admin view/)).toBeTruthy();
  });

  it('asks signed-out visitors to sign in and never calls the API', async () => {
    auth.user = null;
    renderAt();
    fireEvent.click(await screen.findByText('Sign in'));
    expect(screen.getByText('login-modal')).toBeTruthy();
    expect(api.fetchBrandAdminMe).not.toHaveBeenCalled();
  });

  it('renders the settings for a brand admin and 404s unknown tabs', async () => {
    renderAt();
    expect(await screen.findByText('Brand settings')).toBeTruthy();
    expect(api.fetchBrandSettings).toHaveBeenCalledWith(SID);
  });

  it('unknown tab is a not-found page', async () => {
    renderAt('/brand-admin/nope');
    expect(await screen.findByText('not-found-page')).toBeTruthy();
  });

  it('resolveAccessibleSeries scopes by site', () => {
    const all = [mkSeries(), mkSeries({ slug: 'b', actorKind: 'super_admin' })] as any;
    expect(resolveAccessibleSeries(all, 'acme').map((s) => s.slug)).toEqual(['acme']);
    expect(resolveAccessibleSeries(all, '').map((s) => s.slug)).toEqual(['b']);
  });
});

describe('Look tab (theme editor)', () => {
  const open = async (settings = mkSettings()) => {
    api.fetchBrandSettings.mockResolvedValue({ settings, assets: ASSETS });
    renderAt('/brand-admin/look');
    return screen.findByTestId('theme-panel');
  };
  const hex = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  it('applies the draft to the live preview only (scoped variables, no API call, document untouched)', async () => {
    await open();
    const frame = screen.getByTestId('theme-preview') as HTMLIFrameElement;
    const root = () => frame.contentDocument!.documentElement;
    await waitFor(() => expect(root().style.getPropertyValue('--accent')).toBe('#e6212f'));
    // an old page-level theme class must not reach the preview: the frame is its own document
    document.documentElement.classList.add('doge-theme');
    expect(root().classList.contains('doge-theme')).toBe(false);
    document.documentElement.classList.remove('doge-theme');
    fireEvent.change(hex('Accent (buttons)'), { target: { value: '#00aa55' } });
    await waitFor(() => expect(root().style.getPropertyValue('--accent')).toBe('#00aa55'));
    expect(api.saveBrandSettings).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
    expect(root().classList.contains('wl-theme')).toBe(true);
    expect(frame.contentDocument!.body.textContent).toContain('Pizza night downtown');
  });

  it('a failing text contrast pair shows an error chip and blocks Save', async () => {
    await open();
    const save = screen.getByText('Save theme') as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(hex('Muted text'), { target: { value: '#2a2a2c' } });
    const fb = await screen.findByTestId('contrast-feedback');
    await waitFor(() => expect(within(fb).getAllByRole('alert').length).toBeGreaterThan(0));
    expect(fb.textContent).toMatch(/textMuted on bg/i);
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(api.saveBrandSettings).not.toHaveBeenCalled();
  });

  it('low accent contrast is only a warning and Save stays enabled', async () => {
    await open();
    fireEvent.change(hex('Accent (buttons)'), { target: { value: '#2a2a30' } });
    const fb = await screen.findByTestId('contrast-feedback');
    await waitFor(() => expect(fb.textContent).toMatch(/Low contrast, accent on bg/i));
    expect((screen.getByText('Save theme') as HTMLButtonElement).disabled).toBe(false);
  });

  it('saves a valid theme, shows server warnings, and never sends overrides', async () => {
    const withOverrides = mkSettings({ themeTokens: { ...TOKENS, overrides: { '--accent-hover': '#aa0000' } } });
    await open(withOverrides);
    expect(screen.getByTestId('overrides-note').textContent).toMatch(/1 extra style value/);
    api.saveBrandSettings.mockResolvedValue({ changed: ['themeTokens'], settings: withOverrides, warnings: ['contrast too low: accent on bg is 2.9:1, needs 3:1'] });
    fireEvent.change(hex('Accent (buttons)'), { target: { value: '#007a3d' } });
    fireEvent.click(screen.getByText('Save theme'));
    await waitFor(() => expect(api.saveBrandSettings).toHaveBeenCalledTimes(1));
    const [id, body] = api.saveBrandSettings.mock.calls[0];
    expect(id).toBe(SID);
    expect(body.themeTokens.accent).toBe('#007a3d');
    expect('overrides' in body.themeTokens).toBe(false);
    expect(await screen.findByText(/accent on bg is 2.9:1/)).toBeTruthy();
    // a super-admin-pinned set can't be cleared by a brand admin
    expect(screen.queryByText('Use the default look')).toBeNull();
  });

  it('shows the existing presentation flags as toggles', async () => {
    await open(mkSettings({ themeTokens: { ...TOKENS, hideHeaderName: true } }));
    const header = screen.getByRole('checkbox', { name: /Logo only in the header/ });
    expect(header.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: /repeat the logo/ }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('Images tab', () => {
  const file = (type = 'image/png', size = 1000) => new File([new Uint8Array(size)], 'a.png', { type });
  const open = async () => {
    renderAt('/brand-admin/images');
    return screen.findByTestId('images-panel');
  };
  const pick = (slot: string, f: File) => {
    const input = within(screen.getByTestId(`image-slot-${slot}`)).getByLabelText(/^Upload/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [f] } });
  };

  it('rejects the wrong type client-side without calling the API', async () => {
    await open();
    pick('logo', file('image/svg+xml'));
    expect(await within(screen.getByTestId('image-slot-logo')).findByText(/not accepted/)).toBeTruthy();
    expect(assetApi.uploadBrandAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['FILE_TOO_BIG', 'That image is too big (10 MB max)', /too big/],
    ['BAD_FILE_TYPE', '', /PNG, JPEG or WebP/],
    ['RATE_LIMITED', 'Request failed', /Too many uploads/],
    ['UPLOADS_UNAVAILABLE', 'Image uploads are not available yet', /not available yet/],
  ])('shows a clear message for %s', async (code, message, expected) => {
    assetApi.uploadBrandAsset.mockRejectedValue(Object.assign(new Error(message), { code }));
    await open();
    pick('og', file());
    expect(await within(screen.getByTestId('image-slot-og')).findByText(expected)).toBeTruthy();
  });

  it('shows progress while uploading and the new image afterwards', async () => {
    let finish: (v: unknown) => void = () => undefined;
    assetApi.uploadBrandAsset.mockImplementation((_s: string, _slot: string, _f: File, onStage?: (s: string) => void) => {
      onStage?.('uploading');
      return new Promise((res) => { finish = res; });
    });
    await open();
    pick('favicon', file());
    expect(await screen.findByText('Uploading…')).toBeTruthy();
    finish({ slot: 'favicon', url: '/cdn/brand-assets/x/favicon/new.png', changed: true });
    await waitFor(() => expect(screen.getByAltText('Favicon (current)').getAttribute('src')).toBe('/cdn/brand-assets/x/favicon/new.png'));
  });

  it('removes an image after confirming', async () => {
    assetApi.removeBrandAsset.mockResolvedValue({ slot: 'logo', url: null, changed: true });
    await open();
    const card = screen.getByTestId('image-slot-logo');
    fireEvent.click(within(card).getByText(/Remove \(use default\)/));
    fireEvent.click(within(card).getByText('Remove'));
    await waitFor(() => expect(assetApi.removeBrandAsset).toHaveBeenCalledWith(SID, 'logo'));
    expect(await within(card).findByText('Using the default')).toBeTruthy();
  });
});

describe('Events tab', () => {
  const ev = { id: '33333333-3333-4333-8333-333333333333', name: 'Pizza Night', customUrl: null, inviteCode: 'abc', city: 'Austin', country: 'US', date: null, venueName: null, address: null, underbossStatus: 'pending', createdAt: '2026-11-01T00:00:00Z', user: { email: 'host@example.org', name: 'Host' } };

  it('explains that approval does not unlock payouts or kits', async () => {
    api.fetchBrandEvents.mockResolvedValue({ events: [ev] });
    renderAt('/brand-admin/events');
    expect((await screen.findByTestId('approval-note')).textContent).toMatch(/not.*unlock payouts or kits/);
  });

  it('shows the PizzaDAO veto message on a 409 and keeps the event listed', async () => {
    api.fetchBrandEvents.mockResolvedValue({ events: [ev] });
    api.setBrandEventStatus.mockRejectedValue(Object.assign(new Error("PizzaDAO has set this event's status"), { code: 'PIZZADAO_DECIDED' }));
    renderAt('/brand-admin/events');
    fireEvent.click(await screen.findByText('Approve'));
    expect(await screen.findByText(/PizzaDAO has set this event's status, so it can no longer be changed here/)).toBeTruthy();
    expect(screen.getByText('Pizza Night')).toBeTruthy();
  });

  it('removes an event from the list once approved, and toggles own alerts', async () => {
    api.fetchBrandEvents.mockResolvedValue({ events: [ev] });
    api.setBrandEventStatus.mockResolvedValue({ party: { id: ev.id, underbossStatus: 'approved' } });
    api.setBrandOwnAlerts.mockResolvedValue({ admin: { alertsEnabled: false } });
    renderAt('/brand-admin/events');
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(api.setBrandEventStatus).toHaveBeenCalledWith(SID, ev.id, 'approved'));
    await waitFor(() => expect(screen.queryByText('Pizza Night')).toBeNull());
    fireEvent.click(screen.getByRole('checkbox', { name: /Email me when a new event/ }));
    await waitFor(() => expect(api.setBrandOwnAlerts).toHaveBeenCalledWith(SID, false));
  });

  it('super-admins have no alerts toggle', async () => {
    api.fetchBrandAdminMe.mockResolvedValue({ series: [mkSeries({ actorKind: 'super_admin', alertsEnabled: null })] });
    renderAt('/brand-admin/events');
    await screen.findByTestId('events-panel');
    expect(screen.queryByRole('checkbox', { name: /Email me/ })).toBeNull();
  });
});

describe('Checklist tab', () => {
  it('shows automatic items read-only and editable items with controls', async () => {
    api.fetchBrandChecklist.mockResolvedValue({
      items: [
        { id: 'a', name: 'Auto thing', dueDate: null, linkTab: null, sortOrder: 0, isAuto: true },
        { id: 'b', name: 'Book venue', dueDate: null, linkTab: null, sortOrder: 1, isAuto: false },
      ],
    });
    renderAt('/brand-admin/checklist');
    const auto = await screen.findByTestId('checklist-auto-item');
    expect(within(auto).queryByLabelText('Edit item')).toBeNull();
    expect(within(auto).queryByLabelText('Delete item')).toBeNull();
    const item = screen.getByTestId('checklist-item');
    expect(within(item).getByLabelText('Edit item')).toBeTruthy();
    expect((within(item).getByLabelText('Move up') as HTMLButtonElement).disabled).toBe(true); // neighbour is automatic
  });

  it('adds an item', async () => {
    api.addBrandChecklistItem.mockResolvedValue({ item: { id: 'n', name: 'Order pizza', dueDate: null, linkTab: null, sortOrder: 0, isAuto: false } });
    renderAt('/brand-admin/checklist');
    fireEvent.change(await screen.findByLabelText('New checklist item'), { target: { value: 'Order pizza' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(api.addBrandChecklistItem).toHaveBeenCalledWith(SID, { name: 'Order pizza' }));
    expect(await screen.findByText('Order pizza')).toBeTruthy();
  });
});

describe('Checklist reorder', () => {
  // doge-like: 1-based, automatic items interleaved
  const seeded = [
    { id: 'a1', name: 'Auto 1', dueDate: null, linkTab: null, sortOrder: 1, isAuto: true },
    { id: 'm2', name: 'Manual 2', dueDate: null, linkTab: null, sortOrder: 2, isAuto: false },
    { id: 'm3', name: 'Manual 3', dueDate: null, linkTab: null, sortOrder: 3, isAuto: false },
    { id: 'a4', name: 'Auto 4', dueDate: null, linkTab: null, sortOrder: 4, isAuto: true },
    { id: 'm5', name: 'Manual 5', dueDate: null, linkTab: null, sortOrder: 5, isAuto: false },
  ];

  it('swaps the two stored values: no ties, at most 2 PATCHes', () => {
    const patches = planMove(seeded, 2, -1);
    expect(patches).toEqual([{ id: 'm3', sortOrder: 2 }, { id: 'm2', sortOrder: 3 }]);
    expect(patches.length).toBeLessThanOrEqual(2);
    const after = seeded.map((i) => ({ ...i, sortOrder: patches.find((p) => p.id === i.id)?.sortOrder ?? i.sortOrder }));
    expect(new Set(after.map((i) => i.sortOrder)).size).toBe(after.length);
    expect(planMove(seeded, 1, -1)).toEqual([]); // neighbour is automatic
  });

  it('picks a free value when the two are tied, never creating another tie', () => {
    const tied = [
      { id: 'x', name: 'X', dueDate: null, linkTab: null, sortOrder: 3, isAuto: false },
      { id: 'y', name: 'Y', dueDate: null, linkTab: null, sortOrder: 3, isAuto: false },
      { id: 'z', name: 'Z', dueDate: null, linkTab: null, sortOrder: 5, isAuto: false },
    ];
    const up = planMove(tied, 1, -1);
    expect(up).toHaveLength(1);
    expect([3, 5]).not.toContain(up[0].sortOrder);
    const down = planMove(tied, 0, 1);
    expect(down).toHaveLength(1);
    expect([3, 5]).not.toContain(down[0].sortOrder);
  });

  it('sends the swap and reloads the stored order, also when a PATCH fails part-way', async () => {
    api.fetchBrandChecklist.mockResolvedValue({ items: seeded });
    api.updateBrandChecklistItem.mockResolvedValueOnce({ item: seeded[2], propagated: 0 }).mockRejectedValueOnce(new Error('boom'));
    renderAt('/brand-admin/checklist');
    const rows = await screen.findAllByTestId('checklist-item');
    fireEvent.click(within(rows[1]).getByLabelText('Move up'));
    await waitFor(() => expect(api.updateBrandChecklistItem).toHaveBeenCalledTimes(2));
    expect(api.updateBrandChecklistItem.mock.calls.map((c) => [c[1], c[2]])).toEqual([['m3', { sortOrder: 2 }], ['m2', { sortOrder: 3 }]]);
    await waitFor(() => expect(api.fetchBrandChecklist).toHaveBeenCalledTimes(2)); // reloaded
    expect(await screen.findByText('boom')).toBeTruthy();
  });
});

describe('History tab', () => {
  const rows = [
    { id: 'h1', action: 'settings.update', actorEmail: 'brand@example.org', actorKind: 'series_admin', createdAt: '2026-11-10T10:00:00Z', changes: { tagline: { old: 'Old', new: 'New' } } },
    { id: 'h2', action: 'asset.update', actorEmail: 'brand@example.org', actorKind: 'series_admin', createdAt: '2026-11-09T10:00:00Z', changes: { flyerArt: { old: null, new: { poster: '/cdn/brand-assets/x/p.png' } } } },
    { id: 'h3', action: 'asset.remove', actorEmail: 'PizzaDAO admin', actorKind: 'super_admin', createdAt: '2026-11-08T10:00:00Z', changes: { logoUrl: { old: '/cdn/brand-assets/x/l.png', new: null } } },
  ];

  it('offers revert for settings rows only, and never prints raw flyer art or image URLs', async () => {
    api.fetchBrandHistory.mockResolvedValue({ history: rows });
    renderAt('/brand-admin/history');
    const els = await screen.findAllByTestId('history-row');
    expect(els).toHaveLength(3);
    expect(within(els[0]).getByText('Revert')).toBeTruthy();
    expect(within(els[1]).queryByText('Revert')).toBeNull();
    expect(within(els[2]).queryByText('Revert')).toBeNull();
    expect(els[1].textContent).toContain('Flyer art changed');
    expect(els[2].textContent).toContain('Logo removed');
    expect(document.body.textContent).not.toContain('/cdn/brand-assets');
    expect(els[0].textContent).toContain('Tagline: Old → New');
  });

  it('reverts through a confirm dialog and refreshes the saved settings', async () => {
    api.fetchBrandHistory.mockResolvedValue({ history: rows });
    api.revertBrandSettings.mockResolvedValue({ changed: ['tagline'], settings: mkSettings() });
    renderAt('/brand-admin/history');
    fireEvent.click(await screen.findByText('Revert'));
    const modal = await screen.findByTestId('revert-modal');
    fireEvent.click(within(modal).getByText('Revert'));
    await waitFor(() => expect(api.revertBrandSettings).toHaveBeenCalledWith(SID, 'h1'));
    await waitFor(() => expect(screen.queryByTestId('revert-modal')).toBeNull());
  });

  it('shows the server error inside the dialog when a revert is refused', async () => {
    api.fetchBrandHistory.mockResolvedValue({ history: rows });
    api.revertBrandSettings.mockRejectedValue(new Error('themeTokens: contrast too low'));
    renderAt('/brand-admin/history');
    fireEvent.click(await screen.findByText('Revert'));
    const modal = await screen.findByTestId('revert-modal');
    fireEvent.click(within(modal).getByText('Revert'));
    expect(await within(modal).findByText(/contrast too low/)).toBeTruthy();
  });
});

describe('Identity tab', () => {
  it('blocks Save on an invalid field and sends only changed fields otherwise', async () => {
    renderAt('/brand-admin');
    const tagline = (await screen.findByLabelText('Tagline')) as HTMLInputElement;
    const save = screen.getByText('Save changes') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(tagline, { target: { value: 'x'.repeat(90) } });
    expect(save.disabled).toBe(true);
    fireEvent.change(tagline, { target: { value: 'Fresh slices' } });
    expect(save.disabled).toBe(false);
    api.saveBrandSettings.mockResolvedValue({ changed: ['tagline'], settings: mkSettings({ tagline: 'Fresh slices' }) });
    fireEvent.click(save);
    await waitFor(() => expect(api.saveBrandSettings).toHaveBeenCalledWith(SID, { tagline: 'Fresh slices' }));
  });
});
