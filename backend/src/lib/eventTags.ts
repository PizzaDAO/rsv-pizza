/**
 * calzone-50114: internal vs. public event_tags.
 *
 * `parties.event_tags` is overloaded as both a public taxonomy (season/program
 * markers like 'gpp2026', 'swc', 'SWC Hub', 'wpc', 'ens', 'Global Pizza Party')
 * AND a private control channel for admin/underboss workflows (scam flags,
 * payout state, reimbursement caps, pre-launch gates). The control tags must
 * never reach a public PublicEvent / GPP payload.
 *
 * `publicTags()` is applied ONLY at public response boundaries. Admin /
 * underboss / payments / partner / report / leaderboard routes keep the raw
 * tag list.
 */

export const INTERNAL_EVENT_TAGS = new Set<string>([
  'possible-scam', // manual /payments scam flag
  'paid',          // payout closed out (auto-tagged on mark-paid close-out)
  'prepay',        // payout workflow state
  'go',            // payout workflow state
  'nonpres',       // admin-only "not a presidential/SWC city" gate marker
  'missed',        // payout workflow state
  // marzano-58293: admin-only per-party SWC-Hub-gate opt-out (USDC). Mirrors
  // 'nonpres' — used only in the payments-admin UI + swcHub helper, never
  // surfaced publicly.
  'nonhub',
  // paccheri-58541: 'refund' marks an open city that has been OVERPAID (paid
  // exceeds capped receipt total) so admins can chase a refund. Admin-only —
  // must never surface on a public PublicEvent / GPP payload.
  'refund',
  // rigatoni-58919: pre-launch control tag for "side" (conference side) events.
  // The public 'side' taxonomy tag stays public; this gate marker must not leak.
  'side-prelaunch',
]);

const INTERNAL_TAG_PATTERNS: RegExp[] = [
  // numeric reimbursement-cap tags. Matches helpers/reimbursementCap.ts
  // (`^\d+(\.\d{1,2})?$`): '200', '500', '350.50'.
  /^\d+(\.\d{1,2})?$/,
  /^gpp2027$/i, // pre-launch year gate marker
];

export function isInternalTag(tag: string): boolean {
  if (typeof tag !== 'string') return false;
  const t = tag.trim();
  if (INTERNAL_EVENT_TAGS.has(t) || INTERNAL_EVENT_TAGS.has(t.toLowerCase())) return true;
  return INTERNAL_TAG_PATTERNS.some((re) => re.test(t));
}

export function publicTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => !isInternalTag(t));
}

/**
 * calzone-50114: idempotently append the internal 'paid' tag (used by the
 * admin-payout close-out handler). Repeat calls are a no-op.
 */
export function withPaidTag(tags: string[] | null | undefined): string[] {
  return Array.from(new Set([...(tags ?? []), 'paid']));
}

/**
 * calzone-50114: remove the internal 'paid' tag (used when an admin re-opens a
 * closed-out city).
 */
export function withoutPaidTag(tags: string[] | null | undefined): string[] {
  return (tags ?? []).filter((t) => t !== 'paid');
}

/**
 * Tags a host must never be able to add or remove themselves: the scam flag
 * (feeds the host track record) and numeric / party-kit cap tags (set
 * reimbursement caps). Only payment admins may change them.
 */
export function isGuardedTag(tag: unknown): boolean {
  if (typeof tag !== 'string') return false;
  const t = tag.trim().toLowerCase();
  return t === 'possible-scam' || /^\d+(\.\d{1,2})?$/.test(t) || /^k\d+(\.\d{1,2})?$/.test(t);
}

/** True when `next` adds or removes any guarded tag relative to `current`. */
export function changesGuardedTags(current: string[] | null | undefined, next: unknown[]): boolean {
  const norm = (arr: unknown[]) =>
    new Set(arr.filter(isGuardedTag).map((t) => (t as string).trim().toLowerCase()));
  const a = norm(Array.isArray(current) ? current : []);
  const b = norm(Array.isArray(next) ? next : []);
  if (a.size !== b.size) return true;
  for (const t of a) if (!b.has(t)) return true;
  return false;
}
