/**
 * Run work after the HTTP response without blocking it.
 *
 * On Vercel the function can be frozen once the response is sent, so the promise is registered
 * with the platform's `waitUntil` (the same request-context hook `@vercel/functions` uses). If
 * that hook is NOT present at call time we cannot safely fire into a possibly frozen lambda, so we
 * fall back to awaiting the work inline (the previous behaviour) in a bounded "inline" mode: the
 * callback is told `inline: true` (callers use a single attempt, no retries) and the wait is
 * hard-capped at INLINE_CAP_MS so a response can never block much longer than that.
 * Errors are always caught and logged: background work must never fail the request.
 *
 * Always `await` the result: it resolves immediately in waitUntil mode.
 */
export const INLINE_CAP_MS = 12_000;

let loggedMode = false;

export interface BackgroundMode {
  /** true when running inline (no waitUntil): keep it to one short attempt. */
  inline: boolean;
}

function getWaitUntil(): ((p: Promise<unknown>) => void) | null {
  try {
    const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
    if (ctx && typeof ctx.waitUntil === 'function') return (p) => ctx.waitUntil(p);
  } catch {
    // no request context
  }
  return null;
}

export async function runInBackground(
  work: (mode: BackgroundMode) => Promise<unknown>,
  label = 'background task',
): Promise<void> {
  const waitUntil = getWaitUntil();
  if (!loggedMode) {
    loggedMode = true;
    console.log(`[background] mode: ${waitUntil ? 'waitUntil (after response)' : 'inline fallback (no waitUntil, single attempt, capped)'}`);
  }
  const run = async (inline: boolean) => {
    try {
      await work({ inline });
    } catch (err) {
      console.error(`[${label}] failed:`, err);
    }
  };
  if (waitUntil) {
    waitUntil(run(false));
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[${label}] inline fallback hit ${INLINE_CAP_MS}ms cap; continuing without waiting`);
      resolve();
    }, INLINE_CAP_MS);
  });
  await Promise.race([run(true), cap]);
  if (timer) clearTimeout(timer);
}
