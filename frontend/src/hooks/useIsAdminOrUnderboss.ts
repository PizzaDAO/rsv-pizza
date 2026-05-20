import { useEffect, useState } from 'react';
import { fetchAdminMe, fetchUnderbossMe } from '../lib/api';

/**
 * Returns whether the current user is an admin OR underboss.
 *
 * Mirrors the canonical check used elsewhere in the app (e.g. `AppsHub`'s
 * Payouts soft-launch gate): fan out to `fetchAdminMe()` + `fetchUnderbossMe()`
 * and combine `isAdmin || isUnderboss`. Both calls are auth-gated; logged-out
 * users resolve to `false`.
 *
 * State machine:
 * - `null`  — still loading (caller should render a spinner / nothing)
 * - `true`  — admin or underboss
 * - `false` — neither (caller should redirect or render denied UI)
 *
 * Used for soft-launch gates (pepperoni-58341: Day-Of feature).
 */
export function useIsAdminOrUnderboss(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ub, ad] = await Promise.all([
          fetchUnderbossMe().catch(() => null),
          fetchAdminMe().catch(() => null),
        ]);
        if (cancelled) return;
        setAllowed(Boolean(ub?.isUnderboss) || Boolean(ad?.isAdmin));
      } catch {
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return allowed;
}
