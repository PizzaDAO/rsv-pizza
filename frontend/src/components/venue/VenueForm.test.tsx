import '../../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VenueForm } from './VenueForm';

// --- Google Maps API Mock ---

// Mock place details returned by getDetails
const mockPlaceDetails = {
  name: "Joe's Pizza",
  formatted_address: '7 Carmine St, New York, NY 10014, USA',
  formatted_phone_number: '(212) 366-1182',
  website: 'https://www.joespizzanyc.com',
  place_id: 'ChIJmwpQ1HBZwokR9w',
};

// Mock predictions from autocomplete

// Will be assigned by our mock Autocomplete constructor
let placesChangedCallback: (() => void) | null = null;
let mockGetPlace: ReturnType<typeof vi.fn>;
let mockGetDetails: ReturnType<typeof vi.fn>;
let mockFindPlaceFromQuery: ReturnType<typeof vi.fn>;
let mockGetPlacePredictions: ReturnType<typeof vi.fn>;
let mockAutocompleteSetFields: ReturnType<typeof vi.fn>;
// Track Autocomplete constructor calls manually since we use a plain function
let autocompleteConstructorCalls: Array<[HTMLInputElement, any]> = [];

function setupGoogleMapsMock() {
  placesChangedCallback = null;
  mockGetPlace = vi.fn();
  mockGetDetails = vi.fn();
  mockFindPlaceFromQuery = vi.fn();
  mockGetPlacePredictions = vi.fn();
  mockAutocompleteSetFields = vi.fn();
  autocompleteConstructorCalls = [];

  // Mock Autocomplete class - must use function keyword for `new` to work
  function MockAutocomplete(this: any, inputEl: HTMLInputElement, options: any) {
    autocompleteConstructorCalls.push([inputEl, options]);
    this.addListener = vi.fn(function (event: string, cb: () => void) {
      if (event === 'place_changed') {
        placesChangedCallback = cb;
      }
    });
    this.getPlace = mockGetPlace;
    this.setFields = mockAutocompleteSetFields;
    this.setBounds = vi.fn();
    this.setOptions = vi.fn();
  }

  // Mock AutocompleteService
  function MockAutocompleteService(this: any) {
    this.getPlacePredictions = mockGetPlacePredictions;
  }

  // Mock PlacesService
  function MockPlacesService(this: any) {
    this.findPlaceFromQuery = mockFindPlaceFromQuery;
    this.getDetails = mockGetDetails;
  }

  // Set up window.google.maps.places
  (window as any).google = {
    maps: {
      places: {
        Autocomplete: MockAutocomplete,
        AutocompleteService: MockAutocompleteService,
        PlacesService: MockPlacesService,
        PlacesServiceStatus: {
          OK: 'OK',
          ZERO_RESULTS: 'ZERO_RESULTS',
          ERROR: 'ERROR',
        },
      },
      event: {
        clearInstanceListeners: vi.fn(),
      },
    },
  };
}

describe('VenueForm', () => {
  const mockOnSave = vi.fn().mockResolvedValue(undefined);
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupGoogleMapsMock();
  });
  // The "Add Venue" flow is a single LocationAutocomplete search. Picking a place
  // auto-creates the venue (enriched with phone/website from Places) and closes the modal.
  // Editing an existing venue shows the full form instead.
  const SEARCH_PLACEHOLDER = /search for a venue/i;

  const existingVenue = {
    id: 'venue-1',
    partyId: 'party-1',
    name: 'Existing Venue',
    address: '123 Main St',
    website: 'https://example.com',
    capacity: 100,
    cost: 500,
    organization: null,
    pointPerson: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    status: 'confirmed' as const,
    isSelected: false,
    notes: null,
    pros: null,
    cons: null,
    latitude: null,
    longitude: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  // =============================================
  // Test 1: Search input renders and is wired to Google Places Autocomplete
  // =============================================
  describe('Search autocomplete', () => {
    it('renders a single venue search input wired to Google Places autocomplete', async () => {
      // The Google Places Autocomplete widget handles predictions natively.
      // We verify that the Autocomplete constructor was called on the input,
      // which means the input is hooked up for autocomplete.
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      const searchInput = await screen.findByPlaceholderText(SEARCH_PLACEHOLDER);
      expect(searchInput).toBeTruthy();
      fireEvent.focus(searchInput); // Google autocomplete loads on first focus

      await waitFor(() => {
        expect(autocompleteConstructorCalls.length).toBeGreaterThan(0);
      });

      // The first argument to the Autocomplete constructor should be the input element
      expect(autocompleteConstructorCalls[0][0]).toBe(searchInput);
    });

    it('configures autocomplete with establishment type for venue search', async () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      fireEvent.focus(await screen.findByPlaceholderText(SEARCH_PLACEHOLDER));
      await waitFor(() => {
        expect(autocompleteConstructorCalls.length).toBeGreaterThan(0);
      });

      // Check the options passed to Autocomplete constructor
      const options = autocompleteConstructorCalls[0][1];
      expect(options.types).toContain('establishment');
    });

    it('accepts plain text without creating a venue', async () => {
      const user = userEvent.setup();

      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      const searchInput = await screen.findByPlaceholderText(SEARCH_PLACEHOLDER);
      await user.type(searchInput, "Joe's Pizza NYC");

      expect(searchInput).toHaveValue("Joe's Pizza NYC");
      // Typing alone must not look anything up or save; only picking a suggestion does.
      expect(mockFindPlaceFromQuery).not.toHaveBeenCalled();
      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  // =============================================
  // Test 2: Selecting an autocomplete suggestion auto-creates the venue
  // =============================================
  describe('Autocomplete selection creates the venue', () => {
    it('saves name, address, phone, website and coordinates when a place is selected, then closes', async () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // What Autocomplete.getPlace returns when the user picks a suggestion
      mockGetPlace.mockReturnValue({
        name: "Joe's Pizza",
        formatted_address: '7 Carmine St, New York, NY 10014, USA',
        place_id: 'ChIJmwpQ1HBZwokR9w',
        geometry: { location: { lat: () => 40.7308, lng: () => -74.0021 } },
      });

      // Enrichment: text search for the place_id, then getDetails for phone/website
      mockFindPlaceFromQuery.mockImplementation(
        (_request: any, callback: (results: any[], status: string) => void) => {
          callback([{ place_id: 'ChIJmwpQ1HBZwokR9w' }], 'OK');
        }
      );
      mockGetDetails.mockImplementation(
        (_request: any, callback: (place: any, status: string) => void) => {
          callback(mockPlaceDetails, 'OK');
        }
      );

      // Trigger the place_changed callback (simulates user selecting a suggestion)
      // The Google script/autocomplete now loads on first focus, not on mount.
      fireEvent.focus(screen.getAllByRole('textbox')[0]);
      await waitFor(() => {
        expect(placesChangedCallback).toBeTruthy();
      });
      placesChangedCallback!();

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Joe's Pizza",
            address: '7 Carmine St, New York, NY 10014, USA',
            contactPhone: '(212) 366-1182',
            website: 'https://www.joespizzanyc.com',
            latitude: 40.7308,
            longitude: -74.0021,
          })
        );
      });

      // Place details are looked up by the place_id found via the text search
      expect(mockGetDetails.mock.calls[0][0].placeId).toBe('ChIJmwpQ1HBZwokR9w');
      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('still saves the venue (without phone/website) when the details lookup finds nothing', async () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      mockGetPlace.mockReturnValue({
        name: 'Margherita Pizza',
        formatted_address: '100 Main St, Brooklyn, NY',
        place_id: 'ChIJtest456',
      });
      mockFindPlaceFromQuery.mockImplementation(
        (_request: any, callback: (results: any[], status: string) => void) => {
          callback([], 'ZERO_RESULTS');
        }
      );

      // The Google script/autocomplete now loads on first focus, not on mount.
      fireEvent.focus(screen.getAllByRole('textbox')[0]);
      await waitFor(() => {
        expect(placesChangedCallback).toBeTruthy();
      });
      placesChangedCallback!();

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Margherita Pizza',
            address: '100 Main St, Brooklyn, NY',
            website: undefined,
            contactPhone: undefined,
          })
        );
      });
      expect(mockGetDetails).not.toHaveBeenCalled();
    });

    it('passes the initial status through to the created venue', async () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} initialStatus="researching" />
      );

      mockGetPlace.mockReturnValue({
        name: 'Margherita Pizza',
        formatted_address: '100 Main St, Brooklyn, NY',
        place_id: 'ChIJtest456',
      });
      mockFindPlaceFromQuery.mockImplementation(
        (_request: any, callback: (results: any[], status: string) => void) => {
          callback([], 'ZERO_RESULTS');
        }
      );

      // The Google script/autocomplete now loads on first focus, not on mount.
      fireEvent.focus(screen.getAllByRole('textbox')[0]);
      await waitFor(() => {
        expect(placesChangedCallback).toBeTruthy();
      });
      placesChangedCallback!();

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'researching' })
        );
      });
    });
  });

  // =============================================
  // Test 3: Edit mode shows the full form, not the search input
  // =============================================
  describe('Edit mode', () => {
    it('does not show the search input when editing an existing venue', () => {
      render(
        <VenueForm venue={existingVenue} onSave={mockOnSave} onClose={mockOnClose} />
      );

      // The search input should NOT be present in edit mode
      expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
    });

    it('renders the full set of venue fields prefilled from the existing venue', () => {
      render(
        <VenueForm venue={existingVenue} onSave={mockOnSave} onClose={mockOnClose} />
      );

      expect(screen.getByPlaceholderText('Venue Name *')).toHaveValue('Existing Venue');
      expect(screen.getByPlaceholderText('Address')).toHaveValue('123 Main St');
      expect(screen.getByPlaceholderText('Website / Map Link')).toHaveValue('https://example.com');
      expect(screen.getByPlaceholderText('Contact Phone')).toBeTruthy();
    });

    it('includes edited data in the save payload', async () => {
      const user = userEvent.setup();

      render(
        <VenueForm venue={existingVenue} onSave={mockOnSave} onClose={mockOnClose} />
      );

      await user.type(screen.getByPlaceholderText('Contact Phone'), '(212) 366-1182');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Existing Venue',
            address: '123 Main St',
            website: 'https://example.com',
            contactPhone: '(212) 366-1182',
          })
        );
      });
    });
  });
});
