import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

const getDisplayForViewer = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ getDisplayForViewer, getDisplayPhotos: vi.fn() }));
const getDisplayHackathon = vi.hoisted(() => vi.fn());
vi.mock('../lib/hackathonGalleryApi', async (orig) => ({ ...(await orig<typeof import('../lib/hackathonGalleryApi')>()), getDisplayHackathon }));

import { DisplayPage } from './DisplayPage';

const PID = '11111111-1111-4111-8111-111111111111';
const viewer = {
  display: { id: 'd1', name: 'TV', slug: 'tv', contentType: 'hackathon', contentConfig: { mode: 'countdown', showQr: false }, rotationInterval: 10, backgroundColor: '#000000', showClock: false, showEventName: false },
  party: { id: PID, name: 'Hack', date: null, address: null, venueName: null, eventImageUrl: null, inviteCode: 'abc', customUrl: null },
  hackathon: { locked: false, submissionsOpenAt: null, submissionDeadline: new Date(Date.now() + 3600_000).toISOString(), resultsRevealedAt: null, galleryOpen: false, tracks: [], projects: [], winners: [] },
};
const pwError = () => Object.assign(new Error('Password required'), { code: 'PASSWORD_REQUIRED' });

function renderAt(url: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/display/:partyId/:slug" element={<DisplayPage />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('DisplayPage password (PR 6 review)', () => {
  it('prompts on PASSWORD_REQUIRED, retries with the typed password and remembers it for the session', async () => {
    getDisplayForViewer.mockImplementation(async (_p: string, _s: string, pw?: string) => {
      if (pw !== 'tvpw') throw pwError();
      return viewer;
    });
    renderAt(`/display/${PID}/tv`);
    expect(await screen.findByTestId('display-password')).toBeTruthy();
    expect(getDisplayForViewer).toHaveBeenLastCalledWith(PID, 'tv', undefined);

    fireEvent.change(screen.getByPlaceholderText('display.passwordPlaceholder'), { target: { value: 'nope' } });
    fireEvent.submit(screen.getByTestId('display-password').querySelector('form')!);
    await waitFor(() => expect(getDisplayForViewer).toHaveBeenLastCalledWith(PID, 'tv', 'nope'));
    expect(await screen.findByText('display.wrongPassword')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('display.passwordPlaceholder'), { target: { value: 'tvpw' } });
    fireEvent.submit(screen.getByTestId('display-password').querySelector('form')!);
    expect(await screen.findByTestId('hk-display-countdown')).toBeTruthy();
    expect(sessionStorage.getItem(`display-pw:${PID}/tv`)).toBe('tvpw');
  });

  it('takes ?password= from the URL', async () => {
    getDisplayForViewer.mockResolvedValue(viewer);
    renderAt(`/display/${PID}/tv?password=fromurl`);
    expect(await screen.findByTestId('hk-display-countdown')).toBeTruthy();
    expect(getDisplayForViewer).toHaveBeenCalledWith(PID, 'tv', 'fromurl');
  });

  it('locked hackathon data shows the countdown only, whatever the mode', async () => {
    getDisplayForViewer.mockResolvedValue({
      ...viewer,
      display: { ...viewer.display, contentConfig: { mode: 'winners', showQr: false } },
      hackathon: { ...viewer.hackathon, locked: true },
    });
    renderAt(`/display/${PID}/tv`);
    expect(await screen.findByTestId('hk-display-countdown')).toBeTruthy();
    expect(screen.queryByText('Winners will be announced soon')).toBeNull();
  });
});
