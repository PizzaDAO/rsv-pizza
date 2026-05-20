# quattro-71244 — Gamified host dashboard KPIs

**Priority:** P2
**Branch:** `quattro-71244-gamified-dashboard`

## Problem / Goal

Today the host dashboard (`GPPDashboardTab`, default tab at `/host/:inviteCode`) is a checklist + countdown with four small "Invited / RSVPs / Days Until / Pending Approval" tiles. The rich KPIs (RSVPs, attendees, newsletter signups, wallet addresses, POAP mints, page views, etc.) only show up post-event on the report page. Snax wants those KPIs pulled forward onto the dashboard from the moment an event is created, gamified with milestone badges, a peer leaderboard rank, host-set goal bars with momentum deltas, and live counter/confetti animations — so the pre-event hosting experience feels rewarding and goal-oriented (zero values are themselves motivating).

## Approach overview

1. **Reuse `ReportKPIs` in read-only mode** as the KPI grid renderer. Wrap it in a new `DashboardKPIs` component that:
   - Fetches an `EventReport`-shaped payload by calling the existing `GET /api/parties/:partyId/report` endpoint (already returns auto-calculated stats from `guests`, so it works pre-event — zeros come back as zeros). Page-view stats come from the existing `GET /api/parties/:partyId/report/views` endpoint.
   - Layers gamification chrome around (and minimally through) the grid: a leaderboard rank pill, a milestone-badge strip, a per-tile goal bar overlay, a velocity-delta footer line per tile, and pulse / confetti animations driven off the live `guests` array from `PizzaContext`.
2. **One new optional prop on `ReportKPIs`** — `gamified?: { goals: HostGoals; deltas: Record<string, MomentumDelta>; pulseKeys: Set<string> }`. When provided in read-only mode, the tile renderer adds a goal bar under the value, a delta line, and applies a `pulse-once` class to keys present in `pulseKeys`. This avoids forking the KPI math and keeps a single source of truth for `getDisplayValue` / `reportStatsConfig`. The wrapper still owns the badge strip, leaderboard pill, and confetti overlay, which sit *outside* the grid.
3. **Goals stored as a single `host_goals` JSONB column on `parties`** — collapses N integer columns into 1, dramatically reducing the 7-place change surface. Editing is inline (click a tile's goal bar → number input appears in place).
4. **Badges computed deterministically each render in v1** (no DB). Persisted "this-session-already-celebrated" set lives in `sessionStorage` keyed by `partyId` so confetti doesn't re-fire on tab switch / remount but does re-fire if the host opens a fresh tab tomorrow after hitting a new milestone.
5. **Leaderboard rank** — new `GET /api/parties/:partyId/leaderboard-rank?metric=<key>` endpoint that ranks this event against peer GPP-tagged events (scope: same `eventType = 'gpp'` and same `eventTags` season tag if present; falls back to all `eventType = 'gpp'` if no season tag). In-memory 5-min cache keyed by `(metric, scope-fingerprint)`.
6. **Feature flag** — gate the whole `DashboardKPIs` block behind a simple env constant `VITE_DASHBOARD_KPIS_ENABLED` (or just an inline boolean for v1) so the frontend can ship green before backend changes land on master, and so we can hide it if leaderboard load proves expensive.

## Data model changes

### New column on `parties`: `host_goals` JSONB nullable

Shape:
```ts
type HostGoals = Partial<{
  rsvps: number;
  attendees: number;
  newsletterSignups: number;
  walletAddresses: number;
  poapMints: number;
  pageViews: number;
}>;
```

Goal keys mirror `ReportKPIs` stat keys exactly so we can index into them with the same `key` string.

### The 7-places change list (single column, single pass)

1. **DB migration** — `backend/prisma/migrations/<ts>_add_host_goals_to_parties/migration.sql`:
   ```sql
   ALTER TABLE parties ADD COLUMN host_goals JSONB;
   ```
2. **Column-level GRANT** (REQUIRED per Feb 2026 audit — `parties` no longer has table-level SELECT for anon/authenticated):
   ```sql
   GRANT SELECT (host_goals) ON parties TO authenticated;
   ```
   Decision: host-only data, so GRANT to `authenticated` only — NOT to `anon`. This keeps goals private to the logged-in host (and admins) and avoids leaking host targets to public viewers of the event page. **Confirm with Snax.**
3. **Prisma schema** — `backend/prisma/schema.prisma`, in `model Party { ... }`:
   ```prisma
   hostGoals Json? @map("host_goals")
   ```
   Note: real table is `parties` via `@@map("parties")` at line 214 — migration must target `parties`, not `Party`.
4. **Backend PATCH handler** — `backend/src/routes/party.routes.ts`: add `hostGoals` to the destructured body and to `prisma.party.update({ data: { ... } })`. Add a tiny shape-validator (drop non-numeric values, clamp negatives to 0, cap at e.g. 1,000,000).
5. **`updatePartyApi`** (`frontend/src/lib/api.ts`) — add `hostGoals: data.hostGoals` to the body.
6. **`updateParty`** (`frontend/src/lib/supabase.ts`) — add `host_goals?: HostGoals` to the updates signature and pass `hostGoals: updates.host_goals` into `updatePartyApi`.
7. **`dbPartyToParty` mapper** (`frontend/src/contexts/PizzaContext.tsx`) — add `hostGoals: dbParty.host_goals ?? null`.

Plus:
8. **`DbParty` interface** (`frontend/src/lib/supabase.ts` line ~659) — add `host_goals?: HostGoals | null`.
9. **`Party` interface** (`frontend/src/types.ts` line ~214) — add `hostGoals?: HostGoals | null`.
10. **Backend report GET endpoint** (`backend/src/routes/report.routes.ts` line ~107) — include `hostGoals: party.hostGoals` on the returned `report` object so the dashboard wrapper can read goals out of the same payload it's already fetching for stats.
11. **`EventReport` interface** (`frontend/src/types.ts` line ~619) — add `hostGoals?: HostGoals | null`.
12. **`safeColumns`** — verified does NOT exist as a constant in this repo; public party read path uses explicit column lists inside `getPartyByCustomUrl` / `getPartyByInviteCode`. Do NOT add `host_goals` there — goals are host-only and arrive via the report endpoint, which gates on `canUserViewReport`.

## Files to create

- `frontend/src/components/gpp-dashboard/DashboardKPIs.tsx` — wrapper: fetches `getReport(party.id)`, derives `pageViewStats`, computes goals/deltas/badges, renders `<LeaderboardPill />` + `<MilestoneBadgeStrip />` + `<ReportKPIs editable={false} gamified={...} />` + confetti overlay.
- `frontend/src/components/gpp-dashboard/MilestoneBadgeStrip.tsx` — horizontal scrollable row of `<KPIBadge />` chips, one per unlocked milestone (greyed/locked for next-up).
- `frontend/src/components/gpp-dashboard/KPIBadge.tsx` — single badge chip (icon + label + "unlocked" / next-threshold hint).
- `frontend/src/components/gpp-dashboard/LeaderboardPill.tsx` — fetches `getLeaderboardRank(partyId, metric)` for a configurable primary metric (default: `totalRsvps`), renders `#N / TOTAL` with a subtle medal icon.
- `frontend/src/components/gpp-dashboard/GoalBar.tsx` — value-vs-goal progress bar with inline "set goal" affordance (number input, debounced PATCH on blur).
- `frontend/src/hooks/useMilestones.ts` — pure function + hook: given current stats, returns `{ unlocked: Milestone[]; justCrossed: Milestone[] }`. First-mount returns an empty `justCrossed` to suppress false-positive confetti. Reads/writes `sessionStorage` key `dashboardKPIs.celebrated.<partyId>` to dedupe.
- `frontend/src/hooks/useMomentum.ts` — given the realtime `guests` array, derives `{ rsvpsLastHour, rsvpsToday, busiestHourLabel }`. Pure derivation off `submittedAt` timestamps.
- `backend/src/routes/leaderboard.routes.ts` — `GET /api/parties/:partyId/leaderboard-rank?metric=<key>`. Returns `{ rank, total, topPercent, scope }`. In-memory `Map` cache with 5-min TTL keyed by `(metric, scope-fingerprint)`.

## Files to modify

- `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx` — render `<DashboardKPIs party={party} guests={guests} />` between the existing "Quick stats" mini-grid and the "Checklist progress" card. Replace/hide the four existing inline tiles since `DashboardKPIs` supersedes them. Current hook order already places all hooks before the early return at line 104 — preserve when adding any new state.
- `frontend/src/components/report/ReportKPIs.tsx` — add `gamified?: GamifiedExtras` prop. In the `if (!editable)` read-only branch only, when `gamified` is provided, render below each tile's value: a `<GoalBar value={value} goal={gamified.goals[stat.key]} onSetGoal={...} />` and a small velocity line (`+3 in the last hour`) from `gamified.deltas[stat.key]`. Apply `class="animate-pulse-once"` when `gamified.pulseKeys.has(stat.key)`. No changes to editable mode.
- `frontend/src/lib/api.ts` — add `getLeaderboardRank(partyId, metric)`; add `hostGoals` field to `updatePartyApi` body; add `updateHostGoals(partyId, hostGoals)` convenience.
- `frontend/src/lib/supabase.ts` — `DbParty` interface + `updateParty` signature.
- `frontend/src/contexts/PizzaContext.tsx` — `dbPartyToParty` mapper. **Do NOT touch the existing `subscribeToGuests` block** — dashboard already inherits realtime via the existing context subscription on `/host/:inviteCode`. Verified at lines 173-179.
- `frontend/src/types.ts` — `Party.hostGoals`, `EventReport.hostGoals`, new `HostGoals` type, new `MilestoneId` enum / `Milestone` type, new `MomentumDelta` type.
- `frontend/src/index.css` — `@keyframes pulse-once` and `.animate-pulse-once { animation: pulse-once 600ms ease-out; }`. Reuse existing `confetti-fly` keyframe powered by `useConfetti`.
- `frontend/src/i18n/locales/{en,zh,pt,ja,fr,es,de}/host.json` — add `dashboard.kpis.*` keys (listed below). **Only 7 locales exist**, not 8 (no `ko` folder). Confirm with Snax whether to add a Korean locale folder.
- `backend/prisma/schema.prisma` — `hostGoals` field on `Party`.
- `backend/src/routes/party.routes.ts` — accept and persist `hostGoals` in the PATCH handler. Mount new leaderboard endpoint as its own router file to avoid the `router.use(mw)` at `/api/parties` blast-radius gotcha.
- `backend/src/routes/report.routes.ts` — include `hostGoals` in `GET /:partyId/report` response.
- `backend/src/index.ts` — `app.use('/api/parties', leaderboardRoutes);` after the existing report-routes mount.

## Step-by-step implementation

Order is critical: **migration → backend deploy → frontend merge** (preview deploys hit production backend).

1. **PR-1 (backend, mergeable independently): DB + Prisma + endpoints.**
   - Write migration SQL (`ALTER TABLE parties ADD COLUMN host_goals JSONB;` + `GRANT SELECT (host_goals) ON parties TO authenticated;`).
   - Add `hostGoals Json? @map("host_goals")` to `model Party` in `schema.prisma`.
   - **Apply the migration to production Supabase BEFORE the PR merges to master.** Prisma schema in master would 500 the backend on missing column otherwise.
   - Add `hostGoals` handling to `PATCH /api/parties/:partyId` and include `hostGoals` in `GET /:partyId/report` response.
   - Create `backend/src/routes/leaderboard.routes.ts` with the new endpoint + 5-min in-memory cache. Mount in `backend/src/index.ts`.
   - Tests: unit-test the leaderboard ranking math (mock prisma), smoke test that PATCHing `hostGoals` round-trips.
   - Merge to master; verify Vercel backend deploy is green; smoke-test `GET /api/parties/:id/leaderboard-rank?metric=totalRsvps`.

2. **PR-2 (frontend, depends on PR-1 live on master backend): types + wrapper + UI.**
   - Update `types.ts` (`Party.hostGoals`, `EventReport.hostGoals`, `HostGoals`, `Milestone`, `MomentumDelta`).
   - Update `DbParty` in `supabase.ts`, add `host_goals` to `updateParty` signature, thread `hostGoals` through `updatePartyApi` in `api.ts`.
   - Update `dbPartyToParty` in `PizzaContext.tsx`.
   - Build `useMilestones`, `useMomentum`, `LeaderboardPill`, `KPIBadge`, `MilestoneBadgeStrip`, `GoalBar`, `DashboardKPIs`.
   - Add optional `gamified` prop to `ReportKPIs` (read-only branch only).
   - Wire `DashboardKPIs` into `GPPDashboardTab.tsx`; remove/hide the existing inline 4-tile mini-grid.
   - Add `pulse-once` keyframe to `index.css`.
   - Add `host.dashboard.kpis.*` keys to all 7 (or 8 if Snax confirms `ko`) locale files.
   - Manual verification on Vercel preview (see Verification).
   - Merge to master.

## Translation strings

New keys under the `host` namespace, all under `dashboard.kpis.*`:

```
host.dashboard.kpis.title                — "Your Event Stats"
host.dashboard.kpis.setGoal              — "Set goal"
host.dashboard.kpis.goalLabel            — "Goal: {{value}}"
host.dashboard.kpis.percentToGoal        — "{{percent}}% to goal"
host.dashboard.kpis.goalHit              — "Goal hit!"
host.dashboard.kpis.deltaLastHour        — "+{{n}} in the last hour"
host.dashboard.kpis.deltaToday           — "{{n}} today"
host.dashboard.kpis.busiestHour          — "Busiest hour: {{label}}"
host.dashboard.kpis.leaderboardRank      — "#{{rank}} of {{total}} {{scope}}"
host.dashboard.kpis.leaderboardTopPct    — "Top {{percent}}% for {{metric}}"
host.dashboard.kpis.leaderboardScopeGpp  — "GPP hosts"
host.dashboard.kpis.badgeUnlocked        — "Unlocked"
host.dashboard.kpis.badgeLocked          — "Next: {{label}}"
host.dashboard.kpis.milestones.first     — "First RSVP"
host.dashboard.kpis.milestones.25rsvps   — "25 RSVPs"
host.dashboard.kpis.milestones.50rsvps   — "50 RSVPs"
host.dashboard.kpis.milestones.100rsvps  — "100 RSVPs"
host.dashboard.kpis.milestones.firstWallet     — "First wallet"
host.dashboard.kpis.milestones.firstNewsletter — "First newsletter signup"
host.dashboard.kpis.milestones.firstPoap       — "First POAP mint"
host.dashboard.kpis.milestones.goalReached     — "Goal reached"
```

All 7 existing locales must be updated in the same PR-2 (`de, en, es, fr, ja, pt, zh`).

## Verification

Snax tests on the Vercel preview:

1. Create a brand-new event from `/start`. Navigate to `/host/:inviteCode`. **Expect:** Dashboard KPIs block renders with all-zero tiles, no badges unlocked, leaderboard pill shows "#N of M GPP hosts" (likely last place), all goals empty with "Set goal" affordance visible.
2. Click "Set goal" on the RSVPs tile, enter `10`, blur. **Expect:** goal bar fills to 0/10, percent label shows `0%`. Reload — goal persists.
3. From a different browser/incognito, RSVP to the event 3 times. **Expect:** in the host's open dashboard tab, the RSVPs tile pulses on each new RSVP, the `First RSVP` badge becomes "Unlocked" on the first one with a brief confetti burst. Velocity footer shows "+3 in the last hour".
4. Continue RSVPing until 10. **Expect:** confetti fires once when the goal is hit; "Goal hit!" label appears.
5. Refresh the dashboard tab. **Expect:** confetti does NOT re-fire (sessionStorage dedupes), badge stays unlocked.
6. Open dashboard in a fresh browser session 10 min later, then RSVP a 25th guest. **Expect:** `25 RSVPs` badge confetti fires, but the earlier (1, 10) milestones do NOT re-fire (first-mount suppression).
7. Check the leaderboard pill across two different events from the same season. **Expect:** ranks are consistent (event A #1, event B #2; not both #1).
8. Hide a stat via `reportStatsConfig` on the report tab. **Expect:** dashboard hides it too (shared config).
9. Visit `/host/:inviteCode` as a co-host without `report` tab access. **Expect:** dashboard KPIs still render (see risk #1 — may need to loosen `canUserViewReport` or add a lightweight endpoint).

## Risks & gotchas

1. **`canUserViewReport` may 403 co-hosts.** Verify against `backend/src/routes/report.routes.ts`. If co-hosts without the `report` tab don't have access, `DashboardKPIs` must gracefully degrade. Decide during PR-1: (a) loosen `canUserViewReport` so any can-edit user can fetch report stats (low risk — they can see those guests already), or (b) add a new lightweight `GET /:partyId/dashboard-kpis` endpoint.
2. **Leaderboard query cost.** Naive `groupBy guests` over hundreds of GPP parties could be slow. 5-min cache mitigates, but if cold-start latency is bad: precompute on a 60-sec interval, or materialized view via Supabase cron. Defer to v2 unless preview shows >500ms cold-fetch.
3. **Table name discrepancy.** Real table is `parties` via `@@map("parties")`. Migration MUST target `parties`, not `Party`.
4. **No `ko` locale folder.** Only 7 locales present. PR-2 either creates `ko/host.json` from scratch or skips. **Recommend skip unless Snax confirms.**
5. **Confetti spam on multi-tile crosses.** If a host imports a huge guest list at once and crosses multiple milestones simultaneously, batch into a single burst when `justCrossed.length > 1`.
6. **First-mount false positive.** On an event with 30 RSVPs already, must NOT fire confetti for every passed milestone. Initial state must be `prevStats = currentStats`. Persist highest-achieved milestones to `sessionStorage` keyed by `partyId` to dedupe across remounts.
7. **`safeColumns` is not a real invariant in this repo.** Public-read protection is the explicit column list in `getPartyByCustomUrl` / `getPartyByInviteCode`. Just don't add `host_goals` to those.
8. **Two PATCH paths.** Add `hostGoals` to BOTH `updatePartyApi` AND `updateParty`. Missing one = repeat bug history.
9. **Preview-hits-prod-backend.** PR-2 preview deploys cannot test the new backend until PR-1 is on master.
10. **Hooks-above-early-returns in `GPPDashboardTab.tsx`.** Preserve current ordering. Most new state belongs inside `DashboardKPIs` itself.

## Resolved decisions (Snax, 2026-05-20)

1. **Leaderboard scope:** **current season GPP** — filter by `eventType = 'gpp'` AND matching `eventTags` season tag. If the event has no season tag, fall back to all-GPP (don't show a broken pill).
2. **Goal-setting UI:** **inline-in-tile.** Click the empty goal bar (or a small "Set goal" affordance on hover) → number input appears in place → blur to save. Reversible; no confirm step.
3. **Co-host access:** **yes — co-hosts (any role with edit access on the party) see dashboard KPIs.** During PR-1, loosen `canUserViewReport` so any can-edit user can fetch report stats (low risk — they already see the guest list). Do NOT add a separate `/dashboard-kpis` endpoint; reuse `/report`.
4. **Locale set:** **stay at 7** — `de, en, es, fr, ja, pt, zh`. Do NOT create `ko/host.json`.
5. **Primary leaderboard metric:** **`totalRsvps`** (no rotation in v1).
6. **`GRANT host_goals`:** **`authenticated` only** — NOT `anon`. Goals are host-private; do not leak to public viewers of the event page.
