import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatePartyApi } from './api';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('updatePartyApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set auth token so the API function doesn't throw "Not authenticated"
    localStorage.setItem('authToken', 'test-token');

    // Mock successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ party: { id: 'party-1' } }),
    });
  });

  it('should include selectedPizzerias in the request body when provided', async () => {
    const testPizzerias = [
      {
        id: 'custom-abc123',
        placeId: '',
        name: 'Test Pizzeria',
        address: '123 Main St',
        phone: '555-1234',
        url: 'https://testpizzeria.com',
        location: { lat: 0, lng: 0 },
        orderingOptions: [],
      },
    ];

    await updatePartyApi('party-1', {
      selectedPizzerias: testPizzerias,
    });

    // Verify fetch was called
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Get the request body that was sent
    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    // The selectedPizzerias field MUST be present in the request body
    // This is the core of the bug: selectedPizzerias was being dropped
    expect(body.selectedPizzerias).toBeDefined();
    expect(body.selectedPizzerias).toEqual(testPizzerias);
    expect(body.selectedPizzerias[0].name).toBe('Test Pizzeria');
  });

  it('should not include selectedPizzerias when not provided', async () => {
    await updatePartyApi('party-1', {
      name: 'Updated Party Name',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    // selectedPizzerias should be undefined (not sent) when not in the update data
    expect(body.selectedPizzerias).toBeUndefined();
  });

  it('should preserve other fields alongside selectedPizzerias', async () => {
    const testPizzerias = [
      {
        id: 'custom-xyz',
        placeId: '',
        name: 'My Custom Pizzeria',
        address: '456 Oak Ave',
        location: { lat: 40.7128, lng: -74.006 },
        orderingOptions: [],
      },
    ];

    await updatePartyApi('party-1', {
      name: 'Pizza Night',
      address: '789 Elm St',
      selectedPizzerias: testPizzerias,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    // All fields should be present
    expect(body.name).toBe('Pizza Night');
    expect(body.address).toBe('789 Elm St');
    expect(body.selectedPizzerias).toHaveLength(1);
    expect(body.selectedPizzerias[0].name).toBe('My Custom Pizzeria');
  });
});
