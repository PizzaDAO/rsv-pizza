# napoli-93184 — Shareable progress card

**Priority:** P2
**Branch:** `napoli-93184-share-card`

## Context

`DashboardKPIs` already has a row reserved for the leaderboard pill that uses `flex items-center justify-between gap-3 flex-wrap`. The right side is currently empty — a perfect anchor for a small "Share" icon button.

**Prior art rejects DOM-snapshot libs.** `frontend/src/components/flyer/FlyerGenerator.tsx` produces a 1080×1080 PNG via **native Canvas 2D API** (`document.createElement('canvas')` → `ctx.fillRect`/`drawImage`/`fillText` → `canvas.toBlob`/`toDataURL`). The comment is explicit: "Uses native Canvas 2D API instead of html2canvas — html2canvas mangles custom fonts." The project font (`Hub 191 Display`, loaded via `@font-face`) is exactly the kind of asset `html-to-image` reliably mishandles.

`getLeaderboardRank` exists in `frontend/src/lib/api.ts` (returns `{ rank, total, topPercent, scope }` with graceful-null on auth failure). `EventReport.stats.totalRsvps` carries the hero number. Brand assets: `/pizzadao-logo.svg` (vector, no CORS, embeddable as base64).

## Approach

**Native Canvas 2D API**, not `html-to-image`:
1. Repo's only prior art explicitly rejected DOM-snapshot libs because of the project font.
2. Card is structurally simple: solid background, 4–6 text labels, one logo. ~120 lines.
3. Zero new dependencies.

The card is generated lazily — only on Share click. A `<canvas>` is created off-DOM at 1200×630, drawn into, then `canvas.toBlob('image/png')` yields the blob. Modal preview reuses the blob via `URL.createObjectURL` shown inside an `<img>` constrained to 600×315.

**Visual design:**
- Solid pizza-red (`#ff393a`) background + 12% white radial-gradient highlight top-left.
- Hub 191 Display for the hero number, system sans for body. Wait on `document.fonts.ready` before drawing.
- Top-left: event name (48px) + `date.toLocaleDateString(navigator.language, { dateStyle: 'long' })` (24px).
- Center: hero `totalRsvps` (240px), label "RSVPs" (32px) beneath.
- Bottom-left: `#{rank} of {total}` (28px) — render only if rank data is present.
- Bottom-right: `pizzadao-logo.svg` 80×80 at `(1040, 470)`, `rsv.pizza/{slug}` (20px) at `(1040, 570)`.

**Decisions answered:**
- **Share button location:** in the existing `flex items-center justify-between` row holding `LeaderboardPill`, on the right. `Share2` icon from lucide-react, 28px target, `aria-label` from i18n.
- **QR code in v1:** skip. URL is already written on the card; share targets are text-paste-friendly.
- **Metric pick:** always `totalRsvps` as the hero. Stable across hosts for comparability.

**Flow:**
1. Host clicks Share → modal opens with spinner.
2. `useProgressCardImage.generate()`: waits for `document.fonts.ready`, calls `getLeaderboardRank`, draws to off-DOM canvas, `canvas.toBlob`, returns blob.
3. Preview `<img>` at 600×315.
4. **Download** — `<a download="rsvpizza-progress-{inviteCode}.png" href={objectURL}>`, programmatic click. Always available.
5. **Copy** — `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. Feature-detect at render; hide on iOS Safari < 16.4 / older Firefox. Toast on success/failure.
6. On modal close, `URL.revokeObjectURL(objectURL)`.

## Files

**New:**
- `frontend/src/components/gpp-dashboard/ShareProgressButton.tsx` — icon button + modal orchestrator.
- `frontend/src/components/gpp-dashboard/ProgressCard.tsx` — exports `drawProgressCard(ctx, opts)`. Pure function, no React.
- `frontend/src/hooks/useProgressCardImage.ts` — `{ generate(): Promise<Blob>, loading, error }`.

**Modified:**
- `frontend/src/components/gpp-dashboard/DashboardKPIs.tsx` — render `<ShareProgressButton party={party} report={report} />` opposite the `LeaderboardPill`.
- `frontend/src/components/gpp-dashboard/index.ts` — export `ShareProgressButton`.
- `frontend/src/i18n/locales/{de,en,es,fr,ja,pt,zh}/host.json` — under `dashboard.share.*`: `buttonLabel`, `modalTitle`, `download`, `copy`, `copySuccess`, `copyFailed`, `generating`, `generateFailed`, `close`. 7 files.

**Not modified:**
- `frontend/package.json` — no new deps.

## Step-by-step

1. Add the `ShareProgressButton` icon to the existing leaderboard row in `DashboardKPIs.tsx`.
2. Build `ProgressCard.tsx`:
   - `drawProgressCard(canvas, { party, report, rank, totalRsvps })`.
   - `canvas.width = 1200; canvas.height = 630`.
   - Fill background, gradient overlay, event name + date, hero number, label, rank line if present, logo, URL.
   - `slug = party.customUrl || party.inviteCode`.
3. Build `useProgressCardImage.ts`:
   - `useCallback`-wrapped `generate(party, report)`: `await document.fonts.ready`, `getLeaderboardRank`, off-DOM canvas, `drawProgressCard`, `canvas.toBlob('image/png')`.
4. Build `ShareProgressButton.tsx`:
   - `Share2` icon button → controlled modal.
   - On open: `generate()`, store blob + objectURL, render `<img>` preview.
   - Download button (hidden `<a>` programmatic click).
   - Copy button (feature-detect; hide if unsupported).
   - On unmount/close: `URL.revokeObjectURL(objectURL)`.
5. Add the 9 i18n keys to all 7 host.json files.

## Risks & gotchas

- **Font loading.** `Hub 191 Display` has `font-display: swap`. Always `await document.fonts.ready` before drawing.
- **CORS-tainted canvas.** Use only same-origin assets (`/pizzadao-logo.svg`). Skip `party.eventImageUrl` in v1 to avoid taint.
- **`navigator.clipboard.write` support.** iOS Safari < 16.4 lacks `ClipboardItem`. Feature-detect at render; never throw. Download is the always-available fallback.
- **`getLeaderboardRank` may be null.** `ProgressCard` skips the rank line gracefully.
- **`@napi-rs/canvas` confusion.** Server-side Node Canvas in deps; rely on browser `HTMLCanvasElement` API; nothing imports `@napi-rs/canvas` in our path.
- **Modal pattern.** Grep `role="dialog"` and existing `*Modal*.tsx` files during implementation. Inline overlay div is fine if no shared component.
- **Sharing on past events.** Card still works (victory-lap share). Handle null `party.date` by hiding the date line.
- **Hero metric assumption.** Always `totalRsvps`. `drawProgressCard` signature allows easy future swap.
