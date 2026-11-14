/**
 * Pre-launch visibility gates for a resolved party, shared by GET /api/events/:slug and any
 * public read that hangs off an event (hackathon public read). True = the viewer must not see
 * the event (the event route 404s).
 *   - soppressata-50927: gated 2027 GPP events (admins + in-scope underbosses only)
 *   - rigatoni-58919: unpublished "side" events (same audience)
 */
import { isGpp27Hidden } from './gpp27.js';
import { isSideHidden } from './side.js';

export interface EventVisibilityFields {
  eventType: string | null;
  eventTags: unknown;
  date: Date | null;
  region: string | null;
  city: string | null;
}

export async function isEventHiddenFrom(party: EventVisibilityFields, viewerEmail: string | null | undefined): Promise<boolean> {
  const eventTags = (party.eventTags as string[]) || [];
  if (party.eventType === 'gpp') {
    const year = party.date ? new Date(party.date).getFullYear() : 0;
    if (await isGpp27Hidden({ year, eventTags, region: party.region ?? null, city: party.city ?? null }, viewerEmail)) return true;
  }
  if (party.eventType === 'side' || eventTags.includes('side-prelaunch')) {
    if (await isSideHidden({ eventType: party.eventType ?? null, eventTags, region: party.region ?? null, city: party.city ?? null }, viewerEmail)) return true;
  }
  return false;
}
