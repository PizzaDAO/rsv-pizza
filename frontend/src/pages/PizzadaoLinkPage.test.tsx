import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { PizzadaoLinkPage } from './PizzadaoLinkPage';

let authState: { user: { email: string } | null; loading: boolean } = { user: null, loading: false };
const signOut = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ ...authState, signOut }),
}));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

const URL_ = '/link/pizzadao?return=https%3A%2F%2Fpizzadao.org%2Fp&state=abcDEF0123456789_-xyz';
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/link/pizzadao" element={<PizzadaoLinkPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PizzadaoLinkPage', () => {
  const fetchMock = vi.fn();
  const assign = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    assign.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { ...window.location, assign });
    localStorage.setItem('authToken', 'sess');
    authState = { user: null, loading: false };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends signed-out visitors through login and back to this page', async () => {
    renderAt(URL_);
    const where = await screen.findByTestId('where');
    expect(where.textContent).toBe(`/login?redirect=${encodeURIComponent(URL_)}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the account and sends nothing until the visitor confirms', async () => {
    authState = { user: { email: 'me@example.org' }, loading: false };
    renderAt(URL_);
    expect((await screen.findByTestId('link-email')).textContent).toBe('me@example.org');
    expect(screen.getByTestId('link-return-host').textContent).toBe("You'll be sent back to pizzadao.org");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://pizzadao.org/p?rsv_link=t&state=s' }) });
    await userEvent.click(screen.getByTestId('link-confirm'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pizzadao.org/p?rsv_link=t&state=s'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pizzadao-link');
    expect(JSON.parse(init.body)).toEqual({ returnUrl: 'https://pizzadao.org/p', state: 'abcDEF0123456789_-xyz' });
    expect(init.headers.Authorization).toBe('Bearer sess');
  });

  it('shows an error and does not navigate when the backend refuses', async () => {
    authState = { user: { email: 'me@example.org' }, loading: false };
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: {} }) });
    renderAt(URL_);
    await userEvent.click(await screen.findByTestId('link-confirm'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('refuses a link with missing params', async () => {
    authState = { user: { email: 'me@example.org' }, loading: false };
    renderAt('/link/pizzadao?return=https%3A%2F%2Fpizzadao.org%2Fp');
    expect(await screen.findByTestId('link-invalid')).toBeTruthy();
    expect(screen.queryByTestId('link-confirm')).toBeNull();
  });
});
