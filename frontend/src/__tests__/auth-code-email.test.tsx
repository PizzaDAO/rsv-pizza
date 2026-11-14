/**
 * invite-verify: every frontend call to POST /api/auth/verify-code sends the email the code
 * was sent to, so the backend's legacy code-only lookup (weak against brute force) can be
 * retired. Covers: signIn remembering the email, AuthVerifyPage sending it (or asking for it),
 * the shared postVerifyCode helper, and a guard that no file calls the endpoint directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../i18n';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const setUser = vi.hoisted(() => vi.fn());
vi.mock('../contexts/AuthContext', async (orig) => ({
  ...(await orig<typeof import('../contexts/AuthContext')>()),
  useAuth: () => ({ user: null, setUser }),
}));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { AuthVerifyPage } from '../pages/AuthVerifyPage';
import { postVerifyCode, rememberAuthCodeEmail, getAuthCodeEmail } from '../lib/authCodeEmail';

let fetchMock: ReturnType<typeof vi.fn>;
const verifyCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/auth/verify-code'));
const bodyOf = (c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setUser.mockClear();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, accessToken: 'jwt', user: { id: 'u', email: 'al@example.com' } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function typeCode(code: string) {
  const user = userEvent.setup();
  for (let i = 0; i < 6; i++) await user.type(screen.getByTestId(`verify-code-${i}`), code[i]);
}

describe('postVerifyCode', () => {
  it('always sends the (normalized) email with the code', async () => {
    await postVerifyCode('123456', ' Al@Example.com ', { name: 'Al' });
    expect(bodyOf(verifyCalls()[0])).toEqual({ code: '123456', email: 'al@example.com', name: 'Al' });
  });
});

describe('signIn remembers which email the code went to', () => {
  it('stores it for the code-entry page', async () => {
    const { AuthProvider, useAuth: realUseAuth } = await vi.importActual<typeof import('../contexts/AuthContext')>('../contexts/AuthContext');
    let ctx!: ReturnType<typeof realUseAuth>;
    function Probe() { ctx = realUseAuth(); return null; }
    render(<AuthProvider><Probe /></AuthProvider>);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, isNewUser: false }) });
    await ctx.signIn('Al@Example.com');
    expect(getAuthCodeEmail()).toBe('al@example.com');
  });
});

describe('AuthVerifyPage', () => {
  const renderPage = () => render(<MemoryRouter><AuthVerifyPage /></MemoryRouter>);

  it('sends the remembered email with the code', async () => {
    rememberAuthCodeEmail('al@example.com');
    renderPage();
    expect(screen.queryByTestId('verify-code-email')).not.toBeInTheDocument();
    await typeCode('123456');
    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(bodyOf(verifyCalls()[0])).toEqual({ code: '123456', email: 'al@example.com' });
    expect(getAuthCodeEmail()).toBeNull(); // cleared after a successful login
  });

  it('no remembered email (new tab): asks for it with a placeholder-only field and sends it', async () => {
    renderPage();
    const field = screen.getByTestId('verify-code-email');
    expect(field).toHaveAttribute('placeholder');
    await userEvent.setup().type(field, 'Al@Example.com');
    await typeCode('654321');
    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(bodyOf(verifyCalls()[0])).toEqual({ code: '654321', email: 'al@example.com' });
  });

  it('no email at all: never calls the code-only endpoint', async () => {
    renderPage();
    await typeCode('111111');
    expect(verifyCalls()).toHaveLength(0);
  });
});

describe('guard: no direct calls to /api/auth/verify-code', () => {
  it('only lib/authCodeEmail.ts calls the endpoint, so every caller sends the email', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.(ts|tsx)$/.test(f)) continue;
        const rel = relative(root, p);
        if (rel === join('lib', 'authCodeEmail.ts')) continue;
        const code = readFileSync(p, 'utf8')
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // ignore comments
          .join('\n');
        if (code.includes('/api/auth/verify-code')) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
