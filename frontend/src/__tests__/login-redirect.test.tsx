/**
 * /login?redirect= is stored in sessionStorage.authReturnUrl and navigated to after sign-in.
 * It must only accept local paths: "/\evil.com" or "//evil.com" would be an open redirect
 * (react-router <= 7.17 turns a backslash path into an off-site navigation, GHSA-wrjc-x8rr-h8h6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, signIn: vi.fn() }),
}));
vi.mock('../components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { LoginPage } from '../pages/LoginPage';

function renderAt(url: string) {
  render(<MemoryRouter initialEntries={[url]}><LoginPage /></MemoryRouter>);
}

beforeEach(() => sessionStorage.clear());

describe('LoginPage ?redirect=', () => {
  it('stores a local path', () => {
    renderAt('/login?redirect=' + encodeURIComponent('/host/abc?tab=guests'));
    expect(sessionStorage.getItem('authReturnUrl')).toBe('/host/abc?tab=guests');
  });

  it.each(['/\\evil.com', '//evil.com', 'https://evil.com', 'javascript:alert(1)'])('ignores %s', (bad) => {
    renderAt('/login?redirect=' + encodeURIComponent(bad));
    expect(sessionStorage.getItem('authReturnUrl')).toBeNull();
  });
});
