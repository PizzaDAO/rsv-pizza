# stracciatella-92114 — Multi-Receipt-Per-Photo OCR

## Goal
Upgrade the receipt OCR so a SINGLE uploaded photo containing MULTIPLE receipts (e.g. two pizza receipts side by side) is detected and each receipt is handled independently. Today the pipeline assumes **1 photo → 1 receipt → 1 DB row**.

## Decisions (locked by Snax 2026-06-05)
1. **Persistence: one `payout_documents` row per detected receipt.** N receipts from one photo become N rows sharing the same image `url`. Preserves all existing duplicate/ineligible/analytics/admin-edit invariants. (NOT a JSONB array on one row.)
2. **Split bias: under-split.** When ambiguous, the model MERGES pieces into one receipt; the host manually splits if needed. Primary host override is "remove"; "merge" is secondary. Keeps the common single-receipt case clean.
3. Save plan + dispatch implementation agent (worktree + draft PR).

## Current pipeline (verified against origin/master)
- **Upload** — `ReceiptUpload.tsx` → one `ReceiptItem` per file → `uploadPayoutPhoto()` (HEIC→JPEG via heic2any; PDF→`.thumb.png`) → `previewReceiptOCR()` assigns a single `OcrPreviewResult` to `item.ocr`.
- **OCR preview** — `POST /:partyId/payouts/ocr-preview` → `analyzeReceipt({imageUrl, partyCountry})` (gpt-4o vision, `response_format json_object`, `max_tokens 1500`, returns ONE object) → `convertToUSD()` → single-object response.
- **Submit** — `NewPayoutForm.tsx`: `ocrSum` = sum of `r.ocr.amount`; `receiptPhotos` payload = one entry per file forwarding `ocrOriginalAmount/Currency/Confidence/LineItems/Raw/Error`.
- **Persist** — `POST /:partyId/payouts`: per `receiptPhotos[i]`, trust forwarded OCR or re-`analyzeReceipt`; build ONE `payout_documents` row (`kind:'receipt'`) with `ocrAmount/originalAmount/originalCurrency/exchangeRate/ocrRaw/ocrLineItems/ocrError/sortOrder`.
- **Schema** — `model PayoutDocument` (`@@map("payout_documents")`): one row per file; per-receipt financials live on the row. Downstream consumers that key off the row: `ocrSum`/`survivingOcrSum` recompute, by-city `receiptUsdTotal`, pizza-price analytics, admin per-receipt edit, `isDuplicate`/`ineligible`.

## Detection: array-returning prompt (back-compat)
In `backend/src/services/ocr.service.ts`:
- Add **`analyzeReceiptMulti(arg): Promise<OcrResult[]>`** (one element per detected receipt).
- Refactor `analyzeReceipt` into a thin wrapper returning `result[0]` (throw/`NO_RECEIPT` if empty) — preserves every existing caller's single-object contract.
- New `buildMultiSystemPrompt` (or `multi` flag on `buildSystemPrompt`): return `{ "receipts": Receipt[] }`, each `Receipt` = existing fields (`amount`,`currency`,`confidence`,`merchant`,`receiptDate`,`lineItems`,`items`) + optional nullable `boundingHint` ("left half"/"top").
  - **Under-split instruction:** "A single image MAY contain multiple separate receipts. Return one Receipt per DISTINCT transaction/total. If pieces clearly belong to the SAME transaction (same merchant header, continuous items, one grand total), MERGE them — do not double-count. When unsure whether something is one receipt or two, prefer treating it as ONE. Exactly one receipt → array of one. No legible receipt → `{ "receipts": [] }`."
- Keep the country-prior context block (applies to all receipts).
- Bump `max_tokens` 1500 → ~4000. Cap detected receipts (e.g. 10) and truncate per-receipt line items in the sanitizer to avoid token blowups.
- Refactor existing per-receipt sanitization into `parseSingleReceipt(parsed)`; map over `parsed.receipts`. **Robustness:** if the model returns a bare legacy object instead of `{receipts:[...]}`, wrap as a single-element array.

## Response shape + consumers
### Backend `ocr-preview`
- Use `analyzeReceiptMulti`, then `convertToUSD` per receipt (FX is per-amount).
- Return new `receipts: OcrReceiptPreview[]` + `receiptCount: number` **alongside** existing top-level single-receipt fields populated from `receipts[0]` (zeros when empty) so old/cached frontends keep working.
- Each element: `amount/originalAmount/originalCurrency/exchangeRate/confidence/lineItems/ocrRaw/ocrError/conversionNote` + `index` + optional `boundingHint`/`merchant`.
- 0 receipts → `receiptCount:0`, `ocrError:'NO_RECEIPT_DETECTED'`, top-level amount 0.

### Frontend types (`frontend/src/types.ts`)
- Add `OcrReceiptPreview` (per-receipt fields + `index`, `merchant?`, `boundingHint?`).
- Extend `OcrPreviewResult` with `receipts?: OcrReceiptPreview[]` and `receiptCount?: number` (keep existing fields).

### `ReceiptUpload.tsx` (biggest UI change)
- Change `ReceiptItem.ocr?: OcrPreviewResult` → `receipts?: OcrReceiptPreview[]` (keep ONE `ReceiptItem` per file).
- When `receiptCount > 1`: render the file thumbnail once + a nested list of detected receipts, each with its own amount/USD conversion/confidence + per-receipt `CurrencyOverrideSelect` + a per-receipt **remove** control (primary) and a secondary **merge-into-previous** control (for over-split). Show `boundingHint`/`merchant` to help the host map each to the image. Header badge "2 receipts detected in this photo."
- **Single-receipt case must look identical to today** — only render nested UI when `receiptCount > 1`.
- `CurrencyOverrideSelect` (focaccia-89172) now mutates `item.receipts[k]`, not `item.ocr`.

### `NewPayoutForm.tsx`
- `ocrSum` / `unresolvedReceiptCount`: flatMap across all detected receipts across all files (still exclude `CURRENCY_UNRESOLVED`).
- `receiptPhotos` payload: one entry **per detected receipt**, all sharing `url/fileName/fileSize/mimeType`, each carrying its own OCR fields + new `sourceReceiptIndex` (0..N-1).

### Backend `POST /:partyId/payouts`
- `IncomingDocument`: add `sourceReceiptIndex?: number`.
- Receipt loop: multiple incoming entries may share a `url` — each becomes its own `payout_documents` row. Forwarded-payload fast-path needs no second OCR.
- **Fallback (old client / no forwarded OCR):** when an entry lacks `ocrOriginalAmount`, call `analyzeReceiptMulti(deriveOcrUrl(r))` and **expand into N rows**. This is the only place the backend fans one input into many.
- `sortOrder`: composite (fileIndex*100 + receiptIndex, or a running counter) for stable ordering.
- Set new `sourceReceiptIndex`/`sourceReceiptCount` on each row.

### Admin (`admin-payout.routes.ts`, `ReceiptEditor.tsx`, `PayoutReviewModal.tsx`)
- Rows already render per `payout_documents` row → split rows appear naturally. Add "Receipt k of n — from {fileName}" label from `sourceReceiptIndex/Count`; optionally group siblings under one thumbnail.
- `isDuplicate`/`ineligible`/amount/line-item edits already work per row — now per detected receipt (desired granularity).
- **Admin retry stays single-row** (uses `analyzeReceipt` = `[0]`); do NOT auto-split existing rows on retry. Multi-detection only at original upload/submit. Add `sourceReceiptIndex/Count` to the doc-list response shape so admin UI can label.

## Schema (additive, nullable — no backfill)
On `model PayoutDocument` (`@@map("payout_documents")`):
- `sourceReceiptIndex Int? @map("source_receipt_index")`
- `sourceReceiptCount Int? @map("source_receipt_count")`
- `boundingHint String? @map("bounding_hint")` (optional)

**Migration:** no Prisma auto-apply in this repo. Add to `schema.prisma`, then apply `ALTER TABLE payout_documents ADD COLUMN ...` manually via Supabase MCP (`mcp__supabase-pizzadao__`, project `znpiwdvvsqaxuskpfleo`) using **snake_case table/column names**. No new FK. All nullable → existing rows valid, zero backfill. **Apply DDL to prod BEFORE merging the Prisma schema change** (preview/backend share prod DB).

## Backwards compatibility
- Existing rows have `source_receipt_index = NULL` → render exactly as today (flat, no "k of n").
- `analyzeReceipt` wrapper keeps the old single-object contract for retry/analytics callers.
- `ocr-preview` keeps top-level single-receipt fields → un-deployed/cached old frontend still works.
- New columns nullable → no backfill.

## Edge cases
- **1 receipt (common):** one element; flat UI unchanged; one row, `source_receipt_index = 0`/null.
- **0 receipts:** `receipts:[]`, `NO_RECEIPT_DETECTED`, host sees "No receipt found — remove or re-upload"; don't silently create a zero-amount doc (mirror today's error-row behavior).
- **Overlapping/partial:** under-split prompt + host merge/remove overrides. Host review stays mandatory; never auto-submit.
- **Torn receipt across SEPARATE photos:** out of model scope (one image at a time). Cross-file merge = stretch (open question 4).
- **HEIC:** unchanged — converted JPEG reaches `analyzeReceiptMulti` transparently.
- **PDF:** single `.thumb.png` still feeds OCR; multi-receipt on one thumbnail works. Multi-page PDF only thumbnails page 1 (known limitation).
- **FX per receipt:** one `convertToUSD` per receipt; an unresolved currency on one must not poison siblings (per-row `ocrError`/`CURRENCY_UNRESOLVED`).
- **Token truncation:** cap receipts + truncate line items.

## File-by-file change list
**Backend**
- `backend/src/services/ocr.service.ts` — add `analyzeReceiptMulti`; extract `parseSingleReceipt`; `analyzeReceipt`→wrapper; `buildMultiSystemPrompt`; bump `max_tokens`; cap count; under-split instructions.
- `backend/src/routes/payout.routes.ts` — `ocr-preview` returns `receipts[]`+`receiptCount`+back-compat top-level+`NO_RECEIPT_DETECTED`; `IncomingDocument.sourceReceiptIndex?`; `POST /payouts` fan-out one row per detected receipt; fallback uses `analyzeReceiptMulti`; composite `sortOrder`; set `sourceReceiptIndex/Count`. Confirm PATCH `survivingOcrSum` already sums per-row.
- `backend/src/routes/admin-payout.routes.ts` — retry stays single-row; add `sourceReceiptIndex/Count` to doc-list response.
- `backend/prisma/schema.prisma` — add 3 nullable columns; apply ALTER manually.

**Frontend**
- `frontend/src/types.ts` — `OcrReceiptPreview`; extend `OcrPreviewResult`.
- `frontend/src/components/payouts/ReceiptUpload.tsx` — `ocr`→`receipts[]`; nested per-receipt UI; per-receipt currency/remove/merge; single-receipt path unchanged.
- `frontend/src/components/payouts/NewPayoutForm.tsx` — flatten for sums; one payload entry per receipt + `sourceReceiptIndex`.
- `frontend/src/lib/api.ts` — `CreatePayoutPhotoInput.sourceReceiptIndex?`.
- `frontend/src/components/payments-admin/ReceiptEditor.tsx` / `PayoutReviewModal.tsx` — "Receipt k of n — from {fileName}" labeling; optional sibling grouping.

**No change:** `frontend/src/lib/supabase.ts` (`uploadPayoutPhoto`/HEIC), `pdfUtils.ts` — image/PDF reaching OCR is unchanged.

## Open questions (non-blocking; defaults chosen)
3. Admin retry stays single-row (chosen default). 4. Cross-file merge = stretch (defer). 5. Higher `max_tokens`/multi-prompt adds latency to sync `ocr-preview` — add "detecting receipts…" affordance. 6. Multi-page PDF = known limitation for now. 7. Low-confidence N>1 → default UI to "review" (don't surprise-split the common path).

## Verification
- Single-receipt upload: UI + DB row identical to today.
- Two-receipts-in-one-photo upload: 2 nested receipts, 2 `payout_documents` rows sharing `url`, correct independent amounts/FX, admin shows "Receipt 1/2 & 2/2".
- 0-receipt image: graceful error, no zero-amount doc.
- Old-client submit (no forwarded OCR): backend fan-out path produces N rows.
- HEIC + PDF paths still OCR.
- tsc clean both packages; Vercel preview green.
