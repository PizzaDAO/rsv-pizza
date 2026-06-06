/**
 * parmigiana-92104: SWC Hub party detection helper.
 *
 * Reimbursement for SWC Hub parties is processed through SWC, not rsv.pizza.
 * Admin reimbursement actions (approve / execute / mark-paid / external add /
 * bulk-send / mark-city-paid) surface an amber warning + ack checkbox when
 * the target party is an SWC Hub party — the action buttons stay disabled
 * until the admin ticks the ack.
 *
 * marinara-71630 P7: the COUNTRY/TAG literals that used to be hardcoded here
 * (country === 'United States', the 'SWC Hub' tag, the 'nonhub' exclusion tag)
 * moved into `app_config` (key `private.swc_hub_rules`) so they're out of the
 * open-source frontend bundle. They're served to the payments-admin viewer set
 * via GET /api/config/payout-caps and reach this matcher through a config hook
 * (`useSwcHubRules`). This file keeps only the (non-secret) MATCHING logic and
 * takes the rule data as an argument.
 *
 * Signals (either is sufficient, unless an exclude tag is present):
 *   1. `event_tags` includes one of `rules.tags` (e.g. 'SWC Hub') — also
 *      catches any non-US SWC Hub events the admins might tag in the future.
 *   2. `country` is one of `rules.countries` (e.g. 'United States').
 * An `event_tags` entry matching one of `rules.excludeTags` (e.g. 'nonhub')
 * forces the party OUT of the gate and takes precedence over both signals.
 *
 * Frontend-only soft block — there is no API-level gate. The admin can still
 * proceed by acknowledging the warning. Use at every admin reimbursement
 * entry point (PayoutReviewModal, BulkSendModal, ExternalPaymentModal,
 * MarkPartyPaidModal).
 *
 * The `rules` argument matches the EXACT normalization the previous hardcoded
 * logic used, so behavior is preserved when seeded with the equivalent values:
 *   - countries: matched EXACTLY (`country === c`) — was `=== 'United States'`.
 *   - tags: matched EXACTLY (`eventTags.includes(t)`) — was `includes('SWC Hub')`.
 *   - excludeTags: matched case-INSENSITIVELY and trimmed
 *     (`t.trim().toLowerCase() === ex`) — was the 'nonhub' opt-out. Seed
 *     excludeTags values already lowercased (e.g. 'nonhub').
 *
 * When `rules` is undefined (config still loading / unresolved) NOTHING is
 * flagged SWC — the SAFE default for a soft admin ack (the warning simply
 * doesn't block; the backend is not an enforcement point here).
 */
export interface SwcHubRules {
  countries: string[];
  tags: string[];
  excludeTags: string[];
}

export function isSwcHubParty(
  party?: { country?: string | null; eventTags?: string[] | null } | null,
  rules?: SwcHubRules | null,
): boolean {
  if (!party) return false;
  if (!rules) return false;
  const tags = Array.isArray(party.eventTags) ? party.eventTags : [];
  // marzano-58293: explicit per-party opt-out. An exclude tag (e.g. 'nonhub')
  // forces USDC treatment — it takes precedence over BOTH the tag and the
  // country signals below. Mirrors the existing `nonpres` opt-out precedent.
  // Matched case-insensitively + trimmed, exactly as the old 'nonhub' check.
  const excludeTags = Array.isArray(rules.excludeTags) ? rules.excludeTags : [];
  if (excludeTags.length > 0) {
    const present = tags.some(
      (t) =>
        t != null &&
        excludeTags.includes(t.trim().toLowerCase()),
    );
    if (present) return false;
  }
  // Tag signal — matched EXACTLY (preserves the old `includes('SWC Hub')`).
  const ruleTags = Array.isArray(rules.tags) ? rules.tags : [];
  if (ruleTags.some((t) => tags.includes(t))) return true;
  // Country signal — matched EXACTLY (preserves the old `=== 'United States'`).
  const countries = Array.isArray(rules.countries) ? rules.countries : [];
  if (party.country != null && countries.includes(party.country)) return true;
  return false;
}
