/**
 * guests-anon-reads: behavior of the guest fetch and the broadcast subscription.
 * - transient fetch errors return null (never [] that would blank the host list)
 * - forged / malformed broadcasts are ignored and refetches are rate limited
 * - a fast re-subscribe waits for the previous channel removal
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    handlers: [] as Array<(msg: any) => void>,
    created: [] as string[],
    removeResolvers: [] as Array<() => void>,
    events: [] as string[],
  };
  const client = {
    channel: (topic: string) => {
      state.created.push(topic);
      state.events.push(`create:${topic}`);
      const ch: any = {
        on: (_t: string, _f: any, cb: (m: any) => void) => {
          state.handlers.push(cb);
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {
      state.events.push('remove');
      return new Promise<string>((res) => state.removeResolvers.push(() => res('ok')));
    },
    from: () => ({}),
  };
  return { state, client };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }));

import { fetchAllGuests, subscribeToGuests, GUESTS_MIN_INTERVAL_MS } from '../lib/supabase';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function mockFetch(impl: () => Promise<any> | any) {
  const f = vi.fn(async () => impl());
  vi.stubGlobal('fetch', f);
  return f;
}
const ok = (guests: any[]) => ({ ok: true, status: 200, json: async () => ({ guests }) });

beforeEach(() => {
  h.state.handlers.length = 0;
  h.state.created.length = 0;
  h.state.removeResolvers.length = 0;
  h.state.events.length = 0;
  localStorage.setItem('authToken', 't');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('fetchAllGuests', () => {
  it('returns null (not []) on 429, 5xx and network errors', async () => {
    for (const status of [429, 500, 503]) {
      mockFetch(() => ({ ok: false, status, json: async () => ({}) }));
      expect(await fetchAllGuests('p1')).toBeNull();
    }
    mockFetch(() => Promise.reject(new Error('offline')));
    expect(await fetchAllGuests('p1')).toBeNull();
  });

  it('returns [] for logged out and for 401/403/404 (no list for this caller)', async () => {
    mockFetch(() => ok([]));
    localStorage.removeItem('authToken');
    expect(await fetchAllGuests('p1')).toEqual([]);
    localStorage.setItem('authToken', 't');
    for (const status of [401, 403, 404]) {
      mockFetch(() => ({ ok: false, status, json: async () => ({}) }));
      expect(await fetchAllGuests('p1')).toEqual([]);
    }
  });
});

describe('subscribeToGuests', () => {
  it('ignores broadcasts without a valid op, refetches immediately on the first valid one', async () => {
    const f = mockFetch(() => ok([{ id: 'g1' }]));
    const cb = vi.fn();
    const unsub = subscribeToGuests('pA', cb);
    await flush();
    const fire = h.state.handlers[0];

    fire({ payload: {} });
    fire({ payload: { op: 'truncate', id: 'x' } });
    fire({ payload: { op: 42 } });
    fire({});
    await flush();
    expect(f).not.toHaveBeenCalled();

    fire({ payload: { op: 'INSERT', id: 'random' } });
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith([{ id: 'g1' }]);
    unsub();
  });

  it('rate limits a flood to one trailing refetch per interval', async () => {
    const f = mockFetch(() => ok([]));
    const unsub = subscribeToGuests('pB', vi.fn());
    await flush();
    const fire = h.state.handlers[0];

    fire({ payload: { op: 'insert' } });
    await flush();
    expect(f).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 50; i++) fire({ payload: { op: 'update' } });
    await vi.advanceTimersByTimeAsync(GUESTS_MIN_INTERVAL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(f).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('keeps the previous state when a refetch fails', async () => {
    mockFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
    const cb = vi.fn();
    const unsub = subscribeToGuests('pC', cb);
    await flush();
    h.state.handlers[0]({ payload: { op: 'delete' } });
    await flush();
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('waits for the previous channel removal before re-creating the same topic', async () => {
    mockFetch(() => ok([]));
    const unsub1 = subscribeToGuests('pD', vi.fn());
    await flush();
    expect(h.state.created).toEqual(['guests:pD']);

    unsub1();
    await flush();
    const unsub2 = subscribeToGuests('pD', vi.fn());
    await flush();
    // removal still pending: no second channel yet
    expect(h.state.created).toEqual(['guests:pD']);

    h.state.removeResolvers[0]();
    await flush();
    expect(h.state.created).toEqual(['guests:pD', 'guests:pD']);
    expect(h.state.events).toEqual(['create:guests:pD', 'remove', 'create:guests:pD']);
    unsub2();
  });
});
