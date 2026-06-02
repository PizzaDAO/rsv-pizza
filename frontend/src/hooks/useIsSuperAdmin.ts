import { useEffect, useState } from 'react';
import { fetchAdminMe } from '../lib/api';

/**
 * provolone-58931: Returns whether the current user is a SUPER admin.
 *
 * Mirrors the canonical admin check (`fetchAdminMe()` — backed by GET
 * /api/admin/me, which returns `{ isAdmin, role }`) but narrows to the
 * `super_admin` role specifically. Logged-out / non-admin users resolve to
 * `false`.
 *
 * Used to gate the soft-delete restore UI in the Photos gallery and Budget
 * tab: only super-admins ever receive soft-deleted rows from the backend, so
 * this hook also tells the UI when to render the "Deleted by host" badge +
 * Restore button.
 */
export function useIsSuperAdmin(): boolean {
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchAdminMe().catch(() => null);
        if (cancelled) return;
        setIsSuper(Boolean(me?.isAdmin) && me?.role === 'super_admin');
      } catch {
        if (!cancelled) setIsSuper(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isSuper;
}
