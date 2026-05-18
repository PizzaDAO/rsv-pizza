# onion-58617 — partnerSync destructive replace clobbers avatar_url when SponsorUser has no avatar+logo

**Priority**: P2 (latent data-loss bug; 0/70 partner entries currently affected in a 14-event GPP sweep, but the path is hot — fires on every SponsorUser PATCH via Case 4 in `sponsor-user.routes.ts:391`)

**Branch**: `onion-58617-partnersync-replace`

**Type**: Bug fix — pure backend, no DB / Prisma / frontend changes

## Problem

`backend/src/helpers/partnerSync.ts` performs a destructive replace inside `addPartnerToParty` when a partner cohost entry already exists for the partner's tag. The mechanism:

1. `buildPartnerCoHost` (lines 39–56) constructs `partnerEntry` using `|| undefined` fallbacks for `website`, `twitter`, `instagram`, and `avatar_url`:

   ```ts
   avatar_url: sponsorUser.coHostAvatarUrl || sponsorUser.coHostLogoUrl || undefined,
   ```

   When both `coHostAvatarUrl` and `coHostLogoUrl` are null/empty on the SponsorUser, `avatar_url` becomes `undefined`. JSON serialization (the eventual write into the `parties.coHosts` jsonb column via Prisma) drops keys whose value is `undefined`, so `partnerEntry` lacks an `avatar_url` key entirely.

2. `addPartnerToParty` (lines 93–105) then does a destructive spread when an existing entry is found:

   ```ts
   updatedCoHosts[existingIdx] = { ...partnerEntry, id: existing.id };
   ```

   This wholesale-replaces the prior entry. Any previously-set `avatar_url` (or `website`, `twitter`, `instagram`) that survived from an earlier sync — where the SponsorUser still had that field populated — is lost. The replacement keeps only `id` from the existing entry; everything else comes from the partial `partnerEntry`.

This sync is triggered on **every** SponsorUser PATCH that leaves `autoCoHost` on, via Case 4 in `backend/src/routes/sponsor-user.routes.ts:389–392`:

```ts
// Case 4: Profile fields updated but still autoCoHost — upsert co-host entries in place
else if (isAutoCoHost && isActive_ && wasAutoCoHost) {
  syncedCount = await syncPartnerToAllEvents(sponsorUser);
}
```

So any save of a partner whose avatar fields are momentarily null — for example a freshly-created partner being edited again before an avatar upload, or a partner whose avatar was transiently cleared by the mushroom-38004 frontend bug — propagates that null across every event tagged with the partner's tag, permanently (until the next save with a populated avatar).

## Root cause

The upsert path in `addPartnerToParty` treats `buildPartnerCoHost`'s output as authoritative on every field, even though `buildPartnerCoHost` emits `undefined` (and thus drops keys on serialization) for unset optional strings. Those dropped keys mean the spread `{ ...partnerEntry, id: existing.id }` blanks out the corresponding values on the stored entry instead of preserving them.

The correct semantics: when the SponsorUser does not provide a value for an optional string field, the sync should **leave the existing event-cohort value alone**, not overwrite it with the missing value.

### Concrete reproduction

1. Create a SponsorUser with `tag: "demo"`, `autoCoHost: true`, `coHostLogoUrl: "https://cdn.example/logo.png"`, `coHostAvatarUrl: null`.
2. Create a Party with `eventTags: ["demo"]`, empty `coHosts: []`.
3. `syncPartnerToAllEvents` → `addPartnerToParty` appends a new cohort entry. `existingIdx < 0`, so the append path runs. The entry has `avatar_url: "https://cdn.example/logo.png"` (from the logo fallback). All good.
4. PATCH the SponsorUser, clearing `coHostLogoUrl` to `null` (this can happen if the avatar/logo field is cleared from the UI once mushroom-38004 ships, or via direct admin edit). `autoCoHost` is still on; `wasAutoCoHost` is true; Case 4 fires.
5. `buildPartnerCoHost` now emits `avatar_url: undefined` because both `coHostAvatarUrl` and `coHostLogoUrl` are null.
6. `addPartnerToParty` finds the existing entry (`existingIdx >= 0`). The destructive replace at line 102 writes `{ ...partnerEntry, id: existing.id }`. The new entry has **no** `avatar_url` key. The cohort entry's avatar is gone on the event.

The 14-event GPP sweep on 2026-05-17 found 0/70 currently-broken entries, so this isn't an active fire — but the destructive-replace contract is wrong, and it compounds with mushroom-38004.

## Related context

- **`plans/mushroom-38004-partner-manager-clear-fields.md`** (not yet implemented) addresses a frontend bug in `PartnerManager.tsx`'s `handlePartnerSubmit` where `|| undefined` drops cleared field values from the PATCH payload before they reach the backend. That bug currently *prevents* fields from being cleared in the Underboss UI; this onion-58617 bug *destroys* event-cohort data when the upstream SponsorUser happens to have a missing field on save.
- The two bugs compound: once mushroom-38004 is fixed, partners can finally clear an avatar from the UI, which makes the destructive-replace path here strictly more dangerous (the null-avatar SponsorUser state becomes reachable by normal user action).
- **Fix onion-58617 independently.** Do not couple to mushroom-38004. Different file, different ticket.

## Proposed solution — Option B (strip undefined, then spread)

In the upsert branch of `addPartnerToParty`, strip undefined-valued keys from `partnerEntry` before merging into the existing entry. This preserves any field on the existing entry that `partnerEntry` does not have an explicit value for.

```ts
let updatedCoHosts: any[];
if (existingIdx >= 0) {
  const existing = existingCoHosts[existingIdx];
  // Only overlay fields the SponsorUser actually provided. Undefined-valued
  // keys in partnerEntry would otherwise wipe existing values on JSON write.
  const defined = Object.fromEntries(
    Object.entries(partnerEntry).filter(([_, v]) => v !== undefined)
  );
  updatedCoHosts = [...existingCoHosts];
  updatedCoHosts[existingIdx] = { ...existing, ...defined, id: existing.id };
} else {
  updatedCoHosts = [...existingCoHosts, partnerEntry];
}
```

### Why Option B over Option A

- **Option A** (start from existing, manually overlay each defined field with a for-loop) is functionally identical but verbose.
- **Option B** is a clean, one-line semantic change. `Object.fromEntries` + `Object.entries.filter` is a well-understood idiom.
- Boolean fields (`showOnEvent`, `canEdit`, `isPartner`) are always emitted as concrete `true`/`false` by `buildPartnerCoHost` (lines 47–49 use `!== false` and `!!`), so they survive the `v !== undefined` filter unchanged — the destructive replace behavior for booleans is preserved (correct, per task constraints).
- `id` is explicitly re-applied at the end of the spread; the existing entry's id is the stable cohort id, must never change.
- `partnerTag` is always set (line 50: `sponsorUser.tag`), so it survives the filter.
- `name` uses an `||` chain ending in `sponsorUser.email`, which is non-null per the SponsorUser model — so `name` is always defined.
- `allowedTabs` is only added when `Array.isArray(sponsorUser.coHostAllowedTabs)` (lines 52–54). If the SponsorUser doesn't have allowedTabs, the field isn't on `partnerEntry`, so the existing value (if any) on the event-cohort entry survives via `...existing`.

### Append path (existingIdx < 0): unchanged

The constraint says don't change behavior when there's no existing entry to preserve. Option B leaves the `else` branch alone.

### Diff sketch

```diff
   let updatedCoHosts: any[];
   if (existingIdx >= 0) {
     const existing = existingCoHosts[existingIdx];
+    // Strip undefined-valued keys so we don't clobber existing fields
+    // (e.g., avatar_url) when the SponsorUser has no value to provide.
+    // Boolean fields (showOnEvent, canEdit, isPartner) are always defined
+    // by buildPartnerCoHost, so they continue to overwrite as before.
+    const defined = Object.fromEntries(
+      Object.entries(partnerEntry).filter(([_, v]) => v !== undefined)
+    );
     updatedCoHosts = [...existingCoHosts];
-    updatedCoHosts[existingIdx] = { ...partnerEntry, id: existing.id };
+    updatedCoHosts[existingIdx] = { ...existing, ...defined, id: existing.id };
   } else {
     updatedCoHosts = [...existingCoHosts, partnerEntry];
   }
```

That's the entire fix.

## Files to modify

1. **`backend/src/helpers/partnerSync.ts`** — `addPartnerToParty`, the upsert branch (lines 99–102). No other changes in this file.

## Step-by-step implementation

1. Create worktree: `git worktree add ../rsvpizza-onion-58617 -b onion-58617-partnersync-replace origin/master`
2. Open `backend/src/helpers/partnerSync.ts`.
3. Modify the `if (existingIdx >= 0)` branch of `addPartnerToParty` to strip undefined keys from `partnerEntry` and merge over `existing` (Option B above).
4. Leave `buildPartnerCoHost`, `findExistingSponsor`, `syncQuizTemplatesToEvent`, `removePartnerFromParty`, `removePartnerFromAllEvents`, `syncAutoSponsorsToAllEvents`, `removeAutoSponsorsFromAllEvents`, `getAutoCoHostPartners`, and `syncPartnerToAllEvents` untouched.
5. Run `cd backend && npx tsc --noEmit` to confirm no TypeScript regressions.
6. Run the backend test suite (`cd backend && npm test`).
7. Add a focused integration test (see Verification below).
8. Commit, push, open draft PR.

## Verification

### Integration test (add under `backend/src/helpers/__tests__/partnerSync.test.ts` if the test harness supports it, otherwise inline in an existing partnerSync test file)

Scenario: confirm a previously-set `avatar_url` survives a sync triggered after the SponsorUser's avatar/logo fields go null.

1. Seed a SponsorUser with `tag: "test-onion-58617"`, `autoCoHost: true`, `autoSponsor: false`, `coHostLogoUrl: "https://cdn.test/logo.png"`, `coHostAvatarUrl: null`, `coHostName: "Test Partner"`.
2. Seed a Party with `eventTags: ["test-onion-58617"]`, empty `coHosts`.
3. Call `addPartnerToParty(party, sponsorUser)`. Assert `coHosts[0].avatar_url === "https://cdn.test/logo.png"`.
4. Re-fetch the party (to get the persisted cohort with the partner-id assigned). Re-fetch the SponsorUser and mutate it to `coHostLogoUrl: null, coHostAvatarUrl: null`.
5. Call `addPartnerToParty(party, mutatedSponsorUser)` again.
6. Re-fetch the party.
7. Assert: `coHosts[0].avatar_url === "https://cdn.test/logo.png"` (preserved from step 3, not wiped by the upsert). Assert: `coHosts[0].id` is unchanged (stable cohort id).
8. Bonus: also seed `coHostWebsite: "https://test.partner"` in step 1, null it in step 4, and assert it's preserved through step 7. Same for `coHostTwitter`, `coHostInstagram`.
9. Boolean regression check: in step 4, also flip `coHostShowOnEvent: false`. After step 6, assert `coHosts[0].showOnEvent === false` — booleans should still overwrite, since they're always defined.
10. Append-path regression check: in a separate test, seed a Party with empty `coHosts`, call `addPartnerToParty` with a SponsorUser whose `coHostAvatarUrl` and `coHostLogoUrl` are both null. Assert: `coHosts[0]` is created and does NOT contain an `avatar_url` key (no existing value to preserve; the append path is unchanged).

### Manual QA on Vercel preview

1. After mushroom-38004 has shipped (so the UI can actually clear fields), go to `/underboss` → Partners → pick a partner that has an avatar set, save without touching any field. Open the relevant event page; confirm the partner cohort's avatar still renders.
2. Stronger test: pick a partner with an avatar; change only `coHostName` in the underboss form (don't touch the avatar field); save. Confirm: (a) the partner's `co_host_avatar_url` in `sponsor_users` is unchanged; (b) for every event tagged with this partner's tag, `parties.coHosts -> [partner entry] -> avatar_url` still equals the avatar URL from before the save.
3. SQL spot-check:
   ```sql
   SELECT
     p.id,
     p.name,
     jsonb_path_query(p.co_hosts, '$[*] ? (@.partnerTag == "<tag>") .avatar_url') AS partner_avatar
   FROM parties p
   WHERE '<tag>' = ANY(p.event_tags);
   ```
   Confirm `partner_avatar` is the expected URL (not null) on every row.

## What this plan does NOT change

- No DB migration. The `parties.coHosts` jsonb column shape is unchanged.
- No Prisma schema change.
- No frontend change. Mushroom-38004 stays in its own ticket.
- No backfill. The 14-event GPP sweep found 0/70 entries currently in the broken state.
- No change to `buildPartnerCoHost`, `removePartnerFromParty`, `syncQuizTemplatesToEvent`, `findExistingSponsor`, `syncAutoSponsorsToAllEvents`, `removeAutoSponsorsFromAllEvents`, `removePartnerFromAllEvents`, `getAutoCoHostPartners`, or `syncPartnerToAllEvents`.
- No change to the partner-entry shape stored in `parties.coHosts`.
- No change to the append path in `addPartnerToParty` when `existingIdx < 0`.

## Gotchas

- **Don't preserve booleans accidentally.** Option B's filter is `v !== undefined`, not `v != null` or truthy-check — so `false` survives the filter and continues to overwrite. Critical for `showOnEvent` (where `false` is a meaningful "hide this partner from event" signal) and `canEdit`.
- **`partnerEntry.id` is a fresh UUID every call** (`partner-${crypto.randomUUID()}`). The trailing `id: existing.id` in the spread is load-bearing — without it, every sync rerolls the cohort id, which would break any UI or RSVP path that joins on `coHosts[].id`.
- **Order of spread matters**: `{ ...existing, ...defined, id: existing.id }`. `existing` first → `defined` overrides → `id` re-applied last. Reversing puts stale fields on top.
- **No need to deep-merge nested objects.** The cohort entry shape is flat. A shallow spread is correct.
- **`allowedTabs` array replacement**: when the SponsorUser has `coHostAllowedTabs` set, `partnerEntry.allowedTabs` replaces (not merges with) the existing array. Existing behavior, preserved.

## Deploy strategy

- Backend-only change. Standard backend deploy (manual `cd backend && vercel --prod` from `rsvpizza-master-deploy` worktree per `feedback_backend_deploy_from_master_only`).
- No coordinated frontend release needed.
- Low risk: scoped to one branch of one function, with explicit unit-test coverage of both the preserve and overwrite paths.

## DNS length check

`rsvpizza-git-onion-58617-partnersync-replace-pizza-dao` = 24 + 33 = 57 chars. Under the 63-char limit. ✓
