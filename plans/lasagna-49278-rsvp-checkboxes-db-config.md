# lasagna-49278: DB-driven config for RSVP opt-in checkboxes

**Priority:** P2
**Type:** Architecture refactor — eliminate redeploy-for-checkbox-edit
**Status:** Plan
**Branch:** `lasagna-49278-rsvp-checkboxes-db-config`

## Context

The RSVP form's opt-in checkboxes (mailing list, 6 SWC regions, ETHConf) are all hardcoded across the frontend (`RSVPFormStep1.tsx`, `useRSVPForm.ts`, `optinAbRegions.ts`), backend (`rsvp.routes.ts`, `prisma/schema.prisma`), and i18n bundles. Every change — re-wording a label, swapping a privacy URL, gating a checkbox on a new event tag, adding a new partner — requires a multi-file PR and a frontend+backend deploy.

In the last ~3 months alone: `neapolitan-84274` (Brazil checkbox), `parmesan-98989` (US combined A/B), `mushroom-36006` (5 regional A/Bs), `rigatoni-72401` (ship variant), and `linguine-83104` (extend to all events) — each one shipped a multi-file PR for what is essentially copy/config.

Snax wants to add, recopy, retag, or hide checkboxes from a Supabase row without a deploy.

## Goal

Move the **checkbox configuration** (which checkboxes render, their label, their info-modal copy, their tag-based render conditions, which DB column they write to) out of the frontend bundle and into a Supabase table. The frontend fetches the active config when the RSVP form mounts and renders from it.

The eight existing destination columns on `guests` (`mailing_list_opt_in`, `swc_opt_in`, `swc_ca_opt_in`, `swc_au_opt_in`, `swc_eu_opt_in`, `swc_uk_opt_in`, `swc_br_opt_in`, `ethconf_opt_in`) stay exactly where they are. A config row describes which column each rendered checkbox writes to.

## Important discoveries up front

1. **Adding a NEW destination column will still require a deploy** — Prisma schema, generated client, backend whitelist (`backend/src/routes/rsvp.routes.ts:280–305 / 504–533 / 577–607`), and frontend `addGuestToParty` parameter list (`frontend/src/lib/supabase.ts:1566–1627`) all enumerate the eight columns. There is no realistic way to make column-add deploy-free without a generic `extra_opt_ins JSONB` field on `guests` plus a backend-side migration policy. **Scope this plan to: re-copy / re-tag / hide / show the eight existing checkboxes.** Adding a 9th partner = one row in config + one new column shipped via the existing add-a-column pattern (`neapolitan-84274`). Document this constraint up front and don't hide it.

2. **There's already a precedent for "frontend reads DB config to gate UI":** `experiment_flags` (created in `supabase/migrations/20260518_create_experiment_flags.sql`, read from frontend via `getExperimentFlag` in `frontend/src/lib/supabase.ts:2422`). It uses column-level `GRANT SELECT (key, enabled) ON … TO anon`, RLS-enabled, writes via backend service_role only. **Adopt this exact security pattern** for the new config table.

3. **There's already a key/value store (`app_config`) used by the GPP default description.** It's a flat string-valued KV table (`supabase/migrations/20260421_app_config.sql`) — too thin for what we need (per-row metadata, ordering, tag conditions). Don't reuse it; a dedicated table with typed columns is right here. Mirror the `survey_question_sets` / `survey_questions` precedent from `plans/pugliese-58297-survey-db-config.md`.

4. **The combined opt-in already crosses checkbox boundaries** — `setCombinedOptIn` in `useRSVPForm.ts:188` toggles `mailingListOptIn`, optionally `ethconfOptIn`, and one of six SWC fields. The "what does this checkbox toggle?" abstraction is therefore **a list of opt-in fields, not a single field.** The config schema must support a checkbox writing to N>=1 fields (the combined case is the model — every checkbox is "writes to a list of destination fields"; standalone checkboxes just have a list of length 1).

5. **`optinAbVariant` preservation must keep working.** A guest previously bucketed into `optin_ab_variant='control'` still sees the legacy two-checkbox layout when they re-RSVP. The config-driven renderer must respect this preservation path, either by shipping a "legacy preservation" config that mirrors the old UI or by keeping the preservation branch hardcoded and only making the non-preservation path config-driven. **Recommend: keep preservation hardcoded as a tiny fallback branch; config drives the modern path only.** Preservation will become reachable for fewer and fewer rows over time and can eventually be deleted.

6. **i18n is already DB-aware-friendly via a fallback pattern.** The codebase uses `react-i18next` namespaces keyed by string (e.g. `swcModal.title`). The cleanest hybrid is: config row stores **an optional i18n key** AND **an optional literal default string per locale**; renderer prefers literal-when-present, falls back to `t(i18nKey)`. New checkboxes can ship with literals only (no deploy); existing checkboxes keep using their i18n keys (translations stay in bundles, no editor-must-fill-8-locales burden).

7. **`activeRegionConfig` is currently a switch on event tags** (`frontend/src/lib/optinAbRegions.ts:findActiveRegion`). After this lands, the entire region-routing logic for the combined opt-in can be derived from config — but `setCombinedOptIn`'s knowledge of "which SWC field maps to which region" still has to live somewhere. **Easiest: each `rsvp_checkbox` row that participates in the combined opt-in declares its membership via a `combined_group: 'pizzadao_partners'` column. The combined-renderer selects all rows in the same group whose render conditions evaluate true.**

8. **Two frontend entry points wrap `useRSVPForm`:** `frontend/src/pages/RSVPPage.tsx` and `frontend/src/components/RSVPModal.tsx`. Both go through `useRSVPForm`. **The config fetch lives in the hook, not in the page/modal,** so both entry points get it for free.

9. **`linguine-83104` is still only a plan as of master tip** (commit `8c26be90`). If linguine ships first, every event already renders one checkbox (combined or mailing-list-only). If lasagna ships first, the linguine logic can become "render whatever config returns." Either ordering works; write the plan assuming linguine has shipped (simpler model), and call out the small adjustment if it hasn't.

## Storage design

### Recommended: dedicated `rsvp_checkboxes` table (per-row), NOT a JSON blob

Per-row gives:
- easy admin editing later (one row per checkbox in a CRUD UI; columns are typed),
- atomic single-checkbox edits via standard SQL,
- query-friendly tag matching via array operators,
- consistency with the survey-config precedent (`pugliese-58297`).

Single JSON in `app_config` would force the renderer to fetch and parse a blob on every form mount; partial edits (just retag one checkbox) become read-modify-write hazards under concurrent admin edits.

### Schema

One migration, one new table, no Prisma-side renames or `guests` changes.

```sql
-- One row per renderable checkbox. v1 ships 8 global rows (party_id IS NULL).
-- Per-event override rows MAY be added later (party_id REFERENCES parties(id));
-- when present, they take precedence over the global row with the same `id`.
CREATE TABLE rsvp_checkboxes (
  -- Composite primary key: a checkbox handle is global (party_id=null) OR scoped to one party.
  id                 text NOT NULL,                   -- stable handle: 'mailing_list','swc_us','swc_ca','swc_au','swc_eu','swc_uk','swc_br','ethconf', or future custom IDs
  party_id           text REFERENCES parties(id) ON DELETE CASCADE, -- NULL = global default; non-null = override for one event
  position           int  NOT NULL,                   -- render order on the form
  active             boolean NOT NULL DEFAULT true,   -- soft-disable without delete (set to false to hide everywhere)

  -- Render condition
  required_tags      text[] NOT NULL DEFAULT '{}',    -- render only if event.event_tags @> any of these (OR semantics across array)
  excluded_tags      text[] NOT NULL DEFAULT '{}',    -- never render if event has any of these tags
  always_show        boolean NOT NULL DEFAULT false,  -- if true, ignore required_tags (used for mailing_list, which renders on every event)

  -- Destination columns this checkbox writes to (1..N entries, all must be in the backend WHITELIST: see admin PATCH validation)
  opt_in_fields      text[] NOT NULL,                 -- e.g. ['mailingListOptIn'], or ['mailingListOptIn','swcOptIn'] for combined
  combined_group     text,                            -- nullable; rows sharing a non-null group render as ONE combined checkbox

  -- Label copy
  label_i18n_key     text,                            -- e.g. 'step1.combinedOptIn' — preferred when present
  label_default      text,                            -- fallback English literal if i18n key missing/unresolved
  label_overrides    jsonb NOT NULL DEFAULT '{}',     -- optional per-locale literal overrides: {"pt":"...","de":"..."} — beats both above for those locales

  -- Optional info modal
  info_modal_i18n_ns text,                            -- e.g. 'swcModal' — if set, render the (i) button; modal pulls {ns}.title / {ns}.description / {ns}.privacyPolicy / {ns}.{termsKey} unless overridden by modal_overrides
  info_modal_privacy_url text,                        -- only used if info_modal_i18n_ns set OR modal_overrides supplies privacy text/url
  info_modal_terms_url   text,                        -- only used if info_modal_i18n_ns set OR modal_overrides supplies terms text/url
  info_modal_terms_key   text,                        -- 'termsConditions' or 'termsOfService' — chooses sub-key inside the i18n namespace
  modal_overrides    jsonb NOT NULL DEFAULT '{}',     -- per-locale + per-field modal copy overrides. Shape: {"en":{"title":"...","description":"...","privacyPolicy":"Privacy Policy","termsConditions":"Terms","privacyUrl":"https://...","termsUrl":"https://..."},"pt":{...}}. Any field not provided falls back to i18n namespace / info_modal_*_url columns. Empty {} means use i18n bundle entirely.

  -- Theme accent for the checkbox color (matches today's red for mailing-list, purple for SWC)
  accent_color       text NOT NULL DEFAULT 'red',     -- 'red' | 'purple' — frontend whitelist; unknown values fall back to red

  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text,

  PRIMARY KEY (id, party_id)                          -- one global row per id; optional per-party overrides keyed by (id, party_id)
);

-- Lookup index for the renderer: fetch global rows + the override rows for ONE party at a time.
CREATE INDEX rsvp_checkboxes_global_idx  ON rsvp_checkboxes (active, position) WHERE party_id IS NULL;
CREATE INDEX rsvp_checkboxes_per_event_idx ON rsvp_checkboxes (party_id, id) WHERE party_id IS NOT NULL;

-- Column-level public read of the fields the form needs. updated_at / updated_by stay admin-only.
GRANT SELECT (
  id, party_id, position, active, required_tags, excluded_tags, always_show,
  opt_in_fields, combined_group,
  label_i18n_key, label_default, label_overrides,
  info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
  modal_overrides, accent_color
) ON rsvp_checkboxes TO anon, authenticated;

ALTER TABLE rsvp_checkboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read rsvp checkboxes"
  ON rsvp_checkboxes FOR SELECT
  USING (true);

-- (no INSERT / UPDATE / DELETE grants — service_role only, via backend admin endpoint)
```

### Per-event override semantics

- Renderer fetches **two** sets of rows per RSVP page load:
  1. All `active=true` rows with `party_id IS NULL` (global config) — cached at module level, same fetch for every page in the session.
  2. All `active=true` rows with `party_id = <current event id>` (override) — fetched per event.
- For each `id`, an override row supersedes the global row entirely (no field-level merge — simpler, predictable).
- **GPP events (`eventType === 'gpp'`) are not editable from the host-facing UI** — admin UI still allows it, and direct DB edits work, but the host UI (deferred to phase 2 — see §Out of scope) won't expose the editor for GPP. The data model imposes no restriction.

### Seed: 8 rows mirroring today's hardcoded behavior

Same migration file. The exact seed data:

| id | position | always_show | required_tags | opt_in_fields | combined_group | label_i18n_key | info_modal_i18n_ns | privacy_url | terms_url | terms_key | accent |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `mailing_list` | 10 | true | `{}` | `{mailingListOptIn}` | `pizzadao_partners` | `step1.mailingList` | null | null | null | null | red |
| `swc_us` | 20 | false | `{swc}` | `{swcOptIn}` | `pizzadao_partners` | `step1.swcJoin` | `swcModal` | `https://www.standwithcrypto.org/privacy` | `https://www.standwithcrypto.org/terms-of-service` | `termsConditions` | purple |
| `swc_ca` | 21 | false | `{swccanada}` | `{swcCaOptIn}` | `pizzadao_partners` | `step1.swcNotify` | `swcCaModal` | `https://www.standwithcrypto.org/ca/privacy` | `https://www.standwithcrypto.org/ca/terms-of-service` | `termsOfService` | purple |
| `swc_au` | 22 | false | `{swcau}` | `{swcAuOptIn}` | `pizzadao_partners` | `step1.swcNotify` | `swcAuModal` | (au privacy) | (au terms) | `termsOfService` | purple |
| `swc_eu` | 23 | false | `{swceu}` | `{swcEuOptIn}` | `pizzadao_partners` | `step1.swcNotify` | `swcEuModal` | (eu privacy) | (eu terms) | `termsOfService` | purple |
| `swc_uk` | 24 | false | `{swcuk}` | `{swcUkOptIn}` | `pizzadao_partners` | `step1.swcNotify` | `swcUkModal` | (uk privacy) | (uk terms) | `termsOfService` | purple |
| `swc_br` | 25 | false | `{swcbr}` | `{swcBrOptIn}` | `pizzadao_partners` | `step1.swcBrNotify` | `swcBrModal` | (br privacy) | (br terms) | `termsOfService` | purple |
| `ethconf` | 30 | false | `{ethconf}` | `{ethconfOptIn}` | `pizzadao_partners` | `step1.ethconfDiscount` | null | null | null | null | red |

Notes:
- All `combined_group='pizzadao_partners'` so the combined renderer (post-linguine-83104) merges them into one checkbox per event.
- `mailing_list.always_show=true` means it participates in the combined group on every event; the SWC rows only join when their tag is present.
- `ethconf` also joins the combined group on events tagged `ethconf` (mirrors today's `setCombinedOptIn` behavior at `useRSVPForm.ts:189–199`).

### Combined opt-in: how the renderer derives the combined checkbox from config

For each event:

1. Frontend fetches **all** active config rows (one query, anon-readable).
2. Filter to rows that pass `(always_show=true OR required_tags ∩ event.tags ≠ ∅) AND (excluded_tags ∩ event.tags = ∅)`.
3. Group filtered rows by `combined_group`:
   - rows with `combined_group=null` render as one independent checkbox each.
   - rows with the same non-null `combined_group` render as **one** combined checkbox whose:
     - label = the label of the row with the lowest `position` in the group whose `label_i18n_key='step1.combinedOptIn'`, falling back to the lowest-position row's label. (Equivalent: pre-pick one row as the "spokesperson" — simplest is the lowest-position row with `always_show=true`, which is `mailing_list`.) **Simpler rule: spokesperson = lowest-position row in the group, and that row's label MUST be `step1.combinedOptIn` for combined-group rows. Seed enforces this by giving `mailing_list.label_i18n_key='step1.combinedOptIn'` and `mailing_list.position=10` (lowest in group).**
     - info modal = the spokesperson's info modal config; if `mailing_list` is spokesperson and has none, fall back to whichever in-group row has `info_modal_i18n_ns` set (e.g. on SWC events, the SWC row's modal).
     - on click, toggle all rows' `opt_in_fields` together (mirrors today's `setCombinedOptIn`).

**Important seed adjustment:** Update `mailing_list.label_i18n_key` to `step1.combinedOptIn` in the seed when there's at least one other row in the group active for the event. The simplest implementation: spokesperson label is `step1.combinedOptIn` if `>1 row in group`, else `step1.mailingList`. Frontend derives this — config stays declarative.

Alternatively (cleaner): introduce a `label_when_grouped_i18n_key` column. But that's complexity for one edge case; spend it only if needed.

### Why per-locale literal overrides instead of just i18n keys?

- Snax can add a brand-new checkbox (e.g. "Send me updates from Pizza Hut") without any deploy by setting `label_default='Send me updates from Pizza Hut'` and skipping `label_i18n_key`.
- Existing checkboxes keep using their i18n keys, so translations remain in version-controlled bundles. No "config edit forces a re-translation" burden.
- `label_overrides` is the escape hatch for partial overrides (e.g. urgent label tweak in 2 locales).

## Frontend rendering strategy

### Fetch + cache

- New hook: `frontend/src/hooks/useRsvpCheckboxConfig.ts`. Single Supabase query on mount: `supabase.from('rsvp_checkboxes').select('…all readable columns…').eq('active', true).order('position')`.
- Module-level promise cache (NOT React Query — not in repo dependencies; mirror the `getExperimentFlag` direct-supabase pattern). Cache the promise so multiple components calling the hook in the same page hit the same fetch.
- Cache key: none (one config set for the whole app). TTL: lifetime of the JS module (i.e. one fetch per session). For staleness recovery, expose a `refresh()` function for the admin UI; not used in v1.
- Loading state: while in-flight, the form renders with **zero checkboxes**. This is intentionally conservative — better to show no opt-in than to flash the wrong one. The fetch takes < 200ms warm; cold-start adds < 500ms on top of existing form load.
- Failure state: if the fetch errors, fall back to a **hardcoded baseline config** baked into the hook (the same 8 rows the seed inserts). This is the survey-config precedent — keeps RSVP alive even if the new table goes sideways. Log to console; don't surface to the user.

### Renderer changes

- `RSVPFormStep1.tsx`: delete the 9 hardcoded checkbox blocks (combined block + standalone mailing list + 6 SWC blocks + ETHConf block). Replace with a `<CheckboxRenderer config={config} form={form} eventTags={eventData.eventTags} />` component that:
  1. Filters config rows by tag rules.
  2. Groups by `combined_group`.
  3. For each rendered checkbox (combined or standalone), wires its onClick to update **all** `opt_in_fields` listed on the row(s) in the group.
  4. If `info_modal_i18n_ns` is set, renders the (i) button + portal modal using the existing `createPortal` pattern from the current file (extract once, reuse 7×).
  5. Resolves label as: `label_overrides[currentLocale]` if present → else `t(label_i18n_key)` if key resolves → else `label_default` if present → else hide the row (log warning).

- `useRSVPForm.ts`: keep all eight `*OptIn` state slots and setters (they're the canonical state). Add a **single generic** `setOptInByField(fieldName: string, value: boolean)` helper that switches on the field name string and calls the appropriate setter. Keep `combinedOptIn` / `setCombinedOptIn` for the preservation branch only (delete callers in the new renderer path).
- The renderer calls `setOptInByField(fieldName, value)` for each field in the checkbox's `opt_in_fields` array. No more switch-on-region in the hook.

### Locale handling

- Resolution order (per render):
  1. `label_overrides[i18n.language]` — explicit per-locale literal
  2. `t(label_i18n_key)` — bundled translation (existing path)
  3. `label_default` — English fallback literal
- Same resolution for info-modal title/description/privacyPolicy/termsKey if a `modal_overrides` JSON column is added later. **V1: keep modal copy bundled (i18n keys only); admin can change the URL via config but not the description.** This is a deliberate scope cut; adding modal_overrides later is a one-column-add migration.

### Preservation branch

- Keep a tiny hardcoded "legacy" render path active for one condition only: `activeRegionConfig && optinAbVariant === 'control'`. That branch renders the old two-checkbox layout (mailing-list + the matching regional SWC block). Reuses today's code; will gradually become dead as control-bucket users churn out.

## Backend changes

### Required (small)

- **No new write endpoint needed for the renderer** — anon SELECT covers config reads.
- **No changes to `POST /api/rsvp/:inviteCode/guest`** — backend still accepts the 8 named opt-in flags from the request body and writes to the 8 named columns. The frontend's responsibility is to set the right flags before submit; the backend stays config-agnostic.
- **One server-side validation hardening:** add an allowlist check that `opt_in_fields` from any config row must be one of the 8 known fields. This belongs in a config-loader on the **admin write endpoint** (below), not the public read path.

### Admin endpoints (in v1 — shipped with the renderer)

Mirror the experiment-flags pattern at `backend/src/routes/admin.routes.ts:993–1032`:
- `GET    /api/admin/rsvp-checkboxes` — list all rows (active + inactive, global + per-event). Query param `?party_id=<id>` filters to overrides for one event.
- `POST   /api/admin/rsvp-checkboxes` — create a new row. Body validates `opt_in_fields` against a hardcoded backend whitelist (`mailingListOptIn`, `swcOptIn`, `swcCaOptIn`, `swcAuOptIn`, `swcEuOptIn`, `swcUkOptIn`, `swcBrOptIn`, `ethconfOptIn`) and `accent_color` against `{red,purple}`. `party_id` is optional (null = global default).
- `PATCH  /api/admin/rsvp-checkboxes/:id?party_id=<id?>` — update a row identified by composite key (`id`, optional `party_id`). Same field validation as POST. Always stamps `updated_by = req.userEmail`.
- `DELETE /api/admin/rsvp-checkboxes/:id?party_id=<id?>` — hard delete (only legal for non-seeded rows OR per-event overrides; the 8 seeded global rows should be `active=false`'d instead — backend enforces by rejecting DELETE if the row is one of the 8 known global IDs).

All endpoints require `requireAuth + isAdmin(req.userEmail)`. Same pattern as `/funnel-stats` and the OptinAB endpoint.

### Admin UI (in v1 — shipped with the renderer)

New tab on `/admin` (mirrors the existing OptinABTab pattern from arugula-34107):
- `frontend/src/components/admin/RsvpCheckboxesTab.tsx` — table of all global rows + a "show overrides for event…" picker.
- For each row: inline-edit position, active toggle, required_tags multi-select, excluded_tags multi-select, opt_in_fields multi-select (from the 8-item allowlist), combined_group text, label_i18n_key / label_default / label_overrides JSON editor, info_modal_*  fields, modal_overrides JSON editor, accent_color dropdown.
- "+ New checkbox" button → modal with the same fields (must pick an `opt_in_field` from the whitelist).
- "Reset to defaults" button per row (PATCH with the seed values from a static frontend constant).
- Edits are sent to the admin endpoints; on save, the renderer cache is invalidated for the next page mount (refresh button surfaces in the tab too).
- **GPP carve-out:** the admin UI works for all events including GPP. The carve-out only affects the **host-facing** editor (deferred to phase 2 / future PR), which won't expose this UI to GPP hosts.

## Migration strategy: parity-first cutover

Goal: zero behavior change at the moment of deploy. After deploy, Snax can edit a row in Supabase and see it reflected within the same session.

### Sequence

1. **Migration applied to prod** — creates `rsvp_checkboxes` table + seeds 8 global rows (`party_id IS NULL`) mirroring today's hardcoded behavior **exactly** (URLs, i18n keys, tags, fields, accent colors). Seed values are checked into the migration file; no manual DB intervention needed.
2. **Backend deploy** — new admin endpoints land here (`GET/POST/PATCH/DELETE /api/admin/rsvp-checkboxes`). RSVP submit path is unchanged.
3. **Frontend deploy** — renderer flips on as the only path. **No kill-switch flag** (Snax accepts the risk; hardcoded-fallback-in-hook covers the "DB fetch failed" case, which is the dominant failure mode).

### Parity verification (must run before frontend deploy)

For each of the 6 SWC regions + ETHConf + a non-SWC event:
- Load `/rsvp/<slug>` in incognito, take screenshot of the rendered checkbox stack.
- Compare visually to the same URL on the previous deploy. Spec: identical labels, identical (i) info modals, identical render order, identical accent colors.
- Submit one RSVP per case and verify the same DB columns get `true` as before (test in dev/preview against a sandbox event).

If parity fails for any case, fix the config row(s) in Supabase and re-test before merging.

### Cleanup PR (v1.1, after one week of clean operation)

Delete:
- The hardcoded checkbox blocks in `RSVPFormStep1.tsx` (the renderer is now the only path; preservation branch stays).
- `frontend/src/lib/optinAbRegions.ts` — `REGIONAL_OPTIN_AB` array (config table is the source of truth). `findActiveRegion` may keep one tag-match utility if anywhere else uses it; check via grep before deletion.

The preservation branch stays for now (until OptinAB analytics confirm no more `control` re-submits, which Snax can verify from the admin OptinAB tab).

## Step-by-step implementation order

1. **Migration `supabase/migrations/<ts>_rsvp_checkboxes.sql`** — create table, indexes, GRANT, RLS policy, insert 8 global seed rows (`party_id IS NULL`).
2. **Apply migration to prod** before backend or frontend deploys.
3. **Frontend type** — add `RsvpCheckboxConfig` interface in `frontend/src/types/` or inline in the new hook. Mirror the columns 1:1.
4. **Hook `frontend/src/hooks/useRsvpCheckboxConfig.ts`** — Supabase select with two fetches: global (`party_id IS NULL`, cached at module level) + per-party (passed as a hook argument). Hardcoded fallback constant (same 8 seed rows written as a TS array) returned if the global fetch errors. Returns `{ config, loading, error }`.
5. **Renderer component `frontend/src/components/RsvpCheckboxList.tsx`** — accepts `config`, `form` (`useRSVPForm` return), `eventTags`. Does the filter → group → render pipeline. One renderer for both standalone and combined checkboxes.
6. **Wire renderer into `RSVPFormStep1.tsx`** — replace the hardcoded blocks with `<RsvpCheckboxList ... />` (preservation branch kept as a separate conditional sibling). Pass `eventData.id` to the hook so per-event overrides apply.
7. **Hook helper in `useRSVPForm.ts`** — add `setOptInByField(field: string, value: boolean)` that maps field-name strings to the existing 8 setters. Export it.
8. **Backend admin routes** — `backend/src/routes/admin.routes.ts`: add `GET/POST/PATCH/DELETE /api/admin/rsvp-checkboxes` per §"Admin endpoints". Hardcoded whitelist constant for `opt_in_fields`. Reject DELETE on the 8 seeded global IDs (force soft-disable instead).
9. **Frontend API client** — `frontend/src/lib/api.ts`: add `listRsvpCheckboxes`, `createRsvpCheckbox`, `updateRsvpCheckbox`, `deleteRsvpCheckbox`.
10. **Admin UI** — `frontend/src/components/admin/RsvpCheckboxesTab.tsx`. Wire into the existing tab strip on `/admin` (look at OptinABTab placement at `AdminPage.tsx` for the pattern). Table view + inline edit + "+ New" modal + per-party-override picker.
11. **TSC + build clean** both sides.
12. **Parity check on a dev event** for every SWC region + ETHConf + a vanilla event (compare screenshots vs. linguine-83104 master).
13. **PR with the deploy ordering warning** in the body: migration → backend → frontend, applied in that sequence.
14. **Post-deploy verification** — RSVP in incognito on 3 prod events (one US SWC, one non-SWC, one ETHConf); confirm correct columns flip in Supabase. Then run the "win-condition test" SQL (see below) and confirm the label changes without a deploy.

## Verification / test plan

### Unit / type-safety

- Hook returns hardcoded fallback when supabase throws (mock the client, throw, expect fallback array).
- Renderer filter logic: given tags `['swcuk']` and the 8-row config, produces exactly `{mailing_list, swc_uk, ...maybe ethconf}` filtered set in order.
- Combined-group logic: given two rows in the same group, produces one rendered checkbox whose onClick toggles both fields.
- Resolution order: row with `label_overrides={'pt':'Foo'}` and `label_i18n_key='step1.x'` renders `'Foo'` in pt locale and `t('step1.x')` in en locale.

### Manual parity QA

Spell out the exact event slugs to load (use known SWC test events from each region in dev/preview). For each:
- screenshot before vs. after
- diff checkbox order, labels, info modal contents, accent colors
- RSVP and confirm correct guest row columns post-submit

### The win-condition test (do this AFTER ship)

```sql
UPDATE rsvp_checkboxes
   SET label_default = 'Get the PizzaDAO weekly slice update',
       label_overrides = '{}'::jsonb,
       label_i18n_key = null
 WHERE id = 'mailing_list';
```

Wait < 1 session (or reload page). Confirm the next form-mount in a fresh browser shows the new label in **every** locale. No PR, no deploy, no merge. **This is the proof the refactor worked.**

## Decisions made (2026-06-05)

1. **Per-event override:** data model supports it via `(id, party_id)` composite PK. Admin UI exposes the editor for all events. Host-facing editor is deferred to a future PR; when shipped, it will be hidden for GPP events (hosts of GPP events can't change checkboxes).
2. **Modal copy editable via DB:** `modal_overrides JSONB` column in v1 — full per-locale modal title/description/url override.
3. **Kill switch:** none. Hardcoded fallback in `useRsvpCheckboxConfig` covers the DB-fetch-failed path.
4. **Admin CRUD UI:** in v1, bundled with the renderer. New `/admin` tab `RsvpCheckboxesTab` + backend admin endpoints.
5. **Combined-group spokesperson rule:** lowest-position row in group. `mailing_list` always wins because it's `always_show=true` + `position=10`. No new column needed.
6. **Locale resolution:** silently fall back to `label_default` (option a) — don't surface raw i18n keys to users.

## Out of scope (explicitly)

- **Adding a 9th destination column without a deploy** — fundamentally requires Prisma + backend + frontend changes; not solvable by config-only. (Backend admin POST validates against the hardcoded 8-field whitelist.)
- **Host-facing editor for per-event overrides** — data model supports it, admin UI exposes it, but the host-facing surface (RSVP form's settings on the HostPage) is deferred. When shipped, must hide the editor for GPP events.
- **Migrating non-checkbox fields** (wallet, dietary, etc.) to DB-driven config — those have richer validation logic; out of scope.
- **Touching the OptinAB analytics tab** — config table is independent of `optin_ab_variant` column.
- **Deleting the preservation branch** — kept until OptinAB control re-submits go to zero.
- **Restructuring `addGuestToParty`'s 21-positional-arg signature** — tempting follow-up but not required for this work. (A future plan should turn it into a single object arg.)

## Files to modify

### New
- `supabase/migrations/<ts>_rsvp_checkboxes.sql` — table, grants, RLS, 8 seed rows, kill-switch flag seed.
- `frontend/src/hooks/useRsvpCheckboxConfig.ts` — fetch + cache + fallback.
- `frontend/src/components/RsvpCheckboxList.tsx` — render pipeline.
- (optional) `frontend/src/components/RsvpCheckboxInfoModal.tsx` — extracted from the duplicated portal modal markup currently 7× inline in `RSVPFormStep1.tsx`.

### Modified
- `frontend/src/components/RSVPFormStep1.tsx` — delete the hardcoded checkbox blocks, render `<RsvpCheckboxList>`, keep preservation branch as a guarded sibling.
- `frontend/src/hooks/useRSVPForm.ts` — add `setOptInByField` generic setter; keep all 8 specific setters + state slots; leave preservation logic intact.
- `frontend/src/lib/optinAbRegions.ts` — leave for now (referenced by preservation branch); cleanup in v1.1.
- `frontend/src/lib/api.ts` — add 4 admin client methods (`list/create/update/delete RsvpCheckbox`).
- `frontend/src/pages/AdminPage.tsx` — add new tab strip entry for "RSVP Checkboxes" and mount `<RsvpCheckboxesTab />`.
- `backend/src/routes/admin.routes.ts` — add 4 admin endpoints + hardcoded `opt_in_fields` whitelist constant.

### New
- `supabase/migrations/<ts>_rsvp_checkboxes.sql`
- `frontend/src/hooks/useRsvpCheckboxConfig.ts`
- `frontend/src/components/RsvpCheckboxList.tsx`
- `frontend/src/components/admin/RsvpCheckboxesTab.tsx`
- (optional) `frontend/src/components/RsvpCheckboxInfoModal.tsx` — extracted modal portal

### Untouched (deliberately)
- `backend/prisma/schema.prisma` — eight `*OptIn` Guest columns stay.
- `backend/src/routes/rsvp.routes.ts` — request body shape unchanged.
- `frontend/src/lib/supabase.ts` — `addGuestToParty` signature unchanged.
- `frontend/src/i18n/locales/*/rsvp.json` — translations remain bundled (config references keys).
