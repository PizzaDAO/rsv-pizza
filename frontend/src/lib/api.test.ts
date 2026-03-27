import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatePartyApi, apiRequest, AUTH_EXPIRED_EVENT } from './api';

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

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('adds Authorization header when authenticated', async () => {
    localStorage.setItem('authToken', 'my-jwt-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: 'test' }),
    });

    await apiRequest('/api/test');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('throws "Not authenticated" when requireAuth is true and no token', async () => {
    await expect(
      apiRequest('/api/test', { requireAuth: true })
    ).rejects.toThrow('Not authenticated');

    // fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw when requireAuth is false and no token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: 'public' }),
    });

    const result = await apiRequest('/api/public', { requireAuth: false });
    expect(result).toEqual({ data: 'public' });
  });

  it('sends token when available even with requireAuth false', async () => {
    localStorage.setItem('authToken', 'optional-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiRequest('/api/test', { requireAuth: false });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer optional-token');
  });

  it('dispatches AUTH_EXPIRED_EVENT on 401', async () => {
    localStorage.setItem('authToken', 'expired-token');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Token expired' }),
    });

    const handler = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, handler);

    try {
      await apiRequest('/api/test');
    } catch {
      // Expected to throw
    }

    expect(handler).toHaveBeenCalledTimes(1);
    // Token should be cleared
    expect(localStorage.getItem('authToken')).toBeNull();

    window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
  });

  it('does not dispatch AUTH_EXPIRED_EVENT on 401 when requireAuth is false', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });

    const handler = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, handler);

    try {
      await apiRequest('/api/test', { requireAuth: false });
    } catch {
      // Expected to throw
    }

    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
  });

  it('uses correct HTTP method', async () => {
    localStorage.setItem('authToken', 'test-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiRequest('/api/test', { method: 'POST', body: { key: 'value' } });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ key: 'value' });
  });

  it('defaults to GET method', async () => {
    localStorage.setItem('authToken', 'test-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiRequest('/api/test');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
  });
});
