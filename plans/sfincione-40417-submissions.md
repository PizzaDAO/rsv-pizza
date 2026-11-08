# sfincione-40417 (submissions): public receipt submissions to the Pizza Price Index

## Goal

Let anyone send a pizza receipt to rsv.pizza/pizza-index. An admin reviews it, and once approved
its pizza lines count in the public index next to GPP payout receipts and the 2021-25 archive.
Receipt files stay admin-only. Existing payout/archive syncs must not change.

## Decisions (Snax, 2026-11-07); these override the recommendations below

- **Anonymous submissions allowed (no login).** v1 anti-abuse without a captcha:
  - optional email field (IconInput, placeholder "Email (optional) — we'll tell you when it's reviewed");
  - a hidden honeypot field (reject silently when filled);
  - IP limits of 3 per hour and 10 per day, plus a cap of 300 pending in total (503 "try later" when full);
  - OCR only when an admin opens the submission, so spam costs nothing until reviewed;
  - logged-in users may still submit, and record `submitted_by_user_id` when present.
  - Turnstile is deferred until spam actually shows up.
- **Same figure, tagged.** Community receipts join each country's median. They're marked `community` in the drill-down, with an `app_config` switch to pull them out.
- **A country can publish from community receipts alone,** once approved.
- **Receipt dates from 2021-01-01 to today.**
- Other open questions use the plan's recommendations: underbosses don't review; rejected files are deleted after 30 days in v2.

## Recommendations (decide before implementing)

1. **Login required (magic link via `LoginModal`).** Reasons:
   - Per-IP limits are easy to get around (mobile CGNAT, VPNs). Per-account limits plus a ban
     list are not.
   - Receipts carry names, phone numbers and card digits. A verified email gives us a contact and
     some accountability.
   - The repo has no captcha (no Turnstile/hCaptcha anywhere).
   - Volume will be low, so the friction is cheap. One country can publish from a single event
     (`MIN_PARTIES.country = 1`), so a single fake receipt could put a country on the map. Admin
     review stops that, but every pending item costs a reviewer time and, if we run OCR, money.
   - Fallback if Snax wants anonymous: add Cloudflare Turnstile, tighter IP limits, a required
     email, and OCR only on admin open.
   - Because login gives us the account email, the "optional email" field becomes a
     `Checkbox` reading "Email me when it's reviewed".
2. **New table `pizza_submissions`.** Do not reuse `pizza_history_receipts`, because:
   - its `year` CHECK is 2019-2025;
   - `source_file_id` is NOT NULL UNIQUE (a Drive id);
   - its generated `event_key` (`hist:{year}:{city}|{country}`) would merge a submission into
     archive city-year events;
   - the queue treats every history row as "archive".

   A third origin (`'submission'`) keeps the three sources separable everywhere.
3. **An "event" is one pizzeria in one city in one year:**
   `sub:{year}:{merchant_key or submission id}|{city}|{country}`. Ten receipts from the same
   pizzeria count as one event, so one person can't inflate `nParties`. Different pizzerias do
   add events.
4. **OCR only when an admin asks** ("Read receipt" button, or automatically when the review card
   opens). Spam costs nothing until a human looks at it.

## Data model: migration `backend/prisma/migrations/sfincione-40417-8-submissions.sql`

Follow the -6/-7 style: `SET lock_timeout`, idempotent, backward compatible.

```
pizza_submissions
  id uuid pk default gen_random_uuid()
  status text not null default 'pending' CHECK (status IN ('pending','approved','rejected'))
  submitter_user_id text REFERENCES "User"(id) ON DELETE SET NULL   -- Prisma User has no @@map: table "User", id is a cuid (text)
  submitter_email text not null, notify boolean not null default false
  storage_path text not null unique          -- object path in the private bucket, never a URL
  ocr_image_path text                        -- PNG rendered from page 1 of a PDF (pdfRasterize)
  mime_type text not null, file_size int not null CHECK (file_size <= 10485760)
  file_sha256 text not null                  -- unique index: an exact re-upload is rejected
  receipt_date date not null, year int not null CHECK (year BETWEEN 2019 AND 2100)
  country text not null, country_code char(2), city text, region text (countryNameToRegion)
  merchant text not null, merchant_key text  -- normalizeMerchantKey; admin can edit
  size_note text CHECK (length(size_note) <= 200)
  kind text CHECK (kind IN ('itemized','lump_sum','not_pizza'))   -- set on approve
  currency char(3), total numeric(14,4), pizza_count numeric(8,2)
  fx_rate numeric(18,8), fx_source text, fx_date date
  ocr_raw jsonb, ocr_at timestamptz
  duplicate_of uuid REFERENCES pizza_submissions(id), duplicate_reason text
  reviewed_by text, reviewed_at timestamptz, reject_reason text
  ip_hash text                               -- sha256(ip + secret), for abuse review only
  event_key text GENERATED ALWAYS AS ('sub:' || year || ':' || coalesce(merchant_key, id::text)
            || '|' || lower(trim(coalesce(city,''))) || '|' || country) STORED
  created_at timestamptz default now(), updated_at timestamptz
indexes: (status, created_at), (submitter_user_id, created_at), unique(file_sha256),
         (merchant_key, receipt_date)
ENABLE ROW LEVEL SECURITY; no policies; REVOKE ALL ON pizza_submissions FROM anon, authenticated;
```

Changes to `pizza_line_items`:
- `ADD COLUMN submission_id uuid REFERENCES pizza_submissions(id) ON DELETE CASCADE`.
- Partial unique index `(submission_id, line_index) WHERE submission_id IS NOT NULL`.
- Drop and re-add `pizza_line_items_origin_chk` as three exclusive branches, `NOT VALID` and
  then `VALIDATE`:
  - document + party;
  - history only;
  - submission only.

View `pizza_price_index_lines`:
- `CREATE OR REPLACE` the -7 definition word for word, plus a third `UNION ALL` branch:
  `JOIN pizza_submissions s ON s.id = li.submission_id WHERE s.status = 'approved' AND s.kind <> 'not_pizza'`.
- The usual line filters (`excluded = false`, `area > 0`, `usd > 0`) still apply.
- Column names, types and order stay the same.
- `party_name` = `s.merchant`.
- `event_year` = `s.year`.
- **`document_url` = NULL and `document_mime_type` = NULL.** The storage path never goes into the
  view.
- `event_key` = `s.event_key`, `origin` = `'submission'`, `fx_source` = `s.fx_source`,
  `receipt_date` = `s.receipt_date`, `is_lump_sum` = `(s.kind = 'lump_sum')`.
- Keep `REVOKE ALL ... FROM anon, authenticated`.

Why this is safe before the merge: no `approved` submission rows exist until the new code
approves one. So old code sees no new rows, and old `mapViewRow` turning unknown origins into
`'event'` is harmless.

Prisma (`backend/prisma/schema.prisma`):
- new `PizzaSubmission` model;
- `PizzaLineItem.submissionId` plus its relation;
- `eventKey` is generated, so it is never written. Same pattern as `PizzaHistoryReceipt`.

**Storage:**
- Snax creates a **private** bucket `pizza-index-submissions` in the Supabase dashboard. Buckets
  must be created in the dashboard, not in code; do not copy `taxFormStorage`'s `ensureBucket`.
  Settings: 10 MB cap, mime allowlist `image/jpeg, image/png, image/webp, image/heic,
  application/pdf`.
- Object paths: `{userId}/{uuid}.{ext}`, and `{...}.thumb.png` for rendered PDFs.
- Admins only ever see short-lived signed URLs, minted per request (`createSignedUrl`, 30 min,
  the same idea as `taxFormStorage.service.ts`). No public URL is ever stored or returned.

## Backend

New service `backend/src/services/pizzaSubmission.service.ts`, using the Supabase service-role
client:
- `createUploadUrl(userId, mime, size)`: checks type and size, returns `createSignedUploadUrl(path)`.
- `finalizeSubmission(user, body, ipHash)`:
  - checks the object exists under `{userId}/`;
  - downloads it, sniffs magic bytes (reject a mismatch), re-checks the size;
  - computes sha256; a hit on an existing hash returns 409 "already submitted";
  - validates fields:
    - `receipt_date` between 2019-01-01 and today;
    - country is non-empty and canonicalised (`canonicalizeCountryName`);
    - merchant is 1-120 chars;
    - `size_note` is at most 200 chars, run through `sanitizePgString`;
  - inserts a `pending` row;
  - soft duplicate check: same `merchant_key` + `receipt_date` within ±1 day, or the same user and
    the same merchant on the same day, sets `duplicate_of`. It flags, never blocks.
- `extractSubmission(id)`:
  - PDF: `pdfRasterize` page 1, upload `.thumb.png`;
  - OCR: `analyzeReceiptMulti({ imageUrl: signedUrl, partyCountry: country })`. A signed URL
    works because `imageUrlToBase64DataUrl` just fetches the URL;
  - store `ocr_raw` and `ocr_at`; prefill currency, total, pizza lines (category `pizza`),
    `pizzaCount` and `pizzaSize`.
- `approveSubmission(id, actor, draft)`. The draft is the admin-edited kind, currency, total,
  pizzaCount, lines `{name, qty, unitPrice, sizeLabel?}`, merchant, city, country and date.
  - FX: `convertToUSD` (`fx.service.ts`) gives today's rate. For receipts more than 30 days old,
    use frankfurter by date, by moving `getReceiptFx`'s network path out of
    `backend/scripts/lib/historicalFx.ts` into `src/services` so it can run at runtime.
  - Lines: move the pure `buildHistoryLines` from `backend/scripts/lib/historyImport.ts` into
    `backend/src/services/pizzaManualLines.ts`; the script re-imports it. The record shape
    (`kind`, `lines`, `total`, `pizzaCount`) already matches submissions.
  - Write the lines with `submissionId`, document/party NULL, **`updated_by = actor.email`** (see
    Risks). Use the size note as a label hint. Set status `approved`, `reviewed_by` and
    `reviewed_at`.
  - Then `invalidatePizzaIndexCache()` and `refreshOutliers(0)`.
- `rejectSubmission(id, actor, reason)`: deletes any lines and sets `rejected`. The file is kept
  for 90 days for abuse review (open question).

Routes, in `backend/src/routes/pizza-index.routes.ts` or a new
`pizza-index-submissions.routes.ts`:
- Public, `requireAuth`, mounted at `/api/pizza-index/submissions` in `backend/src/index.ts`
  **before** `publicPizzaIndexRouter`:
  - `POST /upload-url` `{mimeType, fileSize}` returns `{path, token}`;
  - `POST /` `{path, receiptDate, merchant, city, country, countryCode, sizeNote?, notify}`
    returns `{id, status:'pending'}`;
  - `GET /mine`, the submitter's own list (status only, no figures). Phase 2.
- Admin, `fullChain` (submissions have no party, so they follow the same "full admins only" rule
  as archive lines), under `/api/admin/pizza-index`:
  - `GET /submissions?status=&limit=&offset=` (rows plus signed URLs, `Cache-Control: private, no-store`);
  - `GET /submissions/:id`;
  - `POST /submissions/:id/extract`;
  - `POST /submissions/:id/approve`;
  - `POST /submissions/:id/reject`;
  - `GET /submissions/counts` (for the tab badge).

Abuse limits:
- `express-rate-limit` on `/api/pizza-index/submissions`: 10/hour per IP (`trust proxy` is
  already 1).
- DB checks in `finalizeSubmission`:
  - at most 5 pending and 20 per day per user;
  - a global ceiling of 300 pending (return 503 "queue full", so a flood can't bury the queue);
  - a `pizza_index.submissions_enabled` kill switch in `app_config`, read by both public routes.
- Files: 10 MB, the mime allowlist, magic-byte sniff, one file per submission. JSON bodies stay
  under the 100 KB default because file bytes never pass through Express (Vercel's 4.5 MB body
  limit is the reason for using signed upload URLs).

Existing code that must learn about the third origin:
- `pizzaIndex.service.ts`:
  - `IndexRow.origin` becomes `'event'|'history'|'submission'`, and `mapViewRow` maps it;
  - in `fetchIndexRows`, `receipt_key` becomes
    `coalesce(document_id::text, 'h:'||history_receipt_id, 's:'||submission_id)`;
  - the underboss guard `v.origin = 'event'` already excludes submissions.
- `getPublicCountryEvents`: add `community: boolean` to `PublicEvent` (additive). Name the event
  after the merchant. No photos.
- `PublicCountryEntry`: add `nCommunityParties` (additive).
- `getPublicCountryReceipts` keeps skipping rows with a null `documentUrl`. Showing admins
  submission receipts there is phase 2, via signed URLs.
- `loadPublic`: drop `origin='submission'` rows when the `app_config` flag
  `pizza_index.submissions_public` is off. This lets us include or exclude them without a deploy.
- In the routes' `GET /queue`:
  - `eligible` gets `OR (s.id IS NOT NULL AND s.status='approved' AND s.kind <> 'not_pizza')`,
    with a `LEFT JOIN pizza_submissions s`;
  - **`origin='event'` must become `li.document_id IS NOT NULL`.** Today it is
    `history_receipt_id IS NULL`, which would pull submission lines in;
  - add `origin='submission'`;
  - `histGuard` becomes `li.document_id IS NOT NULL` for non-full actors;
  - the progress conditions and the `groupKey` coalesce also need `submission_id`.
- `reresolveUnverified`: the `include` adds `submission: {select:{country}}`, and the country
  becomes `party ?? historyReceipt ?? submission`. Without this, submission lines lose
  country-level presets.
- `apply-to-merchant`: the sibling update for history lines (`history_receipt_id IS NOT NULL`)
  gets a matching submission branch, full admins only.
- `loadLineInScope`: no change, because a line with no party is already full-admin only.

## Frontend

- `frontend/src/pages/PizzaIndexPage.tsx`:
  - a "Submit a receipt" button in the header (and in the empty state);
  - logged out (`useAuth`), it opens `LoginModal` first, then the form;
  - the subtitle copy gains ", plus receipts sent in by pizza fans";
  - event rows with `community` get a small "Community" pill;
  - the country row shows "incl. N community" when `nCommunityParties > 0`.
- New `frontend/src/components/SubmitPizzaReceiptModal.tsx`. It follows the `LoginModal` pattern:
  fixed backdrop, `z-50`, click outside to close, card, close button. Placeholders only, no
  `<label>`s. Fields:
  - file picker, a hidden file input behind a button showing an image preview or the PDF name.
    This is the only allowed raw input, the same as other upload buttons; check how existing
    upload buttons are built before adding one;
  - `LocationAutocomplete` with `types={['(cities)']}`; `onCitySelected` fills city, country and
    countryCode, and country is required;
  - `IconInput` "Pizzeria name";
  - `IconInput type="date"` "Receipt date";
  - `IconInput multiline` "Pizza size, e.g. 12 inch / 30 cm (optional)";
  - `Checkbox` "Email me when it's reviewed";
  - helper text (`text-xs text-white/40`): "Receipts are only seen by our reviewers. Cover card
    numbers if you like."

  Submit flow: `upload-url`, then `supabase.storage.from('pizza-index-submissions').uploadToSignedUrl`,
  then `POST`. A success state says "Thanks, we'll review it", and the modal shows the 409 and 429
  messages.
- `frontend/src/lib/api.ts`: add `requestPizzaSubmissionUpload`, `createPizzaSubmission`,
  `fetchPizzaSubmissions`, `extractPizzaSubmission`, `approvePizzaSubmission`,
  `rejectPizzaSubmission`; add `'submission'` to the `origin` unions.
- Admin: a new SubView `'submissions'` in `frontend/src/components/underboss/PizzaIndexTab.tsx`
  (full admin only, like Ops, with a pending-count badge), plus
  `frontend/src/components/underboss/PizzaSubmissionsView.tsx`:
  - a pending list with the receipt (`ReceiptLightbox`, signed URL), submitter email, date and
    location, size note, and duplicate warnings that link to `duplicate_of`;
  - "Read receipt" (OCR) prefills an editable line table (`IconInput` cells);
  - a kind toggle (itemized or lump sum plus pizza count);
  - Approve and Reject (with a reason).

  After approval, lines are sized in the normal Review queue under Source = "Submissions".

## Risks

- **`markDuplicateLines`:**
  - Its un-mark statement touches *every* line with `excluded_reason='duplicate_line'`,
    `verified_at IS NULL` and `updated_by IS NULL`, whatever its origin. So:
    - submission lines are written with `updated_by` set;
    - they never use the `duplicate_line` reason (duplicates are handled at submission level:
      reject with "duplicate", or `excluded_reason='other'` with notes).
  - Optional hardening: add `AND li.document_id IS NOT NULL` to the un-mark statement.
  - `syncPizzaLineItems` and `removeOrphans` only reach lines through `payout_documents`, so
    they are untouched.
- The queue's `origin='event'` filter (`history_receipt_id IS NULL`) would quietly include
  submission lines. It must change in the same PR, and it gets a test.
- Leaks:
  - storage paths and signed URLs must never reach `/api/pizza-index*`;
  - submitter email must never reach any public DTO;
  - test the public JSON for `supabase`, `@` and `storage_path`.
- Lines with no resolved size never reach the view (`area > 0`). Approval should warn when no
  line has a size. The size note helps here. The LLM, vision and photo passes join
  `payout_documents`, so they skip submissions; adding submissions to them is phase 3.
- `MIN_PARTIES.country = 1`: one approved submission can publish a new country. This needs a
  decision (Q2).
- Migration: `DATABASE_URL` is the 6543 transaction pooler, and session `SET`s leak (memory note).
  Apply with Supabase MCP `apply_migration` (`mcp__supabase-pizzadao__`, project
  `znpiwdvvsqaxuskpfleo`), or wrap the file in `BEGIN; SET LOCAL lock_timeout ...; COMMIT;`.
- PII: receipts can show card digits. The bucket is private, signed URLs last 30 min, and
  rejected files get a retention purge (phase 2 cron).

## Rollout order

1. Snax creates the private bucket `pizza-index-submissions` in the dashboard.
2. Apply `sfincione-40417-8-submissions.sql` to prod, after a dry read of its effect. Confirm:
   - RLS is on;
   - `has_table_privilege('anon','pizza_submissions','select')` is false;
   - the view row count is unchanged.
3. Run `npm --prefix backend run check:schema-drift`. Then merge the Prisma, backend and frontend
   PR. Only after that, set `app_config` `pizza_index.submissions_enabled = true`.

## Phasing

- **v1 (one PR):**
  - migration and bucket;
  - the public modal (login required);
  - upload-url, submit and the limits;
  - the admin Submissions view with OCR, editable lines, approve and reject;
  - the third view branch and its origin plumbing;
  - the community pill and count;
  - kill switches.
- **v2:**
  - `GET /mine` and a "My submissions" list;
  - review emails (`notify`) from a backend mailer, not Gmail;
  - signed-URL receipts for submissions in the admin `public-receipts` drill-down;
  - the retention purge;
  - stronger duplicate checks against `payout_documents` (merchant + date + `ocr_amount`).
- **v3:**
  - run the LLM, vision and photo size passes on submissions;
  - an optional public pizza photo per submission (needs its own moderation and public bucket);
  - anonymous submissions with Turnstile, if Snax wants them.

## Verify

- Unit tests (vitest, next to the existing `*.test.ts` files):
  - `pizzaManualLines` (moved builder, script output unchanged);
  - `mapViewRow` origin;
  - `selectPublicRows` / `getPublicCountryEvents` with submission rows (eventKey grouping, the
    `community` flag, no URL fields);
  - queue `origin` filters (`event` excludes submissions);
  - `markDuplicateLines` leaves submission lines alone;
  - `finalizeSubmission` checks (mime sniff, size, date range, sha conflict, per-user and global
    caps);
  - public route tests in `pizza-index.routes.test.ts`, including a leak assertion.
- `npm --prefix backend run build`, `npm --prefix frontend run build`, the hooks lint gate, and
  `import-pizza-history.ts --no-db` dry run (unchanged report).
- Vercel preview (`https://rsvpizza-git-sfincione-40417-subs-pizza-dao.vercel.app/pizza-index`).
  The preview uses the prod backend, so this happens after merge or with the backend deployed:
  - logged out, the button opens the login modal;
  - logged in, submit a JPEG and a PDF; check the 10 MB rejection and the 409 for a re-upload;
  - in the Underboss dashboard, Pizza Index, Submissions: the signed image loads, OCR prefills,
    approve works;
  - the line appears in Review with Source = Submissions; size it;
  - the country shows a Community pill after the cache clears;
  - reject deletes the lines;
  - `/mobile-check` on the modal.
- SQL checks:
  - view counts by origin before and after;
  - `SELECT count(*) FROM pizza_line_items WHERE submission_id IS NOT NULL AND updated_by IS NULL`
    returns 0.

## Open questions for Snax

1. Login required (recommended), or anonymous with captcha and a required email?
2. Can a country be published from community receipts alone, or does it need at least one GPP or
   archive event? A middle option: publish, but marked "community only".
3. Should community receipts sit in the same figure as GPP receipts (recommended: yes, flagged,
   with a kill switch), or get their own toggle or tab?
4. Which receipt dates are allowed? Any date back to 2019 (older ones feed the archive years), or
   only the last 12 months?
5. OCR at submit time (instant prefill, costs money on spam) or on admin open (recommended)?
6. How long to keep rejected files: 90 days, or delete straight away?
7. Should underbosses review submissions in their region? Recommended: admins only in v1, since
   submissions have no party scope.
