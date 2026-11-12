/**
 * CORS origin check. Vercel preview URLs are only trusted for the pizza-dao team:
 *   rsvpizza-git-<branch>-pizza-dao.vercel.app, rsvpizza-<hash>-pizza-dao.vercel.app,
 *   rsvpizza-team1-git-...-pizza-dao.vercel.app, and the bare rsvpizza.vercel.app alias.
 * (The old pattern accepted any host starting with "rsvpizza", e.g. other teams' projects.)
 */
export const VERCEL_PREVIEW_ORIGIN = /^https:\/\/rsvpizza([a-z0-9-]*-pizza-dao)?\.vercel\.app$/;

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}
