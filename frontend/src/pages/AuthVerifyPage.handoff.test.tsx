import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthVerifyPage } from './AuthVerifyPage';

const setUser = vi.fn();
const signOut = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, setUser, signOut }),
}));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/auth/verify" element={<AuthVerifyPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthVerifyPage token hand-off (login CSRF protection)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    sessionStorage.clear();
    setUser.mockClear();
    signOut.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not spend the token until the user taps, and shows the account email', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'victim-target@example.org' }) });
    renderAt('/auth/verify?token=tok&next=%2Fe%2Fparty');
    expect(await screen.findByText('victim-target@example.org')).toBeTruthy();
    // Only the non-spending lookup has happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auth/verify?token=tok');
    expect(localStorage.getItem('authToken')).toBeNull();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: 'jwt', user: { id: 'u', email: 'victim-target@example.org', name: 'Spoofed Name' } }),
    });
    await userEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));
    await waitFor(() => expect(localStorage.getItem('authToken')).toBe('jwt'));
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/auth/verify-token');
    // Persistent "signed in as" uses the email, never the display name.
    expect(screen.getByText(/victim-target@example\.org/)).toBeTruthy();
    expect(screen.queryByText(/Spoofed Name/)).toBeNull();
  });

  it('skips the token entirely when this browser is already signed in', async () => {
    localStorage.setItem('authToken', 'existing');
    localStorage.setItem('user', JSON.stringify({ email: 'me@example.org' }));
    renderAt('/auth/verify?token=tok&next=%2Fe%2Fparty');
    expect(await screen.findByText('me@example.org')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect((await screen.findByTestId('where')).textContent).toBe('/e/party');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBe('existing');
  });

  it('on a bad token shows a message and "Continue without signing in" to the sanitized next', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    renderAt('/auth/verify?token=tok&next=%2Fe%2Fparty');
    expect(await screen.findByText(/expired or was already used/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /continue without signing in/i }));
    expect((await screen.findByTestId('where')).textContent).toBe('/e/party');
  });

  it('ignores an unsafe next', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    renderAt('/auth/verify?token=tok&next=%2F%2Fevil.example');
    await userEvent.click(await screen.findByRole('button', { name: /continue without signing in/i }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
  });
});
