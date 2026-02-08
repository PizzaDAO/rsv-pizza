import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RSVPModal } from './RSVPModal';
import type { ExistingGuestData } from '../lib/supabase';
import type { PublicEvent } from '../lib/api';

// Mock all external dependencies
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('../lib/supabase', () => ({
  addGuestToParty: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue(null),
  saveUserPreferences: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/ordering', () => ({
  searchPizzerias: vi.fn().mockResolvedValue([]),
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));

vi.mock('../hooks/useMintNFT', () => ({
  useMintNFT: () => ({ mint: vi.fn() }),
}));

vi.mock('../lib/nftContract', () => ({
  NFT_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000000',
}));

const makeEvent = (overrides?: Partial<PublicEvent>): PublicEvent => ({
  id: 'party-1',
  name: 'Test Pizza Party',
  inviteCode: 'test123',
  customUrl: null,
  date: null,
  duration: null,
  timezone: null,
  pizzaStyle: 'New York',
  availableBeverages: [],
  availableToppings: [],
  address: null,
  venueName: null,
  maxGuests: null,
  hideGuests: false,
  eventImageUrl: null,
  description: null,
  rsvpClosedAt: null,
  coHosts: [],
  hasPassword: false,
  hostName: null,
  hostProfile: null,
  guestCount: 5,
  userId: null,
  ...overrides,
});

const makeExistingGuest = (overrides?: Partial<ExistingGuestData>): ExistingGuestData => ({
  id: 'guest-1',
  name: 'Test User',
  email: 'test@example.com',
  ethereumAddress: null,
  roles: [],
  mailingListOptIn: false,
  dietaryRestrictions: [],
  likedToppings: ['pepperoni'],
  dislikedToppings: ['anchovies'],
  likedBeverages: [],
  dislikedBeverages: [],
  pizzeriaRankings: [],
  ...overrides,
});

describe('RSVPModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset body class
    document.body.classList.remove('modal-open');
  });

  it('should stay on success screen when existingGuest prop changes after submission', async () => {
    const user = userEvent.setup();
    const { addGuestToParty } = await import('../lib/supabase');
    const mockAddGuest = vi.mocked(addGuestToParty);

    // Mock a successful update response
    mockAddGuest.mockResolvedValue({
      guest: { id: 'guest-1', party_id: 'party-1', name: 'Test User' } as any,
      alreadyRegistered: false,
      requireApproval: false,
      updated: true,
    });

    const event = makeEvent();
    const existingGuest = makeExistingGuest();
    const onClose = vi.fn();
    const onRSVPSuccess = vi.fn();

    const { rerender } = render(
      <RSVPModal
        isOpen={true}
        onClose={onClose}
        event={event}
        existingGuest={existingGuest}
        onRSVPSuccess={onRSVPSuccess}
      />
    );

    // The modal should open on step 1 with pre-filled data
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();

    // Click "Next" to go to step 2
    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    // Should now be on step 2
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();

    // Submit the form (click "Edit RSVP" button)
    const submitButton = screen.getByRole('button', { name: /edit rsvp/i });
    await user.click(submitButton);

    // Wait for submission to complete and success screen to appear
    await waitFor(() => {
      expect(screen.getByText('RSVP Updated!')).toBeInTheDocument();
    });

    // Now simulate what happens in EventPage.onRSVPSuccess:
    // The parent refetches guest data and passes a new existingGuest object
    const updatedGuest = makeExistingGuest({
      likedToppings: ['pepperoni', 'mushrooms'], // changed preference
    });

    rerender(
      <RSVPModal
        isOpen={true}
        onClose={onClose}
        event={event}
        existingGuest={updatedGuest}
        onRSVPSuccess={onRSVPSuccess}
      />
    );

    // BUG: The modal should STILL show the success screen,
    // not reset back to step 1
    expect(screen.getByText('RSVP Updated!')).toBeInTheDocument();
    expect(screen.queryByText('Step 1 of 2')).not.toBeInTheDocument();
  });
});
