# scamorza-58296: graceful receipt-OCR preview fallback + manual amount entry

## Problem
A host on `/auburn` uploaded a receipt and the row showed "internal server error"
with no way to proceed. Any transient OCR-call failure dead-ended the host.

## Root cause
`POST /:partyId/payouts/ocr-preview` in `backend/src/routes/payout.routes.ts`
awaited `analyzeReceipt` + `convertToUSD` directly inside its `try`, and the only
`catch` did `next(error)` → bare HTTP 500 → the frontend receipt row went to
`status:'error'` ("internal server error") with no recovery path. The submit path
(`POST /:partyId/payouts`) already degrades gracefully via `Promise.allSettled`;
preview did not. The receipts/data/format are NOT the problem (gpt-4o reads them
cleanly with the prod key) — only the lack of graceful handling.

## Changes

### 1. Backend — `backend/src/routes/payout.routes.ts` (ocr-preview handler)
Auth/approval/url asserts unchanged (keep their 400/404 codes). Wrap ONLY the
`analyzeReceipt` + `convertToUSD` block in a try/catch. On failure, do NOT call
`next(error)`; return HTTP 200 with a shape-compatible body carrying
`ocrError: 'OCR_FAILED'` (amount 0, fxSource 'unresolved', empty items/lineItems)
so the frontend can drop into manual entry. Existing success/`unresolved`
response block is untouched.

### 2. Frontend types — `frontend/src/types.ts` (`OcrPreviewResult.ocrError`)
Field already existed; documented the new `'OCR_FAILED'` value.

### 3. Frontend client — `frontend/src/lib/api.ts` (`previewReceiptOCR`)
Verify-only. `apiRequest` only throws on `!response.ok`, so a 200 carrying
`ocrError` resolves normally. No code change.

### 4. Frontend UI — `frontend/src/components/payouts/ReceiptUpload.tsx`
An OCR failure now arrives as a 200 with `ocr.ocrError === 'OCR_FAILED'`, flowing
into the `status:'done'` branch. For such rows, render an editable USD-amount
`IconInput` (manual entry) instead of the green amount + confidence +
CurrencyOverrideSelect. On change, update the item's `ocr` in-place:
`amount`/`originalAmount` = typed number, `originalCurrency:'USD'`,
`exchangeRate:1`, `confidence:1`, `fxSource:'usd-passthrough'`, and clear
`ocrError` once a valid amount is entered so submit treats it as a normal USD
receipt. The genuine `status:'error'` branch (network/auth/non-2xx) stays as-is.

## Deploy ordering
The backend change must be **merged + the backend deployed from master** before
the manual-amount UI works on the preview, because preview frontends call the
**production backend** (preview FE → prod BE). Until the backend deploys, a
transient OCR failure on preview still returns a 500.
