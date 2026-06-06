# diavola-58479 — "Post about the party on socials" checklist item + compose modal

## Goal
Add a host-dashboard checklist item **"Post about the party on socials"**, placed
immediately **after** the "Estimated Attendance" item, that opens a **compose modal**.
The modal shows the party's photos (with download) and a pre-filled, editable recap
post the host can copy / post to X.

### Template text
```
{country flag}🍕🥳
We had a blast celebrating Bitcoin Pizza Day in {city}!

Thanks {partner @tags} for supporting the event! See you next year!
```
- `{country flag}` → `countryNameToFlag(party.country)` (`frontend/src/utils/countryFlag.ts`), falls back to 🗺️.
- `🍕🥳` → literal `\u{1F355}\u{1F973}` (matches the guest share-on-X house style).
- `{city}` → `party.city`, fallback to `party.name.replace(/^Global Pizza Party\s*/i,'').trim()`.
- `{partner @tags}` → **same handles as the guest "share on X" post** at the end of RSVP
  (`RSVPPage.tsx:289-299` → `ShareRSVP.tsx`):
  - host profile twitter (if present),
  - each co-host with `twitter && showOnEvent !== false`,
  - prepend `Pizza_DAO`, then normalize (strip `@`/URL) + dedupe via `normalizeHandle`,
  - render each as `@handle` joined by spaces.
  - If no partner handles resolve beyond `@Pizza_DAO`, still render `@Pizza_DAO`.

## Background / key facts
- Checklist items are DB-driven: `checklist_defaults` (template) → seeded per-party into
  `checklist_items` by `POST /:partyId/checklist/seed` (backend/src/routes/checklist.routes.ts).
- **Migrations do NOT auto-run** in this repo — the new `checklist_defaults` row must be
  applied directly to the prod DB (Supabase MCP / pg).
- Two renderers, both must be wired:
  - `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx` — sorts items by **due date**;
    opens modals via **name-based `onClick`** (see Estimated Attendance / Find a Venue).
  - `frontend/src/components/checklist/ChecklistTab.tsx` — orders by `sort_order`; opens modals
    via `handleNavigate(tab)` keyed on a sentinel `linkTab` (see `'attendance'`, `'venue'`).
- To land **right after Estimated Attendance** (sort_order 10, due 2026-06-01) in BOTH renderers,
  the new row needs `sort_order = 11` **and** a `due_date` later than 2026-06-01.

## Changes

### 1. DB — new checklist default
New migration file `supabase/migrations/20260605_checklist_social_post.sql` (for the repo record)
**and** apply the same INSERT to prod:
```sql
INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order) VALUES
  ('Post about the party on socials', '2026-06-08', false, NULL, 'social-post', 11)
ON CONFLICT DO NOTHING;
```
- `is_auto = false` → host can manually check it complete.
- `link_tab = 'social-post'` → sentinel, intercepted by both renderers to open the modal (NOT a real tab/route).
- Existing parties pick it up automatically: next checklist load sees
  `existingDefaults < defaults.length` and re-seeds (deletes+reinserts default rows).
  **Side effect to note:** re-seed resets manual `completed` state on default items for parties
  not yet at full default count — same behavior the Estimated-Attendance addition caused. Acceptable.

### 2. Frontend — new modal `frontend/src/components/checklist/SocialPostModal.tsx`
Props: `{ open, onClose, party }` (full camelCase `Party`).
- On open: fetch photos via `getPartyPhotos(party.id, { limit: ... })` and keep `status === 'approved'`
  images (starred first). Fetch nothing else needed — partner handles + city + flag derive from `party`.
- Build default post text from the template above; store in editable state.
- UI (mirror `SuggestionModal` shell + `PostComposerPage` actions):
  - Backdrop `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm`, click-outside-to-close, `X` close button, `createPortal`.
  - Title "Post about the party on socials".
  - Photo grid: thumbnails of approved photos, each with a Download button
    (use `PostComposerPage`'s `downloadImage(url, filename)` blob-fetch approach for cross-origin Supabase URLs).
    Empty state: small "No photos yet" note.
  - Editable post: `<IconInput multiline rows={7} icon={Megaphone} value=... onChange=... />` + char counter (280, red over).
  - Buttons: **Copy to clipboard** (Copy/Check toggle, 2s reset) and **Post on X**
    (`https://twitter.com/intent/tweet?text=` + `encodeURIComponent`).
- Reuse/export `normalizeHandle` from `ShareRSVP.tsx` so handle formatting stays in sync with the guest post.

### 3. Wire into `GPPDashboardTab.tsx`
- `ICON_MAP`: `'Post about the party on socials': Megaphone` (or `Share2`).
- Add state `socialModalOpen`; in the `checklist` map `onClick`, add
  `item.name === 'Post about the party on socials' ? () => setSocialModalOpen(true) : ...`.
  (name-based onClick takes precedence over `linkTab`, so the `'social-post'` sentinel won't navigate.)
- Render `<SocialPostModal open={socialModalOpen} onClose={...} party={party} />`.

### 4. Wire into `ChecklistTab.tsx`
- Add state `socialModalOpen`; in `handleNavigate`, add
  `if (tab === 'social-post') { setSocialModalOpen(true); return; }` (before the `inviteCode` navigate).
- Render `<SocialPostModal open={socialModalOpen} onClose={...} party={party} />`.

## Out of scope
- No backend route changes (existing seed/toggle endpoints suffice).
- No new storage/bucket changes.

## Verification
- `cd frontend && npx tsc --noEmit` (and backend tsc if touched — it isn't).
- Vercel preview: open a host dashboard + the standalone checklist tab; confirm the new item
  appears right after Estimated Attendance, opens the modal, photos load + download, template
  renders correct flag/city/partner tags, copy + Post-on-X work.
- After merge: apply the `checklist_defaults` INSERT to prod DB so the item shows on existing parties.

## Sequencing
1. Apply the `checklist_defaults` INSERT to **prod DB** (Snax-authorized) — frontend previews talk to prod backend/DB, so the item must exist there to render on previews.
2. Implement frontend in a worktree branch off `origin/master`, draft PR, verify on Vercel preview.
