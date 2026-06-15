# piadina-58543 — Actionable submit-readiness photo checklist copy

## Problem
The /payments reimbursement (PayoutsTab) amber "A few things are still needed before you can submit for review:" checklist shows terse labels. Two confuse hosts:
- "Box stack photo" — host doesn't realize they must designate/choose an existing photo into the box-stack role slot (Event photos section), not just upload more photos.
- "{{count}}/{{required}} additional photos" — host doesn't realize the group/box/pizza role photos are excluded from this count. Belgrade host uploaded 5 photos total but saw "3/5 additional photos" and reported it as a problem.

## Change (frontend-only, copy only)
`frontend/src/i18n/locales/en/host.json`:
- `missingBoxStackPhoto`: "Box stack photo" → "Box stack photo — choose one in Event photos"
- `missingAdditionalPhotos`: "{{count}}/{{required}} additional photos" → "{{count}}/{{required}} extra event photos (group/box/pizza don't count)"

No `.tsx` change — `PayoutsTab.tsx` already interpolates `{ count, required }` and calls `t('payouts.missingBoxStackPhoto')` / `t('payouts.missingAdditionalPhotos', {...})`. English locale only; other locales keep their existing (terser) translations as fallback.

## Risk
None functional — pure display strings. No backend, no migration.
