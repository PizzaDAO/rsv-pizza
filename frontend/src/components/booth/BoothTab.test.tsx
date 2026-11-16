import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ getBooth: vi.fn(), saveBooth: vi.fn() }));
vi.mock('../../lib/api', () => api);
vi.mock('../../lib/booth/loadBooth', () => ({
  loadBooth: vi.fn(async () => {
    if (!customElements.get('questpass-booth-editor')) {
      customElements.define('questpass-booth-editor', class extends HTMLElement { config: unknown = null; });
    }
  }),
}));

import { BoothTab } from './BoothTab';

const PARTY = { id: 'party-1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice-night', city: 'Lisbon', date: null, timezone: null };
const SETUP = { enabled: true, hostEnabled: true, globalEnabled: true, config: null, updatedAt: null, canEdit: true };

beforeEach(() => {
  vi.clearAllMocks();
  api.getBooth.mockResolvedValue({ ...SETUP });
  api.saveBooth.mockImplementation(async (_id: string, body: any) => ({ ...SETUP, ...(body.enabled !== undefined ? { hostEnabled: body.enabled } : {}), config: body.config ?? null }));
});

async function open() {
  render(<BoothTab party={PARTY} />);
  await screen.findByTestId('booth-tab');
  return (await waitFor(() => {
    const el = document.querySelector('questpass-booth-editor');
    expect(el).toBeTruthy();
    return el!;
  })) as HTMLElement & { config: any };
}

describe('BoothTab', () => {
  it('shows the link, the credit and the party details in the editor', async () => {
    const editor = await open();
    expect(screen.getByTestId('booth-link').textContent).toMatch(/\/slice-night\/booth$/);
    expect(screen.getByTestId('booth-credit')).toBeTruthy();
    await waitFor(() => expect(editor.config?.title).toBe('Slice Night'));
  });

  it('the toggle saves right away', async () => {
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: /photo booth on for this party/i }));
    await waitFor(() => expect(api.saveBooth).toHaveBeenCalledWith('party-1', { enabled: false }));
  });

  it('warns when the global switch is off', async () => {
    api.getBooth.mockResolvedValue({ ...SETUP, globalEnabled: false, enabled: false });
    await open();
    expect(screen.getByTestId('booth-global-off')).toBeTruthy();
  });

  it('a cancelled party gets a read-only notice, no form', () => {
    render(<BoothTab party={{ ...PARTY, cancelledAt: '2027-01-01T00:00:00Z' }} />);
    expect(screen.getByTestId('booth-tab-cancelled').textContent).toMatch(/cancelled/);
    expect(screen.queryByTestId('booth-save')).toBeNull();
    expect(document.querySelector('questpass-booth-editor')).toBeNull();
  });

  it('edits mark the form unsaved; Save sends only the changes', async () => {
    const editor = await open();
    await waitFor(() => expect(editor.config?.title).toBe('Slice Night'));
    expect((screen.getByTestId('booth-save') as HTMLButtonElement).disabled).toBe(true);
    const edited = JSON.parse(JSON.stringify(editor.config));
    edited.brand.colors.accent = '#00FF00';
    act(() => { editor.dispatchEvent(new CustomEvent('change', { detail: { config: edited } })); });
    expect(await screen.findByTestId('booth-unsaved')).toBeTruthy();
    expect(api.saveBooth).not.toHaveBeenCalled(); // no save on each edit
    fireEvent.click(screen.getByTestId('booth-save'));
    await screen.findByTestId('booth-saved');
    expect(api.saveBooth).toHaveBeenCalledWith('party-1', { config: { brand: { colors: { accent: '#00FF00' } } } });
  });

  it('Reset asks first, then sends config null', async () => {
    await open();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('booth-reset'));
    expect(api.saveBooth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('booth-reset'));
    await waitFor(() => expect(api.saveBooth).toHaveBeenCalledWith('party-1', { config: null }));
    confirm.mockRestore();
  });
});
