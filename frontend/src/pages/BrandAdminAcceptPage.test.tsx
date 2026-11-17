import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const auth = vi.hoisted(() => ({ user: { id: 'u1', email: 'partner@example.org' } as any, loading: false }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/LoginModal', () => ({ LoginModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>login-modal</div> : null) }));
const accept = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ acceptBrandAdminInvite: accept }));

import { BrandAdminAcceptPage } from './BrandAdminAcceptPage';

const TOKEN = 'A'.repeat(43);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const renderPage = (url = `/brand-admin/accept?token=${TOKEN}`) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes><Route path="/brand-admin/accept" element={<BrandAdminAcceptPage />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.user = { id: 'u1', email: 'partner@example.org' };
  auth.loading = false;
});

describe('BrandAdminAcceptPage', () => {
  it('strips the token from the address bar and accepts with it on tap', async () => {
    accept.mockResolvedValue({ success: true, seriesId: 's1' });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/brand-admin/accept'));
    fireEvent.click(await screen.findByText('Accept invite'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByText(/You're a brand admin/)).toBeTruthy();
    expect(sessionStorage.getItem('brandAdminInviteToken')).toBeNull();
  });

  it('shows the server error (e.g. wrong email) and keeps the token for a retry', async () => {
    accept.mockRejectedValue(new Error('This invite is for a different email address.'));
    renderPage();
    fireEvent.click(await screen.findByText('Accept invite'));
    expect(await screen.findByText(/different email/)).toBeTruthy();
    expect(sessionStorage.getItem('brandAdminInviteToken')).toBe(TOKEN);
  });

  it('asks signed-out visitors to sign in first and never calls the API', async () => {
    auth.user = null;
    renderPage();
    fireEvent.click(await screen.findByText('Sign in'));
    expect(screen.getByText('login-modal')).toBeTruthy();
    expect(accept).not.toHaveBeenCalled();
  });

  it('reads the token back from storage after the sign-in round trip', async () => {
    sessionStorage.setItem('brandAdminInviteToken', TOKEN);
    accept.mockResolvedValue({ success: true, seriesId: 's1' });
    renderPage('/brand-admin/accept');
    fireEvent.click(await screen.findByText('Accept invite'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(TOKEN));
  });

  it('explains a missing token', async () => {
    renderPage('/brand-admin/accept');
    expect(await screen.findByText('Invite link missing')).toBeTruthy();
  });
});
