# marinara-61842 — Lock down `event-images` storage listing (payout receipts exposed)

Status: **review** · P1 · security · Branch `task/marinara-61842`

**The SQL in this branch has NOT been applied to any database.** Nothing has been deployed, and no backfill has been run.

## Finding

Verified live on 2026-10-18 using only the public anon key from the rsv.pizza JS bundle:

- `POST https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/list/event-images` returns every object in the bucket (about 15.4k).
- That includes `payouts/<partyId>/<tmpId>/receipt/*`. A read-only DB count on 2026-10-18 found 2,701 receipt objects, of which 107 are `application/pdf` (the rest are JPG/PNG photos plus `.pdf.thumb.png` thumbnails).
- It also includes 172 objects under `receipts/<partyId>/` (budget receipts) and pizza photos.
- Receipts can show names, addresses and card digits.

Object paths carry random suffixes (`tmp-<ms>-<rand6>/receipt/<ms>-<rand5>.<ext>`), so listing is the only practical way to find them.

### Cause

Prod has this policy on `storage.objects` (read from `pg_policies` on 2026-10-18):

| policy | cmd | roles | qual |
|---|---|---|---|
| `Anyone can view event images` | SELECT | `{public}` | `bucket_id = 'event-images'` |
| `Anyone can upload event images` | INSERT | `{public}` | with_check `bucket_id = 'event-images'` |

The SELECT policy comes from `backend/sql/fix-storage-policies.sql` (also in `backend/sql/create-event-images-bucket.sql` and `STORAGE-SETUP.md`). Storage's list endpoint runs as the caller's role and filters `storage.objects` through the caller's SELECT policies, so `USING (bucket_id = 'event-images')` exposes every row.

`event-images` is a **public** bucket (`storage.buckets.public = true`). Public reads (`/object/public/...`) do not consult `storage.objects` RLS, so the SELECT policy was never needed for the site's images.

The UPDATE and DELETE policies in `fix-storage-policies.sql` are **not** present in prod.

## Fix in this PR

1. **`supabase/migrations/20261018_marinara_61842_lockdown_event_images_listing.sql`**
   - `DROP POLICY IF EXISTS "Anyone can view event images" ON storage.objects;`
   - Defensive `DROP POLICY IF EXISTS` for `Anyone can update event images` and `Anyone can delete event images`. Neither is live; they are dropped in case anyone re-runs the old script.
   - The INSERT policy is kept. No replacement SELECT policy is added, so listing closes for anon **and** authenticated. The browser client has no Supabase Auth session (the app uses a custom JWT), so `authenticated` never reaches storage anyway.
   - The file includes a rollback statement in its header.
2. **`backend/sql/fix-storage-policies.sql`, `backend/sql/create-event-images-bucket.sql`, `STORAGE-SETUP.md`**: these no longer create the SELECT, DELETE or UPDATE policies, so re-running a setup script can't reopen the hole.

### Call sites checked

| Call site | Key | Op on event-images | Affected? |
|---|---|---|---|
| `frontend/src/lib/supabase.ts` `uploadEventImage` (and `useImageUpload` hook) | anon | `upload` upsert:false + `getPublicUrl` | No: needs INSERT only |
| `uploadSponsorLogo`, `uploadCoHostAvatar`, `proxyAvatarToStorage`, `uploadDescriptionImage`, `uploadReceipt` | anon | `upload` upsert:false + `getPublicUrl` | No |
| `uploadPayoutPhoto` (pizza/event/receipt + `.pdf.thumb.png` sibling) | anon | `upload` upsert:false + `getPublicUrl` | No |
| `uploadProfilePicture` (profile-pictures, **upsert:true**), `uploadEventPhoto` / `uploadVenuePhoto` (event-photos), `uploadEventVideo` (event-videos) | anon | other buckets | Not touched |
| `backend/src/routes/admin-payout.routes.ts` (rotate receipt) | service_role | upload/getPublicUrl | No: bypasses RLS |
| `backend/src/routes/logoAudit.routes.ts`, `telegram-inbound.routes.ts`, `lib/imageAuthenticity.ts` (ELA overlays) | service_role | upload/getPublicUrl | No |
| `backend/src/services/ocr.service.ts`, `pdfRasterize.ts`, `routes/heic.routes.ts` | none | HTTP GET on `/object/public/...` | No: public read path |
| `frontend/vercel.json` `/cdn/*` rewrite → `/object/public/*` | none | public GET | No |
| `scripts/backfill-avatar-proxy.js`, `scripts/batch-generate-flyers.js` | service_role | upload | No |
| `scripts/check-storage-bucket.js` (diagnostic) | anon | upload + `remove` | Its cleanup `remove` was already failing (no DELETE policy in prod); unchanged |
| `.list(` / `/object/list` / `download` / `move` / `copy` / `createSignedUrl` on event-images | — | — | **None found** in `frontend/src`, `backend/src`, `supabase/functions` or `scripts` |

Supabase's storage access-control docs say a plain upload needs INSERT only, and SELECT (plus UPDATE) only for `upsert: true`. Every event-images upload uses `upsert: false`. This is the one assumption the post-apply upload check below confirms.

## Rollout order (owner runs on prod)

1. **Apply the policy SQL**: run `supabase/migrations/20261018_marinara_61842_lockdown_event_images_listing.sql` in the Supabase SQL editor (project `znpiwdvvsqaxuskpfleo`).
2. **Verify right away** using the checklist below: listing is closed, site images still load, and uploads still work. If any upload fails with an RLS error, run the rollback statement from the migration header and report back.
3. **Merge this PR.** It contains no app code changes, only the migration record and the setup docs/scripts.
4. **Later (follow-up task):** do the private-bucket move for payout receipts, then the backfill (see below).

## Verification checklist

```bash
SB=https://znpiwdvvsqaxuskpfleo.supabase.co
# The public anon key: VITE_SUPABASE_ANON_KEY (frontend env), or copy it from the rsv.pizza JS bundle
ANON=<anon key>

# 1. Listing is closed. Expect [] (HTTP 200 with an empty array) or a 4xx. Before the fix this returned objects.
curl -s -X POST "$SB/storage/v1/object/list/event-images" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"prefix":"payouts","limit":5,"offset":0}'
curl -s -X POST "$SB/storage/v1/object/list/event-images" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"prefix":"","limit":5,"offset":0}'

# 2. A known public image still returns 200, both direct and through the CDN rewrite
curl -s -o /dev/null -w '%{http_code}\n' "$SB/storage/v1/object/public/event-images/sponsor-logos/1770450656457-l4k3ta.png"
curl -s -o /dev/null -w '%{http_code}\n' "https://www.rsv.pizza/cdn/event-images/sponsor-logos/1770450656457-l4k3ta.png"
```

Both URLs in step 2 returned 200 on 2026-10-18, before the fix.

- [ ] Both list calls return `[]` or a 4xx
- [ ] Both image URLs return `200`
- [ ] Policy check: `select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' and qual ilike '%event-images%';` returns **no rows**. `Anyone can upload event images` (INSERT) still shows when searching `with_check ilike '%event-images%'`.
- [ ] rsv.pizza event page: the cover image, co-host avatars, sponsor logos and description images all render
- [ ] Upload a new event cover image (host page). It succeeds and renders.
- [ ] Host payouts flow: upload a pizza photo and a receipt (one JPG plus one PDF). Both upload, the PDF thumbnail appears, and OCR preview works.
- [ ] Payments admin: open a payout review. Receipt thumbnails and the PDF lightbox load. Rotate a receipt and confirm it still works (service role).
- [ ] Budget tab: upload a receipt (`receipts/<partyId>/`) and confirm it renders

## Payout receipts: private bucket move (follow-up, not in this PR)

Closing listing removes the enumeration vector. Receipt URLs still exist as unauthenticated, permanent public links wherever they have been shared (DB rows, emails, AI prompts).

The full fix is a private bucket. It was **not** done in this PR because receipt URLs are public URLs that flow through about 30 files. Changing them in one pass risks breaking the payout admin flow:

- **Frontend:** `lib/supabase.ts` (`uploadPayoutPhoto`, `uploadReceipt`), `lib/api.ts`, `lib/pdfUtils.ts`, `lib/mediaUtils.ts`, `types.ts`, `payouts/ReceiptUpload.tsx`, `payouts/PayoutsTab.tsx`, `payouts/ReceiptsLibrary.tsx`, `payments-admin/PayoutReviewModal.tsx`, `PayoutsByPartyTable.tsx`, `ReceiptEditor.tsx`, `AdminAddAttachment.tsx`, `ExternalPaymentModal.tsx`, `payments-shared/AuthenticityPanel.tsx`, `budget/BudgetItemForm.tsx`, `BudgetItemRow.tsx`, `BudgetTab.tsx`
- **Backend:** `routes/payout.routes.ts` (`assertSupabasePayoutUrl`, which expects `/object/public/event-images/payouts/<partyId>/`), `routes/admin-payout.routes.ts` (rotate, admin URL check), `routes/telegram-inbound.routes.ts`, `routes/imageAuthenticity.routes.ts` + `lib/imageAuthenticity.ts`, `services/ocr.service.ts` (fetches the URL), `services/pdfRasterize.ts`, `services/payout-receipts.ts`, `services/refundTag.ts`, `routes/budget.routes.ts`, `routes/shipping.routes.ts`, `routes/photo.routes.ts`, `routes/payout-document-vote.routes.ts`
- **DB columns:** `payout_documents.url` (kind `receipt`), `payouts.external_proof_url`, plus the budget receipt URL column(s)

Design (mirrors `backend/src/services/taxFormStorage.service.ts`):

1. Create a bucket `payout-receipts` with `public: false` and the same MIME allowlist plus `application/pdf`, 25MB. Add **no** storage.objects policies for it, so only service_role can access it.
2. **Uploads go through the backend.** Add `POST /api/payouts/:partyId/receipt-upload-url`, which requires the host (or a payment admin) and returns `createSignedUploadUrl(path)` for `payouts/<partyId>/<tmpId>/receipt/<ts>-<rand>.<ext>` (and the `.thumb.png` sibling). `uploadPayoutPhoto` (kind `receipt`) and `uploadReceipt` call `uploadToSignedUrl`. Pizza and event photos stay in public `event-images`, because the photo feed shows them.
3. **Store the object path, not a URL**, with a `storage://payout-receipts/<path>` scheme so old public URLs and new paths can coexist in the same column.
4. **Read through signed URLs.** Add `getSignedReceiptUrl(value)`, which accepts a public URL (legacy) or a `storage://` path and returns a 10-minute `createSignedUrl`. Payout and budget API responses map receipt URLs through it, only for the payout's host/co-hosts and payment admins. Everyone else gets no URL.
5. **Backend consumers** (OCR, pdfRasterize, ELA, rotate, refundTag) download with the service-role client instead of `fetch(publicUrl)`. `assertSupabasePayoutUrl` accepts the `storage://payout-receipts/payouts/<partyId>/` form.
6. **Backfill script** (written in the follow-up PR, run only after steps 1–5 are deployed):
   - list `event-images` `payouts/**/receipt/**` and `receipts/**` with service_role
   - copy each object to `payout-receipts` at the same path, then verify size and hash
   - in one transaction per batch, rewrite `payout_documents.url` / `payouts.external_proof_url` / budget receipt URLs from `.../object/public/event-images/<path>` to `storage://payout-receipts/<path>`
   - only after a verification pass (every rewritten row resolves to an existing private object), delete the public copies
   - dry-run by default; `--apply` and `--delete-public` are separate flags
7. Purge the `/cdn/` edge cache for deleted paths (`s-maxage=86400`). Otherwise deleted receipts keep being served from the Vercel cache for up to 1 day.

## Related findings (not fixed here; flagged for the owner)

- `event-photos`, `event-videos` and `profile-pictures` have the same listable SELECT-to-anon policy pattern. These are lower sensitivity (user-facing photos), but deleted or hidden photos can be enumerated. `uploadProfilePicture` uses `upsert: true`, which needs SELECT, so changing `profile-pictures` needs an app change first. Possible follow-up.
