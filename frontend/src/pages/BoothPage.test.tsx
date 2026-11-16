import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown>, loading: false }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const api = vi.hoisted(() => ({ getEventBySlug: vi.fn(), getBooth: vi.fn(), uploadPhoto: vi.fn() }));
vi.mock('../lib/api', () => api);
const storage = vi.hoisted(() => ({ uploadEventPhoto: vi.fn() }));
vi.mock('../lib/supabase', () => storage);

// The real loader injects a script; the stub defines a bare custom element instead.
vi.mock('../lib/booth/loadBooth', () => ({
  loadBooth: vi.fn(async () => {
    if (!customElements.get('questpass-booth')) {
      customElements.define('questpass-booth', class extends HTMLElement {
        config: unknown = null;
        person: unknown = null;
      });
    }
  }),
}));

import { BoothPage } from './BoothPage';

const EVENT = { id: 'party-1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice-night', date: null, timezone: null, photosEnabled: true, boothEnabled: true };
const SETUP = { enabled: true, hostEnabled: true, globalEnabled: true, config: null, updatedAt: null, canEdit: false };
const UPLOAD = { url: 'https://cdn.test/p.jpg', fileName: 'p.jpg', fileSize: 10, mimeType: 'image/jpeg', width: 1, height: 1 };

const renderPage = () => render(
  <MemoryRouter initialEntries={['/slice-night/booth']}>
    <Routes><Route path="/:slug/booth" element={<BoothPage />} /></Routes>
  </MemoryRouter>,
);

async function bootBooth() {
  renderPage();
  return (await waitFor(() => {
    const el = document.querySelector('questpass-booth');
    expect(el).toBeTruthy();
    return el!;
  })) as HTMLElement;
}

function takePhoto(el: HTMLElement, name = 'booth.jpg') {
  act(() => {
    el.dispatchEvent(new CustomEvent('questpass:photo', {
      detail: { blob: new Blob(['x'], { type: 'image/jpeg' }), frame: 'pizza-box', ratio: '4:5', name },
    }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null;
  api.getEventBySlug.mockResolvedValue({ ...EVENT });
  api.getBooth.mockResolvedValue({ ...SETUP });
  storage.uploadEventPhoto.mockResolvedValue(UPLOAD);
  api.uploadPhoto.mockResolvedValue({ photo: { status: 'pending' } });
});

describe('BoothPage', () => {
  it('shows the booth with the privacy note and the credit', async () => {
    await bootBooth();
    expect(screen.getByTestId('booth-privacy').textContent).toMatch(/stay on your phone/);
    expect(screen.getByTestId('booth-credit').textContent).toMatch(/Apache-2\.0/);
    expect(screen.queryByTestId('booth-consent')).toBeNull();
  });

  it('hands the booth the party config', async () => {
    const el = await bootBooth() as HTMLElement & { config: any };
    await waitFor(() => expect(el.config?.title).toBe('Slice Night'));
    expect(el.config.credit).toBe(true);
  });

  it('a finished photo shows the consent card, and nothing uploads without a click', async () => {
    const el = await bootBooth();
    takePhoto(el);
    expect(await screen.findByTestId('booth-consent')).toBeTruthy();
    expect(storage.uploadEventPhoto).not.toHaveBeenCalled();
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it('Add uploads the photo with the booth tag and says the host will review it', async () => {
    auth.user = { name: 'Pat', email: 'pat@example.com' };
    const el = await bootBooth();
    takePhoto(el, 'shot.jpg');
    fireEvent.click(await screen.findByTestId('booth-consent-add'));
    await screen.findByText('Added. The host will review it');
    expect(storage.uploadEventPhoto).toHaveBeenCalledTimes(1);
    const [file, partyId] = storage.uploadEventPhoto.mock.calls[0];
    expect(partyId).toBe('party-1');
    expect(file.name).toBe('shot.jpg');
    expect(api.uploadPhoto).toHaveBeenCalledWith('party-1', expect.objectContaining({
      url: UPLOAD.url, tags: ['booth'], uploaderName: 'Pat', uploaderEmail: 'pat@example.com',
    }));
  });

  it('says just "Added" when the photo is auto-approved (hosts)', async () => {
    api.uploadPhoto.mockResolvedValue({ photo: { status: 'approved' } });
    const el = await bootBooth();
    takePhoto(el);
    fireEvent.click(await screen.findByTestId('booth-consent-add'));
    expect(await screen.findByText('Added')).toBeTruthy();
  });

  it('surfaces the API error and lets the guest retry', async () => {
    api.uploadPhoto.mockRejectedValueOnce(new Error('This event has reached its photo limit'));
    const el = await bootBooth();
    takePhoto(el);
    fireEvent.click(await screen.findByTestId('booth-consent-add'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/photo limit/);
    api.uploadPhoto.mockResolvedValueOnce({ photo: { status: 'pending' } });
    fireEvent.click(screen.getByTestId('booth-consent-add'));
    await screen.findByText('Added. The host will review it');
  });

  it('No thanks uploads nothing and closes the card; the next photo asks again', async () => {
    const el = await bootBooth();
    takePhoto(el);
    fireEvent.click(await screen.findByTestId('booth-consent-no'));
    expect(screen.queryByTestId('booth-consent')).toBeNull();
    expect(storage.uploadEventPhoto).not.toHaveBeenCalled();
    takePhoto(el);
    expect(await screen.findByTestId('booth-consent')).toBeTruthy();
  });

  it("Don't ask again suppresses later prompts this visit", async () => {
    const el = await bootBooth();
    takePhoto(el);
    await screen.findByTestId('booth-consent');
    fireEvent.click(screen.getByRole('checkbox', { name: /don't ask again/i }));
    fireEvent.click(screen.getByTestId('booth-consent-no'));
    expect(screen.queryByTestId('booth-consent')).toBeNull();
    takePhoto(el);
    expect(screen.queryByTestId('booth-consent')).toBeNull();
    expect(storage.uploadEventPhoto).not.toHaveBeenCalled();
  });

  it('photosEnabled false: no consent card', async () => {
    api.getEventBySlug.mockResolvedValue({ ...EVENT, photosEnabled: false });
    const el = await bootBooth();
    takePhoto(el);
    expect(screen.queryByTestId('booth-consent')).toBeNull();
  });

  it('renders the off state when the booth is disabled', async () => {
    api.getBooth.mockResolvedValue({ ...SETUP, enabled: false });
    renderPage();
    expect((await screen.findByTestId('booth-message')).textContent).toMatch(/doesn't have a photo booth/);
    expect(document.querySelector('questpass-booth')).toBeNull();
  });

  it('editors still see the booth when it is off, with a preview banner', async () => {
    api.getBooth.mockResolvedValue({ ...SETUP, enabled: false, globalEnabled: false, canEdit: true });
    await bootBooth();
    expect(screen.getByTestId('booth-preview-banner').textContent).toMatch(/not public yet/);
  });

  it('unknown event shows not found', async () => {
    api.getEventBySlug.mockResolvedValue(null);
    renderPage();
    expect((await screen.findByTestId('booth-message')).textContent).toMatch(/not found/i);
  });
});
