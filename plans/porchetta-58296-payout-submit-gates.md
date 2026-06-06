# porchetta-58296 — Gate payout submission on designated event photos + receipts

## Goal

The "Submit … receipt" button on the Payments tab stays disabled until, for this event:

1. **Three role photos are designated** by the host — a **group photo**, a **box stack photo**, and a **pizza photo**. For each role the host either:
   - **selects an existing gallery photo** (photos already on the event from this year, uploaded by the host **or** a guest), or
   - **uploads a new photo** (new uploads land in the public event gallery — the `photos` table).
   Each designated photo must be dated **after the event's start** (existing cutoff). Designations are **event-level** — one group / one box-stack / one pizza photo per event, shared across co-hosts and any payout.
2. **At least one receipt** is uploaded, AND a checkbox is ticked: **"I have submitted all my receipts and they are itemized."**

There is also an **optional zone to upload additional photos** (beyond the 3 roles) straight into the gallery.

The explicit 3-role selection **is** the photo gate — there is **no** separate photo attestation checkbox (only the receipts checkbox remains). Enforced **client- and server-side**.

## Decisions (confirmed with Snax)

- **Role photos:** 3 total — group, box stack, pizza. Host explicitly designates each.
- **Source:** select an existing gallery photo (host- or guest-uploaded) **or** upload new.
- **New uploads → public event gallery** (`photos` table), the same store selected from.
- **Designation scope: event-level** — shared across co-hosts/payouts (one photo per role per event).
- **Cutoff:** designated photos must be dated after event start (reuse existing rule).
- **Checkboxes:** drop the photo checkbox; explicit selection is the gate. Keep the receipts checkbox.
- **Enforcement:** frontend (button) + backend (`POST /payouts` rejects).

## Decisions (made while planning — flag if you disagree)

- **Dedicated `payout_role` column on `photos`, NOT free-form tags.** The gallery already exposes human tags `Pizza` / `Box Tower` / `Group Photo` (photo.routes.ts `/photos/tags`, default list), and guests can apply them at upload. The requirement is that the **host affirmatively designates** the photo — so a guest free-tagging "Pizza" must NOT auto-satisfy the gate. A host-set `payout_role` enum (`'group' | 'box_stack' | 'pizza'`) records the host's choice unambiguously. (Optional nicety: when a role is assigned, also add the matching human tag so the photo shows under that gallery filter.)
- **Event-level single designation enforced in the backend.** A partial unique index keeps one photo per role per party; assigning a role to a new photo clears it from the prior holder in the same transaction. Matches the "one group / box / pizza per event" model.
- **The 3 role slots replace the form's old inline pizza/event photo dropzones.** Today `NewPayoutForm` uploads `pizzaPhotos`/`eventPhotos` as `payout_documents` (kind `pizza`/`event`). Those dropzones are superseded by the gallery-based role flow; the new role photos live in `photos`, not `payout_documents`. Receipts are unchanged (`payout_documents` kind `receipt`).
- **`party.date` NULL ⇒ no cutoff** (mirrors photo-feed: `pa.date IS NULL OR created_at >= pa.date`).
- **No "after start" cutoff on receipts** — requirement puts the cutoff on photos only.
- **Additional-photos zone is optional** — not part of the gate.

## Relevant code (verified)

### Frontend — `frontend/src/components/payouts/NewPayoutForm.tsx`
- Form state: `receipts` (98), `pizzaPhotos` (99), `eventPhotos` (102) — the last two get removed/replaced.
- `isProcessing` (177–179); `canSubmit` (231–235): `finalAmount > 0 && attendanceValid && !isProcessing && !submitting && userMethodValid`.
- Submit button JSX (584–595): `disabled={!canSubmit}`. `handleSubmit` (237–333) builds `createPayout` payload (currently forwards `pizzaPhotos`/`eventPhotos` at 269–285 — drop these).

### Gallery — backend `backend/src/routes/photo.routes.ts`
- **Upload:** `POST /api/parties/:partyId/photos` (451–652). Host upload (`canUserEditParty`) ⇒ `status='approved'`, `starred=true`, `reviewedBy=userId`. Guest ⇒ `pending`. Insert fields at 608–634.
- **List:** `GET /api/parties/:partyId/photos` (21–312). Per-photo response 210–239 (includes `tags`, `photoYear`, `starred`, `status`, `uploadedBy`, `createdAt`, `source`). Filters: `starred`, `tag`, `status`, `uploadedBy`. Add `payoutRole` to the response mapping.
- **PATCH:** `PATCH /api/parties/:partyId/photos/:photoId` (710–772). Currently updates `caption`, `tags`, `starred`, `photoYear`, `status`. Auth: `canUserEditParty` + photos-tab access. **Extend to accept `payoutRole`** (the star/`starredAt` pattern at 753–756 is the model to mirror).
- Default human tags `['Pizza','Box Tower','Group Photo']` served by `/:partyId/photos/tags` (~331) — used by PhotoGallery filter UI; do **not** overload these for the gate.

### Gallery — frontend
- Upload helper + `PhotoUploadData` in `frontend/src/lib/api.ts` (~1154–1169). Photo-fetch API returns the per-photo shape above.
- Reusable components under `frontend/src/components/photos/`: **`PhotoGallery.tsx`** (grid + filters + upload), **`PhotoCard.tsx`** (tile; add an `onSelect`/selection overlay), `PhotoModal.tsx`, `PhotoUpload.tsx`, `MediaThumb.tsx`. Reuse PhotoCard inside the role picker.
- `Photo` type in `frontend/src/lib/types.ts` (~496–538) — add `payoutRole`.

### Backend — `backend/src/routes/payout.routes.ts`
- `POST /:partyId/payouts` create handler (~716+); existing assert gates (`assertPartyApproved`, `assertUserHasValidPayoutMethod`, caps). Add the new photo/receipt gate here.
- `GET /:partyId/payouts/receipts-library` (1560–1609) — auth precedent (`canUserEditParty`) for a sibling readiness endpoint.

### After-event-start cutoff (REUSE) — `backend/src/routes/photo-feed.routes.ts`
- `AND (pa.date IS NULL OR p.created_at >= pa.date)` (304) — `parties.date` is `@db.Timestamptz`.

### Data model — `backend/prisma/schema.prisma`
- `Party.date` (~57) `DateTime? @db.Timestamptz`. `Photo` model (~774–833): has `tags`, `starred/starredAt`, `status`, `uploadedBy` (guest id), `deletedAt`. Indexes on `(partyId, …)`.

## Implementation

### 1. Migration — `photos.payout_role` (apply to prod BEFORE merge)

This repo has **no Prisma auto-apply** — apply via Supabase MCP / `pg`, then add to `schema.prisma`:

```sql
ALTER TABLE photos ADD COLUMN payout_role text;            -- 'group' | 'box_stack' | 'pizza' | NULL
ALTER TABLE photos ADD COLUMN payout_role_set_at timestamptz;
ALTER TABLE photos ADD COLUMN payout_role_set_by text;     -- userId who designated (audit)
-- one live photo per role per event:
CREATE UNIQUE INDEX photos_party_payout_role_uniq
  ON photos (party_id, payout_role)
  WHERE payout_role IS NOT NULL AND deleted_at IS NULL;
```

`schema.prisma` Photo additions:
```prisma
  payoutRole      String?   @map("payout_role")        // 'group' | 'box_stack' | 'pizza'
  payoutRoleSetAt DateTime? @map("payout_role_set_at") @db.Timestamptz
  payoutRoleSetBy String?   @map("payout_role_set_by")
```
Order per repo rule: **apply column in prod → merge schema change → backend deploy** (merging a Prisma field-add before the column exists 500s every Photo query).

### 2. Backend — PATCH photo accepts `payoutRole`

In `PATCH /:partyId/photos/:photoId`:
- Accept `payoutRole: 'group' | 'box_stack' | 'pizza' | null`. Validate the enum.
- Reject designating a pre-cutoff photo: load `party.date`; if non-null and `photo.created_at < party.date` → 400 `PHOTO_BEFORE_EVENT_START`.
- In a transaction, clear the role from any other photo on the party (`UPDATE photos SET payout_role=NULL WHERE party_id=? AND payout_role=? AND id<>?`) then set it on this one with `payout_role_set_at=now()`, `payout_role_set_by=userId`. (Belt-and-braces with the unique index.)
- Optional: also `array_append` the matching human tag (`Group Photo`/`Box Tower`/`Pizza`) if absent.
- Add `payoutRole` to the GET-photos response mapping (210–239).

### 3. Backend — submission-readiness helper + endpoint

```ts
async function getPayoutSubmissionReadiness(partyId: string) {
  const [row] = await prisma.$queryRaw<{
    has_group: boolean; has_box: boolean; has_pizza: boolean; has_receipt: boolean;
  }[]>(Prisma.sql`
    WITH pa AS (SELECT date FROM parties WHERE id = ${partyId}::uuid)
    SELECT
      EXISTS (SELECT 1 FROM photos p, pa WHERE p.party_id=${partyId}::uuid AND p.deleted_at IS NULL
                AND p.payout_role='group'     AND (pa.date IS NULL OR p.created_at >= pa.date)) AS has_group,
      EXISTS (SELECT 1 FROM photos p, pa WHERE p.party_id=${partyId}::uuid AND p.deleted_at IS NULL
                AND p.payout_role='box_stack' AND (pa.date IS NULL OR p.created_at >= pa.date)) AS has_box,
      EXISTS (SELECT 1 FROM photos p, pa WHERE p.party_id=${partyId}::uuid AND p.deleted_at IS NULL
                AND p.payout_role='pizza'     AND (pa.date IS NULL OR p.created_at >= pa.date)) AS has_pizza,
      EXISTS (SELECT 1 FROM payout_documents pd WHERE pd.party_id=${partyId}::uuid AND pd.kind='receipt') AS has_receipt
  `);
  return {
    hasGroupPhoto: !!row?.has_group,
    hasBoxStackPhoto: !!row?.has_box,
    hasPizzaPhoto: !!row?.has_pizza,
    hasReceipt: !!row?.has_receipt,
  };
}
```
Add `GET /:partyId/payouts/submission-readiness` (auth + `canUserEditParty`) returning that object. **Verify the raw SQL by executing it against the DB** before calling it done (`$queryRaw` is opaque to tsc).

### 4. Backend — enforce in `POST /:partyId/payouts`

After existing asserts, before creating the Payout:
```ts
if (receiptAttested !== true) throw new AppError('Confirm your receipts are submitted and itemized.', 400, 'RECEIPT_ATTESTATION_REQUIRED');
const incomingReceipts = (req.body.receiptPhotos ?? []).length;
const r = await getPayoutSubmissionReadiness(partyId);
if (incomingReceipts < 1 && !r.hasReceipt) throw new AppError('Upload at least one receipt before submitting.', 400, 'RECEIPTS_REQUIRED');
if (!r.hasGroupPhoto)    throw new AppError('Designate a group photo before submitting.', 400, 'GROUP_PHOTO_REQUIRED');
if (!r.hasBoxStackPhoto) throw new AppError('Designate a box stack photo before submitting.', 400, 'BOX_STACK_PHOTO_REQUIRED');
if (!r.hasPizzaPhoto)    throw new AppError('Designate a pizza photo before submitting.', 400, 'PIZZA_PHOTO_REQUIRED');
```
Also stop persisting `pizzaPhotos`/`eventPhotos` as payout documents (those inputs go away).

### 5. Frontend — `createPayout` / `CreatePayoutData`
- Drop `pizzaPhotos` / `eventPhotos` from the payload.
- Add `receiptAttested?: boolean`; forward it.
- Add `designatePhotoRole(partyId, photoId, role | null)` → `PATCH /photos/:photoId { payoutRole }`, and `fetchPayoutSubmissionReadiness(partyId)`.

### 6. Frontend — `NewPayoutForm.tsx`
- **Remove** `pizzaPhotos`/`eventPhotos` state + the two `PizzaPhotoUpload` dropzones.
- New **"Event photos"** section with **3 role slots** (Group photo / Box stack photo / Pizza photo). Each slot:
  - shows the designated photo thumbnail (from readiness/local state) or an empty "Select or upload" CTA;
  - opens a **RolePhotoPicker** modal: a grid of the party's gallery photos (reuse `PhotoGallery`/`PhotoCard`), filtered to **post-event-start eligible** photos (pre-start ones shown disabled with a note), plus an **Upload** action (uses the existing gallery upload path → `POST /photos` host upload). On select/upload, call `designatePhotoRole` and update local slot state.
- **Optional "Additional photos"** uploader below the slots → gallery upload, no role.
- New state: `const [receiptAttested, setReceiptAttested] = useState(false);` and `const [roles, setRoles] = useState<{group?: Photo; box_stack?: Photo; pizza?: Photo}>(...)` seeded from a readiness/photos fetch on mount.
- Derived:
  ```ts
  const hasReceiptUpload = receipts.some(r => r.status === 'done' && r.url) || !!readiness?.hasReceipt;
  const allRolesDesignated = !!roles.group && !!roles.box_stack && !!roles.pizza;
  ```
- Extend `canSubmit`:
  ```ts
  const canSubmit = finalAmount > 0 && attendanceValid && !isProcessing && !submitting && userMethodValid
    && hasReceiptUpload && receiptAttested
    && allRolesDesignated;
  ```
- Receipts `Checkbox` — `disabled={!hasReceiptUpload}`, label *"I have submitted all my receipts and they are itemized."*, helper text when disabled: *"Upload at least one receipt to enable this."*
- Forward `receiptAttested`; handle the new backend error codes in `catch` (messages are human-readable).

### 7. i18n
Add to all 8 locales (`de,en,es,fr,ja,ko,pt,zh`): the 3 role-slot labels (Group photo / Box stack photo / Pizza photo), picker copy ("Select from gallery", "Upload new", pre-start ineligible note), "Additional photos", and the receipts checkbox + helper strings.

## Open scope notes
- **Admin /payments view:** event photos now live in the gallery (with `payout_role`) instead of as payout documents. If /payments shows a payout's photos, point it at the designated role photos. Flag if the admin review UI needs the same 3 slots surfaced — likely a small follow-up.
- **Existing payouts** submitted under the old flow have `pizza`/`event` payout_documents but no role-tagged gallery photos; the gate only affects new submissions, so no backfill needed. Confirm we don't want to retro-require roles on past payouts.

## Verification
- **Migration:** apply the `payout_role` column + index in prod; confirm a duplicate-role insert is rejected by the unique index.
- **PATCH:** designate a guest-uploaded photo as `group` from the host account → succeeds; designating a pre-event photo → 400 `PHOTO_BEFORE_EVENT_START`; re-designating clears the prior holder (only one `group` remains).
- **Readiness SQL:** run against prod for events with 0/partial/all roles.
- **UI (Vercel preview `rsvpizza-git-porchetta-58296-…`):**
  - Fresh event → 3 empty slots, receipts box disabled, Submit disabled.
  - Designate group only → Submit still disabled; fill box stack + pizza → photo side satisfied.
  - Upload a receipt → receipts box enables; tick it → Submit enabled.
  - Pick a guest-uploaded photo for a role → counts.
  - Upload a new photo from a slot → appears in /photos gallery AND fills the slot.
- **API bypass:** POST missing a role or `receiptAttested` → 400 with the right code.
- `tsc` clean both packages.

## Ordering / deploy
- **Migration first** (prod column + index) → merge schema + backend + frontend → master push auto-deploys backend. Previews hit the prod backend, so the column and endpoints must exist in prod before the preview works.
- Standard flow: worktree off `origin/master`, draft PR, Vercel preview, then merge. Manual backend deploy only from the `rsvpizza-master-deploy` worktree if needed.

## Open questions for Snax (optional)
- Apply the gate to **all** payout purposes, or exempt `purpose='shipping'` (kit-shipping reimbursements have no group/box-stack/pizza photo)? Current plan: all purposes.
