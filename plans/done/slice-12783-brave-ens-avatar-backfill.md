# slice-12783 — Backfill Brave + ENS partner avatars from third-party URLs to Supabase storage

**Priority:** P2
**Type:** One-shot data backfill (no PR; no code change to production app)
**Branch:** None — runs locally against prod DB via existing untracked `scripts/*.js` pattern.
**Dependencies:** **MUST run AFTER** `mushroom-38004` (PartnerManager `|| undefined` clobber fix) has deployed. See §8.
**Owner script:** Existing `scripts/fix-gpp-host-avatars.js` and `scripts/syndication-avatar-backfill.js` cover most of the pipeline. A small new wrapper (`scripts/backfill-partner-avatars-brave-ens.js`) keeps the run idempotent and scoped to exactly these two SponsorUser records.

---

## 1. Problem

Two partner SponsorUser records in production store third-party avatar URLs instead of Supabase-mirrored URLs:

| Partner | tag | `coHostAvatarUrl` | Why it's brittle |
|---------|-----|-------------------|-------------------|
| Brave | `brave` | `https://unavatar.io/x/brave` | unavatar.io returns **HTTP 403** to non-browser User-Agents (verified). Works in browsers today but is rate-limited and explicitly avoided per project convention. |
| ENS | `ens` | `https://pbs.twimg.com/profile_images/1810706000669798400/nYlIMYkq_400x400.jpg` | `pbs.twimg.com` profile_images URLs **rotate** when an X user updates their PFP. The image ID will silently 404 the next time @ensdomains changes their avatar. |

Both URLs are stored on the `SponsorUser` row (`co_host_avatar_url`) AND copied into every tagged event's `parties.co_hosts` JSONB array via `backend/src/helpers/partnerSync.ts:buildPartnerCoHost` (line 46: `avatar_url: sponsorUser.coHostAvatarUrl || sponsorUser.coHostLogoUrl || undefined`). Per the 2026-05-17 production sweep:

- **Brave** appears with that exact unavatar URL on at least 12 of 14 GPP cities sampled: philadelphia, miami, austin, denver, losangeles, chicago, berlin, london, buenosaires, santacruz, lagos, nairobi.
- **ENS** appears on at least newyork and tokyo. The real footprint depends on which events carry the `ens` event tag.

This violates the documented convention (memory `reference_avatar_backfill_scripts`): "always mirror to Supabase storage; never leave unavatar.io/x/... as live avatar_url".

## 2. Why this matters

1. **unavatar.io 403s for non-browser callers** (verified). Anywhere we touch the avatar from a server/CLI context (OG image generation, flyer generators, NFT URI builders, social previews) the image fails. Current browser-only success masks the breakage.
2. **pbs.twimg.com URLs are not stable.** When @ensdomains updates their X profile picture, that specific `profile_images/<id>/<filename>` becomes a 404 and every cached event surface that hard-links to it breaks at once.
3. **Project convention is explicit.** Three established pipelines (`fix-gpp-host-avatars.js`, `syndication-avatar-backfill.js`, `backfill-avatar-proxy.js`) all push toward `event-images/co-host-avatars/<filename>` on Supabase storage.
4. **Existing infra is ready.** This is a ~30-minute data fix, not a feature.

## 3. Scope

**In scope:**
- The `brave` SponsorUser record (`co_host_avatar_url` source-of-truth + every `parties.co_hosts[]` entry where `isPartner=true AND partnerTag='brave'`).
- The `ens` SponsorUser record (same pair).

**Out of scope:**
- Mirror-on-write changes to `PartnerManager.tsx` (separate concern — `mushroom-38004`).
- Any general "scan all partner avatars" sweep — just these two.
- Changes to `cdnUrl`, `proxyAvatarToStorage`, the `event-images` bucket policy, or storage paths.
- Removing/altering the unavatar.io fallback anywhere in the codebase.
- Backfilling non-partner co-hosts (covered by `fix-gpp-host-avatars.js --apply` run separately).

## 4. Source images

### 4a. Brave
- **Primary source:** value of `SponsorUser.coHostTwitter` for tag=`brave`. Likely `brave` or `BraveSoftware`. Verify by:
  1. SELECT: `SELECT id, email, tag, co_host_twitter, co_host_avatar_url, co_host_logo_url FROM sponsor_users WHERE tag = 'brave';`
  2. Pass the cleaned handle through `cleanXHandle` (from `fix-gpp-host-avatars.js:16-26`).
  3. GET `https://api.fxtwitter.com/<handle>` and confirm `json.user.avatar_url` looks like the Brave logo.
- **Fallback:** if the X PFP isn't on-brand, use Brave's official press-kit logo. Ask Snax for the URL.
- **Coverage check before run:** if `SponsorUser.coHostLogoUrl` is already a Supabase-storage URL, prefer it for `coHostAvatarUrl` and skip the fxtwitter fetch.

### 4b. ENS
- **Primary source:** value of `SponsorUser.coHostTwitter` for tag=`ens`. Almost certainly `ensdomains`. Same verification path as 4a.
- **Fallback:** ENS's official brand assets — Snax to supply.

The apply step does **not** require the implementation agent to decide between primary and fallback — it produces a dry-run plan with the fxtwitter-resolved URL, Snax inspects, then says go.

## 5. Existing infrastructure to reuse

- `scripts/fix-gpp-host-avatars.js` — fxtwitter → Supabase storage → patch `parties.co_hosts[idx].avatar_url`. Reads `co_hosts` JSONB and writes back the full array. Has `--apply` flag with default dry-run.
- `scripts/syndication-avatar-backfill.js` — same shape but driven by "find any unavatar.io URL in the cohosts array". Closer match for Brave's row.
- `scripts/backfill-avatar-proxy.js` — general "any non-Supabase URL in cohosts → mirror to storage". Closer match for ENS's row.

**None of these update `sponsor_users.co_host_avatar_url`.** They only touch `parties.co_hosts`. That's the gap this task closes.

## 6. Two-phase design: dry-run JSON → review → apply

### Phase A: dry run — produce a rollback snapshot + planned writes JSON

A small new wrapper `scripts/backfill-partner-avatars-brave-ens.js` (do **not** `git add`):

1. Connect via `@supabase/supabase-js` with the service-role key (same pattern as `fix-gpp-host-avatars.js:6-9`).
2. SELECT both SponsorUser rows.
3. SELECT every party where `co_hosts` has an entry with `isPartner=true` AND `partnerTag IN ('brave','ens')`. Using JSONB containment:
   ```sql
   SELECT id, custom_url, name, co_hosts
   FROM parties
   WHERE co_hosts @> '[{"isPartner":true,"partnerTag":"brave"}]'::jsonb
      OR co_hosts @> '[{"isPartner":true,"partnerTag":"ens"}]'::jsonb;
   ```
4. For each partner, derive `handle` via `cleanXHandle(sponsorUser.co_host_twitter)` and fetch `fxtwitterAvatarUrl(handle)`.
5. Write **`scripts/backfill-partner-avatars-brave-ens-rollback-<ISO>.json`** capturing every party's full `co_hosts` snapshot and both SponsorUser rows' prior `co_host_avatar_url`.
6. Write **`scripts/backfill-partner-avatars-brave-ens-plan-<ISO>.json`** with the resolved fxtwitter URLs and the affected-events list.
7. **Do not write to the DB or storage.** Exit 0.

Snax then eyeballs the fxtwitter URLs in a browser to confirm the right logos. If either is wrong, supply a fallback URL and re-run Phase A with `--brave-override <url>` / `--ens-override <url>`.

### Phase B: apply — upload + DB writes

Invoked as `node scripts/backfill-partner-avatars-brave-ens.js --apply --plan <path>`. For each partner:

1. **Download the fxtwitter image** (or the Snax-supplied fallback URL).
2. **Upload to Supabase storage:** `event-images/co-host-avatars/<Date.now()>-<rand>.jpg`. Reuse `mirrorToSupabase` helper.
3. **Update `sponsor_users.co_host_avatar_url`** for that tag.
4. **Propagate to events** (§7 below).

## 7. Propagation paths (per partner)

### Path A (preferred if `mushroom-38004` is deployed): re-trigger `syncPartnerToAllEvents` via admin endpoint

`backend/src/routes/sponsor-user.routes.ts:389-392` ("Case 4") re-runs `syncPartnerToAllEvents(sponsorUser)` on any PATCH where `isAutoCoHost && wasAutoCoHost && isActive_`. PATCH `/api/sponsor-users/:id` with just `{ coHostAvatarUrl: '<new-supabase-url>' }` triggers the sync, which propagates to every tagged event in one shot.

### Path B (default — works regardless of deploy order): direct JSONB patch per party

For each affected party, update the matching `co_hosts` array entry's `avatar_url`. Mirrors `fix-gpp-host-avatars.js:92-126`.

Pseudocode:
```js
for (const partner of [brave, ens]) {
  const newUrl = await uploadToSupabase(partner);
  await supabase.from('sponsor_users').update({ co_host_avatar_url: newUrl }).eq('id', partner.sponsorUserId);

  const { data: parties } = await supabase
    .from('parties')
    .select('id, custom_url, co_hosts')
    .filter('co_hosts', 'cs', JSON.stringify([{ isPartner: true, partnerTag: partner.tag }]));

  for (const p of parties) {
    const updated = p.co_hosts.map(h =>
      (h?.isPartner === true && h?.partnerTag === partner.tag)
        ? { ...h, avatar_url: newUrl }
        : h
    );
    await supabase.from('parties').update({ co_hosts: updated }).eq('id', p.id);
  }
}
```

**Path B is preferred** because:
1. It doesn't depend on the backend route running in the right "Case" branch.
2. It doesn't depend on the SponsorUser being currently `autoCoHost=true && isActive=true`.
3. It's idempotent: running twice produces the same JSONB.
4. It can fall back to the Supabase Management API token (`reference_db_backfill_fallback`) if the service-role-keyed Supabase JS client misbehaves on the JSONB-array filter.

If `cs` (containment) filter is brittle for arrays-of-objects, fall back to: pull every row, filter in JS, write back only matches. The two-partner footprint (~14 parties) is small enough.

## 8. Dependency on `mushroom-38004`

Per `feedback_backfill_after_backend_deploy`: backfills that touch fields the backend currently mishandles can regress on the next save.

- If the backfill runs **before** `mushroom-38004` deploys, the new Supabase URL on `SponsorUser.coHostAvatarUrl` is safe — but the moment anyone re-saves the partner record through the Underboss UI, the form's initial state (loaded from API, possibly cached) re-stamps the old unavatar/pbs.twimg URL across all events via Case-4 sync.
- **Gate the apply step on confirmation from Snax that `mushroom-38004` is live in production.**
- (`onion-58617` is also helpful but not strictly required — it makes the partnerSync side preserve fields when undefined, which insulates against further drift, but doesn't protect against the explicit re-stamp from PartnerManager.)

If `mushroom-38004` ships *after* this backfill but no one saves either partner record in the interim, the backfill remains durable.

## 9. Rollback

The Phase A rollback JSON captures every party's full `co_hosts` snapshot before any writes. A reverse pass (`scripts/backfill-partner-avatars-brave-ens.js --rollback <path>`) loops over the JSON and:
1. `UPDATE sponsor_users SET co_host_avatar_url = '<old>' WHERE id = '<id>';`
2. `UPDATE parties SET co_hosts = '<old_co_hosts>'::jsonb WHERE id = '<id>';`

Storage objects uploaded during Phase B can be left in place.

## 10. Step-by-step

1. **Read the source-of-truth.** Run the SponsorUser SELECT. Record IDs and X handles. If `is_active = false` or `auto_co_host = false`, note that to Snax.
2. **Verify `mushroom-38004` is deployed.** Check `git log master -- frontend/src/components/underboss/PartnerManager.tsx` for a commit that removes the `|| undefined` pattern, or ask Snax. **Do not proceed past step 3 (dry run) until confirmed.**
3. **Phase A dry run.** `node scripts/backfill-partner-avatars-brave-ens.js`. Produces rollback + plan JSONs. Prints summary: `Brave handle: @brave → fxtwitter avatar: <url> | N affected parties: ...`. **No writes.**
4. **Snax reviews the plan JSON.** Open each fxtwitter URL in browser to confirm.
5. **Phase B apply.** `node scripts/backfill-partner-avatars-brave-ens.js --apply --plan <path>`. Downloads, uploads, updates SponsorUser, patches each affected party's JSONB.
6. **Verify** (§11).
7. **Delete the rollback JSON only after Snax confirms verification.**

## 11. Verification

1. **DB:** re-run the SponsorUser SELECT and confirm both `co_host_avatar_url` values now point at Supabase storage.
2. **Per-event JSONB:** re-run the containment SELECT and confirm every row's matching `co_hosts` entry has the new Supabase URL.
3. **Public API spot-check:**
   - Brave: `curl -s 'https://rsv.pizza/api/events/philadelphia' | jq '.event.coHosts[] | select(.partnerTag == "brave") | .avatar_url'`
   - ENS: `curl -s 'https://rsv.pizza/api/events/newyork' | jq '.event.coHosts[] | select(.partnerTag == "ens") | .avatar_url'`
   - Repeat for at least 3 cities per partner.
4. **Live image fetch:** `curl -I <new-supabase-url>`. Expected: HTTP 200, `content-type: image/*`.
5. **Browser:** open any affected event page, confirm avatar renders, inspect `<img src>` is the new Supabase URL.
6. **OG-image regression check:** trigger any OG-image generation that includes co-host avatars and confirm it resolves.

## 12. Edge cases

1. **SponsorUser has `coHostLogoUrl` already set to a Supabase URL.** Prefer it over the fxtwitter fetch.
2. **SponsorUser has `auto_co_host = false`.** Path B still works; Path A would short-circuit.
3. **fxtwitter returns 200 but a placeholder egg avatar.** Inspect in Phase A; abort and use Snax-supplied fallback.
4. **A party has multiple co-host entries with `partnerTag='brave'`.** The patch loop updates all of them. Correct behavior.
5. **A party has `co_hosts` as non-array.** Handle `Array.isArray(co_hosts) ? ... : []`. Skip non-array rows.
6. **Race: someone saves the partner via Underboss UI mid-run.** If `mushroom-38004` is deployed, no harm. If it isn't, the save re-clobbers — don't touch Underboss partner UI during the run window.

## 13. Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| `mushroom-38004` not yet deployed; backfill is re-clobbered by next Underboss save | Gate apply on Snax confirmation |
| Wrong handle resolves to a non-brand avatar | Phase A dry run; Snax eyeballs URL in browser |
| Service-role key in untracked script | Standard project pattern; rollback JSON captures prior state |
| Storage upload succeeds but DB update fails | Rollback JSON restores prior state; uploaded objects become harmless dead files |
| Brave's X PFP isn't the lion logo | Snax-supplied fallback URL path (§4a) |
| Affected-events list is incomplete | JSONB containment SELECT finds *every* matching party, not just sampled |

## 14. What the implementation agent should produce

- `scripts/backfill-partner-avatars-brave-ens.js` (do **NOT** `git add`).
- Phase A output: paste the path to the plan JSON and a summary line per partner (`Brave: @brave → <url> | N parties: ...`). Do **not** paste the full JSON in chat.
- Wait for explicit "go, apply" from Snax (which also confirms `mushroom-38004` is live).
- Phase B output: paste apply summary stats. Run §11 verification and paste results.
- Keep the rollback JSON on disk until Snax confirms; then delete.
- Do **NOT** open a PR. Do **NOT** push a branch.

## 15. References

- `scripts/fix-gpp-host-avatars.js` — fxtwitter + Supabase storage pipeline; helpers (`cleanXHandle`, `fxtwitterAvatarUrl`, `mirrorToSupabase`) reused.
- `scripts/syndication-avatar-backfill.js` — closest match for Brave's unavatar row.
- `scripts/backfill-avatar-proxy.js` — closest match for ENS's twimg row.
- `backend/src/helpers/partnerSync.ts:39-56` — `buildPartnerCoHost` and the avatar precedence chain.
- `backend/src/helpers/partnerSync.ts:241-258` — `syncPartnerToAllEvents` (Path A).
- `backend/src/routes/sponsor-user.routes.ts:286-405` — PATCH handler triggering Case-4 sync.
- `backend/prisma/schema.prisma` — `SponsorUser` model.
- `plans/mushroom-38004-partner-manager-clear-fields.md` — prerequisite fix.
- `plans/onion-58617-partnersync-destructive-replace.md` — companion partnerSync hardening.
- `secrets.md` — Supabase Management API token for `reference_db_backfill_fallback`.
