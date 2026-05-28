/**
 * argentina-92103: Regional underboss access gate for /payments dashboard.
 *
 * Layered on top of the existing payment_admin / admin / super_admin gate
 * (see `isPaymentAdmin` in auth.ts). When a `regions=` CSV query param is
 * supplied, this middleware accepts EITHER:
 *   - a payment-admin-class actor (admin / super_admin / payment_admin), OR
 *   - an active underboss whose `regions` (or legacy single `region`) array
 *     overlaps with the requested region scope.
 *
 * Used by the LATAM portal (`/payments/latam`) so `donmalbec.eth@gmail.com`
 * — the LATAM underboss whose regions cover `central-america` and
 * `south-america` — can read the queue + approve / reject / revert payouts on
 * LATAM events without elevating him to a full payment_admin.
 *
 * Funds-sending endpoints (execute / mark-paid / bulk-execute / external)
 * stay gated by the unchanged `requireAnyAdminOrPaymentAdmin` and remain
 * admin-only.
 */
import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest, isPaymentAdmin } from './auth.js';
import { AppError } from './error.js';

export type ViewerRole = 'admin' | 'underboss';

export interface RegionalAuthRequest extends AuthRequest {
  /**
   * Resolved viewer kind once the middleware grants access. Used by
   * mutating handlers (approve / reject / unapprove / flag-ready) to apply
   * the secondary "target party must be in scope" check ONLY for
   * underbosses — admins skip that gate.
   */
  viewerRole?: ViewerRole;
}

/** Default region scope when `?regions=` is not supplied on the LATAM portal. */
export const LATAM_REGIONS = ['central-america', 'south-america'] as const;

/**
 * Returns whether `email` is allowed to view the requested region scope.
 * - Admin-class actors always pass; `kind: 'admin'`.
 * - An active underboss whose `regions` (or legacy single `region`) overlap
 *   the requested scope passes; `kind: 'underboss'`.
 */
export async function callerHasRegionalAccess(
  email: string | undefined,
  regions: string[],
): Promise<{ ok: boolean; kind: ViewerRole | null }> {
  if (await isPaymentAdmin(email)) return { ok: true, kind: 'admin' };
  if (!email) return { ok: false, kind: null };
  const ub = await prisma.underboss.findFirst({
    where: {
      isActive: true,
      email: { equals: email, mode: 'insensitive' },
      OR: [
        { regions: { hasSome: regions } },
        { region: { in: regions } },
      ],
    },
    select: { id: true },
  });
  return ub ? { ok: true, kind: 'underboss' } : { ok: false, kind: null };
}

/**
 * Parse the `?regions=` CSV query into a clean array. Returns `null` when
 * the param is absent (callers fall back to admin-only behavior).
 */
export function parseRegionsQuery(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * Middleware factory: gate an endpoint behind `admin OR (underboss whose
 * regions overlap the requested scope)`.
 *
 * - When no `regions=` param is supplied: behaves like the existing
 *   `requireAnyAdminOrPaymentAdmin` — admin-class only.
 * - When `regions=` is supplied: admin OR matching-region underboss passes;
 *   `req.viewerRole` is set to 'admin' or 'underboss' so handlers can apply
 *   the per-row "target party must be in scope" check for underbosses.
 *
 * The optional `defaultRegions` is a safety net for portals (e.g. LATAM)
 * that always run in a fixed scope — if the caller forgets the query param,
 * we still apply the portal's scope rather than 403-ing.
 */
export function requireAdminOrRegionalUnderboss(defaultRegions?: readonly string[]) {
  return async function regionalGate(
    req: RegionalAuthRequest,
    _res: Response,
    next: NextFunction,
  ) {
    try {
      const queryRegions = parseRegionsQuery(req.query.regions);
      const regions = queryRegions ?? (defaultRegions ? [...defaultRegions] : null);

      if (!regions || regions.length === 0) {
        // No regional scope at all — admin-class only.
        if (!(await isPaymentAdmin(req.userEmail))) {
          throw new AppError('Payments admin access required', 403, 'FORBIDDEN');
        }
        req.viewerRole = 'admin';
        next();
        return;
      }

      const result = await callerHasRegionalAccess(req.userEmail, regions);
      if (!result.ok) {
        throw new AppError(
          'You do not have access to this regional payments portal.',
          403,
          'FORBIDDEN',
        );
      }
      req.viewerRole = result.kind!;
      next();
    } catch (err) {
      next(err);
    }
  };
}
