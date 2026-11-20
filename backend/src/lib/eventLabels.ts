/**
 * blackolive-70521: host-chosen PUBLIC event tags, stored in `parties.labels`.
 *
 * NOT `event_tags`: that column is the admin/system control channel (payouts, partner reports,
 * RSVP behaviour). Labels are a curated list of stable lowercase slug keys; display text comes
 * from the frontend i18n (`event.labels.keys.<key>`). Keys are final once shipped (renaming
 * needs a data migration), so prefer adding over renaming.
 *
 * Mirrored by hand in frontend/src/lib/eventLabels.ts; both are tested against
 * scripts/event-labels.json.
 */

export const EVENT_LABEL_KEYS = [
  'family-friendly',
  'kid-friendly',
  'all-ages',
  '21-plus',
  'outdoor',
  'live-music',
  'dj',
  'workshop',
  'talks',
  'networking',
  'hackathon',
  'meetup',
  'students',
  'women-in-web3',
  'vegan-options',
  'gluten-free-options',
  'free',
  'wheelchair-accessible',
  'art',
  'gaming',
] as const;

export type EventLabelKey = (typeof EVENT_LABEL_KEYS)[number];

export const MAX_EVENT_LABELS = 5;

const ALLOWED = new Set<string>(EVENT_LABEL_KEYS);

/**
 * trim + lowercase each value, drop anything not in the allowlist (silently, so an old client
 * never 400s a whole save), dedupe, and return in allowlist order. Does NOT cap: use
 * `exceedsMaxLabels` on the result.
 */
export function normalizeLabels(input: unknown): EventLabelKey[] {
  if (!Array.isArray(input)) return [];
  const picked = new Set<string>();
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const k = v.trim().toLowerCase();
    if (ALLOWED.has(k)) picked.add(k);
  }
  return EVENT_LABEL_KEYS.filter((k) => picked.has(k));
}

export function exceedsMaxLabels(normalized: readonly string[]): boolean {
  return normalized.length > MAX_EVENT_LABELS;
}
