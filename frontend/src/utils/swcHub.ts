/**
 * parmigiana-92104: SWC Hub party detection helper.
 *
 * Reimbursement for SWC Hub parties is processed through SWC, not rsv.pizza.
 * Admin reimbursement actions (approve / execute / mark-paid / external add /
 * bulk-send / mark-city-paid) surface an amber warning + ack checkbox when
 * the target party is an SWC Hub party — the action buttons stay disabled
 * until the admin ticks the ack.
 *
 * Signals (either is sufficient):
 *   1. `event_tags` includes the literal string 'SWC Hub' (preferred — also
 *      catches any non-US SWC Hub events the admins might tag in the future).
 *   2. `country` === 'United States'.
 *
 * Both signals exist in prod (the 151 US parties were just bulk-tagged with
 * 'SWC Hub'); either is sufficient. The `country` fallback keeps the gate
 * working for any US party that's missed the bulk-tag for whatever reason.
 *
 * Frontend-only soft block — there is no API-level gate. The admin can still
 * proceed by acknowledging the warning. Use at every admin reimbursement
 * entry point (PayoutReviewModal, BulkSendModal, ExternalPaymentModal,
 * MarkPartyPaidModal).
 */
export function isSwcHubParty(
  party?: { country?: string | null; eventTags?: string[] | null } | null,
): boolean {
  if (!party) return false;
  // marzano-58293: explicit per-party opt-out. A 'nonhub' tag forces USDC
  // treatment — it takes precedence over BOTH the 'SWC Hub' tag and the
  // US-country fallback below. Mirrors the existing `nonpres` opt-out
  // precedent. Used to drop the SWC Hub reimbursement gate from US cities.
  if (
    Array.isArray(party.eventTags) &&
    party.eventTags.some((t) => t != null && t.trim().toLowerCase() === 'nonhub')
  ) {
    return false;
  }
  if (Array.isArray(party.eventTags) && party.eventTags.includes('SWC Hub')) return true;
  if (party.country === 'United States') return true;
  return false;
}
