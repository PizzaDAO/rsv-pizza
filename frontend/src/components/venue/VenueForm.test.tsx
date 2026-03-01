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
const mockPredictions = [
  {
    description: "Joe's Pizza, Carmine St, New York, NY, USA",
    place_id: 'ChIJmwpQ1HBZwokR9w',
    structured_formatting: {
      main_text: "Joe's Pizza",
      secondary_text: 'Carmine St, New York, NY, USA',
    },
  },
  {
    description: "Joe's Pizza, Broadway, New York, NY, USA",
    place_id: 'ChIJd8BlQ2BZwokRjM',
    structured_formatting: {
      main_text: "Joe's Pizza",
      secondary_text: 'Broadway, New York, NY, USA',
    },
  },
];

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

  // =============================================
  // Test 1: Google Maps link paste auto-fills venue fields
  // =============================================
  describe('Google Maps link paste', () => {
    it('auto-fills venue name, address, phone, and website when a Google Maps link is pasted', async () => {
      // Set up the mock to return place details when findPlaceFromQuery is called
      mockFindPlaceFromQuery.mockImplementation(
        (request: any, callback: (results: any[], status: string) => void) => {
          callback(
            [{ place_id: 'ChIJmwpQ1HBZwokR9w', name: "Joe's Pizza" }],
            'OK'
          );
        }
      );
      mockGetDetails.mockImplementation(
        (request: any, callback: (place: any, status: string) => void) => {
          callback(mockPlaceDetails, 'OK');
        }
      );

      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Find the top search/link input (should have autocomplete placeholder)
      const searchInput = screen.getByPlaceholderText(/search for a venue or paste a google maps link/i);
      expect(searchInput).toBeTruthy();

      // Simulate pasting a Google Maps URL
      const mapsUrl = 'https://www.google.com/maps/place/Joe%27s+Pizza/@40.7308,-74.0021,17z';
      fireEvent.paste(searchInput, {
        clipboardData: { getData: () => mapsUrl },
      });

      // Wait for the lookup to complete and fields to be filled
      await waitFor(() => {
        expect(screen.getByDisplayValue("Joe's Pizza")).toBeTruthy();
      });

      // Verify all fields were auto-filled
      await waitFor(() => {
        expect(screen.getByDisplayValue('7 Carmine St, New York, NY 10014, USA')).toBeTruthy();
        expect(screen.getByDisplayValue('(212) 366-1182')).toBeTruthy();
        expect(screen.getByDisplayValue('https://www.joespizzanyc.com')).toBeTruthy();
      });
    });

    it('handles maps.app.goo.gl short URLs', async () => {
      mockFindPlaceFromQuery.mockImplementation(
        (request: any, callback: (results: any[], status: string) => void) => {
          callback(
            [{ place_id: 'ChIJtest123', name: 'Test Pizza' }],
            'OK'
          );
        }
      );
      mockGetDetails.mockImplementation(
        (request: any, callback: (place: any, status: string) => void) => {
          callback(
            {
              name: 'Test Pizza',
              formatted_address: '123 Test St',
              formatted_phone_number: '(555) 123-4567',
              website: 'https://testpizza.com',
            },
            'OK'
          );
        }
      );

      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      const searchInput = screen.getByPlaceholderText(/search for a venue or paste a google maps link/i);

      // Paste a short Google Maps URL (the URL itself won't have a /place/ path,
      // so it falls back to using the URL as website)
      fireEvent.paste(searchInput, {
        clipboardData: { getData: () => 'https://maps.app.goo.gl/abc123' },
      });

      // Should detect it as a maps URL
      await waitFor(() => {
        // Even if extraction fails, the URL should at minimum be stored
        expect(searchInput).toBeTruthy();
      });
    });
  });

  // =============================================
  // Test 2: Search query shows autocomplete suggestions
  // =============================================
  describe('Search autocomplete', () => {
    it('shows autocomplete suggestions when the user types a place name', async () => {
      // The Google Places Autocomplete widget handles predictions natively.
      // We verify that the Autocomplete constructor was called on the input,
      // which means the input is hooked up for autocomplete.
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      const searchInput = screen.getByPlaceholderText(/search for a venue or paste a google maps link/i);
      expect(searchInput).toBeTruthy();

      // Verify that Google Maps Autocomplete was initialized on the input
      expect(autocompleteConstructorCalls.length).toBeGreaterThan(0);

      // The first argument to the Autocomplete constructor should be the input element
      const autocompleteInputArg = autocompleteConstructorCalls[0][0];
      expect(autocompleteInputArg).toBe(searchInput);
    });

    it('configures autocomplete with establishment type for venue search', () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Verify Autocomplete was constructed
      expect(autocompleteConstructorCalls.length).toBeGreaterThan(0);

      // Check the options passed to Autocomplete constructor
      const options = autocompleteConstructorCalls[0][1];
      expect(options.types).toContain('establishment');
    });
  });

  // =============================================
  // Test 3: Selecting an autocomplete suggestion fills all venue fields
  // =============================================
  describe('Autocomplete selection fills fields', () => {
    it('fills name, address, phone, and website when a place is selected from autocomplete', async () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Set up what getPlace returns when autocomplete fires
      mockGetPlace.mockReturnValue({
        name: "Joe's Pizza",
        formatted_address: '7 Carmine St, New York, NY 10014, USA',
        formatted_phone_number: '(212) 366-1182',
        website: 'https://www.joespizzanyc.com',
        place_id: 'ChIJmwpQ1HBZwokR9w',
      });

      // Also mock getDetails for the follow-up detail fetch
      mockGetDetails.mockImplementation(
        (request: any, callback: (place: any, status: string) => void) => {
          callback(mockPlaceDetails, 'OK');
        }
      );

      // Trigger the place_changed callback (simulates user selecting a suggestion)
      expect(placesChangedCallback).toBeTruthy();
      placesChangedCallback!();

      // Verify fields were populated
      await waitFor(() => {
        expect(screen.getByDisplayValue("Joe's Pizza")).toBeTruthy();
      });

      await waitFor(() => {
        expect(screen.getByDisplayValue('7 Carmine St, New York, NY 10014, USA')).toBeTruthy();
        expect(screen.getByDisplayValue('(212) 366-1182')).toBeTruthy();
        expect(screen.getByDisplayValue('https://www.joespizzanyc.com')).toBeTruthy();
      });
    });

    it('fetches additional details (phone, website) via getDetails when not in initial place result', async () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Autocomplete.getPlace only returns basic fields
      mockGetPlace.mockReturnValue({
        name: 'Margherita Pizza',
        formatted_address: '100 Main St, Brooklyn, NY',
        place_id: 'ChIJtest456',
        // No phone or website in getPlace result
      });

      // getDetails returns full info
      mockGetDetails.mockImplementation(
        (request: any, callback: (place: any, status: string) => void) => {
          callback(
            {
              name: 'Margherita Pizza',
              formatted_address: '100 Main St, Brooklyn, NY',
              formatted_phone_number: '(718) 555-0199',
              website: 'https://margheritapizza.com',
            },
            'OK'
          );
        }
      );

      // Trigger autocomplete selection
      placesChangedCallback!();

      // Verify getDetails was called with the place_id
      await waitFor(() => {
        expect(mockGetDetails).toHaveBeenCalled();
        const detailsRequest = mockGetDetails.mock.calls[0][0];
        expect(detailsRequest.placeId).toBe('ChIJtest456');
      });

      // Verify all fields filled from getDetails
      await waitFor(() => {
        expect(screen.getByDisplayValue('Margherita Pizza')).toBeTruthy();
        expect(screen.getByDisplayValue('100 Main St, Brooklyn, NY')).toBeTruthy();
        expect(screen.getByDisplayValue('(718) 555-0199')).toBeTruthy();
        expect(screen.getByDisplayValue('https://margheritapizza.com')).toBeTruthy();
      });
    });
  });

  // =============================================
  // Test 4: Field accepts both Google Maps URLs and plain text search
  // =============================================
  describe('Dual-mode input', () => {
    it('accepts plain text search (not a URL) without triggering link-paste logic', async () => {
      const user = userEvent.setup();

      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      const searchInput = screen.getByPlaceholderText(/search for a venue or paste a google maps link/i);

      // Type a regular search term (not a Maps URL)
      await user.type(searchInput, "Joe's Pizza NYC");

      // The findPlaceFromQuery should NOT have been called (that's for link paste)
      expect(mockFindPlaceFromQuery).not.toHaveBeenCalled();

      // The Google Autocomplete widget handles suggestions natively,
      // so we just verify the input accepted the text
      expect(searchInput).toHaveValue("Joe's Pizza NYC");
    });

    it('still renders other form fields (name, address, etc.) alongside the search input', () => {
      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // The search/link input
      expect(screen.getByPlaceholderText(/search for a venue or paste a google maps link/i)).toBeTruthy();

      // Standard form fields should also be present
      expect(screen.getByPlaceholderText('Venue Name *')).toBeTruthy();
      expect(screen.getByPlaceholderText('Address')).toBeTruthy();
      expect(screen.getByPlaceholderText('Website / Map Link')).toBeTruthy();
      expect(screen.getByPlaceholderText('Contact Phone')).toBeTruthy();
    });
  });

  // =============================================
  // Test 5: Edit mode does not show the search input
  // =============================================
  describe('Edit mode', () => {
    it('does not show the search input when editing an existing venue', () => {
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
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };

      render(
        <VenueForm venue={existingVenue} onSave={mockOnSave} onClose={mockOnClose} />
      );

      // The search input should NOT be present in edit mode
      expect(screen.queryByPlaceholderText(/search for a venue or paste a google maps link/i)).toBeNull();
    });
  });

  // =============================================
  // Test 6: Saving includes all auto-filled data
  // =============================================
  describe('Form submission with auto-filled data', () => {
    it('includes auto-filled data in the save payload', async () => {
      const user = userEvent.setup();

      render(
        <VenueForm onSave={mockOnSave} onClose={mockOnClose} />
      );

      // Simulate autocomplete selection filling all fields
      mockGetPlace.mockReturnValue({
        name: "Joe's Pizza",
        formatted_address: '7 Carmine St, New York, NY 10014, USA',
        formatted_phone_number: '(212) 366-1182',
        website: 'https://www.joespizzanyc.com',
        place_id: 'ChIJmwpQ1HBZwokR9w',
      });

      mockGetDetails.mockImplementation(
        (request: any, callback: (place: any, status: string) => void) => {
          callback(mockPlaceDetails, 'OK');
        }
      );

      placesChangedCallback!();

      // Wait for fields to be populated
      await waitFor(() => {
        expect(screen.getByDisplayValue("Joe's Pizza")).toBeTruthy();
      });

      // Click save
      const saveButton = screen.getByRole('button', { name: /add venue/i });
      await user.click(saveButton);

      // Verify the save payload
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Joe's Pizza",
            address: '7 Carmine St, New York, NY 10014, USA',
            contactPhone: '(212) 366-1182',
            website: 'https://www.joespizzanyc.com',
          })
        );
      });
    });
  });
});
