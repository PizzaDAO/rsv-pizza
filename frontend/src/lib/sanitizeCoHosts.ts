/**
 * Strip private fields from co-host data for public display.
 * Removes: email, canEdit, isUnderboss
 * Keeps: id, name, avatar_url, showOnEvent, twitter, website, instagram, etc.
 */
export function sanitizeCoHosts(coHosts: any[] | null | undefined): any[] {
  if (!Array.isArray(coHosts)) return [];
  return coHosts.map(({ email, canEdit, isUnderboss, ...publicFields }) => publicFields);
}
