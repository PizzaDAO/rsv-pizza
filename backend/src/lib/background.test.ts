import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInBackground } from './background.js';

afterEach(() => {
  delete (globalThis as any)[Symbol.for('@vercel/request-context')];
  vi.useRealTimers();
});

describe('runInBackground', () => {
  it('with waitUntil: returns without waiting and registers the work', async () => {
    const waitUntil = vi.fn();
    (globalThis as any)[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil }) };
    let done = false;
    await runInBackground(async (m) => {
      expect(m.inline).toBe(false);
      await new Promise((r) => setTimeout(r, 30));
      done = true;
    });
    expect(done).toBe(false);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('without waitUntil: awaits the work inline in inline mode', async () => {
    let done = false;
    await runInBackground(async (m) => {
      expect(m.inline).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    expect(done).toBe(true);
  });

  it('inline mode is capped so a hung job cannot block the response', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = runInBackground(() => new Promise(() => {}), 'hung');
    await vi.advanceTimersByTimeAsync(12_001);
    await p;
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('swallows and logs errors in both modes', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runInBackground(async () => { throw new Error('boom'); }, 'test');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
