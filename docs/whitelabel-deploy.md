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
