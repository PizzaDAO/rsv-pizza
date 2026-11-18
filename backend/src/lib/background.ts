/**
 * Run work after the HTTP response without blocking it.
 *
 * On Vercel the function can be frozen once the response is sent, so the promise is registered
 * with the platform's `waitUntil` (the same request-context hook `@vercel/functions` uses) when
 * it exists. Elsewhere (local / long-lived server) the promise simply runs detached.
 * Errors are always caught and logged: background work must never become an unhandled rejection.
 */
export function runInBackground(work: () => Promise<unknown>, label = 'background task'): void {
  const p = (async () => {
    try {
      await work();
    } catch (err) {
      console.error(`[${label}] failed:`, err);
    }
  })();
  try {
    const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch {
    // no request context: the detached promise still runs
  }
}
