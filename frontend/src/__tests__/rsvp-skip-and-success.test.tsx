/**
 * RSVP flow UX: step 2 can be skipped (submits with no prefs, one POST), and the
 * success screen shows the event recap, confirmation line (new RSVPs only), a way
 * back to the event, and a neutral "already on the list" state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../i18n';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, setUser: vi.fn() }) }));
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
vi.mock('../lib/supabase', () => ({
  addGuestToParty: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue(null),
  saveUserPreferences: vi.fn().mockResolvedValue(undefined),
  verifyRsvpEmailCode: vi.fn(),
}));

import { addGuestToParty } from '../lib/supabase';
import { useRSVPForm, RSVPEventData } from '../hooks/useRSVPForm';
import { RSVPFlowContent } from '../components/RSVPFlowContent';

const eventData: RSVPEventData = {
  id: 'p1', name: 'Pizza Night', inviteCode: 'abc123', customUrl: null, address: null,
  availableBeverages: [], availableToppings: [], availableDietaryOptions: [],
};
const event = {
  id: 'p1', name: 'Pizza Night', inviteCode: 'abc123', customUrl: null,
  date: '2030-06-01T18:00:00Z', timezone: 'UTC', venueName: 'Joe Pizzeria', city: 'Austin',
  nftEnabled: false,
} as any;

const onClose = vi.fn();
function Harness() {
  const form = useRSVPForm({ eventData, user: null });
  useEffect(() => {
    form.setName('Ivy');
    form.setEmail('ivy@example.com');
    form.setStep(2);
  }, []);
  return <RSVPFlowContent event={event} form={form} eventName="Pizza Night" closeButtonLabel="Close" onClose={onClose} twitterHandles={[]} />;
}

const result = (over: object = {}) => ({
  guest: { id: 'g1' }, guestToken: 't', emailSent: true, alreadyRegistered: false, requireApproval: false,
  updated: false, waitlisted: false, waitlistPosition: null, ...over,
});

beforeEach(() => {
  vi.mocked(addGuestToParty).mockReset();
  onClose.mockClear();
});

describe('step 2 skip', () => {
  it('skip submits with no preferences and shows the success recap', async () => {
    vi.mocked(addGuestToParty).mockResolvedValue(result() as any);
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('rsvp-skip-prefs'));

    await waitFor(() => expect(screen.getByText('See you at Pizza Night!')).toBeInTheDocument());
    expect(addGuestToParty).toHaveBeenCalledTimes(1);
    const args = vi.mocked(addGuestToParty).mock.calls[0];
    expect(args[1]).toBe('Ivy');
    expect(args[2]).toEqual([]); // dietary
    expect(args[3]).toEqual([]); // liked toppings
    expect(screen.getByTestId('rsvp-recap')).toHaveTextContent('Joe Pizzeria, Austin');
    expect(screen.getByTestId('rsvp-recap')).toHaveTextContent(/June 1/);
    expect(screen.getByTestId('rsvp-confirmation-sent')).toHaveTextContent('Confirmation sent to ivy@example.com');
    await user.click(screen.getByTestId('rsvp-back-to-event'));
    expect(onClose).toHaveBeenCalled();
  });

  it('skip is hidden once a preference is chosen (prefs are never dropped)', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    expect(await screen.findByTestId('rsvp-skip-prefs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vegan' }));
    expect(screen.queryByTestId('rsvp-skip-prefs')).toBeNull();
  });

  it('the close button and dialog are labelled', async () => {
    render(<Harness />);
    expect(await screen.findByRole('dialog', { name: /Pizza Requests/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('success screen states', () => {
  it('already registered is neutral and shows no confirmation line', async () => {
    vi.mocked(addGuestToParty).mockResolvedValue(result({ alreadyRegistered: true }) as any);
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('rsvp-skip-prefs'));
    await waitFor(() => expect(screen.getByText("You're already on the list")).toBeInTheDocument());
    expect(screen.queryByTestId('rsvp-confirmation-sent')).toBeNull();
    expect(screen.queryByText(/already registered!/)).toBeNull();
  });

  it('no confirmation line when the backend did not send an email', async () => {
    vi.mocked(addGuestToParty).mockResolvedValue(result({ emailSent: false }) as any);
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('rsvp-skip-prefs'));
    await waitFor(() => expect(screen.getByText('See you at Pizza Night!')).toBeInTheDocument());
    expect(screen.queryByTestId('rsvp-confirmation-sent')).toBeNull();
  });
});
