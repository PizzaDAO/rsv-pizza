# grissini-58481 — Edit social-post template + adjectives without a deploy

## Goal
Move the SocialPostModal recap copy (the template string **and** the adjective pool) out of
hardcoded frontend constants into the existing `app_config` DB table, served by the backend and
editable by a super-admin in the Admin page — so wording/adjective changes ship **without a code deploy**.

Extends the marinara-71630 private-config architecture (`app_config` + `privateConfig.ts`). This is
the same shape as the existing **GPP Description** editor (`PATCH /api/admin/gpp-description` →
`app_config` → AdminPage section) — we mirror it.

## What's already in place (reuse, don't rebuild)
- `app_config` table (`key TEXT PK, value TEXT (json string), updated_at`) — **live in prod**. `schema.prisma`.
- `backend/src/lib/privateConfig.ts` — `getConfig<T>(key, fallback)` with 60s in-process cache + `invalidate(key)`. Never throws; returns fallback on miss.
- Reference editor: `admin.routes.ts` `PATCH /api/admin/gpp-description` (super-admin gate via `rawIsSuperAdmin`), `frontend/src/lib/api.ts` `fetchGppDescription`/`updateGppDescription`, `AdminPage.tsx` GPP Description section.
- Admin auth: backend `isSuperAdmin(email)` / `rawIsSuperAdmin`; frontend `fetchAdminMe()` → `role === 'super_admin'`.

## Design

### Storage — one `app_config` key
Key: **`social_post_config`**, value = JSON:
```json
{
  "template": "{flag}🍕🥳\nBitcoin Pizza Day {city} was {adjective}!\n\nThanks {tags} for supporting the event. See you next year!",
  "adjectives": ["great", "awesome", "a blast", "epic"]
}
```
Single row → one read accessor, one upsert, one cache key.

### Template tokens (interpolated client-side, in SocialPostModal)
| Token | Replaced with | Source |
|-------|---------------|--------|
| `{flag}` | country flag emoji | `countryNameToFlag(party.country)` |
| `{city}` | city name | `partyCity(party)` |
| `{adjective}` | random pick from `adjectives[]` | config |
| `{tags}` | partner @handles | `buildPartnerTags(party)` (unchanged) |

Literal emojis (🍕🥳) and all wording live **inside** the editable template string, so an admin can
reword anything, move tokens, swap emojis, etc. Unknown `{...}` tokens are left as-is (no crash).

### Code default = the fallback (no mandatory DB seed)
The current hardcoded `template` + `RECAP_ADJECTIVES` become the **fallback constant** passed to
`getConfig` and used by the modal if the fetch fails/returns empty. So:
- Until a super-admin edits it, the modal renders exactly as today (no behavior change, no seed needed).
- The first admin save creates the `app_config` row. **No prod DB seeding step / no DDL — sidesteps the prod-write authorization gate entirely.**

## Changes

### Backend
1. **`privateConfig.ts`** — add typed accessor:
   ```ts
   export interface SocialPostConfig { template: string; adjectives: string[]; }
   export const SOCIAL_POST_FALLBACK: SocialPostConfig = { template: "<current default>", adjectives: ["great","awesome","a blast","epic"] };
   export const getSocialPostConfig = () => getConfig<SocialPostConfig>('social_post_config', SOCIAL_POST_FALLBACK);
   ```
2. **Read endpoint** — `GET /api/config/social-post` (in `config.routes.ts`), `requireAuth` only (any logged-in host opens the modal; copy is non-sensitive). Returns `{ template, adjectives }`. Never 500s (fallback).
3. **Write endpoint** — `PATCH /api/admin/social-post` (in `admin.routes.ts`), super-admin gate (`rawIsSuperAdmin`). Body `{ template: string, adjectives: string[] }`. Validate:
   - `template`: non-empty string, ≤ 1000 chars.
   - `adjectives`: array, 1–50 entries, each non-empty string ≤ 50 chars (trim, drop blanks).
   - Upsert `app_config['social_post_config']` with `JSON.stringify`, then `invalidate('social_post_config')`. Return `{ success: true, config }`.
4. **`api.ts` wrappers** — `fetchSocialPostConfig()` and `updateSocialPostConfig({template, adjectives})`.

### Frontend
5. **`SocialPostModal.tsx`** — on open, `fetchSocialPostConfig()` (catch → in-file fallback constants, which stay as the default). Replace `buildDefaultText` to interpolate the fetched `template` with `{flag}/{city}/{adjective}/{tags}` and random adjective from fetched `adjectives`. Keep the existing fallback constants in-file so the modal still works if the endpoint 404s (e.g. before backend deploy) or errors.
6. **`AdminPage.tsx`** — new super-admin-only "Social Post Template" section, mirroring GPP Description:
   - `IconInput multiline` for the template, with helper text listing tokens: `{flag} {city} {adjective} {tags}`.
   - Adjectives editor: one-per-line `IconInput multiline` (parsed by splitting on newlines, trim, drop blanks). Simple + robust.
   - **Live preview** rendering the template with sample data (🇺🇸, "Philadelphia", a random adjective, "@Pizza_DAO @partner").
   - Save button (disabled when unchanged) → `updateSocialPostConfig`; success/error message. Mirror `handleSaveGppDescription`.

## Auth choice
Editor = **super_admin** (global copy, matches GPP Description). Read = any authenticated user (host).
If you'd rather underbosses edit it, swap the write gate to `requireUnderbossAuth` — easy change, call it out.

## Edge cases / notes
- **Cross-instance cache:** `invalidate()` clears only the serving instance; other serverless instances keep stale config ≤ 60s (privateConfig TTL). Acceptable; an admin save is visible everywhere within a minute.
- **Order of operations:** backend endpoints must be live for the editor + DB-driven copy to work; backend auto-deploys on master merge. The frontend fallback means the modal never breaks even if the read endpoint is missing (it 404s → fallback).
- **No migration / no DDL** — `app_config` already exists; first admin save writes the row.
- Existing per-party `checklist_items` rows are untouched; this only changes what text the modal pre-fills.

## Out of scope
- Per-event / per-region template overrides (this is one global template). Could layer later via additional keys.
- Localizing the template (single-language for now).
- Editing the static line-1 emojis as separate fields (they're just part of the template string).

## Verification
- `cd frontend && npx tsc --noEmit`; backend build.
- Preview: AdminPage shows the section (super-admin); edit template + adjectives, save, reopen SocialPostModal on a host dashboard → reflects the edit. Edit adjectives → re-rolls from the new pool. Revert.
- Confirm the modal still renders correctly with the read endpoint absent (fallback path).

## Rollout
1. Merge → backend auto-deploys (new endpoints live) + frontend deploys.
2. No seed required. (Optional: pre-seed `social_post_config` with the current default via `INSERT ... ON CONFLICT DO NOTHING` if you want the row to exist before first edit — not necessary given the fallback.)

## Suggested effort
Small–medium: ~1 backend accessor + 2 endpoints + 2 api wrappers + modal refactor + 1 AdminPage section. One worktree + draft PR.
