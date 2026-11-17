> **Folded into `plans/wl-self-serve-brands.md` (2026-11-17).** That plan keeps this file's findings, §2.1-2.6 design and PR 1-4 (as its PR 1-4), and supersedes §2.7 / PR 5 (the local runbook script) with a backend domain service + guided settings UI (its PR 16). Cutover there needs no env change or redeploy once runtime brand config ships. Read that plan first.

# wl-custom-domain-email: partner custom domains and sending addresses

Read from `origin/master` @ `0d40c24f` (2026-11-17). Builds on `docs/whitelabel-deploy.md` and
`plans/whitelabel-team1-monad.md` §9 ("own domains later").

## Goal

A white-label partner can run their brand site on their own domain (`events.partner.com`, or an
apex `partner.com`) and send email from their own address (`events@partner.com` or
`events@mail.partner.com`). The work should be config plus a runbook script, with no code change
per partner, and no outage or logout surprises we don't announce first.

Non-goals: inbound email to partner domains, a dedicated IP, one Resend account per partner,
multi-tenant single frontend (each brand stays its own Vercel project).

---

## 1. What it takes today (findings)

### Frontend domain
- Each brand is its own Vercel project (`rsvpizza-<brand>`, PizzaDAO team), built with
  `VITE_BRAND_*`. `VITE_BRAND_DOMAIN` is used in two ways:
  - It is inlined at build time into `BRAND.url` / `brandUrl()` (`frontend/src/config/brand.ts`).
    That covers every client-built link: share links, check-in QR, flyer QR (`flyerQr.ts`
    `flyerEventUrl` -> `brandUrl`), and the booth.
  - It is read at runtime by `frontend/middleware.ts` (OG rewriter `baseUrl`, line ~222) and
    `frontend/api/event/[slug].ts` (`SITE_URL`, line 16).
  - So changing the domain means updating the env var and doing a **prod redeploy**.
- Domains are attached with `POST /v10/projects/<id>/domains`, and `GET /v6/domains/<host>/config`
  returns the recommended record:
  - Subdomain: a CNAME to the project-specific `*.vercel-dns-0xx.com` target (team1 is
    `2a3bb970858c0fa3.vercel-dns-016.com`).
  - Apex: A records (the recommended IPv4, e.g. `216.198.79.1` or legacy `76.76.21.21`). An apex
    can't take a CNAME unless the DNS host flattens it (ALIAS/ANAME).
  - If the domain already belongs to another Vercel account, the API returns a `verification`
    array (a TXT record on `_vercel.<domain>`).
  - TLS is automatic (Let's Encrypt) once DNS resolves. It gets blocked by a CAA record that
    excludes letsencrypt.org, or by Cloudflare proxying (orange cloud).
- Password gate (`SITE_PASSWORD`, middleware): the cookie is host-scoped, so the new domain
  prompts for the password again. Nothing else in the gate depends on the domain. While the gate
  is on, crawlers get the 401 form, so OG previews only work after the gate is removed.
- Old domain: no redirect mechanism exists yet. Vercel can do it per domain with no code
  (`PATCH /v9/projects/<id>/domains/<old>` `{redirect, redirectStatusCode: 308}`).
- There is no hardcoded host list in `frontend/vercel.json`. The `OPEN_FILES` gate allowlist is
  paths only.

### Backend URLs (shared api.rsv.pizza)
- `lib/siteBrand.ts` maps `event_series.site_url` (active rows, 60 s cache) to `{url, name,
  fromEmail}`. It is keyed by series id (`siteForParty`) and by exact Origin (`siteForOrigin`, used
  for login codes in `auth.routes.ts:41,219`).
- Already series-aware, so changing `site_url` just works: login code / magic link, RSVP
  confirm/approve/waitlist emails (`rsvp.routes.ts`), invites (`v1/guests.ts`), reminders, survey
  emails, host survey, party status emails, NFT claim emails and cron (`nftClaim*.ts`), and
  `party.routes.ts:1499,2547`.
- **Still hardcoded to rsv.pizza or the deploy brand**, so a branded party links to the wrong site:
  - `routes/telegram.routes.ts:42,51`: `publicEventLink` / `appDeepLink` hardcode
    `https://rsv.pizza/...`.
  - `routes/admin-payout.routes.ts:7343-7356`: Telegram nudge texts `rsv.pizza/${slug}`.
  - `routes/nft.routes.ts:82`: NFT metadata `external_url`.
  - `services/payoutEmailNotify.ts:47`: host payments link, plus `brand.fromEmail`.
  - `services/pizzaOrderNotify.ts:59`: `brand.url/host/...`, plus `brand.fromEmail`.
  - `services/hostTelegramEmail.ts:24`: `FROM = brand.fromEmail` (host-facing).
  - `routes/gpp.routes.ts`, `partner-intake.routes.ts`, `paymentsTeamNotify.ts`, `invoice*`,
    `mou.routes.ts`, `blandAI.service.ts`, `brandEventAdminNotify.approvalUrl` are GPP, sponsor or
    ops flows, so they stay on rsv.pizza.
- Frontend on **rsv.pizza** building links for a *branded* party (e.g. a super-admin generating a
  team1 flyer on rsv.pizza) uses `brandUrl()`, which points at the wrong site. This is pre-existing
  and minor; see PR 5.

### CORS
- `backend/src/index.ts:131` uses `ALLOWED_ORIGINS` (an exact list from env that *replaces* the
  defaults), checked with `lib/cors.ts` `isAllowedOrigin` plus the `rsvpizza-*-pizza-dao.vercel.app`
  preview regex. A new domain means a hand edit of the encrypted env var plus a backend redeploy.
- Auth is a bearer JWT in `localStorage` (`AuthContext.tsx`). The backend sets no cookies (there is
  no `res.cookie`), so `credentials: true` carries nothing ambient. CORS here mainly stops another
  origin from reading responses, not from riding a session.
- `supabase/functions/mint-nft/index.ts:41` has its own hardcoded list (rsv.pizza, plus
  `*.vercel.app`). Brand domains aren't in it.
- Reown/WalletConnect Allowed Domains need the new origin (a dashboard step).

### Auth / sessions
- Sessions live per origin in `localStorage`, so moving a brand to a new domain **logs everyone out
  once** on that brand. Nothing else breaks:
  - Magic-link tokens, codes and signed guest tokens are verified server-side and don't depend on
    the origin.
  - Already-emailed links to the old host (`/auth/verify?...`, `/rsvp/...`, `/host/...`) keep
    working if the old domain 308-redirects with path and query preserved.
- Printed flyer QR codes and old emails point at `<brand>.rsv.pizza` forever, so **the old domain
  must stay attached as a permanent redirect**.

### Email (Resend)
- There is one Resend account and one `RESEND_API_KEY`. Every send is a hand-rolled
  `fetch('https://api.resend.com/emails')`, across 22 call sites in 18 files. None of them sets
  `reply_to`.
- `rsv.pizza` is verified in Resend:
  - DKIM is at `resend._domainkey.rsv.pizza`.
  - The return path `send.rsv.pizza` has SPF `include:amazonses.com` plus an MX to
    `feedback-smtp.us-east-1.amazonses.com`.
  - **There is no DMARC record (`_dmarc.rsv.pizza` is empty).** Gmail and Yahoo require DMARC for
    bulk senders.
- Branded series already send as `"<brandName> <noreply@rsv.pizza>"` (`siteBrand.brandedSite`).
  This is a display-name rebrand only.
- Resend domains API: `POST /domains {name, region}` returns 3 records (DKIM TXT
  `resend._domainkey.<d>`, SPF MX and TXT on `send.<d>`), plus optional tracking. Then
  `POST /domains/<id>/verify` and `GET /domains/<id>` to read the status. This needs a
  **full-access** API key.
- Domain limits per account: Free 3, Pro 10, Scale 1000. Pro and Scale can add 100 more for
  $20/mo. So one account can hold many partner domains.
- `routes/webhooks.resend.routes.ts` (Svix-verified) updates `guests.email_status` by
  `email_resend_id`. Resend webhooks are account-level, so partner-domain bounces and complaints
  already arrive there. Nothing feeds a per-domain health signal back to the series.

### Data model
- `event_series` already has `site_url` and `brand_name`. Only the backend can read it (RLS-locked,
  and it isn't in the parties anon grants), so new columns need **no** anon GRANT and no
  `SAFE_PARTY_COLUMNS` change.
- `PUBLIC_SELECT` in `series.routes.ts` must not pick up the new email columns.

---

## 2. Design

### 2.1 Data model (PR 1, migration applied to prod before merge)
`backend/prisma/migrations/<date>_series_custom_domain_email/migration.sql`, additive and nullable:

| column | type | meaning |
|---|---|---|
| `site_aliases` | `text[] default '{}'` | Extra origins for this series. Used for CORS and `siteForOrigin`: the old `*.rsv.pizza` after cutover, or the new domain during staging. They are never used to *build* links. |
| `email_from_address` | text | e.g. `events@mail.partner.com`. Null means `noreply@rsv.pizza`. |
| `email_from_name` | text | Null means `brand_name`. |
| `email_reply_to` | text | e.g. `hello@partner.com`. Sent as `reply_to` even before verification. |
| `email_domain` | text | Resend domain name, e.g. `mail.partner.com`. |
| `resend_domain_id` | text | |
| `email_domain_verified_at` | timestamptz | Null means use the fallback sender. **Only the script or send-time logic writes it. Admins can't.** |

There is also an apply script, `backend/scripts/apply-series-custom-domain-email.cjs`:
- It follows the `apply-series-site-url.cjs` pattern (dry-run default, `--apply`, verifies columns
  after).
- It uses only `ADD COLUMN IF NOT EXISTS`. No session `SET`: this is the transaction pooler.

Add the fields to `schema.prisma` `EventSeries` in the same PR. The schema-drift CI must pass, so
**run the apply against prod before merging**.

### 2.2 Sender resolution (`lib/siteBrand.ts`)
Extend `SeriesSite` and `SiteBrand` with `replyTo?: string`, `fallbackFrom: string`,
`seriesId?: string`. `brandedSite(s)`:
- `fromEmail` is `"<email_from_name||name> <email_from_address>"` only when **all** of these hold:
  - `email_from_address` is set.
  - `email_domain_verified_at` is set.
  - The address domain equals `email_domain` (or is a subdomain of it).
- Otherwise `fromEmail` is today's exact `"<name> <noreply@rsv.pizza>"`, so existing brands are
  byte-identical.
- `replyTo` is `email_reply_to` (or null).

Rejected alternative: `"Partner via RSV.Pizza <noreply@...>"` as the fallback display name. It
changes current team1/monad output, and Gmail already shows the real address. Open question Q3.

### 2.3 One Resend sender (`lib/resendSend.ts`, PR 2)
`sendBrandedEmail({ site, to, subject, html, apiKey, fetchImpl? })`:
1. POST with `from: site.fromEmail`. Add `reply_to` only when `site.replyTo` is set, so JSON
   snapshots of unbranded mail stay unchanged.
2. If Resend answers 403/422 with a "domain is not verified" style message, and `fromEmail !==
   fallbackFrom`:
   - Retry once with `fallbackFrom` (keeping `reply_to`).
   - Fire-and-forget `UPDATE event_series SET email_domain_verified_at = NULL WHERE id = $1`.
   - Bust the siteBrand cache and `console.error` a tagged line (`[wl-email] sender reverted`).
   - This is the safety net for a partner later deleting their DKIM record.
3. Return the Resend JSON (the id is still captured where call sites store `email_resend_id`).

Migrate only the **site-aware** call sites to it. They already hold a `site`:
- `loginCode.ts`, `nftClaimEmail.ts`, `rsvp.routes.ts` (4 sites), `v1/guests.ts` (2),
  `reminder.routes.ts`, `survey.routes.ts`, `party.routes.ts:2540`, `hostSurveyEmail.ts`,
  `partyStatusEmailNotify.ts`.

Leave the ops/sponsor senders on `brand.fromEmail`.

### 2.4 Remaining URL call sites (PR 3)
Route these through `siteForParty(party, brand.url)`:
- `telegram.routes.ts` `publicEventLink`/`appDeepLink` (make them async, or pre-resolve the site
  per recipient party).
- `admin-payout.routes.ts:7343-7356` nudge texts (the host is resolved per party).
- `nft.routes.ts:82` `external_url`.
- `payoutEmailNotify.ts:47` (URL plus `sendBrandedEmail`).
- `pizzaOrderNotify.ts:59` (URL plus `sendBrandedEmail`).
- `hostTelegramEmail.ts` (from-address by party).

The brand-check CI only scans *added* lines. These edits remove literals, which is fine.

### 2.5 CORS from the DB (PR 4)
- `corsOptionsDelegate` gets an optional `seriesOrigins: () => Promise<Set<string>>`. It is built
  from `getSeriesSites()`: the normalized `site_url` plus `site_aliases` of **active** series.
- The origin check is env list, then preview regex, then series set.
- On DB error, `getSeriesSites` already returns the stale or empty cache, so the env list still
  works (**fail closed to today's behavior**).
- Only exact https origins count. `siteUrlOrNull` already validates `site_url`; apply the same
  validator to each alias.
- Also extend `siteForOrigin`'s `byOrigin` with the aliases, so a login started on the old domain
  in an open tab emails a link to the *canonical* new domain.

Security weighting:
- The new trust root is "who can write `event_series`". That's super-admins via
  `/api/admin/series` and anyone with `DATABASE_URL`, roughly the same group that can edit Vercel
  env today.
- Because auth is a bearer token in localStorage and there are no cookies, a rogue allowed origin
  can't read another user's data without already holding their token.
- Residual risk: an attacker-controlled origin added by a compromised super-admin could front a
  phishing copy of the site that talks to the API. That is the same as today's env.
- Mitigations:
  - https only.
  - An audit log line on every `site_url`/`site_aliases` change in the admin PATCH.
  - A unit test that a bare `http://`, a path, or a wildcard is rejected.
- `ALLOWED_ORIGINS` stays for non-series origins (rsv.pizza, globalpizza.party, localhost).

The alternative is to keep hand-editing `ALLOWED_ORIGINS`. It's safer by a hair but needs an
encrypted env edit plus a backend redeploy per partner, and it is the step most likely to be
forgotten. Recommended: DB-derived.

The mint-nft function has its own CORS list. Read an `ALLOWED_ORIGINS` function secret, with the
current list as the default, only if brands mint client-side. Today minting is server-side via
`nftMint.ts` with the service key, so this is probably not needed (Q6).

### 2.6 Admin UI (`frontend/src/pages/AdminSeriesPage.tsx`, part of PR 1 or 2)
- New `IconInput` fields with placeholders, no labels:
  - "Site aliases (comma-separated https origins)"
  - "From address (e.g. events@mail.partner.com)"
  - "From name (defaults to brand name)"
  - "Reply-to address"
  - "Email sending domain (e.g. mail.partner.com)"
- A read-only status line (`text-xs text-white/40`): "Sending as noreply@rsv.pizza (domain not
  verified)" or "Verified <date>".
- Backend `admin-series.routes.ts` POST/PATCH:
  - Validate the emails, and that the from-address domain is equal to `email_domain` or under it.
  - Validate the aliases (reuse `siteUrlOrNull`).
  - **Any change to `email_domain` or `email_from_address` resets `email_domain_verified_at` to
    null.**
  - Never accept `email_domain_verified_at` or `resend_domain_id` from the body.

### 2.7 Runbook script (PR 5): `scripts/wl-custom-domain.mjs`
Plain Node, no deps (fetch plus `dns/promises`, and DoH for a second resolver). **Dry run by
default**; each mutating step needs `--apply`. It prints every planned call.

Credentials:
- Vercel: `vercel-token`, PizzaDAO team.
- Resend: a **full-access** key from a new keychain item, e.g. `-l rsvpizza-resend -a resend`.
  It never goes into backend env (Q4).
- DB: `DATABASE_URL` from `backend/.env`, via Prisma.

```
node scripts/wl-custom-domain.mjs plan     --series monad --site events.partner.com \
     [--mail-domain mail.partner.com --from events@mail.partner.com --reply-to hi@partner.com]
node scripts/wl-custom-domain.mjs stage    --series monad ... [--apply]
node scripts/wl-custom-domain.mjs check    --series monad
node scripts/wl-custom-domain.mjs cutover  --series monad [--apply]
node scripts/wl-custom-domain.mjs email-on --series monad [--apply]
node scripts/wl-custom-domain.mjs rollback --series monad [--to site|email|all] [--apply]
```

- **plan**: read-only.
  - Looks up the series row and the Vercel project (`rsvpizza-<slug>`), checks domain
    availability, and checks for an existing Resend domain.
  - Prints the **partner DNS sheet** (§3) with the exact records:
    - Vercel: CNAME or A, plus `_vercel` TXT if needed.
    - Resend: DKIM TXT, `send` MX and TXT.
    - A suggested DMARC.
  - Lints existing partner DNS, and warns on:
    - CAA records without letsencrypt.
    - Cloudflare proxy IPs.
    - An existing `resend._domainkey` (a collision with the partner's own Resend).
    - An apex SPF with more than 10 lookups (informational, since Resend uses `send.` for SPF).
    - DMARC `p=reject` with `aspf=s`.
- **stage**:
  - `POST` the Vercel domain to the project (no redirect).
  - `POST /domains` on Resend, then store `email_domain`, `resend_domain_id`,
    `email_from_address`, `email_from_name` and `email_reply_to` with `verified_at` left null.
  - Add the new origin to `site_aliases`, so CORS and login work on the new host before cutover.
  - None of this changes what users see (mail still goes from rsv.pizza, now with reply-to).
- **check**: read-only.
  - Vercel `GET /v6/domains/<d>/config` (`misconfigured:false`), project-domain `verified`, and a
    cert served (`curl -sI https://<d>`).
  - Resend `POST /domains/<id>/verify` (harmless) then `GET` (`status: verified`, with each record
    status).
  - Prints pass/fail per row.
- **cutover** (needs check = all green on the site rows):
  1. `PATCH` the project env `VITE_BRAND_DOMAIN=<new>` (Production and Preview).
  2. Trigger a prod redeploy. Use `vercel-deploy --prod` from the brand worktree, since the script
     prints the command instead of running it so the git-free deploy rule holds. Wait for Ready.
  3. DB: `site_url=https://<new>`, and put the old origin into `site_aliases` (removing the new
     one).
  4. Vercel: set the old domain `redirect=<new>, redirectStatusCode=308`.
  5. Smoke test: `curl -I https://<old>/x` returns 308 to `https://<new>/x`; OG HTML on the new
     host has `og:url` on the new host; a CORS preflight from the new origin returns 204.
  6. Remind: Reown Allowed Domains, and the release note "you'll need to log in again".
- **email-on** (needs Resend `verified`): set `email_domain_verified_at=now()`, then send a test
  login-code email to `--test-to` using the real path (`sendBrandedEmail`). The backend picks it up
  within 60 s.
- **rollback**:
  - `--to email`: clear `verified_at`. This is instant, falls back to rsv.pizza, and keeps
    reply-to.
  - `--to site`: remove the old-domain redirect, restore `site_url` and env, redeploy (printed),
    and leave the new domain attached.
  - `all`: both.
  - Every step is idempotent, and the script prints the current state first.

Also update `docs/whitelabel-deploy.md` with a new "§6 Partner custom domain and email" section.
It should link to the script and the DNS sheet template, and correct the stale "two Vercel projects
/ new Supabase" note.

---

## 3. What we ask the partner for (DNS sheet template, printed by `plan`)
1. The site hostname. **We recommend a subdomain**, e.g. `events.partner.com`. An apex works only
   with A records, or with ALIAS/flattening at their DNS host.
2. A sending address. **We recommend a dedicated subdomain**, e.g. `events@mail.partner.com`. It
   keeps their main domain's reputation and DMARC separate, and avoids a DKIM selector collision if
   they already use Resend themselves.
3. A reply-to mailbox they read.
4. DNS records to add:
   - Site: CNAME `events -> <vercel target>` (or the apex A record), plus `_vercel` TXT if asked.
   - Email:
     - TXT `resend._domainkey.mail` (DKIM).
     - MX `send.mail -> feedback-smtp.<region>.amazonses.com`, priority 10.
     - TXT `send.mail` `v=spf1 include:amazonses.com ~all`.
     - Recommended: `_dmarc.mail` `v=DMARC1; p=none; rua=mailto:<their address>`.
   - If they use Cloudflare, set these records to DNS only (grey cloud). If they have CAA records,
     allow `letsencrypt.org`.
5. Acknowledgement that recipients may get a one-time re-login after cutover, and that the old
   `<brand>.rsv.pizza` stays as a redirect.

---

## 4. PR breakdown (each is a no-op for rsv.pizza and current brands)

| # | Branch | Contents | Prod step |
|---|---|---|---|
| 1 | `wl-email-cols` | Migration, apply script, Prisma fields, admin POST/PATCH validation plus verified-reset, AdminSeriesPage fields, `PUBLIC_SELECT` unchanged | **Apply script `--apply` on prod before merge**; schema-drift CI green |
| 2 | `wl-email-send` | `siteBrand` sender resolution plus aliases in `byOrigin`; `lib/resendSend.ts`; migrate the site-aware call sites | none |
| 3 | `wl-series-links` | §2.4 Telegram, payout nudges, NFT metadata, payout/order/host-telegram emails | none |
| 4 | `wl-cors-series` | §2.5 DB-derived CORS, audit log on site_url/alias change | none |
| 5 | `wl-domain-runbook` | `scripts/wl-custom-domain.mjs` plus tests of its pure helpers (record building, DNS lint), docs update | none |
| ops | (per partner) | plan, stage, partner DNS, check, cutover, email-on | Snax OK for each `--apply` |

PR 2 needs PR 1 merged. PRs 3, 4 and 5 can run in parallel after PR 1, and PR 5 also needs PR 2
for `email-on`'s test send.

Prerequisite ops (independent of PRs, Snax OK): add a DMARC record for rsv.pizza through the
namecheap script: `_dmarc TXT "v=DMARC1; p=none; rua=mailto:<...>"`.

---

## 5. Risks
- **Deliverability of a fresh partner domain.** It has no reputation and sits on Resend's shared
  IPs (Free/Pro). Start with transactional mail (codes, RSVP confirmations) and avoid a big
  invite or reminder blast in the first week. Watch bounce and complaint rates in the Resend
  dashboard. Complaints on a partner domain hurt *their* domain.
- **Partner DMARC `p=reject` on their apex** with a subdomain sender: Resend DKIM `d=` is the
  sending domain, which aligns under relaxed mode, so it's fine. Strict `adkim=s` with a
  from/DKIM mismatch fails, so the lint warns.
- **The partner removes DNS later.** Resend stops sending and the send-time fallback reverts to
  rsv.pizza (§2.3). A login-code delay of one retry is acceptable.
- **The Resend plan cap** (Pro has 10 domains, and rsv.pizza uses one). Check the plan first (Q2).
- **Shared Resend account blast radius.** A suspended account kills all brands' mail, including
  rsv.pizza. It's a reason to keep partner volume moderate. A sub-account or team per partner is
  possible later.
- **CORS coupled to the DB.** This is mitigated by fail-closed to the env list and the existing
  60 s cache. A preflight costs at most one cached lookup.
- **Logout on cutover.** Every user of that brand re-logs once. Announce it. Don't build a token
  handoff unless Snax wants one (Q5).
- **The old domain must never be detached.** Flyers and QR codes use it. The runbook warns, and
  `rollback` never detaches it.
- **Mail and site mismatch.** Links can point to the new site while mail still comes from
  rsv.pizza. That's intended and harmless.
- **Emails with reply-to before verification.** Replies go to the partner mailbox. They must
  confirm they monitor it.

## 6. Verification
- Unit (vitest, backend):
  - `siteBrand.test.ts`: the verified/unverified/mismatched-domain from-resolution matrix; aliases
    map to the canonical url; unbranded output unchanged.
  - `resendSend.test.ts`: reply_to omitted when unset; retry with the fallback on a "domain not
    verified" 403, plus the verified_at reset call; no retry when already on the fallback.
  - `emailSnapshots.test.ts` and `siteBrandCallSites.test.ts` must pass **unchanged**. Add one
    case for a verified partner sender with reply_to.
  - `cors.test.ts`: series origin allowed; inactive series origin rejected; alias allowed; DB
    error means env list only; http/path origins rejected.
  - `admin-series` route tests: validation, verified_at reset on email field change, verified_at
    ignored in the body.
  - Telegram/payout link tests for a branded party.
- Script: unit tests for record-sheet building and DNS lint, using fixture Resend/Vercel
  responses. Run `plan` against `monad` on prod read-only to confirm the output.
- Vercel preview (`https://rsvpizza-git-<branch>-pizza-dao.vercel.app`):
  - AdminSeriesPage shows the new fields and status, and saving works. The preview shares the
    prod DB, so PR 1's columns must already be applied.
  - Run `/mobile-check` on the admin form.
- End to end (after merge, Snax OK), using a Snax-owned throwaway domain first, e.g. a spare
  Namecheap domain via the namecheap script, so no partner is involved. Stage, check, cutover a
  test series, then email-on:
  - A login code arrives from `events@mail.<test>` with SPF/DKIM/DMARC pass (check "Show
    original" in Gmail).
  - The old host 308s.
  - OG preview on the new host.
  - A RSVP from the new host succeeds (CORS).
  - Rollback, and confirm mail reverts within 60 s.

## 7. Open questions for Snax
1. Do we recommend subdomains only (site `events.partner.com`, mail `mail.partner.com`), or also
   support apex sites and apex senders?
2. What Resend plan are we on (domain cap), and is a full-access key OK in the keychain for the
   script? (Or should the backend get a separate `RESEND_ADMIN_API_KEY` so admins can click
   "verify" in /admin/series?)
3. For the unverified fallback, keep `"Partner <noreply@rsv.pizza>"` (today), or change to
   `"Partner via RSV.Pizza <noreply@rsv.pizza>"`?
4. OK to derive CORS from `event_series` (§2.5), instead of hand-editing `ALLOWED_ORIGINS`?
5. Accept a one-time logout on domain cutover, or build a cross-domain session handoff?
6. Do brands mint NFTs from the browser (that would need mint-nft CORS), or is minting server-side
   only?
7. OK to add `p=none` DMARC to rsv.pizza (with an rua mailbox to report to)?
