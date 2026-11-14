/**
 * rsvp-overwrite-fix (frontend):
 * - the RSVP submit sends the login (so a logged-in owner can still edit their RSVP) and
 *   picks up the guest capability token; the walletShared name leak is gone;
 * - the success screen reads true whether the email was new or already on the list
 *   (the backend answers both the same way for anyone but the logged-in owner);
 * - the discount calls carry the guest token from the check-in link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../i18n';
import { render, screen } from '@testing-library/react';

const authState = vi.hoisted(() => ({ user: null as null | { email: string } }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}), channel: () => ({}), removeChannel: () => Promise.resolve() }),
}));
vi.mock('../components/ShareRSVP', () => ({ ShareRSVP: () => null }));
vi.mock('../lib/nftContract', () => ({ getNFTViewUrl: () => '', getChainConfig: () => ({ explorerUrl: '' }) }));

import { addGuestToParty } from '../lib/supabase';
import { getDiscountStatus, claimDiscount } from '../lib/api';
import { RSVPFlowContent } from '../components/RSVPFlowContent';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  authState.user = null;
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({
      success: true,
      guest: { id: 'g-new', name: 'Al', status: 'CONFIRMED', waitlistPosition: null },
      guestToken: 'tok-abc',
      requireApproval: false,
      waitlisted: false,
      waitlistPosition: null,
      walletShared: { withName: 'Someone Else' },
      message: 'ok',
    }),
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const submit = () =>
  addGuestToParty('p1', 'Al', [], [], [], [], [], 'al@example.com', undefined, [], false, 'abc123');

describe('addGuestToParty', () => {
  it('sends no Authorization header when logged out', async () => {
    await submit();
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends the login so the backend can let the owner edit an existing RSVP', async () => {
    localStorage.setItem('authToken', 'jwt-1');
    await submit();
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-1');
  });

  it('returns the guest token and drops any walletShared name', async () => {
    const res = await submit();
    expect(res.guestToken).toBe('tok-abc');
    expect(res).not.toHaveProperty('walletShared');
    expect(JSON.stringify(res)).not.toContain('Someone Else');
  });
});

describe('discount calls carry the guest token', () => {
  it('adds ?t= when the check-in link had one', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await getDiscountStatus('abc123', 'g1', 'tok/+=');
    await claimDiscount('abc123', 'g1', 'tok/+=');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/checkin\/abc123\/g1\/discount\?t=tok%2F%2B%3D$/);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\?t=tok%2F%2B%3D$/);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
  });
  it('no token: plain path', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await getDiscountStatus('abc123', 'g1');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/discount$/);
  });
});

describe('RSVP success screen', () => {
  const form = (over: Record<string, unknown> = {}) =>
    ({
      submitted: true,
      email: 'al@example.com',
      ethereumAddress: '',
      wasUpdated: false,
      alreadyRegistered: false,
      waitlisted: false,
      pendingApproval: false,
      waitlistPosition: null,
      ...over,
    }) as any;
  const event = { id: 'p1', name: 'Pizza Night', inviteCode: 'abc123', customUrl: null, date: null, nftEnabled: false } as any;
  const renderIt = (f: any) =>
    render(<RSVPFlowContent event={event} form={f} eventName="Pizza Night" closeButtonLabel="Close" onClose={() => {}} twitterHandles={[]} />);

  it('logged out: neutral title + note that an earlier RSVP is unchanged', () => {
    renderIt(form());
    expect(screen.getByText("You're on the list!")).toBeInTheDocument();
    expect(screen.getByText(/Already RSVP'd with this email\? Your original RSVP stays as it was/)).toBeInTheDocument();
    expect(screen.queryByText(/already on the guest list for/)).not.toBeInTheDocument();
  });

  it('logged in as the RSVP email: the usual title, no note', () => {
    authState.user = { email: 'AL@example.com' };
    renderIt(form());
    expect(screen.getByText('See you at Pizza Night!')).toBeInTheDocument();
    expect(screen.queryByText(/Already RSVP'd with this email/)).not.toBeInTheDocument();
  });

  it('owner edit: "RSVP Updated", no note', () => {
    authState.user = { email: 'al@example.com' };
    renderIt(form({ wasUpdated: true }));
    expect(screen.getByText('RSVP Updated')).toBeInTheDocument();
    expect(screen.queryByText(/Already RSVP'd with this email/)).not.toBeInTheDocument();
  });
});
