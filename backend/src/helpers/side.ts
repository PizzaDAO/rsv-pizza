import { AppError } from '../middleware/error.js';
import { getUnderbossScope, partyMatchesScope, UnderbossScope } from './underbossScope.js';

/**
 * rigatoni-58919 — "side" (PizzaDAO conference side-event) helpers.
 *
 * Side events are a clone-and-adapt of the GPP27 create flow (helpers/gpp27.ts),
 * but they are NOT city-based: the host enters the event's own name, date/time
 * and venue. The public slug is derived from the event name and money keeps the
 * full payout machinery, except there are no city tiers — the reimbursement cap
 * is admin/UB-set and clamped to the configured ceiling.
 *
 * The create flow is admin/underboss-gated and reuses the existing `parties`
 * table with `event_type = 'side'`. Two cross-cutting concerns live here:
 *   1. Event-name → slug normalization (shared with the create handler).
 *   2. The "is this viewer allowed to see a gated side event" check used by the
 *      public resolver (event.routes.ts) and the create endpoint.
 */

/**
 * eventTags marker stamped on pre-launch side parties so the public resolver
 * can hide them from anonymous/out-of-scope viewers until launch. Removed by
 * the publish endpoint once the gates pass. This is the INTERNAL control tag —
 * the public `'side'` taxonomy tag stays public.
 */
export const SIDE_TAG = 'side-prelaunch';

/**
 * Master kill-switch for pre-launch gating. While false, side events are only
 * visible to admins + the relevant underboss. Set the env var SIDE_PUBLIC=true
 * (or edit this default) to make side events public at launch.
 */
export function isSidePublic(): boolean {
  return process.env.SIDE_PUBLIC === 'true';
}

/**
 * Normalize an event name into a public slug: strip diacritics, lowercase, drop
 * non-alphanumerics. Mirrors gpp27.ts `citySlugFromCityName` but applied to the
 * host-entered event name instead of a city.
 */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Is the given (already-resolved) event gated behind the side pre-launch wall
 * for this viewer? Returns true when the viewer should be treated as if the
 * event does not exist (404).
 *
 * A side event is gated when:
 *   - side is not yet public (isSidePublic() === false), AND
 *   - the event is a side event (eventType === 'side' OR carries SIDE_TAG), AND
 *   - the viewer is neither an admin nor an underboss in scope for the event.
 *
 * Signature mirrors gpp27.ts `isGpp27Hidden` so it slots into event.routes.ts
 * the same way (year is accepted but unused — side has no year gate).
 */
export async function isSideHidden(
  match: { eventType?: string | null; eventTags: string[]; region: string | null; city: string | null },
  viewerEmail: string | null | undefined,
): Promise<boolean> {
  const isSide = match.eventType === 'side' || (match.eventTags || []).includes(SIDE_TAG);
  if (!isSide) return false;
  if (isSidePublic()) return false;

  // Gated — only admins + in-scope underbosses may see it.
  const scope = await getUnderbossScope(viewerEmail);
  if (scope.isAdmin) return false;
  return !partyMatchesScope(
    { region: match.region, city: match.city, eventType: 'side' },
    scope,
  );
}

/**
 * Resolve the caller's underboss scope and assert they may act on the given
 * city/region (admin OR in-scope underboss). Throws when out of scope.
 */
export async function assertSideAuthorized(
  viewerEmail: string | null | undefined,
  target: { region?: string | null; city?: string | null },
): Promise<UnderbossScope> {
  const scope = await getUnderbossScope(viewerEmail);
  if (scope.isAdmin) return scope;
  const ok = partyMatchesScope(
    { region: target.region ?? null, city: target.city ?? null, eventType: 'side' },
    scope,
  );
  if (!ok) {
    throw new AppError('You are not authorized to manage side events for this region.', 403, 'SIDE_FORBIDDEN');
  }
  return scope;
}
