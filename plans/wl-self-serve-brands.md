# wl-self-serve-brands: partners customize their own brand

Read from `origin/master` @ `a036aac0` (2026-11-17). **Supersedes and folds in
`plans/wl-custom-domain-email.md`** (called "the domain plan" below). Its §1 findings, §2.1-§2.5
design, §3 DNS sheet and §5 risks still hold unless this file says otherwise. Its PR 1-4 are kept
(renumbered here). Its PR 5 runbook script is replaced by a backend domain service plus a guided UI
(PR 16), with the script kept as a thin CLI over the same lib.

## Goal

A white-label partner's own admin can change their brand without PizzaDAO help:
- name, logo, favicon, OG image, colors, fonts, tagline and meta, with no redeploy
- host checklist, event approvals and new-event alerts
- sender name and reply-to; custom site domain and email domain, with guided DNS status
- flyer art on a standard template

The super-admin still owns who the brand admins are and every global or money setting.
rsv.pizza must stay byte-identical through every PR.

Non-goals:
- Partners writing CSS, or making bespoke flyer templates. Those stay code.
- Partners creating new series.
- Payouts and funding-wallet custody.

---

## 1. Findings (today, origin/master)

### Brand identity is build-time
- `frontend/src/config/brand.ts` builds a `BRAND` const from `VITE_BRAND_NAME / DOMAIN / LOGO_URL
  / FAVICON_URL / OG_IMAGE / TAGLINE / DESCRIPTION / SUPPORT_EMAIL / THEME_CLASS / SERIES_SLUG`.
  Many modules read it at module eval:
  - `brandScope.ts`: `IS_SERIES_SCOPED`, `BRAND_FEATURES`
  - `BrandHelmet.tsx`: computes title and OG at module scope
  - `lib/api.ts`: `seriesSlug` query params
- `frontend/vite.config.ts` `brandIndexHtml()` string-replaces the title, description, OG,
  twitter and favicon literals in `index.html` at build time.
- `frontend/middleware.ts` (Edge) does two jobs:
  - The `SITE_PASSWORD` gate. It is per Vercel project, and the cookie is an HMAC of the password.
    `OPEN_FILES` is a hardcoded list of `/brands/<slug>/*.png` paths.
  - Crawler-only OG rewriting for `/:slug` event pages. It reads
    `VITE_BRAND_DOMAIN`/`VITE_BRAND_NAME` from env and **skips `/`**, so home-page crawler meta
    comes only from the build-time `index.html`.
- `frontend/api/event/[slug].ts` is a second OG function that reads the same env. **No rewrite in
  `vercel.json` routes to it.** Only `__tests__/anon-columns.test.ts` reads it, so it looks dead.
  (Plan: retire it in PR 7, or make it host-aware if Snax knows a caller. See Q9.)
- Hard-coded brand branches still in code:
  - `App.tsx:101-131`: font `<link>` per theme class (Nunito, Inter + JetBrains Mono, Satoshi,
    Kanit).
  - `Header.tsx:63`: monad dark-logo swap.
  - `SeriesLandingPage.tsx:160`: a doge-only hero.

### Themes are hand-written CSS
- They live in `frontend/src/index.css` (about 1678 lines).
- Selector lines per theme: `.team1-theme` 41, `.monad-theme` 92, `.doge-theme` 90,
  `.swc-theme` 88.
- Each theme is token overrides (`--bg-*`, `--text-*`, `--stroke-*`, `--accent*`,
  `--color-scheme`) plus a lot of structural CSS:
  - remaps of hard-coded `text-white/*` and `bg-white/*` utilities for light themes
  - inputs, modals, the Google Places dropdown, status hues
  - header and logo hiding
  - decorative flourishes: team1 red glow, monad dot grid and SVG hero art, doge side rules and
    framed Doge, swc lavender wash
- The light-theme remap blocks are close to copies across monad, doge and swc.

### Assets, flyers and series config
- Assets live in `frontend/public/brands/<slug>/` (logo, favicon, og, flyer/*-template.png), and
  are listed by hand in `OPEN_FILES`.
- Flyers:
  - Code configs (`components/generative/configs/*PosterConfig.ts` / `*RollupConfig.ts`) are
    registered in `configs/flyerTemplates.ts`, keyed by `event_series.flyer_template_key`.
  - `useSeriesFlyerTemplate.ts` resolves the key via `/api/series`.
  - A brand template is a `POSTER_CONFIG` spread with `templatePath` / `fullResUrl` pointing at a
    baked PNG, plus text, QR and sponsor-box geometry.
- `event_series` (Prisma `EventSeries`) holds `theme_class, logo_url, og_image_url,
  flyer_template_key, site_url, brand_name, create_flow, name_template`, event defaults,
  `require_approval` (the party RSVP-approval default), photo and guest toggles,
  `funding_wallet_address` and dates. The checklist is `checklist_defaults.series_id`.
- Only super-admins can edit it, at `/api/admin/series` (`admin-series.routes.ts`,
  `requireSuperAdmin` on the whole router) and the frontend `AdminSeriesPage`.
  - `/admin/series` is in `GPP_ONLY_PATHS`, so it redirects away on brand sites.
  - **`PATCH`/`DELETE /checklist/:defaultId` does not check which series the default belongs to.**
    That's fine for a super-admin, but must not be copied into brand-admin routes.
- Public reads go through `series.routes.ts` `PUBLIC_SELECT`/`toPublic` (no `internalTags`).
  `event_series` is RLS-locked and backend-only.

### Roles
- `admins` table: `role` in `admin | super_admin | payment_admin` (`middleware/auth.ts`
  `isAdmin/isSuperAdmin/isPaymentAdmin`). They are looked up by JWT email on every request.
- Underbosses (`underbosses` table plus `middleware/underbossAuth.ts`, `helpers/underbossScope.ts`)
  are scoped by GPP **region/city** and parsed from "Global Pizza Party {City}" names. They are
  not series-aware: the underboss model doesn't fit brand events.
- Brand events are created with `underbossStatus='pending'`. A super-admin approves them at
  `/admin/series` (`PATCH /:id/events/:partyId/status`, audited via `writeStatusAudit(...,
  'admin')`).
- `services/brandEventAdminNotify.ts`:
  - Off unless `BRAND_EVENT_ADMIN_ALERTS=on`.
  - Recipients: `BRAND_EVENT_NOTIFY_EMAILS` csv, otherwise every admin/super_admin.
  - The link is `approvalUrl() = ${brand.url}/underboss` on the main origin.
  - **There's no per-series admin and no per-series recipient list.**
- `helpers/partyAccess.ts` `canUserEditParty`: super-admin, owner, co-host, or GPP global editors.
- There is no generic admin audit table. The existing per-domain ones are `party_status_audit`,
  `reimbursement_cap_audit`, `app_config_audit` and `payout_audit`.

### Uploads and storage
- Pattern to copy: `backend/src/lib/hackathon/media.ts` (private `hackathon-media`):
  1. Signed upload to a `tmp/` path.
  2. The server downloads it, checks size and sniffs magic bytes (`sniffImage`).
  3. It re-uploads to a server-owned final path with an explicit content type, then deletes tmp.
- `sharp` is already a backend dependency (`logoAudit.routes.ts` re-encodes PNGs). Public
  objects are read through the `vercel.json` rewrite `/cdn/:path*` to the Supabase public storage
  URL (same origin, so canvases don't get tainted).
- Rate limits: `express-rate-limit`, and the durable Postgres `auth_rate_events` store
  (`lib/authRateLimit.ts`, tx-scoped advisory locks, pooler-safe).

### Concrete XSS finding (fix in PR 6)
`backend/src/lib/loginCode.ts:33,37` (and `reminder.routes.ts:458`) put `${site.name}` into email
HTML **unescaped**. That is safe today because only super-admins set `brand_name`. Once partners
can set it, it becomes HTML injection in login emails. (`partyStatusEmailNotify.ts` already
escapes.)

### Deploy shape
- rsv.pizza is one Vercel project.
- Each brand is its own project, `rsvpizza-<brand>` (PizzaDAO team), with its own `VITE_BRAND_*`
  and `SITE_PASSWORD`.
- The backend (api.rsv.pizza) and the DB are shared.

---

## 2. Design

### 2.1 Brand admin role (PR 5, PR 6)

**Tables** (one migration, PR 1; all backend-only):

`series_admins`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| series_id | uuid fk event_series on delete cascade | |
| email | text | lowercased, the invited address |
| user_id | uuid null fk users | set on accept |
| role | text | `'owner' \| 'editor'` (CHECK). v1 has the same permissions for both. `owner` is reserved for "may invite editors" later (Q2). |
| status | text | `'invited' \| 'active' \| 'revoked'` (CHECK) |
| alerts_enabled | bool default true | receives new-event alerts |
| invite_token_hash | text null | sha256 of the token. The raw token is emailed once, never stored. |
| invite_expires_at | timestamptz null | 7 days |
| invited_by | text | super-admin email |
| accepted_at, revoked_at, revoked_by | | |
| created_at, updated_at | | |

There is a unique index on `(series_id, email)`.

`series_audit` (append-only)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| series_id | uuid | |
| actor_email | text | |
| actor_kind | text | `'super_admin' \| 'series_admin' \| 'system'` |
| action | text | e.g. `settings.update`, `asset.upload`, `checklist.create`, `event.status`, `admin.invite`, `admin.revoke`, `domain.request`, `domain.cutover`, `revert` |
| changes | jsonb | `{field: {old, new}}` for brand fields. Assets are logged as URLs. Never secrets. |
| snapshot | jsonb null | The full brand-field snapshot *before* the change, so "revert to this" is one click |
| created_at | timestamptz | indexed `(series_id, created_at desc)` |

Every migration does `ENABLE ROW LEVEL SECURITY; REVOKE ALL ... FROM anon; REVOKE ALL ... FROM
authenticated;` (as in `20261117_party_booths`). Both tables are added to
`scripts/anon-no-access-tables.json`. There are no realtime publication changes.

**Access helper**: `backend/src/lib/seriesAccess.ts`
- `requireSeriesAdmin` middleware: needs `requireAuth` first and reads `:seriesId` from params.
  - It passes for a super-admin (`actorKind='super_admin'`).
  - It also passes for a `series_admins` row with `status='active'`, `series_id = :seriesId`, and
    `email = lower(req.userEmail)` (`actorKind='series_admin'`).
  - Otherwise it returns **404** (not 403), so series ids can't be probed.
  - It sets `req.seriesAdmin = {seriesId, actorKind, email}`.
- No caching (one indexed query), so a revoke takes effect on the next request.
- Every brand-admin handler reads `seriesId` **only** from `req.seriesAdmin.seriesId`, never from
  the body. Every child-object lookup (checklist default, party, asset path) re-checks
  `child.seriesId === req.seriesAdmin.seriesId` inside the same query (`where: {id, seriesId}`).
- Plain `admin` (not super) does **not** get brand-admin powers. That matches today:
  `/api/admin/series` is super-admin only.

**Invite and accept flow**
1. A super-admin, on `AdminSeriesPage` (new "Brand admins" section), runs
   `POST /api/admin/series/:id/admins {email, role}`:
   - It creates the row (or re-invites a revoked one) with a fresh 32-byte token. Its hash and
     expiry are stored.
   - It sends the invite through `sendBrandedEmail` (PR 2) from the series site, linking to
     `${site.url}/brand-admin/accept?token=...`.
   - It writes an audit row.
2. The partner opens the link on their brand site, logs in (existing email-code flow), and the
   page calls `POST /api/brand-admin/accept {token}` (`requireAuth`):
   - The server hashes the token and finds an `invited`, unexpired row.
   - **It requires `lower(req.userEmail) === row.email`.** A forwarded link is useless to anyone
     else. On a mismatch it says "this invite is for a different email".
   - It sets `status=active, user_id, accepted_at` and clears the token hash, then writes an audit
     row.
   - It is rate-limited through `authRateLimit` (bucket `series_invite_accept`, per IP and per
     user: 10 per hour).
3. A super-admin can list admins, revoke them (`PATCH .../admins/:adminId {status:'revoked'}`),
   resend the invite, and toggle `alerts_enabled`. A brand admin can toggle only their own
   `alerts_enabled`.

**Scoped permissions**: everything goes under `/api/brand-admin/:seriesId/...`.

| Area | Brand admin | Super-admin only |
|---|---|---|
| Identity | `brand_name`, `display_name`, `tagline`, `meta_description`, `support_email`, `description` | `slug`, `name` (internal), `is_active` |
| Look | `theme_tokens`, logo, logo-on-light, favicon, OG image, flyer art | `theme_class` (bespoke flourish class), `flyer_template_key` other than `standard` or the key already assigned |
| Event defaults | `name_template`, `require_approval`, `hide_guests`, `photos_enabled`, `photos_public`, `event_date/start/end` | `create_flow` (v1; Q4), `event_type`, `public_tags`, `internal_tags` |
| Checklist | CRUD on `checklist_defaults` where `series_id = theirs` (never global) | global template |
| Events | list their series' events, set `underbossStatus` approved/rejected/hidden | everything else |
| Alerts | own `alerts_enabled` | all recipients |
| Email | `email_from_name`, `email_reply_to`, request `email_from_address`/`email_domain` | `email_domain_verified_at`, `resend_domain_id` (server-written only) |
| Domain | request a custom domain, see DNS status | `site_url`/`site_aliases` cutover, detach |
| Money and access | none | `funding_wallet_address`, payouts, password gate, brand admin membership |

The settings PATCH uses an explicit **allowlist** of brand-admin fields: any other key is a 400
with the list. The super-admin PATCH keeps today's behavior and also writes `series_audit`.

**Event approvals and the underboss flow.** Brand events stay `underbossStatus='pending'` on
create. Brand admins approve through `PATCH /api/brand-admin/:seriesId/events/:partyId/status`:
- It reuses the existing handler body, moved into `lib/seriesEventStatus.ts` so both routers call
  one function.
- The party lookup is `where {id, eventSeriesId}`.
- `writeStatusAudit(..., actorKind='series_admin')`.
- It also writes a `series_audit` row.

`partyStatusEmailNotify` fires as today. Underbosses are unchanged: GPP region/city scope, not
series. Super-admins can still override (Q3: does PizzaDAO keep a veto, or are brand approvals
final?).

**Alerts** (`brandEventAdminNotify.ts`):
- `resolveAdminRecipients(seriesId)` returns two groups:
  - `seriesAdmins`: active rows with `alerts_enabled` for that series.
  - `pizzadao`: today's env/admin list, unchanged.
- Two sends:
  - Series admins get a link to `${site.url}/brand-admin/events` on their own site.
  - PizzaDAO recipients get today's email and link, byte-identical.
- Gating: series-admin alerts are on by default once the series has an active admin. They use the
  new env `SERIES_ADMIN_ALERTS` (default `on`) as a kill switch. PizzaDAO alerts keep
  `BRAND_EVENT_ADMIN_ALERTS`. Q3b: do PizzaDAO admins keep getting brand alerts once a brand has
  its own admin?

### 2.2 Runtime brand config (PR 7, then PR 17)

**Data**. New nullable `event_series` columns (PR 1):
- `tagline`, `meta_description`, `support_email`
- `favicon_url`, `logo_light_url` (logo for light backgrounds; replaces the monad hack in
  `Header.tsx`)
- `theme_tokens jsonb`, `flyer_art jsonb`, `config_version int default 1` (bumped on every
  brand-field write)
- From the domain plan: `site_aliases, email_from_address, email_from_name, email_reply_to,
  email_domain, resend_domain_id, email_domain_verified_at`
- Custom domain request:
  - `pending_domain` (host)
  - `pending_domain_token` (ownership TXT value, random, not secret)
  - `pending_domain_status` (`requested | dns_ok | attached | live | failed`)
  - `pending_domain_checked_at`

**Public endpoint**: `GET /api/brand-config?host=<host>` or `?slug=<slug>` (new
`backend/src/routes/brandConfig.routes.ts`).
- It resolves host to series through the siteBrand cache (`site_url` plus `site_aliases`, active
  only). It returns 404 for unknown hosts.
- Response (sanitized): `{ v: config_version, slug, seriesId, name, tagline, description, domain,
  url, logoUrl, logoLightUrl, faviconUrl, ogImageUrl, hasCustomOgImage, supportEmail, themeClass,
  tokens, flyer: {templateKey, art} }`.
- It is built only from validated columns, by the same `toBrandConfig()` the tests cover. It
  never includes email or domain internals, wallets or tags.
- Headers: `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=86400`, and an
  `ETag` from `v`. On DB error it serves the last good in-memory value with `max-age=10`, or a 503
  if there is none.

**Frontend boot without a flash.** One blocking script, loaded only on runtime-enabled builds.
- `frontend/api/brand-config.ts` (Vercel Node function), reached by a `vercel.json` rewrite of
  `/brand-config.js` with a `has` host capture: `{"source":"/brand-config.js","has":[{"type":"host",
  "value":"(?<host>.*)"}],"destination":"/api/brand-config?host=:host"}`.
- It fetches the backend endpoint, keyed by `VITE_BRAND_SERIES_SLUG` when set, otherwise by host.
- It returns JS (`Content-Type: text/javascript`, `max-age=60, s-maxage=60,
  stale-while-revalidate=86400`):
  1. `window.__BRAND__ = <JSON with < > & U+2028/9 escaped>`.
  2. A tiny synchronous applier: set the CSS vars from `deriveThemeVars(tokens)` on
     `document.documentElement.style`, add `wl-theme` / `wl-light` / `themeClass` classes, set
     `<title>`, the favicon `<link>`, and inject the font `<link>` from the **code-side** font map.
- `vite.config.ts` adds `<script src="/brand-config.js"></script>` as the **first** `<head>` child,
  **only when `VITE_BRAND_RUNTIME=1`**. rsv.pizza never sets it, so its `index.html` stays
  byte-identical (asserted by a test).
- `brand.ts` reads `window.__BRAND__` at module eval as an overlay on the env defaults. `BRAND`
  stays a const, so `IS_SERIES_SCOPED`, `BRAND_FEATURES`, `BrandHelmet` and `lib/api.ts` need no
  refactor. Runtime config changes show on the next page load, which is fine for brand settings.
- The applier moves out of `App.tsx` (the font and class `useEffect`). For non-runtime builds,
  `App.tsx` keeps today's code path.

**Fallback chain** (none of it blocks render beyond the one script):
1. CDN-cached function response. SWR keeps serving the previous copy for a day while revalidating.
2. The function's in-memory last-good copy per host.
3. A build-time snapshot: `frontend/scripts/snapshot-brand-config.mjs` runs in `prebuild` and
   writes `frontend/api/_brand-snapshot.json`, read by the function. If the API is down at build,
   the committed copy is used.
4. If the script itself fails to load, `brand.ts` falls back to `VITE_BRAND_*`. That's the status
   quo for per-project builds. On the shared project, PR 17 also bundles the snapshot into the
   app as a last resort.

**Crawlers and SEO** (`middleware.ts`, PR 7):
- Add `getBrandConfig(host)` (fetches `/api/brand-config` on the backend, with an in-isolate
  60-second Map cache). Use it for `baseUrl`, `brandName` and the default OG instead of env, when
  runtime is on (`process.env.BRAND_RUNTIME === '1'`). Env stays the fallback.
- Handle `/` and other non-event paths for crawlers on runtime builds. Rewrite the static
  title/description/og/twitter tags to the brand's values (same regex replacers, factored into
  `rewriteMeta(html, meta)`), so a home-page share card is right without a rebuild.
- `escapeHtml` everything. URLs are already validated server-side, and `escapeHtml` is still
  applied.
- `OPEN_FILES`: allow `/cdn/brand-assets/<seriesId>/...` (prefix match is safe because `/cdn/`
  is a storage rewrite, not the SPA shell), plus `/brand-config.js`.
- `frontend/api/event/[slug].ts`: delete it if it's confirmed unrouted (Q9); otherwise give it
  the same `getBrandConfig`.

**One Vercel project for all brands (PR 17). Recommended.**

Option A, status quo: one project per brand.
- Each brand has its own env, its own deploy per merge and its own password.
- Isolation is strong. But a new brand costs a project, about 12 env vars, a domain and a deploy.
- Every merge rebuilds N projects.

Option B: one `rsvpizza-brands` project serving every brand host. rsv.pizza stays its own
project.
- The host maps to a series via `/api/brand-config`.
- A new brand is a DB row plus a domain attach, with no new project or env, and one build per
  merge.
- Previews: `rsvpizza-brands-git-<branch>-pizza-dao.vercel.app?brand=<slug>`. The function
  honors `?brand=` (and a `wl_brand` cookie it sets) **only on `*.vercel.app` hosts**.
- The password gate becomes per host:
  - Env `SITE_PASSWORDS` is a JSON map `{host: password}`, read by the middleware. An empty or
    absent entry means no gate.
  - The gate HMAC message includes the host, so one brand's cookie can't open another.
  - Changing a password is a super-admin env edit plus a redeploy. That's acceptable because gates
    are pre-launch only. A DB-backed gate is possible later (Q6).

Recommendation: **B, with rsv.pizza kept separate**, done only after PR 7-12 prove runtime config
on the existing per-brand projects. Run the per-brand projects in parallel for a week, then move
each brand's domains to the shared project (domain-move script). Keep the old projects for
instant rollback (re-attach the domain).

Cons of B:
- Blast radius: one bad build hits all brands. That's mitigated by previews and per-brand
  screenshot checks.
- Vercel per-project domain limits: check the PizzaDAO plan (Q7).
- Brand-specific build env is gone, so anything that truly must be build-time is out:
  - Today that's only `VITE_API_URL`, `VITE_SUPABASE_*` and `VITE_BRAND_RUNTIME`, which are shared.
  - Also Reown/WalletConnect project ids, which are shared as well.

What stays build-time: `VITE_API_URL`, `VITE_SUPABASE_*`, `VITE_BRAND_RUNTIME`, and
`VITE_BRAND_SERIES_SLUG` (Option A only). Every other `VITE_BRAND_*` becomes a fallback, removed
from the projects after migration.

### 2.3 Theme tokens (PR 8, PR 9-12)

`theme_tokens` schema (validated server-side in `backend/src/lib/themeTokens.ts`, mirrored in
`frontend/src/config/themeTokens.ts`. A shared fixture test keeps them identical):
```
{ mode: 'dark'|'light',
  bg, surface, text, textMuted, accent, onAccent, border,   // '#rrggbb' only
  radius: 'square'|'soft'|'round'|'pill',                   // button+card radius scale
  fontHeading, fontBody: one of FONT_KEYS }                 // e.g. system, inter, kanit, nunito, satoshi, rubik, space-grotesk
```
- Colors must match `^#[0-9a-fA-F]{6}$`. Nothing else is accepted: no `url()`, no `var()`, no free
  CSS.
- Fonts are keys into a code-side `FONTS` map `{key: {family, href}}`. Its hrefs are a fixed list
  (Google Fonts, Fontshare). A partner can never supply a URL.
- `deriveThemeVars(tokens)` is a pure function. It returns the full existing variable set:
  - `--bg-main, --bg-card(-hover), --bg-surface(-hover), --bg-input(-focus), --bg-header,
    --bg-overlay`
  - `--text-primary/secondary/muted/faint`
  - `--stroke(-hover|-strong)`
  - `--accent, --accent-hover, --success, --warning, --error`
  - `--color-scheme`, `--radius-btn`, `--radius-card`, `--font-heading`, `--font-body`
  - Hover and tint steps are computed by mixing toward text or bg. Status hues come from the
    dark or light AA set (the light set already exists in index.css: success `#1f7a45`, warning
    `#8a5a00`, danger `#b3261e`).
- **Optional per-variable overrides** (`tokens.overrides: {'--bg-card': '#...'}`) with a fixed
  allowlist of variable names. Brand admins can't edit these. They exist so the 4 migrations can
  pin exact values (e.g. team1 `--bg-card: #1a1b1c`).

CSS (index.css):
- A new generic `.wl-theme` layer (dark) and `.wl-theme.wl-light`. They hold the structural rules
  the brand classes copy today: white-utility remaps, inputs, modals, the Places dropdown, status
  pills, avatar chips, buttons using `--radius-btn`, headings using `--font-heading`, and the
  mobile header and guests-card wrap fixes.
- They read only CSS variables and are inert unless the class is present.
- The bespoke parts stay code, as **flourish classes**. Each existing class shrinks to only
  layout and art and is renamed `brand-<slug>`:
  - team1: red radial glow
  - monad: dot grid, framed column, SVG hero
  - doge: side rules, gold-frame hero, pink link underline
  - swc: lavender hero wash and stacked-logo height
  - The logo-hiding rules become a config flag `hideHeaderName` / `hideHeroLogo` in tokens,
    rendered by `Header.tsx` and `SeriesLandingPage.tsx`, instead of CSS.
- `themeClass` stays super-admin-only and now means "flourish class".
- `App.tsx` font `<link>` branches, `Header.tsx:63` and `SeriesLandingPage.tsx:160` switch to
  config: `FONTS[tokens.fontHeading]`, `logoLightUrl`, and the doge hero shown via
  `themeClass === 'brand-doge'`.

**Migrating the 4 themes, zero visual change.** One PR per brand (PR 9 team1, 10 monad, 11 doge,
12 swc). Each PR:
1. Captures baseline screenshots from the **current prod** brand site with a new Playwright
   script, `frontend/e2e/brand-screens.mjs`:
   - Pages: landing `/`, an event page, `/create` step 1, the host dashboard, the RSVP modal, the
     login modal, `/brand-admin`.
   - At 390px and 1280px, with fonts awaited and animations disabled.
   - Gate cookie supplied through env, so the password is never printed.
2. Writes the token JSON plus overrides that reproduce the old variables exactly, and the trimmed
   `brand-<slug>` class.
3. Sets the series row's `theme_tokens` and `theme_class` on prod. This is a data write, applied
   first. It's inert until the brand's frontend build is runtime-enabled.
4. Sets `VITE_BRAND_RUNTIME=1` on that brand's Vercel project. The preview of the PR branch on
   that project is the comparison target.
5. Diffs with `pixelmatch`, threshold 0.1, **0 differing pixels expected**. Any diff must be
   explained, e.g. font-load timing, and re-shot. Only then merge.
6. Leaves the old `.team1-theme` etc. selectors in place for one release as dead CSS, then deletes
   them in PR 18, so rollback is just unsetting `VITE_BRAND_RUNTIME`.

**Contrast check** (`themeTokens.ts` `contrastReport(tokens)`, WCAG 2.x relative luminance):
- Checked pairs: `text/bg`, `text/surface`, `textMuted/bg`, `textMuted/surface`, `onAccent/accent`,
  `accent/bg` (accent used as link text), and the derived `--text-secondary` against both.
- Body pairs need AA 4.5:1. Accent-as-decoration only needs 3:1, and is warned about, not blocked.
- The editor shows live pass/fail chips. The **backend PATCH rejects** tokens that fail any
  required pair (400 with the failing pairs), so the API can't bypass the check.
- Super-admin `overrides` skip the block (the existing themes were QA'd by hand) but still show
  in the report.

### 2.4 Brand settings page (PR 13, PR 14)

Route `/brand-admin` (and `/brand-admin/accept`, `/brand-admin/events`) on brand sites. It is
**not** in `GPP_ONLY_PATHS`, and it is lazy-loaded.
- On rsv.pizza it renders for super-admins only, with a series picker. That's handy for support.
- It uses `Layout`, `IconInput` (placeholders, no labels; `multiline` for descriptions),
  `Checkbox`, and `text-xs text-white/40` helper text. The modal pattern is `LoginModal`'s.
- Access: `GET /api/brand-admin/me` returns the series the user administers. If there are none,
  the page shows "You don't have brand admin access" and no settings.

Tabs:
1. **Identity**: brand name (max 40, charset letters, digits, space and `.&'!-`, no `<>"`),
   display name, tagline (80), meta description (200), support email, series description
   (markdown, 2000).
2. **Look**:
   - Mode, the 8 color tokens (native `<input type="color">` wrapped in a small `ColorInput`
     component built on `IconInput`'s styling, with a hex `IconInput` beside it), radius, and the
     heading/body font selects.
   - **Live preview** pane: a scoped `<div class="wl-theme [wl-light]" style={deriveThemeVars(draft)}>`
     rendering a sample header, a card, primary/secondary buttons, an input, muted text and a
     status pill. These are real components where cheap (`Header` in preview mode,
     `IconInput`, `Checkbox`).
   - Contrast chips, with Save disabled while a required pair fails.
3. **Images**: logo, logo-on-light, favicon, OG image, plus poster/rollup flyer art (PR 15). Each
   has an upload button, its size guidance, the current image, and a "remove (use default)"
   action.
4. **Checklist**: list, add, edit, reorder and delete series checklist defaults. It shares the
   item editor UI with `AdminSeriesPage`, extracted into `components/series/ChecklistEditor.tsx`.
5. **Events**: pending/approved/rejected lists with approve/reject/hide. The component is shared
   with `AdminSeriesPage`.
6. **Email**:
   - Sender name and reply-to are editable.
   - The from address and sending domain are requested here, and shown with the guided DNS status
     (PR 16).
   - Status line: "Sending as `<Name> <noreply@rsv.pizza>`" or "Verified `<date>`".
7. **Domain**: the guided custom-domain flow (PR 16).
8. **History**: the `series_audit` list, with "Revert to before this change" for `settings.update`
   rows, which writes the snapshot back through the same validators.

Save model: save = publish (the next page load on the brand site picks it up within about 60 s of
CDN TTL). It's safe because of the live preview, server validation and one-click revert. The
alternative, draft/publish columns, is noted as a later option if partners want staging.

**Uploads** (PR 13). New `backend/src/lib/brandAssets.ts`, modelled on `hackathon/media.ts`:
- Buckets (ops step, created via the Storage API with the service_role key, per CLAUDE.md):
  - `brand-uploads`: **private**, 10 MB, `image/png, image/jpeg, image/webp`. For tmp uploads.
  - `brand-assets`: **public**, 5 MB, `image/png, image/webp`. Final, server-written only.
  - Public because logos, OG images and flyer art must be fetchable by crawlers and canvases. It
    is served same-origin as `/cdn/brand-assets/...`.
- Endpoints:
  - `POST /api/brand-admin/:seriesId/assets/upload-url {slot, mimeType, fileSize}` returns
    `{path, token}` for `brand-uploads/<seriesId>/tmp/<uuid>.<ext>`.
  - `POST /api/brand-admin/:seriesId/assets/attach {slot, path}`.
- Slots and server output:

  | slot | output | rule |
  |---|---|---|
  | logo, logoLight | PNG | fit inside 1024x512 |
  | favicon | PNG | 256x256, cover |
  | og | PNG | 1200x630 exactly, cover, under 1 MB |
  | flyerPoster, flyerRollup | PNG | exact template pixel size from the standard template |

- Attach does this:
  1. It checks that `path` matches `^<seriesId>/tmp/<uuid>\.(png|jpg|webp)$` for **this**
     seriesId.
  2. It downloads the file and sniffs it: PNG, JPEG or WebP only. **SVG, GIF and AVIF are
     refused**, so no script-in-image path exists.
  3. It decodes with `sharp(buf, { limitInputPixels: 40e6, failOn: 'error' })`. It refuses
     animated input (`pages > 1`).
  4. It re-encodes to a fresh PNG or WebP with metadata stripped (no EXIF/GPS) and resizes per
     slot.
  5. It writes to `brand-assets/<seriesId>/<slot>/<uuid>.png` with `upsert:false` and
     `cacheControl: 31536000` (immutable, since the uuid changes each upload).
  6. It deletes tmp, saves the `/cdn/brand-assets/...` URL into the column or into `flyer_art`,
     bumps `config_version`, and writes an audit row.
- Old asset objects are kept, so revert works. A cleanup job can come later.
- Rate limits (`express-rate-limit`, keyed by user id): upload-url 30 per hour per user,
  settings PATCH 60 per hour per user, attach 30 per hour. Per-series daily cap: 200 uploads.
- Asset URL validation on every write: only `/cdn/brand-assets/<thisSeriesId>/...`, or the legacy
  `/brands/<slug>/...` (super-admin only). There is no arbitrary https, so tracking pixels and
  remote swaps are blocked.

### 2.5 Flyers (PR 15)

- A new `standard` template: `configs/standardPosterConfig.ts` / `standardRollupConfig.ts`.
  - They spread `POSTER_CONFIG`/`ROLLUP_CONFIG` with fixed geometry: the art area on top, and a
    text, QR and sponsor band below.
  - Text colors come from the series tokens (`text`, `accent`, `surface` for the QR tile), with a
    contrast check against the band color.
  - `templatePath`/`fullResUrl` come from `flyer_art.poster` / `flyer_art.rollup`, falling back to
    a neutral built-in art.
  - The geometry is shown to partners as a downloadable guide PNG with safe areas
    (`public/flyer-guides/standard-poster-guide.png`).
- `flyerTemplates.ts`:
  - `resolveFlyerTemplate(key, series)`: for `key === 'standard'`, it builds the config from the
    series tokens and art.
  - `useSeriesFlyerTemplate` passes the public series (it already fetches `/api/series`; add
    `flyerArt` and `themeTokens` to `PUBLIC_SELECT`, both non-sensitive).
- Brand admins may set `flyer_template_key` to `standard`, or back to the bespoke key a
  super-admin assigned (stored in `flyer_art.bespokeKey`). Bespoke templates (team1, doge, swc,
  avax, gpp) stay code.
- Canvas safety: the art is same-origin through `/cdn/`, so canvas export isn't tainted. A test
  asserts that the standard config URLs start with `/cdn/brand-assets/`.

### 2.6 Custom domain and email (PR 16; changes the domain plan's PR 5)

The domain plan's sender resolution (§2.2), the single Resend sender (§2.3), the link fixes
(§2.4) and DB-derived CORS (§2.5) are unchanged.

What changes: partners start and track the process from the brand settings page, instead of
PizzaDAO running a local script for every step.

- New backend `lib/domainService.ts`. Pure record builders and the DNS lint are lifted from the
  domain plan §2.7 so the CLI and backend share them.
- Two new backend secrets:
  - `VERCEL_DOMAINS_TOKEN`: a PizzaDAO-team token, used only for project-domain add and
    config/verify reads.
  - `RESEND_ADMIN_API_KEY`: full access, used only for the domains API. Sends keep
    `RESEND_API_KEY`.
  - This answers the domain plan's Q2 toward a backend key (Q8 confirms).
- Flow:
  1. **Request** (brand admin):
     - Enter a host such as `events.partner.com` and optionally a sending address such as
       `events@mail.partner.com`.
     - Server validation: a public-suffix-aware host, not `*.rsv.pizza`, not another series'
       `site_url`/alias/pending host, not an IP, at most 253 chars.
     - It stores `pending_domain` and generates `pending_domain_token`.
     - It shows the DNS sheet (domain plan §3) plus **our ownership TXT**:
       `_rsvpizza.<host> TXT "rsvpizza-verify=<token>"`.
  2. **Check** (button, plus a cron every 15 minutes while status is `requested`/`dns_ok`):
     - Resolves via DoH, checking the TXT, then the CNAME/A target, then CAA and Cloudflare-proxy
       lint.
     - When the TXT matches, status becomes `dns_ok`, and only then the backend attaches the
       domain to the brand's Vercel project (`POST /v10/projects/<id>/domains`) and reads
       `/v6/domains/<host>/config`.
     - Status becomes `attached` once Vercel reports it configured and a cert is served.
     - **Takeover guard**: nothing is attached and no host-to-series mapping exists before our TXT
       proves DNS control. Another brand admin can't pre-claim someone else's host.
  3. **Email**:
     - `POST` the Resend domain creates the row (stored), and its 3 records show in the sheet.
     - The Check button calls Resend verify/GET.
     - `email_domain_verified_at` is set **only** by this server path when Resend says `verified`
       and the from-address domain matches. The domain plan's §2.3 send-time revert stays as the
       safety net.
  4. **Cutover** (super-admin button on `AdminSeriesPage`, Q5):
     - It sets `site_url` to the new host and moves the old host to `site_aliases`.
     - It sets the old domain to a 308 redirect on Vercel.
     - Status becomes `live`, and an audit row is written.
     - With runtime config (PR 7) **no env change or redeploy is needed**, because `BRAND.url`
       comes from `/brand-config.js`. That's the main simplification over the domain plan's
       cutover.
     - The UI warns that users must log in again once (localStorage is per origin).
  5. **Rollback** (super-admin): the same steps reversed, idempotent. The old domain is **never**
     detached (printed flyer QR codes).
- `scripts/wl-custom-domain.mjs` stays as a thin ops CLI (`plan`/`check`/`rollback`) importing the
  same lib.
- Offboarding note in the docs: the partner removes their DNS **before** we detach a domain, so no
  dangling CNAME points at Vercel.

### 2.7 Security summary

- **Tenant isolation**:
  - Every `/api/brand-admin/:seriesId/*` route goes through `requireSeriesAdmin`.
  - Child objects are re-scoped in the query.
  - 404 on a mismatch.
  - A table-driven test hits every brand-admin route as an admin of series A against series B's
    ids and expects 404 and no write. A route-registry test makes sure no `/api/brand-admin` route
    lacks the middleware.
- **XSS**:
  - Strict field validators (charset and length; no `<>"` or control chars in names; colors are
    hex only; fonts are enum; URLs are server-produced storage paths only).
  - React escaping in the app.
  - `escapeHtml` in the middleware.
  - JSON in `/brand-config.js` escapes `<`, `>`, `&`, U+2028 and U+2029.
  - Fix the unescaped `${site.name}` in `loginCode.ts` and `reminder.routes.ts`.
  - Email `from` display names are stripped of `"<>\r\n`.
  - The markdown description goes through the existing markdown renderer, which already handles
    host descriptions.
- **Uploads**: private tmp bucket, server-side magic-byte sniff, sharp re-encode with a pixel
  limit, no SVG/GIF/AVIF, server-chosen paths and content type, size caps on both the bucket and
  the server, rate limits.
- **Domains**: our TXT ownership proof before attach or mapping; no `*.rsv.pizza`; no duplicate
  across series; cutover super-admin only; old domains never detached; https-only origins in CORS
  (domain plan §2.5).
- **Email**: the verified flag is server-written only; reply-to is validated; a change to
  from-address or domain resets verification (domain plan §2.6).
- **Privilege**: membership, `site_url`/aliases, `is_active`, slug, `create_flow`, tags, event
  type, `funding_wallet_address`, the gate password and `theme_class` are super-admin only. The
  invite token is hashed, single-use, expires after 7 days, and is bound to an email.
- **Audit**: `series_audit` on every write (both roles). Super-admins see the History tab for any
  series.
- **Abuse**: rate limits per user and per series. A brand admin can't email anyone except
  through existing flows; new email is limited to invites, sent by super-admins only.

### 2.8 Migrations and CI rules

- PR 1 is the **only** schema PR for PRs 1-16. It is additive and nullable, applied with
  `backend/scripts/apply-wl-self-serve.cjs`:
  - dry run by default, `--apply`
  - `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, RLS plus `REVOKE` for both new
    tables
  - no session `SET` (6543 pooler)
  - verifies columns and grants afterwards
- It is applied to prod **before merge**, and `schema-drift.yml` must be green.
- New tables go into `scripts/anon-no-access-tables.json` in the same PR. C1 fails if the table
  isn't there yet, which is another reason to apply first.
- `event_series` stays backend-only: no anon GRANT and no `SAFE_PARTY_COLUMNS` change.
  `PUBLIC_SELECT` gains only `themeTokens`, `flyerArt`, `tagline`, `metaDescription`,
  `faviconUrl`, `logoLightUrl`, `supportEmail`. It never gains email/domain/token columns (a test
  asserts the key list).
- No realtime publication changes.
- Hooks lint (`lint.yml`): the new pages keep hooks above early returns.

---

## 3. PR breakdown (in order; each keeps rsv.pizza and current brands unchanged)

| # | Branch | Contents | Prod step before merge | Tests |
|---|---|---|---|---|
| 1 | `wl-ss-schema` | Migration + apply script: all `event_series` columns (§2.2, including the domain plan's email cols), `series_admins`, `series_audit`, RLS/REVOKE; Prisma models; `anon-no-access-tables.json`; super-admin PATCH writes `series_audit`; domain plan PR 1's AdminSeriesPage email fields + validation + verified-reset | **Run the apply `--apply` on prod**; schema-drift + rls-anon-exposure green | admin-series route tests (validation, verified_at ignored in body, audit row written); apply-script dry-run test |
| 2 | `wl-email-send` | Domain plan PR 2 as written (siteBrand sender resolution, aliases in `byOrigin`, `lib/resendSend.ts`, site-aware call sites) | none | domain plan §6 list; `emailSnapshots`/`siteBrandCallSites` unchanged |
| 3 | `wl-series-links` | Domain plan PR 3 (Telegram, payout nudges, NFT metadata, payout/order/host-telegram) | none | branded-party link tests |
| 4 | `wl-cors-series` | Domain plan PR 4 (DB-derived CORS incl. aliases) | none | `cors.test.ts` matrix |
| 5 | `wl-brand-admins` | `lib/seriesAccess.ts`; super-admin invite/list/revoke/resend routes; `POST /api/brand-admin/accept`; invite email; AdminSeriesPage "Brand admins" section; `/brand-admin/accept` page | none | invite token hashed and single-use; email mismatch rejected; expired rejected; revoke takes effect next request; accept rate limit; non-super-admin 403 on invite |
| 6 | `wl-brand-admin-api` | `/api/brand-admin/me`, `/:seriesId/settings` GET/PATCH (allowlist, validators, `config_version` bump, audit, revert), checklist CRUD scoped, events list/status (shared `lib/seriesEventStatus.ts`), own alerts toggle; `brandEventAdminNotify` series-admin recipients plus brand-site link; escape `site.name` in loginCode/reminder | none | **cross-tenant matrix** (every route, A vs B, expects 404, no DB change); route-registry middleware test; field allowlist rejects super-only keys; global checklist default untouchable; alert recipients split, PizzaDAO email byte-identical; loginCode escaping snapshot |
| 7 | `wl-runtime-config` | `GET /api/brand-config`; `frontend/api/brand-config.ts` + rewrite + snapshot prebuild; `brand.ts` `window.__BRAND__` overlay; vite plugin injects the script only if `VITE_BRAND_RUNTIME=1`; middleware `getBrandConfig` + `/` crawler meta + `OPEN_FILES` for `/cdn/brand-assets/`; retire `api/event/[slug].ts` (Q9) | none (no project sets the flag yet) | `index.html` build output byte-identical without the flag (snapshot); JSON escaping (`</script>`, U+2028); `toBrandConfig` excludes private fields; 404 unknown host; fallback chain (API 500 gives the snapshot); middleware crawler meta for `/` on a runtime host and unchanged on rsv.pizza; brand.ts overlay unit test |
| 8 | `wl-theme-tokens` | `themeTokens.ts` (backend + frontend, shared fixture), `deriveThemeVars`, `contrastReport`, `FONTS` map, generic `.wl-theme`/`.wl-light` CSS layer, applier in `/brand-config.js`; config flags replace `Header.tsx:63`, `SeriesLandingPage.tsx:160`, `App.tsx` font branches **for runtime builds only** | none | validator rejects non-hex, `url(`, unknown font/override keys; contrast math against known pairs (white/#E6212F is 4.6, etc.); derive is deterministic; backend PATCH 400 on failing contrast |
| 9 | `wl-theme-team1` | team1 tokens + overrides; trimmed `brand-team1` flourish; set series row (data) and `VITE_BRAND_RUNTIME=1` on `rsvpizza-team1` | **data write on prod + env flag before merge** | `e2e/brand-screens.mjs` baseline (prod) vs branch preview: 0 px diff at 390 and 1280 |
| 10 | `wl-theme-monad` | same for monad (incl. `logoLightUrl`) | same | same |
| 11 | `wl-theme-doge` | same for doge | same | same |
| 12 | `wl-theme-swc` | same for swc | same | same |
| 13 | `wl-brand-assets` | buckets (ops), `lib/brandAssets.ts`, upload-url/attach routes, rate limits | **create `brand-uploads` (private) + `brand-assets` (public) buckets** | sniff rejects SVG/GIF/HTML-as-PNG; sharp refuses a pixel bomb or animated input; path for another series rejected; output dims per slot; EXIF stripped; rate limit 429 |
| 14 | `wl-brand-settings-page` | `/brand-admin` page (tabs §2.4), shared `ChecklistEditor` + `SeriesEventsList` extracted from AdminSeriesPage, `ColorInput`, live preview, History/revert | none | RTL: no access shows a message; contrast chips block Save; preview applies vars; `/mobile-check`; Vercel preview on a brand project as a test brand admin |
| 15 | `wl-standard-flyer` | standard poster/rollup configs, `resolveFlyerTemplate(key, series)`, `PUBLIC_SELECT` adds `flyerArt`/`themeTokens`, guide PNGs, Images-tab flyer slots | none | config build from tokens + art; same-origin URL assertion; existing bespoke templates unchanged (`flyerQr.test.ts` etc.) |
| 16 | `wl-domain-self-serve` | `lib/domainService.ts` (records, DoH, lint, Vercel/Resend clients), Domain + Email tabs, TXT ownership, check cron, super-admin cutover/rollback buttons, thin `scripts/wl-custom-domain.mjs`, docs §6 | add `VERCEL_DOMAINS_TOKEN`, `RESEND_ADMIN_API_KEY` to backend env (Snax OK) | host validator (no `*.rsv.pizza`, no duplicate, IP rejected); no attach before TXT matches; verified_at set only on a Resend-verified response; cutover/rollback idempotent; fixture Vercel/Resend responses |
| 17 | `wl-multi-domain` | `rsvpizza-brands` project; host-keyed config (no `VITE_BRAND_SERIES_SLUG`); `?brand=` only on `*.vercel.app`; `SITE_PASSWORDS` per-host gate (host in HMAC); bundled snapshot fallback; domain-move script | create project (Snax OK); move domains one brand at a time | gate: cookie for host A rejected on host B; `?brand=` ignored on real domains; screenshot diff per brand on the shared project vs the old project |
| 18 | `wl-ss-cleanup` | delete dead `.team1-theme` etc. CSS, drop unused `VITE_BRAND_*` from projects, update `docs/whitelabel-deploy.md` (runtime config, brand admins, multi-domain) | none | screenshot diff again |

Dependencies:
- PR 1 comes first.
- PRs 2-4 follow PR 1 and can run in parallel.
- PR 5 follows PR 1 (and PR 2 for the invite send).
- PR 6 follows PR 5.
- PR 7 follows PR 1. PR 8 follows PR 7. PRs 9-12 follow PR 8, one at a time.
- PR 13 follows PR 6. PR 14 follows PRs 6, 8 and 13. PR 15 follows PRs 13 and 14.
- PR 16 follows PRs 2, 4, 7 and 14.
- PR 17 follows PRs 9-12, 16, and a week of stable runtime config.

**Pilot (after PR 14, before PR 16-17)**:
1. Snax picks one partner (Q1).
2. A super-admin invites one brand admin.
3. They change the logo, colors and checklist on the gated brand site, and approve one test event.
4. Watch `series_audit` and the logs for a week.
5. Domains (PR 16) open to the pilot after that.

---

## 4. Risks

- **Screenshot parity**: some current rules are tied to specific DOM shapes. The generic layer may
  not reproduce every one, so per-brand flourish classes absorb the residue. The 0-px diff gate
  is per PR, and rollback is unsetting `VITE_BRAND_RUNTIME`.
- **The blocking `/brand-config.js` adds one round trip on a cold load.** It's CDN-cached per host
  (verify on the PR 7 preview that the Vercel CDN keys on host plus query: the rewrite passes
  `?host=` explicitly so it does). If the function is slow, the SWR copy serves.
- **Edge middleware fetching config for crawlers**: an in-isolate cache plus a 2 s timeout, and it
  falls back to env meta.
- **Partners making ugly or broken sites**: mitigated by the contrast block, the fixed token set,
  live preview, and one-click revert.
- **Shared blast radius in PR 17**: keep rsv.pizza out of the shared project, and keep the old
  per-brand projects for a while.
- **New backend secrets (Vercel token, Resend full-access key)** widen what a backend compromise
  can do: domain attach on one team, and Resend domain admin. Scope the Vercel token to the
  PizzaDAO team, use it only from `domainService`, and never log it.
- **Brand admin approval mistakes**: super-admins can still override, and audit plus
  `partyStatusEmailNotify` still run.
- **Deliverability and DMARC**: see domain plan §5 (unchanged).

## 5. Verification (overall)

- Backend: `npm --prefix backend test` (vitest) per PR, plus `check:schema-drift` and
  `check-rls-anon-exposure` after the PR 1 apply.
- Frontend: `npm --prefix frontend test`, `tsc`, and the hooks lint.
- Vercel previews:
  - rsv.pizza: `https://rsvpizza-git-<branch>-pizza-dao.vercel.app` must look unchanged on every
    PR (spot-check home, event, create).
  - Brand projects: check the branch preview of the affected brand project (PRs 7-17).
- Screenshot diffs (`frontend/e2e/brand-screens.mjs`) for PRs 9-12, 17 and 18.
- Manual, as a test brand admin on a gated brand preview:
  - invite, accept, and edit each tab
  - try series B ids in devtools and expect 404
  - upload an SVG renamed .png and expect a refusal
  - upload a 12000x12000 PNG and expect a refusal
  - revert a change
- `/mobile-check` on `/brand-admin`.
- End to end for domains: the domain plan §6 throwaway-domain run, now driven from the Domain tab.

## 6. Open questions for Snax

1. Which partner is the pilot brand admin (team1, monad, doge or swc), and who's the contact?
2. Can a brand "owner" invite their own editors, or do only super-admins manage brand admins (v1
   default: super-admin only)?
3. Are brand-admin approvals final, or does PizzaDAO keep a veto? (b) Once a brand has its own
   admin, do PizzaDAO admins keep getting that brand's new-event alerts?
4. Should `create_flow` (and `require_approval` defaults) stay super-admin only?
5. Is custom-domain cutover a super-admin button (recommended), or self-serve once DNS checks
   pass?
6. Is a per-host password map in Vercel env (redeploy to change) OK for the shared project, or do
   you want gate passwords stored in the DB?
7. Is one shared `rsvpizza-brands` Vercel project (rsv.pizza separate) OK, and what Vercel plan
   or domain limit is the PizzaDAO team on?
8. Is it OK to put a PizzaDAO-team Vercel token and a full-access Resend key into backend env for
   the self-serve domain flow? (This replaces the domain plan's keychain-only script.)
9. `frontend/api/event/[slug].ts` looks unrouted. OK to delete it?
10. Which fonts go on the safe list beyond the current 5 (Kanit, Inter, Nunito, Satoshi, system)?

## Snax decisions (2026-11-17: "defaults")
1. Pilot brand: **Own The Doge** (doge series, Snax 2026-11-17). Contact: ask Snax before the pilot invite (PR 14).
2. Only super-admins add brand admins in v1; brand-owner invites later.
3. Brand-admin approvals are final, but PizzaDAO super-admins keep a veto; once a brand has an admin, PizzaDAO stops getting that brand's new-event alerts.
4. create_flow and require_approval stay super-admin only.
5. Custom-domain cutover = super-admin button after DNS checks pass.
6. Gate passwords move to the DB (no redeploy to change). Snax 2026-11-17: leave the current passwords as they are for now.
7. Shared `rsvpizza-brands` Vercel project: yes (PR 17); confirm Vercel plan/domain limit then.
8. Backend may hold a PizzaDAO-team Vercel token + full-access Resend key for the domain flow (PR 16); confirm Resend plan then.
9. Keep `frontend/api/event/[slug].ts` (it IS reachable; verified live 2026-11-17).
10. Fonts: add a handful of free Google fonts to the safe list.
11. Subdomains only for partner sites and senders (no apex).
12. rsv.pizza DMARC p=none: yes, but the DNS change and report mailbox need Snax's OK at the time.
Also: footer PizzaDAO/"powered by RSV.Pizza" and the GitHub/corner links are REMOVED on brand builds (Snax 2026-11-17).
