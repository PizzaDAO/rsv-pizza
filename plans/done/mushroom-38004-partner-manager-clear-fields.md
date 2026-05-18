# mushroom-38004 — PartnerManager silently ignores cleared fields (logo, website, twitter, etc.)

**Priority**: High (silently breaks "remove logo" / "clear field" UX in Underboss; bumps `updated_at` and re-runs partner sync but re-applies stale values to every tagged event)

**Branch**: `mushroom-38004-partner-clear-fields`

**Type**: Bug fix — pure frontend, no DB / Prisma / backend changes

## Problem

In `frontend/src/components/underboss/PartnerManager.tsx`, `handlePartnerSubmit` (~lines 67–95) builds the create/update payload using `data.field || undefined` for every nullable string field:

```ts
const payload = {
  email: data.email,
  tag: data.tag,
  name: data.contactPersonName || undefined,
  notes: data.notes || undefined,
  coHostName: data.name || undefined,
  coHostWebsite: data.website || undefined,
  coHostTwitter: data.brandTwitter || undefined,
  coHostInstagram: data.brandInstagram || undefined,
  coHostAvatarUrl: proxiedAvatarUrl,          // see below — same bug, different shape
  coHostLogoUrl: data.logoUrl || undefined,
  autoCoHost: data.autoCoHost,
  ...
  category: data.category || undefined,
  brandDescription: data.brandDescription || undefined,
};
```

`'' || undefined` evaluates to `undefined`, so when the user clears any field in the Underboss partner edit form and saves, the key is dropped from the JSON payload.

The backend PATCH handler at `backend/src/routes/sponsor-user.routes.ts:308–329` uses the standard "skip if undefined, clear if empty string" pattern:

```ts
if (coHostLogoUrl !== undefined) updateData.coHostLogoUrl = coHostLogoUrl?.trim() || null;
```

Because `undefined` is filtered out one level up, the field never enters `updateData`, the DB value stays, but `updated_at` still bumps (Prisma always touches it on `.update()`) and the partner-sync side-effects in `syncPartnerToAllEvents` / `syncAutoSponsorsToAllEvents` (lines ~336–399) still run, **re-applying the old logo/twitter/website value to every event sponsor row tagged with this partner.**

### Real-world reproduction
Team1 / Avalanche partner record (`sponsor_users.id = 9909cb97-53df-44ea-80cb-00b7d8af5a6c`, tag `avax`) — Snax clicked "remove logo" in Underboss → Partners → Edit → save. `updated_at` bumped, but `co_host_logo_url` is still populated. All 16 `avax`-tagged GPP event sponsor rows have the old `logoUrl` re-stamped on every save.

## Root cause

`|| undefined` is the wrong operator. We need to distinguish:

- **User did not touch this field** → omit from payload → backend keeps existing value
- **User explicitly cleared this field to empty** → send `''` → backend writes `null`

`PartnerForm` initializes every string field to `''` (see `getDefaultFormData()` in `frontend/src/components/sponsors/PartnerForm.tsx:113–125`) and stores user-edited values as strings (never `null`/`undefined`) — so a cleared field always reaches `handlePartnerSubmit` as `''`, never `undefined`. There is no "untouched" sentinel in the form's local state; every field round-trips through the controlled input as a string.

Given that, the frontend always wants to **send every field on save** — passing `''` for cleared fields is the correct behavior, because the backend's `?.trim() || null` then turns `''` into a DB `null` while preserving non-empty strings.

Switching `data.field || undefined` → `data.field ?? undefined` makes empty strings pass through to the backend untouched, while still defending against the (currently impossible but type-permitted) `undefined` case.

## Fix

In `PartnerManager.handlePartnerSubmit`, switch every `|| undefined` to `?? undefined` (or just drop the fallback entirely since `PartnerFormData` declares each field as `string`). For the avatar path, also stop short-circuiting `proxyAvatarToStorage` to `undefined` when the user clears the avatar — we want `''` to propagate so the backend clears `co_host_avatar_url` to `null`.

### Audit of every line in the payload

| Payload key             | Source                       | Current (buggy)              | Fix                                          |
|-------------------------|------------------------------|------------------------------|----------------------------------------------|
| `email`                 | `data.email`                 | passes through (required)    | unchanged                                    |
| `tag`                   | `data.tag`                   | passes through (required)    | unchanged                                    |
| `name`                  | `data.contactPersonName`     | `\|\| undefined`             | `?? undefined`                               |
| `notes`                 | `data.notes`                 | `\|\| undefined`             | `?? undefined`                               |
| `coHostName`            | `data.name`                  | `\|\| undefined`             | `?? undefined`                               |
| `coHostWebsite`         | `data.website`               | `\|\| undefined`             | `?? undefined`                               |
| `coHostTwitter`         | `data.brandTwitter`          | `\|\| undefined`             | `?? undefined`                               |
| `coHostInstagram`       | `data.brandInstagram`        | `\|\| undefined`             | `?? undefined`                               |
| `coHostAvatarUrl`       | `proxiedAvatarUrl` (see note)| short-circuits to `undefined`| explicit `''` when avatar cleared (see note) |
| `coHostLogoUrl`         | `data.logoUrl`               | `\|\| undefined`             | `?? undefined`                               |
| `autoCoHost`            | `data.autoCoHost`            | boolean — fine               | unchanged                                    |
| `autoSponsor`           | `data.autoSponsor`           | boolean — fine               | unchanged                                    |
| `coHostShowOnEvent`     | `data.coHostShowOnEvent`     | boolean — fine               | unchanged                                    |
| `coHostCanEdit`         | `data.coHostCanEdit`         | boolean — fine               | unchanged                                    |
| `coHostAllowedTabs`     | `data.coHostAllowedTabs`     | array — fine                 | unchanged                                    |
| `category`              | `data.category`              | `\|\| undefined`             | `?? undefined`                               |
| `brandDescription`      | `data.brandDescription`      | `\|\| undefined`             | `?? undefined`                               |

### Avatar special case

Current code (lines 72–75):
```ts
const proxiedAvatarUrl = data.coHostAvatarUrl
  ? await proxyAvatarToStorage(data.coHostAvatarUrl)
  : undefined;
```

When the user clears the avatar, `data.coHostAvatarUrl === ''` → ternary returns `undefined` → backend skips the field → DB value stays. Same bug.

Fix:
```ts
const proxiedAvatarUrl = data.coHostAvatarUrl
  ? await proxyAvatarToStorage(data.coHostAvatarUrl)
  : '';   // pass empty string through so backend clears co_host_avatar_url to null
```

Then in the payload: `coHostAvatarUrl: proxiedAvatarUrl` (no change at the assignment line).

Type note: `SponsorUserCreateData.coHostAvatarUrl?: string` and `SponsorUserUpdateData.coHostAvatarUrl?: string` in `frontend/src/lib/api.ts:3011, 3039` accept `string | undefined`. Empty string `''` is a valid `string`, so JSON.stringify emits `"coHostAvatarUrl":""`, the backend sees `coHostAvatarUrl !== undefined`, and `''?.trim() || null` becomes `null`. No type changes needed.

## Out-of-scope (audited but NOT touching in this PR)

### `PartnerForm.tsx` — `extractSponsorData` has the same bug for the host-side CRM

`frontend/src/components/sponsors/PartnerForm.tsx:65–87` builds the CRM `Sponsor` create/update payload with the exact same `data.field || undefined` pattern (lines 68–85). The backend CRM PATCH at `backend/src/routes/sponsor.routes.ts:602–626` uses the same `field !== undefined` skip-pattern, so **clearing any of `website`, `brandTwitter`, `brandInstagram`, `brandDescription`, `pointPerson`, `contactName`, `contactEmail`, `contactPhone`, `contactTwitter`, `telegram`, `productService`, `logoUrl`, `notes`, `category` in `SponsorCRM` or `FlyerGenerator` silently no-ops too.**

**Recommendation**: file a separate task for the CRM-side bug. The Underboss bug is the urgent one (it's what bit Snax today on the avax flyers), and fixing both in one PR muddies the diff and the verification matrix. Mention the CRM bug in the PR body so it's not lost.

If Snax wants both fixed in one shot, the same `?? undefined` swap on every `data.field || undefined` line in `extractSponsorData` does it. No backend changes required there either.

### `PartnerIntakePage.tsx`

`frontend/src/pages/PartnerIntakePage.tsx:11–24` also uses `|| undefined`. But this is the **public intake form** — it's only POSTed once per token (or re-edited by the partner before submission). The backend handler at `backend/src/routes/sponsor-intake.routes.ts` writes a fresh row, so "clearing a field" isn't semantically a thing on first submit. On re-submit, the same skip-if-undefined pattern may apply — but this is a different UX flow and a different ticket. Leave alone.

### All other `|| undefined` callsites in the codebase

Grep returns ~100 hits across `EventForm`, `VenueForm`, `MusicWidget`, `HostsManager`, etc. Each callsite has its own semantics (some are correctly "treat empty as unset because the field is genuinely optional and never gets cleared via this UI"; some have the same latent bug). **Don't audit them all here.** Scope this PR strictly to the reported Underboss partner manager bug.

## Files to modify

1. **`frontend/src/components/underboss/PartnerManager.tsx`**
   - In `handlePartnerSubmit` (lines 67–95):
     - Change `data.coHostAvatarUrl ? await proxyAvatarToStorage(...) : undefined` → `data.coHostAvatarUrl ? await proxyAvatarToStorage(...) : ''` so cleared avatars propagate as `''`.
     - Change every `data.X || undefined` to `data.X ?? undefined` for: `contactPersonName`, `notes`, `name` (coHostName), `website` (coHostWebsite), `brandTwitter` (coHostTwitter), `brandInstagram` (coHostInstagram), `logoUrl` (coHostLogoUrl), `category`, `brandDescription`. (9 lines total.)
   - That's the entire fix. No imports change, no signature changes, no new helpers.

## Files NOT modified

- `frontend/src/components/sponsors/PartnerForm.tsx` — same latent bug in `extractSponsorData`, file separate ticket.
- `frontend/src/pages/PartnerIntakePage.tsx` — different flow, file separate ticket.
- `frontend/src/lib/api.ts` — `SponsorUserCreateData` / `SponsorUserUpdateData` type signatures already accept `string` (which includes `''`); no change.
- `backend/src/routes/sponsor-user.routes.ts` — already correctly translates `''` → `null` via `?.trim() || null`. The skip-if-undefined pattern is the right contract; the bug is on the caller, not the handler.
- No DB migration. No Prisma schema change. No backend redeploy.

## Verification

### Manual QA on Vercel preview

1. Open `/underboss` → Partners tab → find a partner that has a logo set.
2. Click Edit → in the modal, click "remove logo" → save.
3. **Expected — partner record:**
   - `SELECT id, co_host_logo_url, updated_at FROM sponsor_users WHERE id = '<id>'`
   - `co_host_logo_url` is `NULL`.
   - `updated_at` bumped.
4. **Expected — propagation to event sponsors (tag-matched, auto-created):**
   - `SELECT id, party_id, name, logo_url FROM sponsors WHERE contact_email = '<partner email>' AND notes LIKE 'Auto-created from partner tag%'`
   - Every row has `logo_url = NULL`.
5. **Expected — flyer regen kicks in:**
   - The toast in the modal shows `"Synced to N events"`.
   - `onFlyerRegenNeeded?.(data.tag)` in `PartnerManager.tsx:114` fires → parent triggers flyer regen for matching events.
6. Repeat for each cleared-field case (website, twitter, instagram, brandDescription, category, notes, coHostName, contactPersonName, avatar).
7. **Regression check — non-empty values still save** (set website to `https://example.com`, save, verify DB).
8. **Regression check — partial edits don't clobber other fields** (change only website, save, verify only `co_host_website` changed).
9. **Console**: clean, no React warnings, no network 4xx/5xx.

### Direct DB verification for the Team1/avax case

After this PR ships and Snax re-clicks remove-logo:

```sql
SELECT id, email, tag, co_host_logo_url, updated_at
FROM sponsor_users
WHERE id = '9909cb97-53df-44ea-80cb-00b7d8af5a6c';
-- expect: co_host_logo_url IS NULL

SELECT s.id, s.party_id, p.name AS event_name, s.logo_url
FROM sponsors s
JOIN parties p ON p.id = s.party_id
WHERE s.contact_email = 'antoine@team1.network'
  AND s.notes LIKE 'Auto-created from partner tag%';
-- expect: all 16 rows have logo_url IS NULL
```

## Deploy strategy

- Single PR, draft, on branch `mushroom-38004-partner-clear-fields` in a worktree.
- No backend redeploy needed.
- Frontend preview deploys against production backend — safe.

## Gotchas

- **`?? undefined` vs `?? ''`**: Use `?? undefined` not `?? ''` because `PartnerFormData` types every string field as `string`. So `??` will never fall to the RHS in practice — the `?? undefined` is purely a TypeScript guard. The functional change versus the current code is that `''` no longer falls through to `undefined` like it does with `||`.
- **Simpler alternative**: Drop the `?? undefined` entirely and just write `name: data.contactPersonName`. Cleaner but breaks visual symmetry. Recommend `?? undefined` for minimal diff.
- **Don't change type signatures**. The backend already handles `''` → `null` translation; pushing `null` from the frontend would also work but adds churn.
- **`PartnerForm`'s `coHostAvatarUrl` upload widget**: confirm "remove avatar" UX sets `formData.coHostAvatarUrl = ''` (not `null`). If `null`, change the avatar line to `coHostAvatarUrl: proxiedAvatarUrl ?? ''` (or fix `PartnerForm` to use `''`).
- **Boolean fields and arrays**: untouched. The bug doesn't apply.

## Files Modified

- `frontend/src/components/underboss/PartnerManager.tsx`

## Files Audited but NOT Modified

- `frontend/src/components/sponsors/PartnerForm.tsx` (same bug pattern in `extractSponsorData`, separate ticket)
- `frontend/src/pages/PartnerIntakePage.tsx` (different flow, separate ticket)
- `frontend/src/lib/api.ts` (no type changes needed)
- `backend/src/routes/sponsor-user.routes.ts` (already correct)
- `backend/src/routes/sponsor.routes.ts` (already correct, but the frontend caller has the analog bug)

## Open questions

1. Bundle the `extractSponsorData` (CRM-side) fix into this PR, or ship as a follow-up? Recommend follow-up.
2. Confirm the avatar-clear UI in `PartnerForm` sets `formData.coHostAvatarUrl = ''` (not `null`). If `null`, also fix that.
