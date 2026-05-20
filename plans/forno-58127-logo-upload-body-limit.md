# forno-58127: /api/admin/logo-bg-audit/apply-upload returns 500 on real-sized images

## Symptom
`POST https://api.rsv.pizza/api/admin/logo-bg-audit/apply-upload` returns
`500 Internal Server Error` with a 69-byte body. The /admin/logo-cleanup
"Upload replacement" action fails for any non-trivial image.

## Root cause
The 69-byte response is exactly
`{"error":{"message":"Internal server error","code":"INTERNAL_ERROR"}}` —
the generic fallback in `backend/src/middleware/error.ts:53`. So the route
is throwing something that is not an `AppError`.

The thrown thing is `PayloadTooLargeError` from body-parser. The chain:

- Frontend reads the file as base64 (`frontend/src/lib/api.ts` →
  `applyLogoBgFixUpload` → `readAsDataURL`) and POSTs JSON containing
  `fileBase64`. A ~80 KB image → ~107 KB payload.
- `backend/src/index.ts:105` calls `app.use(express.json())` globally with
  no `limit` option, so the default **100 KB** cap applies.
- The router tries to compensate: `backend/src/routes/logoAudit.routes.ts:17`
  has `router.use(express.json({ limit: '8mb' }))`. But middleware runs in
  registration order. The global parser fires first, throws on >100 KB,
  and the request never reaches the router-level parser. The router-level
  parser is **dead code**.
- `PayloadTooLargeError` is not an `AppError`, so `errorHandler` falls
  through to its generic 500 branch — masking the real reason and
  showing the operator a useless "Internal server error".

The sibling `POST /apply` endpoint isn't affected because its payload is
just `{ logoUrl }` (well under 100 KB).

## Fix
Mount the 8 MB JSON parser path-scoped **before** the global one in
`backend/src/index.ts`, mirroring the existing Resend-webhook pattern at
`index.ts:100-103`. Then remove the dead `router.use(express.json(...))`
line from the route file so the next reader isn't misled.

### Change 1 — `backend/src/index.ts`

Add immediately above the existing global JSON parser (currently line 105):

```ts
// Logo-cleanup upload accepts base64-encoded images up to ~5 MB raw
// (~6.7 MB base64). Must be registered BEFORE the global express.json()
// or the global 100 KB default fires first and the route's router-level
// parser becomes dead code.
app.use('/api/admin/logo-bg-audit', express.json({ limit: '8mb' }));

app.use(express.json());
```

### Change 2 — `backend/src/routes/logoAudit.routes.ts`

Delete lines 14-17:

```ts
// The global JSON body parser in index.ts uses the default 100kb limit, which
// is too small for the base64-encoded replacement upload. Bump just this
// router to 8mb (raw file capped at 5mb below; base64 inflates ~33%).
router.use(express.json({ limit: '8mb' }));
```

Also drop the `import express from 'express';` line at the top of that
file if it becomes unused after the deletion. (Keep it if any other code
in the file still references `express`.)

## Out of scope
- Switching to `multipart/form-data` upload (cleaner, but bigger change).
- Improving `errorHandler` to surface `PayloadTooLargeError` as 413
  (worth doing separately — would have made this bug obvious from
  DevTools instead of requiring source-spelunking).

## Verification
1. Build the backend locally: `cd backend && npx tsc --noEmit`.
2. Deploy preview is N/A — backend only deploys from master. After merge,
   run `cd backend && vercel --prod --scope pizza-dao` from the
   `rsvpizza-master-deploy` worktree (see
   `feedback_backend_deploy_from_master_only.md`).
3. After deploy: open `/admin/logo-cleanup` in prod, "Upload replacement"
   on a 200 KB+ PNG, confirm `apply-upload` returns 200 with `newUrl`,
   `sponsorsUpdated`, `sponsorUserUpdated`.

## Files touched
- `backend/src/index.ts` — add path-scoped 8 MB JSON parser
- `backend/src/routes/logoAudit.routes.ts` — remove dead router-level parser
