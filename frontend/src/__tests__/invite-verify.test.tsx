/**
 * invite-verify (frontend):
 * - a host invite link's ?t= token is captured (and stripped from the URL) and sent with
 *   the RSVP submit, along with `codeStep: true`;
 * - a 202 `verificationRequired` answer shows an inline 6-digit code step in the RSVP form;
 * - the right code signs the browser in and re-submits the same RSVP as the owner;
 * - a wrong code shows an error and saves nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../i18n';
import React, { useEffect } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setUser = vi.hoisted(() => vi.fn());
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, setUser }) }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}), channel: () => ({}), removeChannel: () => Promise.resolve() }),
}));
vi.mock('../components/ShareRSVP', () => ({ ShareRSVP: () => null }));
vi.mock('../lib/nftContract', () => ({ getNFTViewUrl: () => '', getChainConfig: () => ({ explorerUrl: '' }) }));
vi.mock('../lib/ordering', () => ({
  searchPizzerias: vi.fn().mockResolvedValue([]),
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  trackRsvpFunnel: vi.fn(),
}));

import { addGuestToParty, verifyRsvpEmailCode, RsvpVerificationRequiredError } from '../lib/supabase';
import { captureInviteToken, getInviteToken } from '../lib/inviteToken';
import { useRSVPForm, RSVPEventData } from '../hooks/useRSVPForm';
import { RSVPFlowContent } from '../components/RSVPFlowContent';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' });

function rsvpCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/rsvp/'));
}
function bodyOf(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setUser.mockClear();
  window.history.replaceState(null, '', '/');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/auth/verify-code')) {
      const b = JSON.parse(init!.body as string);
      return b.code === '123456' && b.email === 'ivy@example.com'
        ? json(200, { success: true, accessToken: 'jwt-ivy', user: { id: 'u-ivy', email: 'ivy@example.com', name: 'Ivy' } })
        : json(401, { error: { code: 'INVALID_CODE', message: 'Invalid code' } });
    }
    if (url.includes('/api/rsvp/')) {
      const h = (init!.headers ?? {}) as Record<string, string>;
      return h.Authorization === 'Bearer jwt-ivy'
        ? json(200, { success: true, updated: true, guest: { id: 'g-ivy', name: 'Ivy' }, guestToken: 'tok-ivy', message: 'Your RSVP has been updated!' })
        : json(202, { success: false, verificationRequired: true, email: 'ivy@example.com', message: 'We sent a sign-in code to ivy@example.com.' });
    }
    return json(200, {});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const submit = () =>
  addGuestToParty('p1', 'Ivy', [], [], [], [], [], 'ivy@example.com', undefined, [], false, 'abc123');

describe('invite link token', () => {
  it('captureInviteToken keeps ?t= for this tab and strips it from the address bar (other params stay)', () => {
    window.history.replaceState(null, '', `/my-party?t=${TOKEN}&year=2026#x`);
    captureInviteToken();
    expect(getInviteToken()).toBe(TOKEN);
    expect(window.location.search).toBe('?year=2026');
    expect(window.location.hash).toBe('#x');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('ignores junk tokens', () => {
    window.history.replaceState(null, '', '/my-party?t=<script>');
    captureInviteToken();
    expect(getInviteToken()).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('the RSVP submit carries codeStep and the captured token', async () => {
    window.history.replaceState(null, '', `/my-party?t=${TOKEN}`);
    captureInviteToken();
    fetchMock.mockResolvedValueOnce(json(201, { success: true, guest: { id: 'g1', name: 'Ivy', status: 'CONFIRMED' }, guestToken: 'tok-g1' }));
    await submit();
    const body = bodyOf(rsvpCalls()[0]);
    expect(body.codeStep).toBe(true);
    expect(body.guestToken).toBe(TOKEN);
  });

  it('no invite link: no guestToken in the body', async () => {
    await submit().catch(() => {});
    expect(bodyOf(rsvpCalls()[0])).not.toHaveProperty('guestToken');
  });
});

describe('addGuestToParty / verifyRsvpEmailCode', () => {
  it('a 202 verificationRequired throws RsvpVerificationRequiredError with the email (nothing reported as saved)', async () => {
    const err = await submit().catch((e) => e);
    expect(err).toBeInstanceOf(RsvpVerificationRequiredError);
    expect(err.email).toBe('ivy@example.com');
  });

  it('verifyRsvpEmailCode binds the code to the email and stores the session like a normal login', async () => {
    const u = await verifyRsvpEmailCode('ivy@example.com', '123456', 'Ivy');
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/verify-code'))!;
    expect(bodyOf(call)).toEqual({ code: '123456', email: 'ivy@example.com', name: 'Ivy' });
    expect(u.email).toBe('ivy@example.com');
    expect(localStorage.getItem('authToken')).toBe('jwt-ivy');
    expect(JSON.parse(localStorage.getItem('user')!).email).toBe('ivy@example.com');
  });

  it.each([
    ['INVALID_CODE', 401, /didn't work/],
    ['CODE_EXPIRED', 401, /expired/],
    ['VERIFY_RATE_LIMITED', 429, /Try again in a few minutes/],
  ])('%s: friendly error, no session stored', async (code, status, msg) => {
    fetchMock.mockResolvedValueOnce(json(status, { error: { code } }));
    await expect(verifyRsvpEmailCode('ivy@example.com', '000000')).rejects.toThrow(msg);
    expect(localStorage.getItem('authToken')).toBeNull();
  });
});

describe('inline code step in the RSVP form', () => {
  const eventData: RSVPEventData = {
    id: 'p1', name: 'Pizza Night', inviteCode: 'abc123', customUrl: null, address: null,
    availableBeverages: [], availableToppings: [], availableDietaryOptions: [],
  };
  const event = { id: 'p1', name: 'Pizza Night', inviteCode: 'abc123', customUrl: null, date: null, nftEnabled: false } as any;
  let formRef: ReturnType<typeof useRSVPForm>;

  function Harness() {
    const form = useRSVPForm({ eventData, user: null });
    formRef = form;
    useEffect(() => {
      form.setName('Ivy');
      form.setEmail('Ivy@Example.com');
    }, []); // once, on mount
    return <RSVPFlowContent event={event} form={form} eventName="Pizza Night" closeButtonLabel="Close" onClose={() => {}} twitterHandles={[]} />;
  }

  async function submitForm() {
    render(<Harness />);
    await act(async () => {
      await formRef.handleSubmit({ preventDefault() {} } as React.FormEvent);
    });
  }

  it('shows "We sent a code to <email>" with a placeholder-only code field, and nothing is saved', async () => {
    await submitForm();
    expect(screen.getByTestId('rsvp-code-step')).toBeInTheDocument();
    expect(screen.getByText('ivy@example.com')).toBeInTheDocument();
    expect(screen.getByText(/We sent a code to/)).toBeInTheDocument();
    const input = screen.getByPlaceholderText('6-digit code');
    expect(input.tagName).toBe('INPUT');
    expect(document.querySelector('label')).toBeNull();
    expect(formRef.submitted).toBe(false);
  });

  it('the right code signs in and re-submits as the owner, then shows the success screen', async () => {
    await submitForm();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: /Confirm & RSVP/ }));

    await waitFor(() => expect(screen.getByText('RSVP Updated')).toBeInTheDocument());
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'ivy@example.com' }));
    const calls = rsvpCalls();
    expect(calls).toHaveLength(2);
    expect(((calls[1][1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer jwt-ivy');
    expect(bodyOf(calls[1])).toEqual(bodyOf(calls[0]));
    expect(formRef.guestToken).toBe('tok-ivy');
    // Stale-closure fix: the re-submit knows the just-verified email, so the
    // save-preferences-to-profile step runs as the new login.
    const prefs = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/preferences'));
    expect(prefs).toBeTruthy();
    expect(((prefs![1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer jwt-ivy');
    expect(bodyOf(prefs!).email).toBe('Ivy@Example.com');
  });

  it('send budget used: the 202 carries recentlySent, so the code box still shows with a "check your inbox" hint', async () => {
    fetchMock.mockImplementationOnce(async () =>
      json(202, { success: false, verificationRequired: true, email: 'ivy@example.com', recentlySent: true, message: 'x' }),
    );
    await submitForm();
    expect(screen.getByTestId('rsvp-code-step')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('6-digit code')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-code-recently-sent')).toHaveTextContent(/We recently sent a code/);
  });

  it('a normal 202 shows no "recently sent" hint', async () => {
    await submitForm();
    expect(screen.queryByTestId('rsvp-code-recently-sent')).not.toBeInTheDocument();
  });

  it('a 429 on "Send a new code" shows "try again in a few minutes" in the code step', async () => {
    await submitForm();
    fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'CODE_SEND_LIMIT', message: 'Too many codes requested for this email. Try again in a few minutes.' } }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Try again in a few minutes/));
    expect(screen.getByTestId('rsvp-code-step')).toBeInTheDocument();
  });

  it('a wrong code shows an error, keeps the code step, and does not re-submit', async () => {
    await submitForm();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('6-digit code'), '999999');
    await user.click(screen.getByRole('button', { name: /Confirm & RSVP/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/didn't work/));
    expect(screen.getByTestId('rsvp-code-step')).toBeInTheDocument();
    expect(rsvpCalls()).toHaveLength(1);
    expect(setUser).not.toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('"Send a new code" re-submits (server rate-limits the email); "Use a different email" goes back to step 1', async () => {
    await submitForm();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(rsvpCalls()).toHaveLength(2));
    expect(screen.getByTestId('rsvp-code-step')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.queryByTestId('rsvp-code-step')).not.toBeInTheDocument();
    expect(formRef.step).toBe(1);
  });
});
