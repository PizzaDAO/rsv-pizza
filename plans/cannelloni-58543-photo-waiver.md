# cannelloni-58543 — Host can submit payout without photos via acknowledgment checkbox

## Goal
Let a host submit their reimbursement **for review/payment** on /payments even when the
required event photos are missing, **provided they tick an acknowledgment checkbox** that
they understand they are submitting without the required photos. The receipt + attestation
+ payment-method + attendance gates are **unchanged** — only the photo gates are waivable.

Decisions (confirmed with Snax):
- **Waive ALL photo requirements** — the 3 role photos (group / box_stack / pizza) AND the
  ≥5 additional event photos (tiramisu-58530). Not a partial relaxation.
- **Persist + surface to admins** — record `photos_waived_at` on the payout row at submit
  time and show a "Submitted without photos" badge on /payments (by-party row + review modal)
  so reviewers know they approved a photo-less submission.

## Background — the two gated submit paths (both must change)
1. `POST /:partyId/reimbursement/submit` (payout.routes.ts ~3460) — the **modern** rolling
   "Submit for review" toggle used by `PayoutsTab`. Gates via `getReimbursementReadiness()`
   → `readyToSubmit` → throws `NOT_READY` with `missing: groupPhoto/boxStackPhoto/pizzaPhoto`
   (and the additional-photo count feeds `readyToSubmit`).
2. `POST /:partyId/payouts` (payout.routes.ts ~868) — the legacy one-shot create flow.
   Throws `GROUP_PHOTO_REQUIRED` / `BOX_STACK_PHOTO_REQUIRED` / `PIZZA_PHOTO_REQUIRED` /
   `ADDITIONAL_PHOTOS_REQUIRED` (lines ~1078-1107).

Clone the existing `submittedForReviewAt` (ziti-58300) plumbing end-to-end — it is the exact
template for a new nullable timestamp that flows schema → serializers → admin projection →
frontend types → UI badge.

## Landmines (from ship-payout-change)
- **Backend auto-deploys from master ~1 min after merge.** Apply the migration to PROD
  **before** merging or every query touching the Payout model 500s.
- Receipt OCR preview ≠ persistence; don't touch the receipt gate — it stays required.
- Rolling payouts snapshot wallet/method onto the row at submit; keep that snapshot logic
  intact (the submit handler already does `payoutRowSnapshotFromUser`).

---

## Changes

### 1. Migration (apply to PROD before merge)
New file `backend/prisma/migrations/cannelloni-58543-photos-waived-at.sql`:
```sql
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "photos_waived_at" TIMESTAMPTZ;
```
Table is `payouts` (verified `@@map("payouts")`). Apply via `mcp__supabase-pizzadao__apply_migration`
from the main session, then verify with `execute_sql`.

### 2. `backend/prisma/schema.prisma` (model Payout, ~line 1982 next to submittedForReviewAt)
```prisma
photosWaivedAt DateTime? @map("photos_waived_at") @db.Timestamptz
```

### 3. `backend/src/routes/payout.routes.ts`
- **serializePayout (~line 197)** — add next to `submittedForReviewAt`:
  ```ts
  photosWaivedAt: p.photosWaivedAt ? p.photosWaivedAt.toISOString() : null,
  ```
- **`POST /:partyId/payouts` create handler**
  - Destructure `photosWaived` from `req.body` (~line 900, near `receiptAttested`).
  - In the photo-gate block (~1078-1107), wrap the four photo throws so they are skipped
    when `photosWaived === true`. Keep the receipt + attestation throws unconditional.
    Cleanest: `if (photosWaived !== true) { ...the four photo gates... }`.
  - When creating the payout row, set `photosWaivedAt: photosWaived === true ? new Date() : null`.
- **`getReimbursementReadiness` (~2907)** — add a derived flag that callers can use without
  changing `readyToSubmit`'s meaning. Return an extra:
  ```ts
  // Everything required EXCEPT photos — drives the "submit anyway with waiver" path.
  readyToSubmitWithoutPhotos: attendanceSet && photoReadiness.hasReceipt && paymentMethodValid,
  ```
  Leave `readyToSubmit` as-is (still includes photos) so existing behavior/labels don't shift.
- **`POST /:partyId/reimbursement/submit` (~3460)**
  - Destructure `photosWaived` alongside `attested`.
  - Keep the `attested !== true` → `ATTESTATION_REQUIRED` throw.
  - Replace the readiness gate: if `photosWaived === true`, require
    `readiness.readyToSubmitWithoutPhotos` (else `NOT_READY` reporting the first non-photo
    miss: attendance / receipt / paymentMethod). If not waived, keep the existing
    `readiness.readyToSubmit` gate exactly.
  - In the `prisma.payout.update`, set `photosWaivedAt: photosWaived === true ? new Date() : null`
    (clearing it on a normal submit is correct — a re-submit with photos un-waives).
- **`GET /:partyId/reimbursement/me` (~2980)** — the response already spreads `...readiness`,
  so `readyToSubmitWithoutPhotos` flows automatically. `photosWaivedAt` flows via
  `serializePayout(record)`. No extra work beyond confirming.
- **`POST /:partyId/reimbursement/unsubmit`** — when clearing `submittedForReviewAt`, also
  clear `photosWaivedAt: null` so reopening drops the stale waiver.

### 4. `backend/src/routes/admin-payout.routes.ts`
- **serializePayout (~837)** — add next to `submittedForReviewAt` (~843):
  ```ts
  photosWaivedAt: row.photosWaivedAt ? row.photosWaivedAt.toISOString() : null,
  ```
  (Confirm the Prisma selects/includes for the by-party + review queries don't use a
  narrow `select` that omits the new column — `submittedForReviewAt` is already returned,
  so the same query should include `photosWaivedAt` for free once it's in the model.)

### 5. `frontend/src/lib/api.ts`
- `ReimbursementReadiness` (~6581): add `readyToSubmitWithoutPhotos: boolean;`.
- `submitReimbursement` (~6706): add a `photosWaived?: boolean` param and include it in the
  POST body: `body: { attested, photosWaived }`.

### 6. `frontend/src/types.ts`
- `Payout` interface (~2057, next to `submittedForReviewAt`): add
  `photosWaivedAt?: string | null;`.

### 7. `frontend/src/components/payouts/PayoutsTab.tsx`
- New state `const [photosWaived, setPhotosWaived] = useState(false);`.
- `photosAllDesignated` already computed (~581). When `!photosAllDesignated`, render a
  **photo-waiver checkbox** in the submit card (section 7, near the attestation):
  label e.g. *"I'm submitting without the required event photos and understand my
  reimbursement may be delayed or returned for the missing photos."* Use the `Checkbox`
  component (per CLAUDE.md reusable-components rule).
- Recompute submit-enable:
  ```ts
  const readyWithWaiver = readiness?.readyToSubmitWithoutPhotos === true;
  const canSubmit = ((readyToSubmit) || (photosWaived && readyWithWaiver)) && attested && !submitting;
  ```
- `handleSubmit` → `submitReimbursement(partyId, attested, photosWaived)`.
- Update the disabled-help text: when `!readyToSubmit` but `readyWithWaiver`, prompt them to
  tick the waiver instead of the generic "not ready" message. Keep the `missing` list visible
  so they still see what's absent.
- Only pass `photosWaived: true` when photos are actually missing (avoid stamping a waiver on
  a complete submission). i.e. send `photosWaived && !photosAllDesignated`.

### 8. Admin badge — `frontend/src/components/payments-shared/PayoutRow.tsx` + `payments-admin/PayoutReviewModal.tsx`
- Where `submittedForReviewAt` is surfaced (the "Submitted" badge), add a small amber pill /
  note "Submitted without photos" when `payout.photosWaivedAt` is set. Reuse existing
  badge/pill styling next to the Submitted badge. (Find current usage by grepping
  `submittedForReviewAt` in `frontend/src/components/payments-*`.)

### 9. i18n
- Add the new copy keys to `frontend/src/i18n/locales/en/host.json` (and mirror to the other
  locale files alongside the existing `payouts.*` keys — at minimum add the English string to
  all 8 so `t()` doesn't render the raw key). Keys: `payouts.photoWaiverAck`,
  `payouts.submitNeedsPhotoWaiver` (the "tick the box to submit without photos" helper).

## Verify
- Preview: `https://rsvpizza-git-cannelloni-58543-photo-waiver-pizza-dao.vercel.app`
- As a host on a city with **no** event photos but with a receipt + valid method + attendance:
  Submit is disabled; ticking the waiver enables it; submit succeeds.
- Admin /payments shows the "Submitted without photos" badge on that city's row + review modal.
- A host **with** all photos submits normally and gets **no** waiver badge (photosWaivedAt null).
- Reopen (unsubmit) clears both submittedForReviewAt and photosWaivedAt.

## Out of scope
- Receipt / attestation / payment-method / attendance gates stay required.
- The `/payouts` legacy create flow keeps all non-photo gates; only photo gates become waivable.
