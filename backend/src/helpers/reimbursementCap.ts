/**
 * arugula-38633 v2 follow-up: numeric-tag reimbursement-cap fallback.
 *
 * Precedence for the "effective" reimbursement cap shown to hosts on the
 * Payments tab:
 *   1. `parties.reimbursement_cap_usd` (set by an underboss via the
 *      /underboss validate / override UI). Wins when not null.
 *   2. The MAX of any numeric strings in `parties.event_tags`. Tags like
 *      '200', '500', '350.50' are parsed; non-numeric tags like 'pfp',
 *      'cohost' are ignored. Returns null if no tag parses.
 *   3. null — no cap; UI shows the "set your expected guests and contact
 *      your underboss" notice.
 *
 * `/underboss` still operates on the raw `reimbursement_cap_usd` column +
 * Validate/Override controls — the tag fallback is invisible there.
 */
export function computeEffectiveCapUsd(
  party: { reimbursementCapUsd: unknown; eventTags: string[] | null | undefined }
): number | null {
  // 1. Underboss-validated value wins.
  if (party.reimbursementCapUsd != null) {
    const n = Number(party.reimbursementCapUsd);
    if (Number.isFinite(n)) return n;
  }

  // 2. Numeric-tag fallback: max of `^\d+(\.\d{1,2})?$` tags.
  return parseNumericCapFromTags(party.eventTags);
}

/**
 * Parse the max numeric value from event_tags. Strict regex — must match
 * `^\d+(\.\d{1,2})?$` so '200', '500', '350.50' parse but '200.123' (3
 * decimals) and 'pfp', 'cohost' do not.
 */
export function parseNumericCapFromTags(
  tags: string[] | null | undefined
): number | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const re = /^\d+(\.\d{1,2})?$/;
  let max: number | null = null;
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!re.test(t)) continue;
    const n = Number(t);
    if (!Number.isFinite(n)) continue;
    if (max == null || n > max) max = n;
  }
  return max;
}
