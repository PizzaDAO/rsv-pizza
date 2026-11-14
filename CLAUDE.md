# RSV.Pizza

## Project Overview
RSV.Pizza is an event RSVP platform with pizza ordering integration, built with React/TypeScript frontend and Supabase backend.

## Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions)
- **Payments**: Stripe
- **Deployment**: Vercel (frontend), Supabase (backend)

## Key Directories
- `frontend/src/pages/` - Page components (EventPage, HostPage, RSVPPage, etc.)
- `frontend/src/components/` - Reusable components
- `frontend/src/lib/` - Supabase client, API functions, Stripe utilities
- `frontend/src/contexts/` - React contexts (Auth, Pizza)
- `frontend/src/hooks/` - Custom React hooks
- `backend/` - Express API with Prisma
- `backend/prisma/` - Database schema
- `supabase/functions/` - Edge functions
- `plans/` - Task implementation plans

## Vercel Preview URL Pattern
```
https://rsvpizza-git-{branch-name}-pizza-dao.vercel.app
```

## Default Branch
This project uses `master` instead of `main`.

## Supabase MCP
Use **`mcp__supabase-pizzadao__`** for this project (not `supabase-snax`).
- Project ID: `znpiwdvvsqaxuskpfleo`
- Project Name: RSV.Pizza

## Supabase credentials (service_role)
The prod **`service_role`** key (bypasses RLS — never echo it) lives in the macOS
**login keychain** as a generic password: **service/label `pizzadaosupabase`**,
**account `service_role`**. Retrieve it non-interactively (sandbox disabled so the
keychain is reachable):

```bash
export SUPABASE_URL="https://znpiwdvvsqaxuskpfleo.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="$(security find-generic-password -l pizzadaosupabase -a service_role -w)"
```

Prod `DATABASE_URL` (pooler) is in `backend/.env`. The public `anon` key ships in
the deployed frontend bundle.

## Branching Convention
- Use `{task-id}-{short-name}` for branches (no `feature/` prefix)
- Example: `buffalo-39031-donation` not `feature/buffalo-39031-donation-option`
- Shorter branch names = shorter Vercel preview URLs

## Reusable Components

**ALWAYS use these existing components instead of writing custom markup:**

| Component | Use For |
|-----------|---------|
| `IconInput` | All text inputs and textareas. Use `multiline` prop for textarea mode. |
| `Checkbox` | All checkboxes/toggles |
| `ClickableEmail` | Displaying emails (makes domain clickable) |
| `CustomUrlInput` | URL slug inputs with `rsv.pizza/` prefix + live validation |
| `LocationAutocomplete` | Address/location inputs (Google Maps autocomplete) |
| `TimezonePickerInput` | Timezone selection |
| `Layout` | Page wrapper (Header + Footer + CornerLinks) |
| `HostsList` | Displaying co-hosts with avatars |
| `TableRow` | Guest/pizza/beverage list rows (multi-variant) |
| `LoginModal` | Auth modal pattern (backdrop + card + close button) |

**Rules:**
- Never create raw `<input>` elements — use `IconInput`
- Never create raw `<textarea>` elements — use `IconInput` with `multiline`
- Never create raw checkboxes — use `Checkbox`
- **Always use placeholders instead of labels** — no `<label>` elements above fields. Put descriptive text in the placeholder. Use small helper text below (`text-xs text-white/40`) only when necessary.
- Follow existing modal patterns (fixed backdrop + `z-50` + click-outside-to-close)

## Project-Specific Notes
- Supabase storage buckets must be created via dashboard, not code
- **Preview deploys share production backend + DB.** Frontend previews auto-deploy per branch, but the backend only deploys from `master` and the database is a single Supabase instance. New DB columns and backend endpoints must be applied to production **before** they'll work on preview branches.

## CI gates & migration safety
- **Apply Prisma migrations to prod BEFORE merging the schema change.** The backend auto-deploys from `master` within ~1 min, and Prisma SELECTs every declared field, so a `schema.prisma` field-add merged ahead of its column 500s every query on that model (incident 2026-05-17, PR #356 / arugula-38633).
- **`scripts/check-schema-drift.js`** (run via `npm --prefix backend run check:schema-drift`, needs `DATABASE_URL`) is the read-only guard for the above. CI runs it on every PR touching the schema/migrations (`.github/workflows/schema-drift.yml`). It only `SELECT`s `information_schema` — never add writes.
- **`parties` is column-granted to anon/authenticated** (once `backend/scripts/apply-lockdown-parties-columns.cjs --apply` is live): table-level SELECT is revoked and only the columns in `SAFE_PARTY_COLUMNS` (`frontend/src/lib/supabase.ts`, mirrored in `scripts/parties-anon-columns.json`) are granted. To let anon read a new column: ship a migration with `GRANT SELECT (col) ON parties TO anon, authenticated;`, apply it to prod BEFORE adding the column to `SAFE_PARTY_COLUMNS` — otherwise every party read fails with 42501. New sensitive/host-only columns go in `scripts/anon-sensitive-columns.json`. `scripts/check-rls-anon-exposure.js` (CI `rls-anon-exposure.yml`) enforces both (sensitive ones are skipped with a warning until the lockdown is applied).
- **`guests` and `user_preferences` are no-access for anon/authenticated** (once `backend/scripts/apply-lockdown-guests.cjs --apply` is live): all reads/writes go through the backend. `scripts/check-rls-anon-exposure.js` (CI `rls-anon-exposure.yml`, weekly + PRs) also enforces **C1** no privilege on the tables in `scripts/anon-no-access-tables.json`, **C3** no sensitive-looking anon-readable column (email/wallet/token/session/...) on any RLS-on table with a permissive anon `SELECT` policy unless listed with a reason in `scripts/anon-column-allowlist.json`, and **C4** every `supabase_realtime` table listed in `scripts/realtime-publication-allowlist.json` (empty).
- **`.github/workflows/lint.yml`** runs **only `react-hooks/rules-of-hooks`** over `frontend/src` on PRs (via `frontend/eslint.hooks.config.js`). That's the high-value class: a hook below an early return builds fine but black-screens at runtime (arugula-38633 v2). It's scoped this tight because full `npm run lint` carries ~678 pre-existing debt items (`no-explicit-any`, `no-unused-vars`); pay that down before widening the gate. `vite build` does NOT lint, so this is the only automated lint.

## Realtime

- **No app table is in the `supabase_realtime` publication** (`postgres_changes` payloads carry every column the subscriber role can SELECT, so a published table leaks whatever anon can read). `guests` was removed by Migration B (`backend/prisma/migrations/20261113_guests_anon_lockdown`); `scripts/realtime-publication-allowlist.json` is empty and CI guard C4 enforces it. **Never add `guests` back to the publication, and never grant anon/authenticated anything on `guests` or `user_preferences`.**
- Host live guest updates use **Broadcast-from-Database**: statement-level triggers on `guests` (Migration A, `20261112_guests_broadcast_trigger`, function `broadcast_guests_changed`) call `realtime.send` on the public topic `guests:<partyId>`, event `guests_changed`, payload `{op}` only (no guest data, no ids). The client listens to the broadcast and refetches through the backend (`GET /api/parties/:id/guests`, editors only). Guest reads never use the anon key.
- Realtime guest subscription is **opt-in per page** via `useGuestsRealtime(partyId, onChange)` from `frontend/src/hooks/useGuestsRealtime.ts` (host pages only; one ref-counted channel per party).
- **Do NOT re-add the subscription to `PizzaContext`** — the global subscription caused a site-wide outage on 2026-05-19 (every public RSVPer opened a realtime channel, churning the realtime `subscription` table and pinning WAL processing). See `plans/calabrese-58204-pool-exhaustion-fix.md`.

## Tax forms
- Tax forms are also rendered by pizzadao-org `app/tax-form` (pizzadao.org, formerly app.pizzadao.org), which calls the public `/api/tax-form-requests/*` routes cross-origin (CORS in `backend/src/lib/cors.ts`, hardcoded, no credentials). Update both when the forms or formData keys change.
