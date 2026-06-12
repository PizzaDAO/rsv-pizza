/**
 * paccheri-58541: frontend mirror of `backend/src/lib/eventTags.ts`.
 *
 * `parties.event_tags` is overloaded as both a public taxonomy (season /
 * program markers like 'gpp2026', 'swc', 'SWC Hub') AND a private control
 * channel for admin / underboss / payments workflows (scam flags, payout
 * state, the new 'refund' refund-due marker, reimbursement caps). Control
 * tags must never reach a guest-facing surface.
 *
 * Pages that load a Party through the backend public payloads
 * (`/api/gpp/events`, `/api/events/:id`) already get tags filtered by the
 * backend `publicTags()` boundary. Pages that load the Party DIRECTLY from
 * Supabase (RSVPPage, the host PizzaContext) bypass that boundary, so they
 * call `publicEventTags()` here at the mapping boundary.
 *
 * Keep INTERNAL_EVENT_TAGS in sync with the backend set.
 */

export const REFUND_TAG = 'refund';

export const INTERNAL_EVENT_TAGS = new Set<string>([
  'possible-scam', // manual /payments scam flag
  'paid',          // payout closed out (auto-tagged on mark-paid close-out)
  'prepay',        // payout workflow state
  'go',            // payout workflow state
  'nonpres',       // admin-only "not a presidential/SWC city" gate marker
  'missed',        // payout workflow state
  'nonhub',        // admin-only SWC-Hub-gate opt-out
  REFUND_TAG,      // paccheri-58541: refund-due (overpaid open city) marker
]);

const INTERNAL_TAG_PATTERNS: RegExp[] = [
  // numeric reimbursement-cap tags ('200', '500', '350.50').
  /^\d+(\.\d{1,2})?$/,
  // party-kit cap tags ('k40', 'k200.50').
  /^k\d+(\.\d{1,2})?$/i,
  /^gpp2027$/i, // pre-launch year gate marker
];

export function isInternalEventTag(tag: string): boolean {
  if (typeof tag !== 'string') return false;
  const t = tag.trim();
  if (INTERNAL_EVENT_TAGS.has(t) || INTERNAL_EVENT_TAGS.has(t.toLowerCase())) return true;
  return INTERNAL_TAG_PATTERNS.some((re) => re.test(t));
}

/**
 * Strip internal/control tags from a tag list for guest-facing rendering.
 * Used at the Supabase-direct public mapping boundaries only.
 */
export function publicEventTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => !isInternalEventTag(t));
}
