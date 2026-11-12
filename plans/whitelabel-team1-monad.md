# whitelabel-team1-monad: launch Team1 and Monad white-label frontends

**Status:** plan only. Nothing here has been applied to prod, Vercel or DNS.

## Goal
Two branded frontends, **team1.rsv.pizza** (Avalanche Team1) and **monad.rsv.pizza** (Monad). Each
is its own Vercel project built from this repo's `frontend/`. Both share `api.rsv.pizza` and the one
prod Supabase DB (`znpiwdvvsqaxuskpfleo`). Each brand will later move to its own domain, so a domain
only ever appears in env vars or a DB row, never in code. rsv.pizza must behave exactly as it does
today, byte for byte.

## Model (how this differs from `docs/whitelabel-deploy.md`)
That playbook assumes isolated stacks: one Supabase and one backend per brand, with backend `BRAND_*`
set per deploy. That doesn't work here, because the backend is single-brand per deploy
(`backend/src/config/brand.ts:16-38`) and we're keeping a single backend. So:
- **Frontend:** brand is decided at build time (`VITE_BRAND_*`, plus a new `VITE_BRAND_SERIES_SLUG`).
- **Backend:** brand is decided **per request / per party**, from the party's `event_series` row
  (new `site_url` + `brand_name` columns) or from a validated `Origin`. If neither applies, it falls
  back to today's literal or `FRONTEND_URL`, unchanged.
- **Brand = an `event_series` row.** Team1 and Monad events get stamped with `team1` / `monad`.
  Existing rows are `gpp2026` (1063 parties) and `gpp2027` (2), both `eventType='gpp'`. Both keep
  `site_url = NULL`, so GPP behavior can't change.

---

## 1. Backend gaps: user-facing URLs and chrome

### Mechanism (smallest safe option)
- **Schema:** add `event_series.site_url TEXT NULL` (canonical origin, e.g. `https://team1.rsv.pizza`,
  no trailing slash) and `event_series.brand_name TEXT NULL` (e.g. `Team1 Pizza`). Both nullable and
  additive.
- **New `backend/src/lib/siteBrand.ts`:**
  - `getSeriesSites()`: one `findMany({ where:{ siteUrl:{ not:null }, isActive:true } })` held in a
    60 s in-memory cache, keyed by id and by normalized origin.
  - `siteForParty(party: { eventSeriesId?: string|null }, fallbackUrl: string)` returns
    `{ url, name, fromEmail }`. A series with no `siteUrl` returns the **call site's existing fallback
    expression** (`'https://rsv.pizza'` or `process.env.FRONTEND_URL || ...`) together with
    `brand.name` / `brand.fromEmail`, so every current output stays identical.
  - `siteForOrigin(origin: string|undefined, fallbackUrl)`: matches only by exact equality against
    the cached `site_url` set. A spoofed Origin can't redirect a link anywhere that isn't already a
    registered brand site. Anything else falls back.
  - `fromEmail` for a branded series is `` `${brand_name} <${brand.noreplyEmail}>` ``, so mail still
    goes out from Resend-verified `noreply@rsv.pizza`.
- **Rejected alternatives:**
  - Origin-only resolution: crons such as reminders and surveys have no request, so it can't cover
    them.
  - A backend env JSON map: changing it needs a backend redeploy, and it duplicates the series row
    that crons already reach through `party.eventSeriesId`.
  - Per-brand backend deploys: that would mean three crons and three sets of webhooks/bots against
    one DB.

### Convert now (host/guest-facing on an ordinary branded event)
| Call site | What | Resolve by |
|---|---|---|
| `backend/src/routes/auth.routes.ts:115-116` | magic link URL | `siteForOrigin(req.get('origin'), FRONTEND_URL...)` |
| `auth.routes.ts:19,23,51` | "Sign In to RSV.Pizza" HTML and subject `RSV.Pizza Code` | same site `name` |
| `auth.routes.ts:49` | `from: brand.fromEmail` | site `fromEmail` |
| `backend/src/routes/rsvp.routes.ts:809, 948, 1066, 1170` | RSVP confirmation, approval, waitlist and promotion emails (base URL, from, chrome) | party |
| `backend/src/routes/party.routes.ts:1268` | invite link API response | party |
| `party.routes.ts:2274` | day-of announcement email | party |
| `backend/src/routes/reminder.routes.ts:144` (`buildEventUrl`) | event reminder cron | party (add `eventSeriesId` to ctx) |
| `backend/src/routes/survey.routes.ts:35`, `backend/src/services/hostSurveyEmail.ts:37` | post-event guest and host survey emails (cron) | party |
| `backend/src/routes/v1/guests.ts:40` | public API invite email | party |

Every call site already loads the party. The change is to add `eventSeriesId: true` to the select
and pass the existing literal as `fallbackUrl`.

### Can wait (GPP, PizzaDAO-ops or sponsor flows; Team1/Monad hosts won't hit them at launch)
- `telegram.routes.ts:42,51`: broadcast links. Telegram broadcast is a GPP city-group flow. Convert
  when brands use Telegram.
- `partyStatusEmailNotify.ts:73,105`, `payoutEmailNotify.ts:47`, `admin-payout.routes.ts:7283-7296`:
  underboss status and payout reminders. These are GPP-only until series funding exists.
- `gpp.routes.ts:193,274,485,586`: GPP-only.
- `invoice.routes.ts:388`, `mou.routes.ts:311,359`, `partner-intake.routes.ts:58,72`,
  `lib/invoicePdf.ts:101`, `services/paymentsTeamNotify.ts:54`: PizzaDAO sponsor and admin docs.
- `nft.routes.ts:80`: `external_url` in NFT metadata. Convert if brands mint.
- `publicLeaderboard.routes.ts:378`: GPP leaderboard.
- `reminder.routes.ts:180` (image hosted on rsv.pizza, harmless) and `reminder.routes.ts:443`
  (unsubscribe page "Back to RSV.Pizza").
- `index.ts:338-485` (API docs page) and `swagger.ts:101`.

### Already fine
- Stripe: `return_url = window.location.href` (`frontend/src/components/DonationForm.tsx:77`,
  `frontend/src/components/invoice/InvoiceStripePayment.tsx:51`). The `stripe-payment` edge function
  sends CORS `*`.
- Most frontend share links already use `window.location.origin` (`PartyHeader.tsx:159,173`,
  `InviteGuestsModal.tsx:66`, `PizzaContext.tsx:325,331`, etc.).
- `wagmiConfig.ts:33` uses `BRAND.url`.
- There are no backend `res.redirect`s.

### Party creation stamping (needed for §4)
`POST /api/parties` (`party.routes.ts:256`) gets an optional `seriesSlug` in the body. It's honored
only when that series is active **and has `site_url` set**, so nobody can self-enroll into
`gpp2026`/`gpp2027` through the API. When honored, it sets `eventSeriesId`. `eventType` stays null,
so the event stays out of GPP map, leaderboard and payout flows (pending Decision D3). Today unknown
body keys are ignored, so an older frontend is unaffected.

### Series listing rule
`GET /api/series/:slug/events` (`series.routes.ts:96-101`) only returns
`underbossStatus in ['approved','listed']`. Every party defaults to `underbossStatus='pending'`
(`schema.prisma:212`), so Team1 and Monad events would never appear. Fix: when the series has a
`site_url`, filter `underbossStatus notIn ['rejected','hidden']` instead. GPP rows keep the current
filter (Decision D5: open listing or curated).

## 2. Auth
- **Supabase Auth isn't used.** Login is the backend's own magic link plus JWT in `localStorage`
  (`AuthContext.tsx:61,128`; `frontend/src/lib/supabase.ts` only does data/storage, with no `.auth.`
  calls). So there's no Supabase site URL or redirect allowlist to change, and no Google OAuth. The
  only auth change is the magic-link origin (§1).
- Sessions are per origin (localStorage). Being logged in on rsv.pizza doesn't log you in on
  team1.rsv.pizza. That's acceptable; mention it in the release notes.
- **WalletConnect / Reown** (`VITE_WALLETCONNECT_PROJECT_ID`, `wagmiConfig.ts:20`): add both origins
  to the Reown project's **Allowed Domains**, or wallet connect fails on the new hosts.
- **Privy** (`PRIVY_APP_ID`, backend only, `services/privy.service.ts`): only a server-side lookup,
  no browser SDK, so no origin change is needed. Confirm in the Privy dashboard that no domain
  allowlist is enforced on the server API.
- **mint-nft edge function** hardcodes its CORS list (`supabase/functions/mint-nft/index.ts:41-47`).
  It does allow `*.vercel.app`, so previews work, but on prod brand hosts it falls back to
  `https://rsv.pizza` and the browser blocks the call. If brands mint NFTs (Decision D8), read an
  `ALLOWED_ORIGINS` function secret, with the current list as default, and redeploy that function.

## 3. CORS
`backend/src/index.ts:106-134`:
- `ALLOWED_ORIGINS` is a **comma-separated exact-match list**, with no wildcards.
- When the env var is set (it is, in production), it **replaces** the default list.
- There's also a hardcoded preview regex, `/^https:\/\/rsvpizza.*\.vercel\.app$/`.

So:
- Name the new Vercel projects **`rsvpizza-team1`** and **`rsvpizza-monad`**. Their previews
  (`rsvpizza-team1-git-<branch>-pizza-dao.vercel.app`) then match the existing regex with no code
  change.
- In the prod backend env, **append** `https://team1.rsv.pizza,https://monad.rsv.pizza` to the
  current `ALLOWED_ORIGINS` value. It's encrypted, so Snax edits it in the dashboard; never echo it.
  Then redeploy the backend, since the value is read at boot.
- A future custom domain is just another entry in this list. No code change.
- Alternative considered: derive CORS from `event_series.site_url` (async cors callback with the same
  cache). That would remove one checklist step but couples CORS to DB health. Not now.

## 4. Scoping a branded build to its series
Add `seriesSlug: (env.VITE_BRAND_SERIES_SLUG || '').trim()` to `BRAND`
(`frontend/src/config/brand.ts`). Empty means today's behavior everywhere.
- **Create:** `createPartyApi` (`frontend/src/lib/api.ts:305`) sends `seriesSlug: BRAND.seriesSlug`
  when it's set.
- **Home (`/`):**
  - Logged out: render the `SeriesLandingPage` content for `BRAND.seriesSlug`, with a "Create an
    event" call to action pointing at `/new`.
  - Logged in: the existing "your events" list, minus the GPP banners at `HomePage.tsx:54` and
    `HomePage.tsx:196`.
- **`/events`:** switch the data source from `/api/gpp/events?curated=1`
  (`api.ts:4848-4851`, filtered to `eventType='gpp'` at `gpp.routes.ts:703`) to
  `/api/series/:slug/events` when `BRAND.seriesSlug` is set.
- **Header** (`Header.tsx:62,70`): it hardcodes `/logo.png` and "RSV.Pizza". Use `BRAND.logoUrl` and
  `BRAND.name`, a no-op for rsv.pizza. The header's only other nav items are Account and Log in.
- **Footer** (`Footer.tsx:12-19`, PizzaDAO link): keep it as "powered by" (Decision D6).
- **Routes in `App.tsx:99-189`.** When `BRAND.seriesSlug` is set, the routes below render
  `<Navigate to="/" replace />`. Implement this as one `GPP_ONLY_PATHS` array so each route isn't
  edited by hand. No hooks are involved, so the rules-of-hooks gate isn't affected.
  - **Hide:** `/gpp`, `/gpp27`, `/side`, `/gpp/pizzerias`, `/gpp/leaderboard`, `/leaderboard`,
    `/pizza-index`, `/map`, `/map/swc`, `/map/all`, `/partners`, `/payments` and all
    `/payments/*`, `/underboss`, `/underboss/:region`, `/shipping`, `/partner`, `/partner/report`,
    `/partner/bizdev`, `/partner-dashboard`, `/sponsor-dashboard`, `/partner-intake/:token`,
    `/sponsor-intake/:token`, `/invoice/:viewToken`, `/mou/:viewToken`, `/graphics`,
    `/graphics/:slug/edit`, `/post`, `/photos`, `/photos/play`, `/suggestions`,
    `/admin/logo-cleanup`, `/raleigh`, `/cmohhr0640003jp047krjarz0`, `/tax-form`.
  - **Keep:** `/`, `/login`, `/new`, `/events` (scoped), `/account`, `/auth/verify`,
    `/rsvp/:inviteCode`, `/host/:inviteCode(/:tab)`, `/run/:inviteCode`, `/checkin/...`,
    `/dj/:inviteCode`, `/display/...`, `/report/:slug`, `/venue-report/:slug`, `/survey/:token`,
    `/host-survey/:token`, `/onesheet/:slug`, `/series/:slug`, `/:slug`.
  - **Admin** (`/admin`, `/admin/series`): hide on branded builds. Series are administered at
    rsv.pizza/admin/series (Decision D4).
- HostPage GPP tabs are already gated on `party.eventType === 'gpp'` (`HostPage.tsx:114,625`), so
  non-GPP brand events don't show them.
- **Cross-domain slugs:** slugs are one global namespace, so `team1.rsv.pizza/<any-gpp-slug>` will
  render that GPP event. Launch with that left alone. Optionally, on a branded build, redirect `/:slug`
  events from another series to `https://rsv.pizza/<slug>` (Decision D7).

## 5. Event series rows
Create them with a new `backend/scripts/apply-brand-series.cjs`, following the
`apply-series-flyer-key.cjs` pattern: dry run by default, `--apply` to write, idempotent upsert by
slug. A script is preferred over the admin API because the values are then reviewable in git.

| Field | team1 | monad |
|---|---|---|
| slug | `team1` | `monad` |
| name / displayName | `Team1 Pizza Parties` / `Team1` (D1) | `Monad Pizza Parties` / `Monad` (D1) |
| site_url | `https://team1.rsv.pizza` | `https://monad.rsv.pizza` |
| brand_name | `Team1 Pizza` (D1) | `Monad Pizza` (D1) |
| themeClass | `team1-theme` | `monad-theme` |
| logoUrl / ogImageUrl | `/brands/team1/logo.png`, `/brands/team1/og.png` | `/brands/monad/...` |
| flyerTemplateKey | `null` at launch (see below) | `null` |
| eventType | `null` (D3) | `null` |
| publicTags | `['Team1','Avalanche']` (D2) | `['Monad']` (D2) |
| internalTags | `['team1']` | `['monad']` |
| requireApproval / hideGuests / photosEnabled / photosPublic | `false / false / true / true` (D2) | same |
| fundingWalletAddress | `null` (no reimbursements) | `null` |

**Checklist defaults:** set per series in `/admin/series` (`POST /api/admin/series/:id/checklist`,
`admin-series.routes.ts:148`). Start with a copy of the generic non-GPP defaults; the actual items
are Decision D9.

**Flyers:** the existing `avax` template (`components/generative/configs/avaxPosterConfig.ts`, using
`/gpp-poster-avax-template.png`) is a **GPP 2026 poster co-branded with Avalanche**. It's not a Team1
template, so don't set it for Team1 unless Team1 events count as GPP (D3). Leave
`flyerTemplateKey=null` at launch. Later, add `team1` and `monad` entries to `FLYER_TEMPLATES`
(`configs/flyerTemplates.ts:18-21`) once the brands provide template art.

## 6. Theme and assets
- **Colors (verified 2026-11-12):**
  - **Monad**'s current guidelines give primary purple **`#6E54FF`**, plus `#DDD7FE`, dark
    `#0E091C`, and accents `#85E6FF` / `#FF8EE4` / `#FFAE45`. `monad.xyz` uses `#6e54ff` heavily.
    `#836EF9` is the older purple, so use `#6E54FF`.
  - **Team1**'s site accent is **`#E6212F`** (`accent-color` on team1.network), with a navy
    `#264496`. Avalanche's own red is `#E84142`. Use Team1's `#E6212F`.
- **CSS:** add `.team1-theme` and `.monad-theme` to `frontend/src/index.css`, following the "Adding New
  Themes" block (`index.css:661+`). Override `--bg-main`, `--bg-card*`, `--bg-surface*`,
  `--bg-input`, `--bg-header`, `--text-*`, `--accent*`, `--stroke`. Both are dark themes:
  Monad `#0E091C` background with `#6E54FF` accent; Team1 near-black with `#E6212F` accent.
  `App.tsx:84-89` applies the class from `VITE_BRAND_THEME_CLASS`.
- **Asset sources:**
  - Monad: monad.xyz/brand-and-media-kit (SVG/PNG logomark and wordmark; Figma kit
    figma.com/community/file/1569575393267749711).
  - Team1: go.team1.network/brand-kit (a Google Drive folder), plus team1.network `/team1.svg`,
    `/icon.png` (512 px) and `/opengraph-image.png` (1200x630).
  - Ask each brand for written OK on logo use (D10).
- **Placement:** `frontend/public/brands/{team1,monad}/{logo.png,favicon.png,og.png}`. Every build
  ships every brand folder (a few KB, harmless). Each project's env points at its own folder.
- **Static things that can't be overridden per build today:**
  - `frontend/index.html:5,9-30`: favicon, title, OG and Twitter tags are literal RSV.Pizza.
    `BrandHelmet` fixes them only after JS runs, so crawlers fetching `/` see RSV.Pizza. Fix with a
    small `transformIndexHtml` plugin in `vite.config.ts` that substitutes `BRAND`-equivalent values
    with the same defaults. **Verify by diffing `dist/index.html` before and after with no env set:
    it must be identical.**
  - `frontend/middleware.ts:121` (`baseUrl = 'https://www.rsv.pizza'`) and `:192`
    (`| RSV.Pizza` title): crawler OG for event pages. Use `process.env.VITE_BRAND_DOMAIN` /
    `VITE_BRAND_NAME` with today's literals as defaults. Edge middleware reads project env at runtime;
    `:105` already reads `VITE_API_URL`.
  - `frontend/api/event/[slug].ts:5,116,171,183,230`: the same treatment.
  - These files sit outside the `scripts/check-no-hardcoded-brand.js` scan (`SCAN_DIRS` covers only
    `frontend/src` and `backend/src`). Add `frontend/middleware.ts`, `frontend/api` and
    `frontend/index.html` to it.
  - `BrandHelmet.tsx:15` description "Invite your friends to share some pizza!" is fixed. Add an
    optional `VITE_BRAND_DESCRIPTION` with that default.
  - Fonts: index.html loads Bangers, Fredoka One and Rubik for everyone. Fine.

## 7. Vercel
Existing frontend project `pizza-dao/rsvpizza`, checked read-only via the API: Root Directory
`frontend`, preset Vite, default build/install commands, Node 24.x, Git-connected to
`PizzaDAO/rsv-pizza`, production branch `master`. `frontend/vercel.json` has no rsv.pizza
hardcode. Its `/cdn` rewrite targets the shared Supabase project, which is correct for a shared DB.

Create **`rsvpizza-team1`** and **`rsvpizza-monad`** on the PizzaDAO team with the same repo, Root
Directory `frontend`, Vite preset and Node 24.x.

**Env per project (Production and Preview):**
- **Copied from `rsvpizza`:**
  - `VITE_API_URL=https://api.rsv.pizza`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_GOOGLE_MAPS_API_KEY`
  - `VITE_STRIPE_PUBLISHABLE_KEY`
  - `VITE_WALLETCONNECT_PROJECT_ID`
  - `VITE_UNSPLASH_ACCESS_KEY`
  - `VITE_AI_ORDERING` (prod only today; D8)
  - `RESEND_API_KEY` exists on `rsvpizza` (prod). Check whether a frontend `api/` function uses it.
    If none does, don't copy it.
- **Brand:**
  - `VITE_BRAND_NAME` (e.g. `Team1 Pizza`)
  - `VITE_BRAND_TAGLINE`
  - `VITE_BRAND_DOMAIN=team1.rsv.pizza`
  - `VITE_BRAND_LOGO_URL=/brands/team1/logo.png`
  - `VITE_BRAND_OG_IMAGE=/brands/team1/og.png`
  - `VITE_BRAND_SUPPORT_EMAIL` (D1; default `help@rsv.pizza`)
  - `VITE_BRAND_THEME_CLASS=team1-theme`
  - `VITE_BRAND_SERIES_SLUG=team1`
  - `VITE_BRAND_DESCRIPTION`
- Monad uses the same keys with monad values.

**Deploys:** Git integration auto-builds production from `master` and a preview per branch, for all
three projects. To avoid 3x build minutes, optionally set an Ignored Build Step on the brand projects
(e.g. build only `master` plus branches matching `whitelabel-*`). For manual deploys,
`vercel-deploy` needs a `.vercel/project.json`. Use a dedicated worktree per brand
(`git worktree add ~/Code/pizzadao/rsv-pizza-team1 master`), `vercel link` it to `rsvpizza-team1`,
then run `vercel-deploy --prod` there, so the main checkout's link is untouched.

**Domains:** add `team1.rsv.pizza` and `monad.rsv.pizza` to the respective projects (API
`POST /v10/projects/<id>/domains`). Then read `GET /v6/domains/<host>/config` for the
`recommendedCNAME`.

## 8. DNS
`dig NS rsv.pizza` returns `dns1/dns2.registrar-servers.com`, so it **is on Namecheap BasicDNS**.
The apex is an A record to Vercel (`216.198.79.1`), www is a CNAME to
`89258d2f88b7c6b6.vercel-dns-017.com`, and api is a CNAME to `cname.vercel-dns.com`. There's no
wildcard, and team1/monad don't resolve today. After §7 domains are attached:
```bash
python3 ~/Code/namecheap/add-dns-record.py rsv.pizza team1 CNAME <recommendedCNAME team1>            # dry run
python3 ~/Code/namecheap/add-dns-record.py rsv.pizza team1 CNAME <recommendedCNAME team1> --apply
python3 ~/Code/namecheap/add-dns-record.py rsv.pizza monad CNAME <recommendedCNAME monad>  [--apply]
```
Wait until Vercel shows `misconfigured: false` and the cert is issued. No Resend change is needed;
mail stays on rsv.pizza.

## 9. Later move to own domain (per brand, e.g. `pizza.monad.xyz`)
1. Vercel: add the new domain to `rsvpizza-monad`; get its recommended record. Use a CNAME for a
   subdomain, or A records for an apex.
2. DNS at the brand's registrar (not ours unless it's Snax's domain, in which case use the namecheap
   script).
3. Frontend env: `VITE_BRAND_DOMAIN=<new>`, then redeploy, since it's inlined at build time.
4. DB: `UPDATE event_series SET site_url='https://<new>' WHERE slug='monad'`, through the admin PATCH
   or the apply script. The backend cache picks it up within 60 s.
5. Backend env: add `https://<new>` to `ALLOWED_ORIGINS`, then redeploy the backend. Keep the old
   `monad.rsv.pizza` entry until traffic moves.
6. Reown Allowed Domains: add the new domain. Do the same for the mint-nft function secret if
   enabled.
7. Keep `monad.rsv.pizza` attached and add a Vercel redirect from it to the new domain, so old
   emailed links keep working. Emailed links are absolute URLs to the old `site_url`.
8. Optional: verify the brand domain in Resend and add `event_series.noreply_email` if they want mail
   from their own domain. That's a new column and a future PR.

## 10. Ordering and PRs
Every PR is a no-op for rsv.pizza with no env set.

| # | PR (branch) | Contents | Prod step |
|---|---|---|---|
| 1 | `wl-brand-static` | Header logo/name via BRAND; index.html `transformIndexHtml`; `middleware.ts` and `api/event/[slug].ts` env defaults; `VITE_BRAND_DESCRIPTION`; `BRAND.seriesSlug` (unused yet); brand-check `SCAN_DIRS` widened | none |
| 2 | `wl-theme-assets` | `.team1-theme`, `.monad-theme` in index.css; `public/brands/{team1,monad}/*` | none |
| 3 | `wl-series-site` | Prisma `EventSeries.siteUrl`/`brandName` + `prisma/migrations/<date>_series_site_url/migration.sql` + `backend/scripts/apply-series-site-url.cjs`; admin POST/PATCH (`admin-series.routes.ts:58,102`) and the AdminSeriesPage fields; public select adds `brandName`/`siteUrl` | **Run the apply script with `--apply` against prod BEFORE merging.** The schema-drift CI must pass. |
| 4 | `wl-site-brand` | `lib/siteBrand.ts` + unit tests; convert the §1 "now" call sites; `POST /api/parties` `seriesSlug`; series listing rule | none (needs PR 3 merged) |
| 5 | `wl-series-scope` | Frontend `BRAND.seriesSlug`: create stamping, home, `/events`, GPP-only route gating | none |
| 6 | ops (no PR) | `apply-brand-series.cjs` (in PR 4 or 5) dry run then `--apply`; checklist defaults in /admin/series; append to backend `ALLOWED_ORIGINS` and redeploy the backend; Reown domains; create both Vercel projects and env; attach domains; DNS; first prod deploy | Snax OK for each prod change |
| 7 | optional `wl-mint-cors` | mint-nft `ALLOWED_ORIGINS` secret + function redeploy | only if D8 |

PRs 1, 2 and 3 can go in parallel. PR 4 needs 3. PR 5 can merge any time, because the backend
ignores unknown `seriesSlug`. Ops start once PRs 1-5 are merged.

## Risks
- **Byte-identical regression on rsv.pizza emails.** Each converted call site keeps its own literal
  as the fallback; don't normalize `'https://rsv.pizza'` vs `FRONTEND_URL`. Snapshot-test the email
  HTML for a party with no series, before and after.
- **Origin spoofing on magic links:** it only matches exact registered `site_url` values. Unit-test
  that an unknown origin falls back.
- **Series self-enrollment:** gated on `site_url IS NOT NULL`. Test that `seriesSlug=gpp2026` is
  ignored.
- **Schema ordering:** the 2026-05-17 incident class. Apply columns before merging PR 3.
- **index.html substitution** could change rsv.pizza meta. Covered by the dist diff check.
- **Cache staleness:** up to 60 s after editing `site_url`. Acceptable.
- **Brand-check CI** will flag the new defaults in `middleware.ts`/`api/` once scanned. Use
  `brand-check-ignore-line` on the default-literal lines.
- **Triple preview builds** on every branch: Ignored Build Step.

## Verification
- **Unit:**
  - `siteBrand.ts` (no series, series without site_url, branded series, unknown and spoofed origin).
  - `POST /api/parties` stamping (branded slug stamps, gpp slug ignored, inactive ignored).
  - The series events filter.
  - Email builder snapshots for a non-series party, unchanged.
- **Build no-op:** `npm --prefix frontend run build` with no `VITE_BRAND_*`, then diff `dist/index.html`
  against master and grep the bundle for `team1-theme` only in CSS.
- **Brand preview:** set `VITE_BRAND_*` (team1) for a local build or the `rsvpizza-team1` preview URL
  `https://rsvpizza-team1-git-<branch>-pizza-dao.vercel.app`, then check:
  - theme, logo, favicon and title render;
  - `/gpp` redirects to `/`;
  - `/events` lists only team1 events;
  - creating an event results in `event_series_id` = team1, checked with a read-only SELECT;
  - the RSVP confirmation email links to `team1.rsv.pizza` (once `site_url` is set) and its From is
    `Team1 Pizza <noreply@rsv.pizza>`;
  - the magic link from the branded origin points at the branded origin;
  - CORS passes on the preview.
- **rsv.pizza preview** (`https://rsvpizza-git-<branch>-pizza-dao.vercel.app`): home GPP banner,
  `/gpp`, `/events`, magic link and RSVP email all unchanged.
- **Crawler:** `curl -A Twitterbot https://team1.rsv.pizza/` and `/<team1-slug>` return Team1 OG
  tags.
- **After DNS:** `dig team1.rsv.pizza` and a valid cert; walk the full host flow on the prod brand
  host.

## Decisions for Snax
- **D1:** Display names, taglines, email from-name and support email per brand. Is it "Team1 Pizza"
  or "Team1 x RSV.Pizza", and is it `help@rsv.pizza` or the brand's address?
- **D2:** Default tags, requireApproval, hideGuests and photos settings for brand events.
- **D3:** Do Team1 events count toward GPP? If yes, set `eventType='gpp'`, consider the `avax` flyer,
  and accept GPP map, leaderboard and payout exposure. Default is no.
- **D4:** Who administers the team1/monad series and checklists: PizzaDAO admins only at
  rsv.pizza/admin/series, or brand people (a new permission scope, out of scope here)?
- **D5:** Brand events listed publicly as soon as they're created, or only after curation?
- **D6:** Keep the "PizzaDAO" footer and "powered by" on branded sites?
- **D7:** Leave cross-brand slugs alone (any event renders on any domain), or redirect them to their
  home domain?
- **D8:** Are donations (PizzaDAO Stripe), NFT minting and AI pizza ordering enabled on branded
  builds?
- **D9:** Checklist items for each brand.
- **D10:** Get written logo, color and asset approval from Team1 and Monad.
- **D11:** Accept 3x preview builds, or add an Ignored Build Step?

## Decided (Snax, 2026-11-12)
Snax approved the suggested defaults and confirmed D10. Snax may still override any of them.
- **D1:** "Team1 Pizza" / "Monad Pizza" (VITE_BRAND_NAME + event_series.brand_name). The email
  from-name is the same; mail stays `noreply@rsv.pizza`. Support stays `help@rsv.pizza`.
- **D2/D9:** copy the global defaults. Edit later at /admin/series.
- **D3:** no. Team1 events are not GPP: not `eventType='gpp'`, not on the GPP map, leaderboard or payouts.
- **D4:** PizzaDAO admins only.
- **D5 (revised, Snax 2026-11-12):** brand events need admin approval before they're listed publicly.
  Branded series list only `approved`/`listed` (same as GPP), still excluding password-protected and
  cancelled events. Super-admins approve/reject at /admin/series (Pending events). Hosts see a note
  on the host page until approved. Replaces the earlier "listed on creation" decision.
- **D6:** keep a small "powered by RSV.Pizza" in the footer.
- **D7:** no cross-brand redirects.
- **D8:** AI ordering on; donations and NFT minting hidden on brand builds. Drop PR 7.
- **D10:** Snax confirmed we have approval to use Team1 and Monad assets.
- **D11:** Ignored Build Step on the brand projects (build only `master`, plus branches matching `wl-*`).
- **NEW, password gate:** both brand sites are password-protected for now (password `gogogo`). Do it
  in `frontend/middleware.ts` (server-side, so the password is never in the client bundle), only when a
  non-VITE `SITE_PASSWORD` env var is set. Unset means no gate, so rsv.pizza is unchanged. Use a
  simple password form that sets an HttpOnly cookie (an HMAC of the password, so the raw value isn't
  stored). Make sure the middleware matcher covers every page route and static HTML. Assets can stay
  open. Remove it later by unsetting the env var. Part of PR 1.
