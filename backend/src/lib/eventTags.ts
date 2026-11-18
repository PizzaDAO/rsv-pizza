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

export const INTERNAL_TAG_PATTERNS: RegExp[] = [
  // numeric reimbursement-cap tags. Matches helpers/reimbursementCap.ts
  // (`^\d+(\.\d{1,2})?$`): '200', '500', '350.50'.
  /^\d+(\.\d{1,2})?$/,
  // party-kit cap tags ('k40', 'k200.50'). Mirrors the frontend set.
  /^k\d+(\.\d{1,2})?$/i,
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

/**
 * Canonical form of a payment-admin-only tag ('go', 'possible-scam', numeric /
 * k cap): trimmed + lowercased. Readers check these tags by exact lowercase, so
 * variants like 'GO' or ' Go ' must never be stored. Other tags are untouched.
 */
export function canonicalizeGuardedTag<T>(tag: T): T | string {
  if (typeof tag !== 'string') return tag;
  const t = tag.trim().toLowerCase();
  return t === 'go' || isGuardedTag(t) ? t : tag;
}

/** Canonicalize guarded-tag variants in a tag list, then dedupe (order preserved). */
export function canonicalizeEventTags(tags: unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    if (typeof t !== 'string') continue;
    const c = canonicalizeGuardedTag(t) as string;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** True when `next` adds or removes the payout-gate 'go' tag relative to `current` (case/whitespace-insensitive). */
export function changesGoTag(current: string[] | null | undefined, next: unknown[]): boolean {
  const has = (arr: unknown) =>
    Array.isArray(arr) && arr.some((t) => typeof t === 'string' && t.trim().toLowerCase() === 'go');
  return has(current) !== has(next);
}

/**
 * True when `next` adds or removes any tag only payment admins may change:
 * 'go', 'possible-scam', or numeric / party-kit cap tags. Shared by the party
 * PATCH and the underboss bulk-event-tags endpoint.
 */
export function changesPaymentAdminTags(current: string[] | null | undefined, next: unknown[]): boolean {
  return changesGoTag(current, next) || changesGuardedTags(current, next);
}

/**
 * blackolive-70521: `parties.event_tags` is an admin/system switchboard (payout
 * state, partner co-host sync, launch gates, RSVP opt-ins). A host or co-host
 * must only be able to add/remove tags in this tiny set via the party PATCH;
 * every other tag is preserved exactly as stored.
 *
 * - 'prepay': the host Payments tab checkbox (PrepayCheckbox.tsx) is the only
 *   host UI that writes event_tags. There is no host-facing taxonomy chip UI
 *   ('side' / series publicTags are stamped server-side on create).
 *
 * Keep this list minimal; add a tag only when a host UI genuinely exposes it.
 */
export const HOST_WRITABLE_EVENT_TAGS: ReadonlySet<string> = new Set(['prepay']);

export function isHostWritableTag(tag: unknown): boolean {
  return typeof tag === 'string' && HOST_WRITABLE_EVENT_TAGS.has(tag.trim().toLowerCase());
}

/**
 * scam-flag-private: targeted prepay toggle. Adds/removes ONLY the canonical 'prepay' tag on the
 * STORED list, so a client that only holds the public (stripped) tags can never wipe internal
 * tags ('possible-scam', 'paid', 'go', caps) by sending its whole array back.
 */
export function withPrepay(tags: string[] | null | undefined, on: boolean): string[] {
  const without = (tags ?? []).filter((t) => !(typeof t === 'string' && t.trim().toLowerCase() === 'prepay'));
  return on ? [...without, 'prepay'] : without;
}

/**
 * Merge a non-privileged caller's requested tag array into the stored one.
 * Only adds/removes of HOST_WRITABLE tags are honoured; all other differences
 * are ignored (stored tags kept, requested extras dropped). Returns the tag
 * list to store plus the ignored changes for logging.
 */
export function mergeHostEventTags(
  current: string[] | null | undefined,
  requested: unknown[],
): { tags: string[]; ignoredAdded: string[]; ignoredRemoved: string[]; changed: boolean } {
  const cur = Array.isArray(current) ? current : [];
  const req = requested.filter((t): t is string => typeof t === 'string');
  const canon = (t: string) => t.trim().toLowerCase();
  // Host-writable tags the caller wants present (canonical form only).
  const wanted = new Set(req.filter(isHostWritableTag).map(canon));
  const reqSet = new Set(req);
  const curSet = new Set(cur);
  const ignoredAdded: string[] = [];
  const ignoredRemoved: string[] = [];
  const tags: string[] = [];
  const emitted = new Set<string>();
  for (const t of cur) {
    if (isHostWritableTag(t)) {
      const c = canon(t);
      if (wanted.has(c) && !emitted.has(c)) {
        emitted.add(c);
        tags.push(c); // always store the canonical form
      }
      continue;
    }
    if (!reqSet.has(t)) ignoredRemoved.push(t);
    tags.push(t);
  }
  for (const c of wanted) if (!emitted.has(c)) tags.push(c);
  for (const t of req) {
    if (!isHostWritableTag(t) && !curSet.has(t) && !ignoredAdded.includes(t)) ignoredAdded.push(t);
  }
  const changed = tags.length !== cur.length || tags.some((t, i) => t !== cur[i]);
  return { tags, ignoredAdded, ignoredRemoved, changed };
}
