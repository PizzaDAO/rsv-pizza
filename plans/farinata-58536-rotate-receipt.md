# farinata-58536: Rotate control in the receipt editor

**Branch**: `farinata-58536-rotate-receipt` (off `origin/master`)
**Preview**: `https://rsvpizza-git-farinata-58536-rotate-receipt-pizza-dao.vercel.app`

## Context
Some receipts are uploaded sideways (e.g. the Santiago de Chile receipt
`1000271295.jpg`, doc `51c2def9`). gpt-4o reads rotated text inconsistently, and
the deployed OCR pipeline only honors **EXIF** orientation (sharp `.rotate()` with
no arg in `imageUrlToBase64DataUrl`), which does nothing for a scan with no/incorrect
EXIF. Admins need a way to rotate a receipt so it's readable **and** so the next
"Re-run OCR" reads the corrected orientation.

Decision: the rotation must be **persisted to the stored image** (not a CSS-only
display transform), because OCR re-reads `payout_documents.url` from storage. We
rotate by writing a **new** rotated object to storage and repointing `doc.url` — a
new path avoids CDN/browser cache staleness, and rotation is itself reversible
(rotate back). No DB migration (the `url` column already exists).

## What already exists (reuse, don't rebuild)
- **sharp** is a backend dependency (`backend/package.json`, `^0.33.5`).
- **Storage upload pattern**: `backend/src/routes/logoAudit.routes.ts:347` /
  `:465` — `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` then
  `supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType, upsert })`
  + `.getPublicUrl(path)`. Mirror this. `taxFormStorage.service.ts` is another example.
- **Bucket**: receipts live in the **`event-images`** bucket under
  `payouts/{partyId}/` (see `payout.routes.ts:230,270,276`). Write the rotated copy
  under the same `payouts/{partyId}/` prefix so it satisfies the OCR URL guard.
- **Retry-OCR endpoint** (`admin-payout.routes.ts:6118`,
  `POST /documents/:docId/retry-ocr`) — mirror its auth
  (`requireAuth` + `requireAnyAdminOrPaymentAdmin`), the `findUnique` doc lookup, and
  the `{ document: {...} }` response shape.
- **Frontend optimistic plumbing**: `receiptOverrides` merge in
  `PayoutReviewModal.tsx:651-686` (the `ReceiptOverride` type is at `:539-555`) and
  the `retryOcr` success handler at `:925-960` — mirror both.
- **Editor buttons**: the "Re-run OCR" button row in
  `ReceiptEditor.tsx:534-554` is the model for a compact icon button with a
  `Loader2` spinner + disabled in-flight state + inline error.

## Changes

### 1. Backend — `backend/src/routes/admin-payout.routes.ts` (new endpoint)
Add `POST /documents/:docId/rotate`, placed near the retry-ocr handler (~6118):
- Auth: `requireAuth`, `requireAnyAdminOrPaymentAdmin` (same as retry-ocr).
- Body: `{ degrees: 90 | -90 | 180 }`. Validate it's one of those three; else
  `AppError('degrees must be 90, -90, or 180', 400, 'INVALID_ROTATION')`.
- `prisma.payoutDocument.findUnique({ where: { id: docId }, select: { id, url, kind, fileName, partyId } })`;
  404 if missing.
- **Guard the input format.** Fetch the bytes: `const resp = await fetch(existing.url)`.
  Determine content type from the response `content-type` header (fallback: extension).
  Reject non-raster: if it's a PDF (`application/pdf` / `.pdf`) or HEIC
  (`image/heic`/`image/heif`/`.heic`/`.heif`) → `AppError('Rotation is only supported
  for JPG/PNG images', 400, 'ROTATE_UNSUPPORTED_FORMAT')`. (sharp can't decode HEIC on
  Vercel — see `architecture_heic_decode_limits`; PDFs aren't raster.)
- Rotate: `import sharp from 'sharp'` (top-level import is fine; it's already a dep).
  `const rotated = await sharp(Buffer.from(await resp.arrayBuffer())).rotate(degrees).toBuffer();`
  (`.rotate(angle)` with an explicit angle rotates clockwise by that many degrees and
  bakes orientation into the pixels; no format method preserves the input format.)
- Upload a **new** object (cache-safe). Build the storage path from the existing URL:
  take the path segment after `/object/public/event-images/` and insert a suffix
  before the extension, e.g. `payouts/{partyId}/{base}-r{Date.now()}{ext}`. Use the
  `event-images` bucket + the `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`
  admin client (mirror logoAudit). `upload(newPath, rotated, { contentType, upsert: false })`,
  then `getPublicUrl(newPath)`.
- `prisma.payoutDocument.update({ where: { id: docId }, data: { url: newUrl } })`.
- Respond `{ document: { id, url: newUrl } }`.
- Do **NOT** delete the old object (it may be the original upload / referenced
  elsewhere). Leaving an orphan is acceptable; note it as a possible future cleanup.
- Do **NOT** re-run OCR here — keep rotate and OCR as separate explicit admin actions
  (admin clicks "Re-run OCR" after rotating). Same single-responsibility contract as
  retry-ocr / the per-receipt PATCH.

### 2. Frontend API — `frontend/src/lib/api.ts`
Add `rotatePayoutDocument(docId: string, degrees: 90 | -90 | 180): Promise<{ document: { id: string; url: string } }>`
next to `retryPayoutDocumentOcr` (~`:4542`). POST to
`/admin/payouts/documents/${docId}/rotate` with `{ degrees }`.

### 3. Modal handler — `frontend/src/components/payments-admin/PayoutReviewModal.tsx`
- Add `url?: string` to the `ReceiptOverride` type (`:539`) and merge it in the
  `receipts` memo (`:664-683`): `url: ov.url !== undefined ? ov.url : d.url`.
- Add per-row rotate state mirroring retry-OCR: `rotatingDocId`, `rotateErrors`.
- Add `async function rotateDoc(docId, degrees)` mirroring `retryOcr` (`:925`):
  set rotating, call `rotatePayoutDocument`, on success
  `setReceiptOverrides((m) => ({ ...m, [docId]: { ...m[docId], url: res.document.url } }))`
  so the lightbox image re-renders rotated; clear on error into `rotateErrors`.
- Pass `onRotate`, `rotating`, `rotateError` down to `ReceiptEditor` at the
  lightbox render site (where `onRetryOcr` is wired, ~`:1547`).

### 4. Editor buttons — `frontend/src/components/payments-admin/ReceiptEditor.tsx`
- Add props: `onRotate?: (degrees: 90 | -90 | 180) => void; rotating?: boolean; rotateError?: string;`
- Render two compact icon buttons (lucide `RotateCcw` = rotate left / `-90`,
  `RotateCw` = rotate right / `90`) in the header row (`:300-335`), next to the
  confidence chip. Same spinner/disabled pattern as the Re-run OCR button; show
  `rotateError` inline. Honor the literal ask ("in the receipt editor"); an overlay
  on the lightbox image is an optional nice-to-have, out of scope here.

## Constraints / gotchas
- **Backend deploys from master only**; previews hit the prod backend, so the new
  `/rotate` endpoint is NOT live on the preview until merged + backend deploys from
  `master`. The frontend buttons will 404 against the current prod backend until then
  — verify end-to-end only after merge.
- **No migration** — `url` already exists on `payout_documents`. (No schema change =
  no pre-merge DB step.)
- **HEIC/PDF**: explicitly rejected with a clear 400 (sharp can't decode HEIC on
  Vercel; PDFs aren't raster). Don't silently no-op.
- **New URL, not overwrite** — repointing to a fresh path avoids the CDN/browser
  caching the pre-rotation pixels under the same URL.
- **Money path untouched** — rotate only changes `url`; it does not write
  amount/currency/USD. OCR re-read remains the only path that sets those.

## Verification
1. `cd frontend && npm run build` passes; `cd backend && npx tsc --noEmit` passes.
2. After backend deploy from master: open receipt `51c2def9` (Santiago de Chile,
   `1000271295.jpg`) in the review lightbox. Click rotate-left (−90°) → the image
   re-renders upright in place (no full refetch).
3. Click **Re-run OCR** → line items/amount/currency populate from the now-readable
   image (requires the `llm.models.ocrCheap` config fix to be live, separately).
4. Rotating a PDF/HEIC receipt surfaces the `ROTATE_UNSUPPORTED_FORMAT` 400 inline,
   not a generic 500.
5. Reload the page → the rotation persists (url repointed in the DB).

## Related
- Separate prod-config fix (NOT part of this PR): `app_config.llm.models` is missing
  the `ocrCheap` key, so the deployed OCR routing calls OpenAI with
  `model: undefined` → "400 you must provide a model parameter". Re-seed the blob to
  add `"ocrCheap":"gpt-4o-mini"`. Without that, Re-run OCR fails regardless of
  rotation. (Also worth a code follow-up: `getLlmModels` should tolerate a missing
  key, e.g. `ocrCheap || ocr`, since `getConfig` doesn't merge defaults.)
