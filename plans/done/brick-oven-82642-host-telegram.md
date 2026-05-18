# brick-oven-82642 — Host Telegram on cohost rows + backfill

## Goal
Show each co-host's Telegram handle as a clickable DM link (`https://t.me/{handle}`) on:
- The /underboss event detail page (rendered via `frontend/src/components/EventDetailsTab.tsx` which embeds `HostsManager`)
- The GPP dashboard "Build a Team" host tab (rendered via `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx` which also embeds `HostsManager`)

Add a Telegram input to the Edit Host modal and the Add Cohost form. Backfill existing GPP events so the primary host's co_hosts entry gets the `telegram` value that was collected at GPP signup.

## Key architectural facts (verified)

1. **Single source for both surfaces**: Both /underboss event detail and the GPP dashboard host tab render `HostsManager.tsx` with `party.coHosts`. One UI change covers both surfaces.

2. **GPP signup telegram is stored on `users.telegram`, not on `parties`.**
   - `backend/src/routes/gpp.routes.ts:243` (POST /api/gpp/events) accepts `telegram`, normalizes it (strips leading `@`), and writes to `users.telegram` (creates or updates the user row).
   - The co_hosts jsonb array entry it creates for the host (`co_hosts.routes.ts:411-416`) only has `id, name, email, showOnEvent, canEdit` — no `telegram`. That is the gap the backfill closes.
   - `users.telegram` column exists per migration `supabase/migrations/20260309_add_user_telegram.sql`.

3. **`co_hosts` jsonb passes unknown keys through end-to-end (no schema migration or grants needed).**
   - `frontend/src/lib/sanitizeCoHosts.ts` only strips `email`; spreads everything else.
   - `frontend/src/lib/supabase.ts:1763` — `updateParty` whitelists `co_hosts` and forwards it via `coHosts: updates.co_hosts` to `updatePartyApi`.
   - `frontend/src/lib/api.ts:247` — `updatePartyApi` whitelists `coHosts: data.coHosts` and PATCHes it through.
   - `backend/src/routes/party.routes.ts:411,463-505,533` — PATCH /api/parties/:id destructures `coHosts`, runs the protected-entry merge, and writes the array verbatim. Non-protected entries pass through `{ ...rest }` so a new `telegram` key on a regular cohost survives unchanged.
   - The GET enrichment at `backend/src/routes/party.routes.ts:360-372` only augments `avatar_url`, `twitter`, `website`, `instagram` from the user profile — `telegram` is NOT pulled across. That is fine for this task (we read `telegram` directly off the co_hosts entry). Note for future scope: if we ever want to auto-fill a cohost's telegram from their user profile, that's where to add it. **Not in this task.**

4. **No DB migration, no new column, no grants.** Per CLAUDE.md the 7-place change is required for new `parties` columns; this task only adds a key inside the existing jsonb, so none of those apply.

## File-by-file changes

### 1. Type — `frontend/src/types.ts:102`
Add `telegram?: string;` to the `CoHost` interface (e.g. after `instagram?: string;` on line 108). No other type changes needed — `coHosts: any[]` in the API/Supabase whitelists already allows unknown keys.

### 2. HostsManager — `frontend/src/components/HostsManager.tsx`

**(a) Row icon cluster — lines 387-405**: After the Instagram `<a>` block (line 404), add a Telegram link that mirrors the existing convention from `frontend/src/components/underboss/EventRow.tsx:550-560`:
- Import `Send` from `lucide-react` (line 3 — append `, Send`).
- Insert:
  ```tsx
  {coHost.telegram && (
    <a
      href={`https://t.me/${coHost.telegram.replace(/^@/, '')}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-white/50 hover:text-white"
      onClick={(e) => e.stopPropagation()}
      title="DM on Telegram"
    >
      <Send size={14} />
    </a>
  )}
  ```
  **Justification for `Send` over an inline Telegram SVG:** `Send` is already the established host-DM icon in `EventRow.tsx` and `CitiesTable.tsx`; using it here keeps visual language consistent. The inline SVG used for Twitter is a special case because Twitter/X has no lucide icon; lucide has no "Telegram" icon, but `Send` (paper-plane) is the de-facto convention in this codebase. Match `text-white/50 hover:text-white` to match the existing Globe/Twitter/Instagram neighbors (not the purple-400 from EventRow — that page uses a different palette).

**(b) Add Cohost state & form — lines 35-42, 173-205**:
- Add `const [newCoHostTelegram, setNewCoHostTelegram] = useState('');` near line 39.
- In `addCoHost` (line 173), add `telegram: newCoHostTelegram.trim() ? stripToHandle(newCoHostTelegram.trim()) : undefined,` to the `newCoHost` object literal (after `instagram` on line 179). `stripToHandle` is already imported (line 8).
- In the reset block (lines 189-198), add `setNewCoHostTelegram('');`.

**(c) Add Cohost modal Telegram input — lines 705-730**: The current 2-col grid is Twitter+Instagram. Change to a 3-col grid (`grid-cols-3`) with Twitter, Instagram, Telegram inputs side by side.
- **Justification for 3-col over stacked**: Mobile width is fine because the modal `max-w-md` (~28rem) with 3 short inputs still works at the typical handle length; matching the row visually keeps the modal short. (Twitter/Instagram already share a 2-col here, so 3-col is the smallest visual change.) If layout testing reveals cramping on small screens, drop to `grid-cols-1 sm:grid-cols-3`.
- New input mirrors Instagram's style:
  ```tsx
  <input
    type="text"
    value={newCoHostTelegram}
    onChange={(e) => setNewCoHostTelegram(e.target.value)}
    onBlur={() => setNewCoHostTelegram(stripToHandle(newCoHostTelegram))}
    placeholder="Telegram (no @)"
    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
  />
  ```
- Match the existing raw-`<input>` pattern in this file (do NOT introduce `IconInput` here — the rest of the modal uses raw inputs; one-off `IconInput` would be inconsistent and CLAUDE.md prefers matching local convention).

**(d) Edit Host state — lines 47-53, 207-227, 244-256**:
- Add `const [editHostTelegram, setEditHostTelegram] = useState('');` near line 51.
- In `startEditingHost` (line 207), add `setEditHostTelegram(host.telegram || '');`.
- In `cancelEditingHost` (line 218), add `setEditHostTelegram('');`.
- In `saveHostEdit` (line 229), within the mapping at line 244-256, add `telegram: editHostTelegram.trim() ? stripToHandle(editHostTelegram.trim()) : undefined,` after `instagram` on line 252.

**(e) Edit Host modal Telegram input — lines 582-608**: Same 2-col → 3-col change as the Add modal, with the Telegram input wired to `editHostTelegram` / `setEditHostTelegram` and `onBlur` calling `stripToHandle`.

### 3. GPP dashboard host tab — `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx`
**No code changes.** This component already renders `HostsManager` at line 292 with `party.coHosts`. The change to `HostsManager` covers this surface automatically.

(`HostResources.tsx` in the same folder is unrelated — it's a static "Host Resources" panel of external links and is NOT the host tab being referenced in the task.)

### 4. Persistence — verified no changes needed
- `frontend/src/lib/sanitizeCoHosts.ts` — passes through `telegram` (only strips `email`). ✓
- `frontend/src/lib/supabase.ts` `updateParty` (line 1687, 1763) — already whitelists `co_hosts` and forwards to API. ✓
- `frontend/src/lib/api.ts` `updatePartyApi` (line 247) — already forwards `coHosts`. ✓
- `backend/src/routes/party.routes.ts` PATCH (line 463-505) — strips only protected flags (`isUnderboss`, `isPartner`, `partnerTag`) via destructuring `const { isUnderboss: _ub, isPartner: _p, partnerTag: _pt, ...rest }`; `telegram` lands in `rest` and is written verbatim. ✓

### 5. Backfill script — `scripts/backfill-cohost-telegram-from-host.js` (NEW)
Modeled directly on `scripts/backfill-cohost-tabs.js`. Behavior:
- Dry-run by default; `--apply` flag writes via PostgREST.
- Fetch via PostgREST embed: `parties?event_type=eq.gpp&user_id=not.is.null&select=id,name,co_hosts,user_id,user:users(email,telegram)`.
- For each party where `user.telegram` is non-empty:
  - Find the primary host cohost — the entry whose `email` matches the user's email (NOT just index 0, because per `gpp.routes.ts:403-417` the array order is `[PizzaDAO, host, ...underbosses]`, so index 0 is "PizzaDAO" with `hello@rarepizzas.com`, NOT the host). Match by joining `users.email` to `co_hosts[].email` (case-insensitive).
  - If that cohost entry exists and `telegram` is falsy, set `coHosts[i].telegram = user.telegram` (already normalized in DB).
- PATCH the updated `co_hosts` array back via PostgREST.
- Log counts: parties scanned, parties affected, cohosts updated, parties skipped (no matching cohost / already has telegram / no user telegram).
- File header should match the pattern of `backfill-cohost-tabs.js` including `DO NOT git add this file` if applicable (most one-off backfills in this repo are not committed — verify by inspecting `.gitignore`/CLAUDE.md before deciding).

**Service role key**: read from env (preferably via `backend/.env` `DATABASE_URL` if using `pg`, or hardcode SERVICE_ROLE_KEY as `backfill-cohost-tabs.js` does — match the existing convention rather than introducing a new one). The existing script hardcodes the key at the top; reuse that exact pattern for consistency.

### 6. i18n
No new strings — the icon has only a `title="DM on Telegram"` tooltip and the input has a `placeholder="Telegram (no @)"` — these match the existing untranslated Twitter/Instagram inputs in the same modal. Do NOT introduce i18n keys for these without a broader i18n pass on the whole Edit Host modal (which is currently entirely untranslated).

## Sequencing & risk

1. Land type change (`types.ts`) + `HostsManager.tsx` UI change in a single PR. UI works the moment a host edits a cohost and adds a telegram handle — instantly visible on /underboss and GPP dashboard.
2. Run backfill in dry-run mode in production to confirm count (expected: roughly == number of GPP events created since launch with a non-null `user.telegram`). Eyeball a handful via the audit logs.
3. Run `--apply`. Spot-check 2-3 events visually.
4. Snax can verify in Vercel preview (see below).

## Verification steps for Snax (on Vercel preview)

1. Open any GPP event under /underboss (e.g. visit `/host/{inviteCode}` for a known GPP event) → scroll to Hosts section. Confirm Telegram paper-plane icon visible next to website/twitter/instagram for cohosts with telegram handles. Click it → opens `https://t.me/{handle}` in a new tab.
2. Open the same event's GPP dashboard view (the host tab via the "Build a Team" expander on `/host/{inviteCode}/dashboard` or wherever the GPP dashboard renders) → same icon, same behavior.
3. Click "Edit" on any cohost → confirm the Edit Host modal now shows three side-by-side inputs (Twitter, Instagram, Telegram). Type a handle, click Save → modal closes, reload page → Telegram icon now visible on that cohost row.
4. Click "Add Host" → confirm same 3-col layout. Add a host with a telegram handle, save → confirm the new cohost row shows the Telegram icon.
5. After backfill `--apply` runs, open a GPP event whose host had registered with a telegram handle → confirm the host's cohost entry now shows the Telegram icon without anyone manually editing it.
6. Confirm leading `@` is stripped (paste `@samgold24`, blur → field becomes `samgold24`, link goes to `https://t.me/samgold24` not `https://t.me/@samgold24`).

## Out of scope (explicitly)

- Pulling `users.telegram` as a fallback on the GET-enriched cohost (backend/src/routes/party.routes.ts:360-372). The task is satisfied by storing telegram on the cohost entry directly via UI + backfill.
- Adding `telegram` to the partner intake / underboss intake flows.
- Migrating the existing 2-col Twitter+Instagram grid to use `IconInput` (broader refactor not requested by this task; matching local convention here).
- i18n of the Edit Host / Add Host modals (entire modals are currently untranslated).

## Files touched

- `frontend/src/types.ts` (add `telegram?: string` to `CoHost`)
- `frontend/src/components/HostsManager.tsx` (state + Add modal + Edit modal + row icon + Send import)
- `scripts/backfill-cohost-telegram-from-host.js` (NEW, follows `backfill-cohost-tabs.js` pattern)

## Files NOT touched (verified unnecessary)

- `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx` — re-uses `HostsManager`, gets the fix for free
- `frontend/src/lib/sanitizeCoHosts.ts` — passes unknown keys through
- `frontend/src/lib/supabase.ts` — `co_hosts` already in whitelist
- `frontend/src/lib/api.ts` — `coHosts` already in whitelist
- `backend/src/routes/party.routes.ts` — non-protected cohost entries pass through PATCH verbatim
- `backend/prisma/schema.prisma` — no new column
- `supabase/migrations/*` — no new column
