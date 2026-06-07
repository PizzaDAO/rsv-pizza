# polpetta — remove `single_checker_dominance` from fraud risk flags

## Problem
The `single_checker_dominance` heuristic fires when one account performed ≥95% of
an event's door check-ins. On this platform a single host checking everyone in is
the **norm**, not a fraud signal — most events are run by one person with one phone.
It produced a false-positive +10 on Bhubaneswar while its sibling check-in
heuristics (`checkin_velocity_superhuman`, `checkin_timestamp_collapse`,
`checkin_ratio_extreme`) — the ones that actually indicate roster-blasting fraud —
did **not** fire. We're retiring it.

## Scope
Backend-only. No DB migration. No frontend change (the Risk pill renders whatever
flags the backend returns, so dropping the flag from `row.flags` removes it from the
UI automatically). Once the key leaves `WEIGHTS`, `resolveWeights` no longer reads
it from `private.fraud_weights`, so any production weight for it goes dead — no
config edit required.

## Changes
### `backend/src/lib/fakeDetection.ts`
1. Remove the `single_checker_dominance: 0,` entry from the `WEIGHTS` map.
2. Delete the `checkSingleCheckerDominance` function and its doc-comment block.
3. Remove the `checkSingleCheckerDominance(allGuests),` call from `scoreEvent`'s
   `rawFlags` array.

### `backend/src/lib/fakeDetection.test.ts`
1. Remove `checkSingleCheckerDominance` from the import list.
2. Remove the `single_checker_dominance: SYNTH_CHECKIN_W,` entry from `TEST_WEIGHTS`.
3. Delete the `describe('checkSingleCheckerDominance', ...)` block.
4. In `scoreEvent — check-in heuristics integration`, remove the two assertions
   referencing `single_checker_dominance` (the `toContain` in the fraud-roster test
   and the `not.toContain` in the healthy-roster test).

## Verification
- `npm run build` (tsc) green in `backend/`.
- `npm test -- fakeDetection` green — the three remaining check-in heuristics still
  fire on the fraud roster and stay quiet on the healthy roster.

## Follow-up (Snax)
- Backfill the project-sheet row with the real pizza id/number for this task.
- Optional housekeeping: drop the `single_checker_dominance` key from the
  `private.fraud_weights` app_config row (harmless if left — it's now ignored).
