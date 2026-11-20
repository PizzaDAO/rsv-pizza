import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const KEY = 'chunk-reload-at';
const WINDOW_MS = 30_000;

/**
 * A lazy chunk failed to load (usually a stale tab after a deploy). Reload the page once so the
 * new build is picked up; the sessionStorage guard makes sure this can never loop.
 * Returns true if a reload was triggered.
 */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** React.lazy that reloads the page once if the chunk fails to load, else surfaces the error. */
export function lazyWithReload<C extends ComponentType<any>>(
  loader: () => Promise<{ default: C }>,
): LazyExoticComponent<C> {
  return lazy(() =>
    loader().catch((err) => {
      if (reloadOnceForChunkError()) return new Promise<{ default: C }>(() => {}); // page is reloading
      throw err;
    }),
  );
}
