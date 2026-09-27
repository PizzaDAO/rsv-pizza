# White-Label / Brand Config — implementation plan

**Status:** proposed (no white-label work exists yet as of 2026-09-27)
**Goal (Phase 1–3):** deploy the app under a *different brand* (name, domain, logo,
colors, email from-address) with **no code edits** — brand comes from config +
env vars. **Non-goal (for now):** true multi-tenant (many brands off one
DB/deploy) — that's Phase 5, sketched but not committed.

Grounding audit (2026-09-27): branding is scattered, not centralized —
~184 `rsv.pizza`, ~188 `PizzaDAO`, ~91 `RSV.Pizza`, ~23 `noreply@rsv.pizza`,
Supabase project id `znpiwdvvsqaxuskpfleo` in 7+ files. BUT good bones already
exist: tokenized CSS theme (`frontend/src/index.css` `:root` + a working second
theme `.gpp-theme` at ~L421), `VITE_SUPABASE_URL` / `VITE_API_URL` already
env-driven (`frontend/src/lib/supabase.ts`), i18n, and React Helmet for per-page
meta.

---

## Model: single-tenant-per-deploy, config-driven

One brand per Vercel project + Supabase project (same as today). "White-label" =
every brand-specific value is read from a **frontend brand config** and
**backend env vars**, defaulting to RSV.Pizza so nothing changes for prod.

Two sources of truth:
- **Frontend:** `frontend/src/config/brand.ts` — a typed `BRAND` object populated
  from `import.meta.env.VITE_BRAND_*`, with RSV.Pizza defaults. One import used
  everywhere instead of literals.
- **Backend:** `backend/src/config/brand.ts` — reads `process.env.BRAND_*`
  (name, domain, from-address, support email), RSV.Pizza defaults.

Build-time config (Vite inlines `VITE_*`) is sufficient because each brand is its
own deploy. No runtime tenant lookup needed until Phase 5.

---

## Phase 0 — Guardrail (½ day)

Prevent *new* hardcoded branding from landing while we migrate.

- Add `scripts/check-no-hardcoded-brand.js` (mirrors the existing
  `scripts/check-rls-on-new-tables.js` / `check-schema-drift.js` pattern): scan
  **added** lines in a PR diff for `rsv\.pizza`, `RSV\.Pizza`, `PizzaDAO`,
  `noreply@rsv\.pizza`, `znpiwdvvsqaxuskpfleo` outside an allowlist
  (`brand.ts`, the `.env.example`s, this plan, `plans/`, i18n source strings).
- Wire `.github/workflows/brand-check.yml` on PRs touching `frontend/src` /
  `backend/src`. Fail with a message pointing at `brand.ts`.
- Allowlist current offenders so it only blocks *new* ones; burn the list down as
  phases land.

**Exit:** CI blocks new hardcoded brand strings.

---

## Phase 1 — Config scaffolding + env plumbing (2–3 days)

Create the config modules and the env surface; no call-sites migrated yet.

- `frontend/src/config/brand.ts`:
  ```ts
  export const BRAND = {
    name: import.meta.env.VITE_BRAND_NAME ?? 'RSV.Pizza',
    tagline: import.meta.env.VITE_BRAND_TAGLINE ?? 'Pizza Party Planner',
    domain: import.meta.env.VITE_BRAND_DOMAIN ?? 'rsv.pizza',
    url: `https://${import.meta.env.VITE_BRAND_DOMAIN ?? 'rsv.pizza'}`,
    logoUrl: import.meta.env.VITE_BRAND_LOGO_URL ?? '/logo.png',
    ogImageUrl: import.meta.env.VITE_BRAND_OG_IMAGE ?? '/logo.png',
    supportEmail: import.meta.env.VITE_BRAND_SUPPORT_EMAIL ?? 'help@rsv.pizza',
    themeClass: import.meta.env.VITE_BRAND_THEME_CLASS ?? '', // '' = default :root theme
  } as const;
  export const brandUrl = (path = '') => `${BRAND.url}/${path.replace(/^\/+/, '')}`;
  ```
- `backend/src/config/brand.ts`: `name`, `domain`, `apiDomain`, `fromEmail`
  (`` `${name} <${noreplyEmail}>` ``), `noreplyEmail`, `supportEmail` — from
  `process.env.BRAND_*` with RSV.Pizza defaults.
- Fix the storage prefix: `frontend/src/lib/supabase.ts:29` derive
  `SUPABASE_STORAGE_PREFIX` from `VITE_SUPABASE_URL` instead of the literal
  `znpiwdvvsqaxuskpfleo.supabase.co`.
- Extend `frontend/.env.example` and `backend/.env.example` with the new
  `VITE_BRAND_*` / `BRAND_*` keys (documented, RSV.Pizza values as examples).

**Exit:** config modules importable; storage prefix env-derived; `tsc` clean.

---

## Phase 2 — Migrate call-sites via codemod (3–5 days)

Replace literals with config references. Scope (from the audit):

1. **Frontend URLs** (`~184` `rsv.pizza`): replace hand-built
   `` `https://rsv.pizza/${slug}` `` with `brandUrl(slug)`. Hotspots:
   `pages/EventPage.tsx`, `HomePage.tsx`, share/copy-link helpers.
2. **`frontend/index.html`** — the head is static so Vite can't inline runtime
   values cleanly. Two options (pick in review):
   - (a) `vite-plugin-html` / a small `transformIndexHtml` plugin injecting
     `VITE_BRAND_*` at build; or
   - (b) move title/OG/twitter tags into a top-level `<Helmet>` (Helmet is
     already used per-event) and leave `index.html` with neutral placeholders.
   Covers title, `og:*`, `twitter:*`, `favicon`, `og:image`.
3. **Brand name / tagline strings** (`~91` `RSV.Pizza`) → `BRAND.name` /
   i18n keys. Header, Footer, CheckInPage, Partners, meta.
4. **Logo/asset refs** → `BRAND.logoUrl` (Header, Footer, CheckIn, Partners).
5. **Backend email from-address** (`~23`): replace
   `'RSV.Pizza <noreply@rsv.pizza>'` with `brand.fromEmail` across the email
   services (`partyStatusEmailNotify.ts`, `hostTelegramEmail.ts`,
   `hostSurveyEmail.ts`, payout/invoice emailers). Replace `rsv.pizza/{slug}`
   links in templates with `brand.url`.
6. **"PizzaDAO" org name** (`~188`): audit-then-replace. NOTE many are
   *legitimately* PizzaDAO (the org that runs this instance), not brandable
   chrome — do NOT blanket-replace. Split into "brand chrome" (→ `BRAND.name`)
   vs "the operating org" (leave, or a separate `BRAND.orgName`).

Approach: write a `scripts/codemod-brand.mjs` (jscodeshift or ts-morph) for the
mechanical URL/string swaps; hand-review #2 and #6. Land in reviewable slices
(URLs, then emails, then chrome) — not one mega-PR. Burn down the Phase-0
allowlist as each slice merges.

**Exit:** `rg` shows brand literals only in `brand.ts` + i18n + allowlist;
prod still renders identically (defaults unchanged).

---

## Phase 3 — Theme per brand (1–2 days)

The token system already supports this (`.gpp-theme` is a live precedent).

- Add a brand theme class in `index.css` (e.g. `.brand-theme { --bg-main…
  --accent… }`) OR generate it from `VITE_BRAND_*` color vars via a tiny inline
  `<style>` that sets the `--accent`/`--bg-*` custom properties at `:root`.
- Apply `BRAND.themeClass` at the app root (`Layout.tsx` `ThemeProvider`) so the
  whole app themes from one env var.
- Swap logo/favicon assets per brand (env URL → CDN, or per-deploy `public/`).

**Exit:** setting `VITE_BRAND_THEME_CLASS` (or color vars) restyles the app with
no code change.

---

## Phase 4 — Second-brand deploy playbook (1 day)

- Doc `docs/whitelabel-deploy.md`: stand up new Supabase project (run migrations),
  new Vercel project, set `VITE_BRAND_*` + `BRAND_*` + `VITE_SUPABASE_*` +
  `VITE_API_URL` + `ALLOWED_ORIGIN`, point DNS (per the `~/Code/namecheap`
  playbook), configure Resend from-domain for the new `noreply@`.
- Dry-run with a throwaway brand on a preview to validate zero code edits.

**Exit:** a second brand runs end-to-end from config alone.

---

## Phase 5 — (Deferred) true multi-tenant + de-pizza-ing the model

Only if the product needs many brands off shared infra. Big; not scheduled.
- `tenants` table + `tenant_id` on all rows + RLS per tenant (leverage the RLS
  discipline from `20260924_taxform_rls_lockdown` + the new CI guard).
- Runtime brand resolution by host header (middleware) instead of build-time env.
- Domain rename for non-pizza verticals: `Party→Event`, `Topping→Option`,
  `Beverage→…`, `Pizzeria→Vendor` across `schema.prisma`, `types.ts`, OCR
  pipeline, RSVP UX. This is the expensive part — the data model is pizza-native.

---

## Effort summary

| Phase | Scope | Est. |
|---|---|---|
| 0 | CI guard vs new hardcoding | ½ day |
| 1 | Config modules + env + storage-prefix fix | 2–3 days |
| 2 | Codemod call-sites (URLs, emails, chrome) | 3–5 days |
| 3 | Per-brand theming | 1–2 days |
| 4 | Deploy playbook + dry run | 1 day |
| **1–4 total (cosmetic white-label)** | | **~2–3 weeks** |
| 5 | Multi-tenant + de-pizza model | not scheduled (major) |

## Risks / decisions to make
- **index.html strategy** (build-time inject vs Helmet) — decide in Phase 2.
- **"PizzaDAO" is dual-meaning** — brand chrome vs operating org; needs human
  triage, don't automate.
- Preview deploys share prod backend+DB (CLAUDE.md) — brand env must be set at
  the Vercel *project* level so previews inherit the right brand.
- Keep RSV.Pizza defaults everywhere so prod is a no-op until a brand opts in.
