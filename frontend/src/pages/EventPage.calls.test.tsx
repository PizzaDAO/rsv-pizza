import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';

// Counts the network calls EventPage makes while auth resolves (loading -> signed-in user). Before the fix every
// call below ran twice (the load effect depended on user?.email) and the page view was double-counted.

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name?: string }, loading: true, signOut: () => {} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));

const EVENT = vi.hoisted(() => ({
  id: 'party-1', name: 'Slice Night', inviteCode: 'abc123', customUrl: 'slice-night', userId: 'owner', hasPassword: false,
  donationEnabled: true, eventSeriesId: null, coHosts: [], selectedPizzerias: [], eventTags: [], date: null, timezone: 'UTC',
  photosEnabled: true, address: null, description: null, eventImageUrl: null,
}));
const api = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  getPhotoStats: vi.fn(),
  getDonationStats: vi.fn(),
  checkEventHost: vi.fn(),
  verifyTweet: vi.fn(),
  trackLinkClick: vi.fn(),
}));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), ...api }));
const supa = vi.hoisted(() => ({ getMyGuest: vi.fn(), verifyPartyPassword: vi.fn() }));
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()), ...supa }));
vi.mock('../lib/seriesSites', () => ({ redirectForeignEvent: vi.fn(async () => false) }));

// Everything below the page is irrelevant to call counting.
const stub = vi.hoisted(() => (name: string) => ({ [name]: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/Header', () => stub('Header'));
vi.mock('../components/Footer', () => stub('Footer'));
vi.mock('../components/CornerLinks', () => stub('CornerLinks'));
vi.mock('../components/GPPClouds', () => stub('GPPClouds'));
vi.mock('../components/RSVPModal', () => stub('RSVPModal'));
vi.mock('../components/DonationStep', () => stub('DonationStep'));
vi.mock('../components/DonorHighlights', () => stub('DonorHighlights'));
vi.mock('../components/LoginModal', () => stub('LoginModal'));
vi.mock('../components/photos', () => stub('PhotoGallery'));
vi.mock('../components/gpp', () => stub('GPPBadge'));
vi.mock('../components/music', () => stub('MusicWidget'));
vi.mock('../components/PizzaChefModal', () => stub('PizzaChefModal'));
vi.mock('../components/PizzaDAOModal', () => stub('PizzaDAOModal'));
vi.mock('../components/AddToCalendarPopup', () => stub('AddToCalendarPopup'));
vi.mock('../components/ParticipatingPizzerias', () => stub('ParticipatingPizzerias'));
vi.mock('../components/LastYearPhotos', () => stub('LastYearPhotos'));
vi.mock('../components/VenueMap', () => ({ default: () => null }));
vi.mock('../components/CheckInButton', () => stub('CheckInButton'));
vi.mock('../components/CheckInScanner', () => stub('CheckInScanner'));
vi.mock('../components/scorecard', () => stub('GuestScorecard'));
vi.mock('../components/NftClaimCard', () => stub('NftClaimCard'));
vi.mock('../components/hackathon/HackathonSection', () => stub('HackathonSection'));

import { EventPage } from './EventPage';

const renderPage = () => render(
  <HelmetProvider>
    <MemoryRouter initialEntries={['/slice-night']}><Routes><Route path="/:slug" element={<EventPage />} /></Routes></MemoryRouter>
  </HelmetProvider>,
);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null;
  auth.loading = true;
  api.getEventBySlug.mockResolvedValue(EVENT);
  api.getPhotoStats.mockResolvedValue({ totalPhotos: 0 });
  api.getDonationStats.mockResolvedValue({ enabled: false });
  api.checkEventHost.mockResolvedValue({ isHost: false, canEdit: false });
  supa.getMyGuest.mockResolvedValue(null);
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('EventPage network calls', () => {
  it('fetches the event, stats and page view once even when auth resolves afterwards', async () => {
    const view = renderPage();
    await waitFor(() => expect(api.getEventBySlug).toHaveBeenCalledTimes(1));

    // Auth resolves to a signed-in non-host.
    auth.user = { id: 'u1', email: 'guest@example.org' };
    auth.loading = false;
    await act(async () => { view.rerender(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/slice-night']}><Routes><Route path="/:slug" element={<EventPage />} /></Routes></MemoryRouter>
      </HelmetProvider>,
    ); });
    await waitFor(() => expect(supa.getMyGuest).toHaveBeenCalledTimes(1));

    expect(api.getEventBySlug).toHaveBeenCalledTimes(1);
    expect(api.getPhotoStats).toHaveBeenCalledTimes(1);
    expect(api.getDonationStats).toHaveBeenCalledTimes(1);
    expect(api.checkEventHost).toHaveBeenCalledTimes(1);
    const views = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/view'));
    expect(views).toHaveLength(1);
    void screen;
  });

  it('makes no user-specific calls for an anonymous visitor', async () => {
    auth.loading = false;
    renderPage();
    await waitFor(() => expect(api.getEventBySlug).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(supa.getMyGuest).not.toHaveBeenCalled();
    expect(api.checkEventHost).not.toHaveBeenCalled();
  });
});
