# jalapeno-61805: re-tune fake-event detection on current data

Weights and tier cutoffs live in the private `app_config.private.fraud_weights` row (#849) and are
never written to this repo. The analysis, per-event results and the config values are kept
privately; this file covers only the public code change.

## Code changes: `backend/src/lib/fakeDetection.ts`

1. Remove 10 heuristics from `WEIGHTS` and the `scoreEvent` flags. Measured on GPP events against
   bounce and admin ground truth, they were noise or could not fire:
   `cap_fill_no_waitlist`, `wallet_too_high_reuse`, `wallet_reuse`, `one_word_name`,
   `cross_event_wallet`, `high_per_visitor_rsvp_saturation`, `name_token_zscore`,
   `lsh_field_sig_cluster`, `email_digit_benford`, `co_host_twitter_handles_missing`.
   The `checkXxx` functions stay exported, `@deprecated`, returning weight 0 via `deprecatedFlag`.
   `scoreEvent` keeps its sybil-wallet parameter (unused by scoring).
2. Threshold changes:
   - `checkFirstnameDigitsEmail`: ratio > 0.95 → > 0.7 (domain entropy < 0.5 unchanged)
   - `checkRepeatSessionRsvpCount`: max ≥ 5 → ≥ 10
   - `checkLowHourEntropy`: H < 1.5 → < 2.0
   - `checkLowFunnelCoverage`: ratio < 0.15 → < 0.25

## Config apply: `backend/src/config/seedPrivateConfig.ts`

Add `--only <key>` (upsert just that key; never fall back to `seed.example.json`) and `--dry-run`
(print key names and change counts, never values). The new private weights are applied after merge
with `npm run seed:private-config -- --only private.fraud_weights --dry-run`, then without
`--dry-run`. A rollback copy of the current row is kept privately.

## Tests: `backend/src/lib/fakeDetection.test.ts`

Drop the removed keys from `TEST_WEIGHTS`; assert the removed ids are absent from `WEIGHTS` and
`scoreEvent` flags; boundary tests for the four threshold changes.

## PR #644

Superseded: its weights were never applied to prod config, and since #849 weights in code do
nothing.
