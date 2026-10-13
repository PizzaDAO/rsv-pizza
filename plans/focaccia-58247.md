# focaccia-58247: Email all approved GPP 2026 hosts (+ non-partner co-hosts) the Party Guide

## Summary
One-off broadcast pointing approved GPP hosts and their non-partner co-hosts at the Party Guide tab in the host dashboard, with a short good-luck note. Built as a `--dry-run`/`--send` Node script under `backend/scripts/` (mirrors `fix-gpp-host-avatars.js`, `tag-pfp-missing-avatars.js`, etc.). Triggered from Snax's machine against prod DB; no admin UI in v1.

## Audience

- **Filter:** `parties.event_type = 'gpp' AND parties.underboss_status = 'approved'`
- **Recipients:**
  - **Primary host:** `users.email` joined via `parties.user_id` for every approved GPP event.
  - **Co-hosts (non-partner only):** Each entry in `parties.co_hosts` JSON array where `isPartner !== true` and `email` is non-empty.
  - Partner co-hosts (`isPartner === true`) are excluded — they're sponsor/brand contacts (often with a `partnerTag`), not the people running the day-of. They get partner-specific comms separately.
- **`CoHost` shape** (frontend/src/types.ts:102): `{ id, name, email?, ..., isPartner?: boolean, partnerTag?: string, isUnderboss?, canEdit?, allowedTabs? }`.
- **Dedup:** Lowercase + dedupe by email across the entire list (a single person may host one event and co-host another — they get one email, not two). The deduped record keeps the **soonest-upcoming** event as the link target and the role label `host` if any record is a primary host (so the email copy can address them as "host" not "co-host").
- **Expected count:** ~500–700 unique recipients (~350–400 primary hosts + ~150–300 unique non-partner co-host emails after dedup; dry-run prints exact figures).

### Audience edge cases

- **Co-hosts without Party Guide tab access** (`allowedTabs` set but missing `'party-guide'`): still emailed. The message has value beyond the tab link (good-luck note, day-of reminders), and the host can grant tab access if asked. Not worth a second filter.
- **Co-hosts with no email:** skipped silently (shape allows `email?`).
- **Multiple co-host entries for the same email across different events:** deduped; soonest-upcoming event wins the link slot.
- **`isUnderboss` co-hosts:** treated as normal co-hosts (not excluded). They're still day-of hosts.

## Email content

- **Subject:** `Your Global Pizza Party guide is ready 🍕`
- **From:** `RSV.Pizza <noreply@rsv.pizza>` (matches every other transactional email).
- **HTML body** (inline-styled, same hand-rolled pattern as the rest of `backend/src/routes/*.ts` — no template engine):
  ```
  Hi {first_name or "host"},

  Your Global Pizza Party is almost here — we're rooting for you.

  We just shipped the Party Guide: a single tab in your dashboard with
  everything you need on the day-of (timeline, checklist, photo prompts,
  pizzeria contacts, Zoom info if you've got one).

    → Open your Party Guide for {event_name}:
      https://rsv.pizza/host/{invite_code}/party-guide

  A few quick reminders:
    • {bullet 1 — final to be drafted with Snax before send}
    • {bullet 2}
    • {bullet 3}

  Questions? Just reply — this inbox is monitored.

  Good luck and happy hosting,
  The RSV.Pizza team
  ```
- **Plain-text alt:** same content stripped of HTML, link as bare URL. Helps deliverability.
- **No role distinction in copy.** Co-hosts get the exact same email as hosts. They have the same access to the Party Guide tab (modulo `allowedTabs`), and "hi host" reads naturally for either role.

## Compliance / unsubscribe

No suppression infra exists on this codebase today (verified: no `email_unsubscribed` column on `User`, no suppression table). Two-tier approach:

1. **Headers (mandatory):** Add `List-Unsubscribe: <mailto:unsubscribe@rsv.pizza?subject=unsubscribe>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Satisfies Gmail/Yahoo bulk-sender rules (2024+) for >5k/day senders. We're under that, but headers cost nothing and protect deliverability.
2. **Footer line (mandatory):** Inline "Reply STOP to opt out of future broadcasts." Replies land in `noreply@rsv.pizza`'s inbox (already monitored). v1 = manual suppression; building a real suppression table is captured as a follow-up before the *next* broadcast.

## Architecture

**Why a script, not an endpoint:** Every other prod-data-touching tool on this repo is a script (`scripts/geocode-backfill.js`, `scripts/swc-geo-audit.cjs`, `backend/scripts/restore-mc-deletions.cjs`, the avatar backfill family). A one-off broadcast = a one-off script. An admin endpoint would add auth, route registration, UI surface, and a deploy cycle for a single send.

- **File:** `backend/scripts/send-gpp-guide-email.cjs`
- **CLI surface:**
  ```
  node backend/scripts/send-gpp-guide-email.cjs --dry-run
    # Writes /tmp/gpp-guide-recipients.csv (email, name, role, event_name, invite_code, party_guide_url)
    # Writes /tmp/gpp-guide-sample.html (rendered email for the first 3 recipients)
    # Prints: raw recipient count, deduped count, # of partner co-hosts excluded
    # Sends nothing.

  node backend/scripts/send-gpp-guide-email.cjs --send --confirm
    # Re-runs the query, sends via Resend with the existing 10/500ms batching pattern.
    # Refuses without --confirm.
    # Writes /tmp/gpp-guide-send-log.json: { sent: [...], failed: [{email, reason}] }.
    # On retry: --send --skip-already-sent reads the log and skips successes (idempotency).

  node backend/scripts/send-gpp-guide-email.cjs --send --only=email1,email2
    # Single-recipient test mode. Snax runs this against her own email first.
  ```

**Reuses:**
- `pg` client + `DATABASE_URL` from `backend/.env` (per memory `reference_db_backfill_fallback` — Supabase API token can die; raw `pg` is the reliable fallback).
- `RESEND_API_KEY` from `backend/.env`.
- Batching: `BATCH_SIZE = 10`, `await new Promise(r => setTimeout(r, 500))` between batches (copied from `backend/src/routes/v1/guests.ts:780`).

**Does NOT need:**
- Prisma client (raw SQL is fine for a one-off SELECT).
- Backend deploy (script runs locally against prod DB + Resend; no code goes to Vercel).
- Frontend changes.
- DB migration (no schema changes in v1).

## Implementation steps

1. **Create `backend/scripts/send-gpp-guide-email.cjs`:**
   - Load `backend/.env` via `require('dotenv').config({ path })`.
   - Connect via `pg.Client` using `DATABASE_URL`.
   - Run SQL (every approved GPP event with host + raw `co_hosts` JSON — flattening happens in JS so we can apply the `isPartner` filter and dedup cleanly):
     ```sql
     SELECT
       p.id           AS party_id,
       p.name         AS event_name,
       p.invite_code,
       p.custom_url,
       p.city,
       p.country,
       p.date         AS event_date,
       p.timezone,
       p.co_hosts,
       u.email        AS host_email,
       u.name         AS host_name
     FROM parties p
     JOIN users u ON p.user_id = u.id
     WHERE p.event_type = 'gpp'
       AND p.underboss_status = 'approved'
     ORDER BY p.date ASC NULLS LAST;
     ```
   - **Build the flat recipient list in JS:**
     ```js
     const flat = [];
     let partnerSkips = 0;
     for (const row of rows) {
       // Primary host
       if (row.host_email && row.host_email.trim()) {
         flat.push({
           email: row.host_email.toLowerCase().trim(),
           name: row.host_name,
           role: 'host',
           invite_code: row.invite_code,
           event_name: row.event_name,
           event_date: row.event_date,
         });
       }
       // Non-partner co-hosts
       const coHosts = Array.isArray(row.co_hosts) ? row.co_hosts : [];
       for (const ch of coHosts) {
         if (ch?.isPartner === true) { partnerSkips++; continue; }
         if (!ch?.email || !ch.email.trim()) continue;
         flat.push({
           email: ch.email.toLowerCase().trim(),
           name: ch.name || row.host_name,
           role: 'cohost',
           invite_code: row.invite_code,
           event_name: row.event_name,
           event_date: row.event_date,
         });
       }
     }
     // Dedup by email; prefer host role over cohost; prefer soonest-upcoming event.
     const byEmail = new Map();
     for (const r of flat) {
       const existing = byEmail.get(r.email);
       if (!existing) { byEmail.set(r.email, r); continue; }
       const promoteToHost = r.role === 'host' && existing.role !== 'host';
       const earlier = r.event_date && (!existing.event_date || new Date(r.event_date) < new Date(existing.event_date));
       if (promoteToHost || earlier) byEmail.set(r.email, r);
     }
     const recipients = [...byEmail.values()];
     console.log(`Raw flat list: ${flat.length} | Deduped: ${recipients.length} | Partner co-hosts excluded: ${partnerSkips}`);
     ```
   - Build HTML using the inline-style template (mirror the GPP welcome-email block in `backend/src/routes/gpp.routes.ts` ~lines 280–360).
   - Dry-run path: write CSV + sample HTML, no `fetch` calls.
   - Send path: per-recipient Resend POST, batch of 10 with 500ms gap, append result to log.

2. **Verify the URL pattern.** Confirm `https://rsv.pizza/host/{invite_code}/party-guide` lands on the Party Guide tab (PR #558 / #561 / #562 / #564 all merged). Open one sample event in browser before sending the blast.

3. **Dry-run + review.** Open `/tmp/gpp-guide-sample.html` in browser, edit final copy in the script (bullets + sign-off), re-run `--dry-run` until happy.

4. **Test send.** `--send --only=samgold24@gmail.com`. Confirm rendering in Gmail (subject, From, body, link, unsubscribe header visible in "show original").

5. **Full send.** `--send --confirm`. Watch the log; expect ~5–10 minutes wall time for ~500–700 emails at 10/500ms.

6. **Post-send check.** Spot-check Resend dashboard for bounces. If any "STOP" replies come in over the next 48h, log them somewhere durable so a future broadcast can suppress.

## Acceptance criteria

- [ ] `--dry-run` outputs CSV containing every approved-GPP primary host email + every non-partner co-host email, deduped by lowercased email. Prints both raw and deduped counts plus the partner-skip count so we can sanity-check the `isPartner` filter.
- [ ] Spot-check: pick one event with a known partner co-host (e.g. `SELECT name, jsonb_pretty(co_hosts) FROM parties WHERE event_type='gpp' AND underboss_status='approved' AND co_hosts::text ILIKE '%isPartner%true%' LIMIT 5`) — confirm that partner's email is NOT in the dry-run CSV.
- [ ] Sample HTML renders cleanly in Gmail + Apple Mail (no broken layout, link clickable, unsubscribe header present).
- [ ] Test send to Snax succeeds and the email lands in inbox (not spam).
- [ ] Full send log shows ≥98% sent, ≤2% failed (hard bounces; record them).
- [ ] No recipient gets more than one email (dedup verified by spot-checking the log).
- [ ] All Party Guide links resolve to the live tab (not 404).

## Risks / pre-flight checks

- **Resend rate limits.** Free tier = 100/day. Verify which tier `RESEND_API_KEY` is on before sending 500–700 in one run. Likely already paid given existing transactional volume — confirm in Resend dashboard.
- **Stale recipient list between dry-run and send.** Re-query inside `--send`; don't rely on the dry-run CSV. New GPP events get approved daily.
- **Partner-flag drift.** `isPartner` is set at the time the co-host is added/edited; a co-host added as a regular co-host before partner-tagging existed won't have `isPartner=true` even if they're a sponsor in spirit. Acceptable for this blast — the filter applies the explicit flag and nothing else.
- **Hosts who already opened the Party Guide tab.** No downside to emailing them — the bullets + good-luck note still land. Don't filter.
- **Memory note `feedback_check_vercel_logs_first_for_widespread_bugs`** doesn't apply here (no widespread bug), but if post-send we see "guide link 404s" reports, check Vercel logs before chasing DB hypotheses.

## Follow-ups (separate tasks, not this PR)

- **Real suppression infra.** Add `users.broadcast_unsubscribed_at TIMESTAMPTZ NULL` + a public `/unsubscribe?token=…` page. Build before the *next* broadcast.
- **Co-host broadcast variants.** If we want different copy for hosts vs co-hosts, split the template; not worth doing for v1.
- **Reusable broadcast tool under /underboss.** Build only if we send broadcasts more than 2–3 times.

## Files touched

- **New:** `backend/scripts/send-gpp-guide-email.cjs` (only file)
- **No code changes** in `backend/src/`, `frontend/src/`, `supabase/`, `prisma/`.

## Dispatch notes

- **Branch name:** `focaccia-58247-gpp-guide-email`
- **Worktree agent isolation:** `worktree`. Per memory `feedback_agent_worktree_git_sandbox`, agent commits/pushes are done from main session after agent finishes.
- **No DB migration** — skip apply-migration step.
- **No backend deploy** (script-only, runs locally).
- **PR is informational** — merge doesn't trigger the send; Snax runs the script manually after PR merges. Skipping the PR is defensible since nothing deploys, but PR'ing it preserves the script for next time.
