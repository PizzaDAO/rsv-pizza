import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInBackground } from './background.js';

afterEach(() => {
  delete (globalThis as any)[Symbol.for('@vercel/request-context')];
});

describe('runInBackground', () => {
  it('returns immediately without awaiting the work', () => {
    let done = false;
    runInBackground(async () => {
      await new Promise((r) => setTimeout(r, 50));
      done = true;
    });
    expect(done).toBe(false);
  });

  it('swallows and logs errors (no unhandled rejection)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runInBackground(async () => {
      throw new Error('boom');
    }, 'test');
    await new Promise((r) => setTimeout(r, 5));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('registers with the platform waitUntil when present', () => {
    const waitUntil = vi.fn();
    (globalThis as any)[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil }) };
    runInBackground(async () => {});
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
