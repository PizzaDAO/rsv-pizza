# White-label deploy playbook

How to stand up this app under a **different brand** (name, domain, logo, colors,
emails) with **no code changes** — branding is entirely config/env driven. Every
value defaults to RSV.Pizza, so an unset var just keeps the RSV.Pizza behavior.

Background: `plans/whitelabel-brand-config.md`. Config lives in
`frontend/src/config/brand.ts` (`BRAND`, `brandUrl`) and
`backend/src/config/brand.ts` (`brand`, `brandUrl`).

> Scope: this is a **cosmetic single-brand-per-deploy** rebrand (each brand = its
> own Vercel + Supabase project). True multi-tenant (many brands on shared infra)
> and de-pizza-ing the data model are the deferred Phase 5 — not covered here.

---

## 1. Provision infrastructure

Each brand is an isolated deploy. You need:

- **A new Supabase project** (data is not shared with RSV.Pizza). Run the repo
  migrations against it (`supabase/migrations/**` + `backend/prisma/migrations/**`).
  Note the project URL + anon key + service_role key.
- **Storage buckets** — created via the Supabase dashboard (project convention;
  buckets are not created in code). The private `tax-forms` bucket is created
  on-demand by the backend, but create the public asset buckets the app uses
  (`event-images`, etc.) as in the RSV.Pizza project.
- **Two Vercel projects** (or one, per your setup): the frontend and the backend
  (`backend/` deploys to the API domain). Same repo, different env.
- **DNS** for the brand domain + api subdomain — use the `~/Code/namecheap`
  playbook (never hand-edit the zone).
- **Resend** (email): verify the brand's send domain so `noreply@<brand-domain>`
  can send.

---

## 2. Environment variables

### Frontend (Vercel project → Environment Variables)

Existing (already required):

| Var | Example |
|---|---|
| `VITE_SUPABASE_URL` | `https://<newproject>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `<anon key>` |
| `VITE_API_URL` | `https://api.<brand-domain>` |
| `VITE_GOOGLE_MAPS_API_KEY` / `VITE_MAP_PROVIDER` | as needed |

New brand vars (all optional; unset = RSV.Pizza):

| Var | Default | Notes |
|---|---|---|
| `VITE_BRAND_NAME` | `RSV.Pizza` | UI chrome + meta titles |
| `VITE_BRAND_TAGLINE` | `Pizza Party Planner` | |
| `VITE_BRAND_DOMAIN` | `rsv.pizza` | bare domain, no scheme; drives `BRAND.url` and all `brandUrl()` links |
| `VITE_BRAND_LOGO_URL` | `/logo.png` | header/favicon logo (bundle path or CDN URL) |
| `VITE_BRAND_FAVICON_URL` | logo URL | browser-tab icon (defaults to the logo) |
| `VITE_BRAND_OG_IMAGE` | `/logo.png` | social share image (resolved absolute on the brand domain) |
| `VITE_BRAND_SUPPORT_EMAIL` | `help@rsv.pizza` | |
| `VITE_BRAND_THEME_CLASS` | `` (empty) | theme override class; see §3 |

### Backend (Vercel project → Environment Variables)

Existing: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
`FRONTEND_URL` (CORS/magic links → the brand frontend origin), `RESEND_API_KEY`, etc.

New brand vars (all optional; unset = RSV.Pizza):

| Var | Default | Notes |
|---|---|---|
| `BRAND_NAME` | `RSV.Pizza` | email display name (`fromEmail` = `${BRAND_NAME} <${BRAND_NOREPLY_EMAIL}>`) |
| `BRAND_DOMAIN` | `rsv.pizza` | |
| `BRAND_API_DOMAIN` | `api.<domain>` | |
| `BRAND_NOREPLY_EMAIL` | `noreply@rsv.pizza` | must be a Resend-verified sender on the brand domain |
| `BRAND_SUPPORT_EMAIL` | `help@rsv.pizza` | |

---

## 3. Theme (optional)

To restyle beyond name/logo:

1. Add a token-override class in `frontend/src/index.css` (see the "Adding New
   Themes" comment there), e.g. `.acme-theme { --bg-main: #0a1020; --accent: #00b3a4; ... }`.
2. Set `VITE_BRAND_THEME_CLASS=acme-theme`.

`App.tsx` applies it to `<html>` at the root; all `text-theme-*` / `bg-theme-*` /
`border-theme-*` components adapt automatically.

---

## 4. Deploy & verify

1. Set all env vars at the **Vercel project** level (so preview deploys inherit
   the right brand too).
2. Deploy frontend + backend.
3. Smoke-test: title/OG (`BrandHelmet`), share links use the brand domain
   (`brandUrl`), a test email arrives from `noreply@<brand-domain>`, storage
   uploads/serves, theme applied.

---

## 5. Guardrail

CI (`.github/workflows/brand-check.yml`) fails PRs that add new hardcoded
`rsv.pizza`/`RSV.Pizza`/Supabase-project-id in `frontend/src` or `backend/src`.
Keep new brand chrome flowing through `BRAND` / `brand` / `brandUrl`.

---

## 6. Partner custom domain and sending email (self-serve)

Brand admins set both up at `/brand-admin` (Domain and Email tabs). Subdomains only
(`events.partner.com`, `mail.partner.com`).

Backend env (all optional; a missing one makes only that feature answer 503 "not configured"):
`VERCEL_DOMAINS_TOKEN` + `VERCEL_TEAM_ID` (PizzaDAO-team token), `RESEND_ADMIN_KEY` (full access,
domains API only; `RESEND_API_KEY` stays send-only), `BRAND_VERCEL_PROJECTS` (JSON
`{"<series slug>":"<Vercel project id or name>"}`), `PARTNER_EMAIL_DOMAIN_LIMIT` (default 5),
`RESERVED_DOMAINS` (extra blocked domains).

Web domain: the partner requests a host and adds `_rsvpizza.<host> TXT rsvpizza-verify=<token>` plus a
CNAME. Statuses: requested, dns_ok (TXT proven), attached, ready, live. A super-admin attaches the host to the
brand's Vercel project (only after the TXT matches), then cuts over once every check is green: `site_url`
becomes the new host, the old origin stays in `site_aliases`, and the old host is set to a 308 redirect.
After a cutover, set `VITE_BRAND_DOMAIN` on the brand project and redeploy production (the backend never
deploys), and add the origin to Reown. Rollback restores the previous `site_url`; the old domain is never
detached (printed flyer QR codes). The partner removes their own DNS before we ever detach a domain.

Sending domain: the backend creates the domain in Resend; `email_domain_verified_at` is set only when Resend
reports it verified and the from address is on it. Crons: `/api/cron/recheck-domains` (15 min; also clears unproven `requested` claims after 14 days),
`/api/cron/recheck-live-domains` (daily health check of ready/live hosts: audit row + `[wl-domain-alert]` log, never auto-removes),
`/api/cron/recheck-email-domains` (hourly, GET only; clears verification only when Resend reports failed/not_found records).
Super-admins can also remove a site alias and reset a domain claim (optionally detaching it from Vercel; not while live).

---

## Known not-yet-parameterized (as of this doc)

Cosmetic follow-ups that still contain "rsv.pizza" but are non-functional or
niche — fine for a first brand, clean up as needed:

- A few **code comments** and **admin-facing prose** (e.g. SWC reimbursement
  tooltips: "processed through SWC, not rsv.pizza").
- "**PizzaDAO**" references — many name the operating org rather than brand
  chrome; triage by hand (the brand-check intentionally does not flag them).
- The **pizza domain model** itself (Party/Topping/Beverage/Pizzeria) is
  unchanged — this playbook rebrands a pizza-party app, it does not convert it to
  another vertical (Phase 5).
