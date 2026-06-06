# marinara-61455: Image-authenticity check (AI-generated / doctored detection)

## Goal
Give admins a manual, on-demand "Verify authenticity" tool that judges whether a
**payment-receipt image** or a **host-uploaded event image** is AI-generated or
doctored. Returns a verdict + confidence + specific reasons, cached so re-opening
doesn't re-pay for the API call. Human-in-the-loop — the verdict flags for review,
it never auto-rejects.

## Decisions (locked with Snax)
1. **Vision provider:** reuse the existing OpenAI gpt-4o vision path (same code the
   OCR service already uses) — no new dependency or secret. Wrapped behind a small
   provider interface so a Claude / 3rd-party second opinion can be added later.
2. **Storage:** a **separate `image_authenticity_checks` table** keyed by image URL —
   do NOT widen `payout_documents` or `Party`.
3. **Scope:** full — Phase 1 (metadata + vision + receipt-math) **and** Phase 2
   (ELA overlay + Claude/3rd-party second opinion) in this task.

## Detection method (layered, cheapest-first)
No single technique is reliable, so the verdict composes several signals, mirroring
the weighted-heuristic shape of `backend/src/lib/fakeDetection.ts`.

### Pass 1 — Metadata / provenance (deterministic, ~free)
- EXIF: camera make/model, capture time, GPS.
- **Generator/editor software tags** — `DALL-E`, `Midjourney`, `Stable Diffusion`,
  `Adobe Firefly`, `Photoshop`, `GIMP` → strong positive signal.
- **C2PA / Content Credentials** manifest → near-definitive when present.
- ⚠️ Presence is a strong signal; **absence is weak** (screenshots, chat-app
  compression, and our Supabase upload re-encode all strip EXIF). Never condemn on
  missing EXIF alone.

### Pass 2 — LLM vision verdict (primary judgment, OpenAI gpt-4o)
- Reuse `getOpenAI()` + the fetch-URL→base64 helper from
  `backend/src/services/ocr.service.ts`.
- Prompt for concrete tells: garbled/warped text & impossible glyphs (AI is bad at
  the dense text on receipts), inconsistent lighting/shadows, melted edges,
  duplicated patterns; doctoring tells: mismatched fonts/kerning on the amount field,
  baseline misalignment, cloned regions, compression discontinuities.
- Structured JSON out: `verdict` (authentic | suspicious | likely_fake),
  `confidence` 0-100, `observations[]`.

### Pass 3 — Receipt-math sanity (receipts only, ~free)
- We already store `ocrLineItems` + `ocrAmount`. Line items not summing to the total
  is a cheap, hard-to-fake tampering signal.

### Pass 4 — ELA overlay (Phase 2, `sharp`, deterministic)
- Recompress at a known quality, diff, surface as a **downloadable overlay artifact**
  for the admin — NOT an auto-verdict (too noisy to score reliably).

### Pass 5 — Second opinion (Phase 2, behind provider interface)
- Claude vision (`@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`) and/or a dedicated
  detector (Hive / Sightengine) as a tie-breaker on `suspicious` verdicts. Off by
  default; wired but gated behind env presence so Phase 1 ships without it.

## Data model — new table
`image_authenticity_checks`:
- `id` pk
- `image_url` text (the Supabase object URL checked) — unique-ish lookup key
- `source_kind` text — `receipt` | `event_image`
- `party_id` text/fk (nullable) — for filtering/joins
- `payout_document_id` (nullable) — when source is a receipt
- `verdict` text — authentic | suspicious | likely_fake
- `score` int 0-100
- `reasons` jsonb — per-pass signals + observations
- `provider` text — openai | anthropic | sightengine
- `ela_artifact_url` text (nullable) — Phase 2 overlay
- `checked_at` timestamptz
- `checked_by` text (admin email)

⚠️ Per repo memory: **no Prisma auto-migration here** (`_prisma_migrations` doesn't
exist). Apply the table to **prod** via Supabase MCP / `pg`+`DATABASE_URL` BEFORE
merging code, and backend deploys from `master` only — previews talk to prod backend.
Add the model to `schema.prisma` so the client types it, but the live DDL is manual.

## Backend
- `backend/src/lib/imageAuthenticity.ts` — weighted-signal scorer mirroring
  `fakeDetection.ts` (per-pass functions → `{id,name,fired,weight,detail}` → capped
  score → tiered verdict). Provider interface for the vision call.
- `backend/src/lib/providers/` — `openaiVision.ts` (Phase 1), `anthropicVision.ts`
  + `sightengine.ts` (Phase 2, env-gated, optional).
- Endpoint `POST /api/admin/image-authenticity` — admin-gated via existing
  `requireAuth` → `isAdmin(req.userEmail)` pattern (see `admin.routes.ts`). Body:
  `{ imageUrl, sourceKind, partyId?, payoutDocumentId?, force? }`. Returns cached row
  unless `force`. Persists to `image_authenticity_checks`.
- Reuse the proven `fetch(url, {signal: AbortSignal.timeout()})` → base64 helper.

## Frontend
- Receipts: "Verify authenticity" button + verdict panel in `ReceiptEditor`
  (mounted inside `ReceiptLightbox`), matching the existing duplicate/ineligible
  toggle pattern — banner + distinctive stripe overlay (purple) + keyboard shortcut.
  Show cached verdict if present; "Re-check" forces a fresh run.
- Event images: same action on the admin event-image view (`Party.eventImageUrl`).
- New API helpers in `frontend/src/lib/api.ts` mirroring `markReceiptDuplicate`.
- Use existing components (no raw inputs/buttons) per project conventions.

## Risks / caveats
- **False positives** on legit photos (heavy compression, scans, dark restaurant
  lighting). Verdict = "needs human review," never auto-reject. Manual-tool design
  keeps a human in the loop by construction.
- Absence-of-EXIF must not dominate the score (see Pass 1 caveat).
- Per-check API cost is small; caching prevents repeats.
- This is a dual-use signal, not proof — pair with existing fake-detection context.

## Verification
- `npx tsc --noEmit` in frontend — clean.
- `npm run build` in backend — clean.
- `image_authenticity_checks` table applied to prod via Supabase MCP before merge.
- Manual: run a known AI-generated receipt → `likely_fake` with text-artifact reason;
  a real phone photo of a receipt → `authentic`; a Photoshop-tampered total → flagged
  via software tag and/or receipt-math mismatch; verdict caches and re-check forces
  a fresh call.
- ⚠️ The vision call is opaque to tsc — exercise the endpoint against a real image
  before calling it done (per repo "verify by executing, not tsc" guidance).

## Out of scope
- Automated on-upload / cron scanning (this is manual-only by request).
- GPP Drive photos, description-embedded images (event cover only for now).
- Auto-reject / send-gate wiring (verdict is advisory; revisit after accuracy data).
