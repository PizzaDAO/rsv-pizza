/**
 * Strip private fields from co-host data for public display.
 * Removes: email (PII)
 * Keeps: id, name, avatar_url, showOnEvent, canEdit, isUnderboss, twitter, website, instagram, etc.
 */
export function sanitizeCoHosts(coHosts: any[] | null | undefined): any[] {
  if (!Array.isArray(coHosts)) return [];
  return coHosts.map(({ email, ...publicFields }) => publicFields);
}
