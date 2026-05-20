/**
 * arugula-38633 v2 follow-up: numeric-tag reimbursement-cap fallback.
 *
 * Mirror of `backend/src/helpers/reimbursementCap.ts` for the supabase
 * data path — host pages load the Party via `db.getPartyWithGuests`
 * (Supabase) rather than the backend, so the mapper computes the
 * effective cap client-side.
 *
 * Precedence:
 *   1. `reimbursementCapUsd` (underboss-validated) wins when not null.
 *   2. Else max of numeric strings in `eventTags` matching
 *      `^\d+(\.\d{1,2})?$` (e.g. '200', '500', '350.50').
 *   3. Else null.
 */
export function computeEffectiveCapUsd(input: {
  reimbursementCapUsd: number | string | null | undefined;
  eventTags: string[] | null | undefined;
}): number | null {
  if (input.reimbursementCapUsd != null) {
    const n = Number(input.reimbursementCapUsd);
    if (Number.isFinite(n)) return n;
  }
  return parseNumericCapFromTags(input.eventTags);
}

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

/**
 * Party-kit reimbursement cap from event_tags shaped like `k40`, `k50`,
 * `k200.50` etc. — letter `k` (case-insensitive) followed by a positive
 * number. Returns the max if multiple tags match. Null if none.
 *
 * Independent from the pizza cap (parseNumericCapFromTags) — both can be
 * set on the same event.
 */
export function parsePartyKitCapFromTags(
  tags: string[] | null | undefined
): number | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const re = /^k(\d+(?:\.\d{1,2})?)$/i;
  let max: number | null = null;
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    const m = re.exec(t);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (max == null || n > max) max = n;
  }
  return max;
}
