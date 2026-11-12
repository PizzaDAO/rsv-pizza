import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./api', () => api);

beforeEach(() => {
  api.apiRequest.mockReset();
  vi.resetModules();
});

describe('usePizzaOrderingEnabled: the build flag alone shows nothing', () => {
  it('flag on + party not allowlisted = false; allowlisted = true; errors = false', async () => {
    vi.stubEnv('VITE_AI_ORDERING', '1');
    const { usePizzaOrderingEnabled } = await import('./pizzaOrder');
    api.apiRequest.mockResolvedValueOnce({ enabled: false });
    const off = renderHook(() => usePizzaOrderingEnabled('p1'));
    await waitFor(() => expect(api.apiRequest).toHaveBeenCalledTimes(1));
    expect(off.result.current).toBe(false);

    api.apiRequest.mockResolvedValueOnce({ enabled: true });
    const on = renderHook(() => usePizzaOrderingEnabled('p2'));
    await waitFor(() => expect(on.result.current).toBe(true));

    api.apiRequest.mockRejectedValueOnce(new Error('404'));
    const err = renderHook(() => usePizzaOrderingEnabled('p3'));
    await waitFor(() => expect(api.apiRequest).toHaveBeenCalledTimes(3));
    expect(err.result.current).toBe(false);
  });

  it('flag off = false and the backend is never asked', async () => {
    vi.stubEnv('VITE_AI_ORDERING', '');
    const { usePizzaOrderingEnabled } = await import('./pizzaOrder');
    api.apiRequest.mockResolvedValue({ enabled: true });
    const r = renderHook(() => usePizzaOrderingEnabled('p1'));
    expect(r.result.current).toBe(false);
    expect(api.apiRequest).not.toHaveBeenCalled();
  });
});
