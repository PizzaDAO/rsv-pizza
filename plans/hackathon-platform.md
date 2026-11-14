# Hackathon platform (host app, any event; default on for `create_flow = 'hackathon'`)

Owner request: "Monad: let's build our own hackathon platform as part of this."
Status: plan only. Written against `origin/master` @ 5ddb864d (2026-11-14). The local checkout
(`maplibre-v6`) is stale; implementers must branch from current `master`.

## 1. Goal

Make a hackathon a first-class part of an RSV.Pizza event, so a host can run the whole thing from
the host page without Devpost/DoraHacks:

tracks + prizes + rules + deadline + rubric -> participants form teams and submit projects ->
invited judges score on the rubric -> host sees a leaderboard and finalizes winners -> public
gallery + winners page + TV display -> prize payout tracking. Public (people's-choice) voting is
included per the owner's decision.

It is **generic**: any event can enable the "Hackathon" host app. It's on by default only for
events created through a series whose `create_flow = 'hackathon'` (today that's `monad` on
monad.rsv.pizza). There's no Monad-specific code; branding comes from the existing theme/brand
config.

It also makes the Monad host checklist items (`Publish tracks, prizes and rules`, `Set up the
submission platform`, `Line up judges and mentors`, `Run demos and judging`, `Post winners and
photos`, `Send prizes to winners`) first-class: each one deep-links into the app (`link_tab =
'hackathon'`), and most auto-complete from hackathon state.

## 2. Competitor table stakes (brief)

- **Devpost**: project gallery per hackathon, team + project pages (tagline, story, built-with,
  repo, video, images), host-defined judging criteria (commonly a 1-5 scale), external/guest
  judges, multi-round judging, public "popular choice" voting, CSV export. Organizers cite
  CSV export and the gallery as essentials.
- **DoraHacks (BUIDL)**: tracks with sponsor-specific prizes, invited external judges who score
  and comment per track and can revise until the organizer closes judging, a score breakdown for
  winner assignment, community/quadratic voting (MACI), prize fund distribution from the dashboard
  (crypto, via a partner).
- **ETHGlobal showcase** (from general knowledge; not confirmed by this search): a permanent public
  project showcase, sponsor prize tracks (one project can enter several sponsor prizes), finalist
  round with live demos, "built with" tags.
- **Luma**: no hackathon features (registration only). That's the gap we fill: RSVP, approval,
  check-in, and hackathon in one place.

What this means for MVP: tracks with per-track prizes, teams via invite link, a rich project page,
a rubric with per-judge scores and comments that judges can edit until close, a leaderboard, a
winners reveal, a public gallery, CSV export, and payout status per award. Quadratic voting,
AI shortlisting, and multi-round judging come later.

## 3. Owner decisions (resolved)

1. **Public voting: YES.** It ships in its own PR right after the gallery (Phase 2, PR 7). It
   depends on the public gallery and isn't needed to run judging. Rules:
   - Login is required (email code). No anonymous votes.
   - One vote per logged-in user per scope. The scope is event-wide or per track (host setting).
   - Eligibility is a host setting: `logged_in` (any account), `registered` (approved guest of
     this event), or `checked_in` (default for in-person events: `checked_in`).
   - The host controls the window (`votingOpensAt` / `votingClosesAt`, plus manual open/close).
   - Tallies are hidden from everyone, including the host, until the window closes. The host
     only sees a total vote count while voting is open.
   - Voters can't vote for their own team's project.
2. **Team size: configurable per event.** `teamMinSize` (default 1, so solo is allowed) and
   `teamMaxSize` (default 5). Submission is blocked while a team is below the minimum, and joining
   is blocked at the maximum.
3. **Blind judging: per-event host setting, default OFF.** When it's ON, the judge view hides team
   name, member names and avatars, and withholds repo, demo video, deck and live URLs until that
   judge has saved a score for that project. This is enforced server-side: the fields are left out
   of the API response, not just hidden in the UI.
   - **Caveat (show in the host UI):** blinding is best-effort. Project name, description,
     screenshots and the links themselves (GitHub org, YouTube channel) can identify a team.

## 4. MVP scope vs later

### MVP (Phases 1-2)
- **Host app "Hackathon"**:
  - Settings: rules (markdown), submission opens/deadline, team min/max, max tracks per
    submission, eligibility (`registered` | `checked_in`), blind judging, gallery visibility.
  - Tracks.
  - Prizes: overall or per track, rank, amount/currency text, quantity.
  - Rubric: criteria with weight and max score.
  - Judges: invite by email, optionally scoped to tracks.
  - Submissions list, with moderation (disqualify/restore).
  - Leaderboard (overall and per track).
  - Award winners.
  - Reveal results.
  - Payout status per award.
  - CSV export.
- **Participant flow** (on the event page; login required):
  - Create a team, or join one with an invite code/link. Leave a team. The captain can remove
    members and rename the team.
  - One team per person per event.
  - Create or edit the submission: name, tagline, description, repo URL, demo video URL,
    deck/link URL, live URL, track(s), cover plus up to 6 screenshots.
  - Save a draft, then submit. Editing is allowed until the deadline. After the deadline it's
    read-only for participants; the host can still edit or extend the deadline.
- **Judge UI** (`/judge/:inviteCode`):
  - Queue of assigned submissions (in their tracks), with scored/unscored status.
  - Scoring form: per-criterion slider/buttons, a private comment for hosts, and optional
    feedback for the team (feedback is stored now and only shown to teams in Phase 3).
  - Judges can edit scores until the host closes judging.
- **Public**:
  - A hackathon section on the event page: tracks, prizes, rules, deadline countdown, and a
    "Join / Submit" CTA.
  - Gallery `/:slug/projects` and project page `/:slug/projects/:projectSlug`, visible only
    after the host reveals them.
  - Winners section.
- **Display/TV**: a new display content type `hackathon` with modes `countdown` | `gallery`
  (rotating projects) | `winners`. It's served through the existing public
  `/displays/view/:partyId/:slug` and only exposes data that's already public.
- **Payout tracking**:
  - Simple status per award: `unpaid` | `pending` | `paid` | `not_applicable`.
  - Fields: recipient (team member user), wallet/handle, reference/tx hash, paid at, notes.
  - This doesn't integrate with the host-reimbursement `payouts` system. That system models host
    reimbursements, with receipts, tax forms, the PizzaDAO treasury and admin review, which is a
    different domain (see open question Q4).

### Phase 2 (in the initial roadmap)
- Public voting (PR 7, rules in section 3) and a "People's Choice" prize kind fed by the vote
  tally.

### Later (not planned in detail)
- Team-facing judge feedback after reveal.
- Finalist round: shortlist, then a second rubric or live-demo ranking.
- Per-judge score normalization (z-score) to correct for harsh or lenient judges.
- Judge assignment balancing, so each project gets N judges.
- Demo schedule/table numbers on the display.
- Mentor office-hours queue.
- "Looking for team" board.
- Devpost CSV import/export compatibility.
- Sponsor-owned tracks via the existing `Sponsor` CRM (`sponsorId` on track) and sponsor-judges.
- Crypto prize sends via the series funding wallet (`event_series.funding_wallet_address`).
- NFT "participant/winner" badges via the existing NFT minting.
- AI-assisted shortlist.
- Quadratic voting.
- New emails (judge invite, submission receipt, winner notification). Each one needs owner OK.

## 5. Data model (Prisma + SQL migrations)

All new tables live in `public`, are owned by the backend (Prisma), and have RLS ENABLED with no
policies and `REVOKE ALL ... FROM anon, authenticated`. Same pattern as
`backend/prisma/migrations/sfincione-40417-8-submissions.sql`.

Every table goes into `scripts/anon-no-access-tables.json`, in the same PR, **after** the
migration is applied to prod. The checker fails on tables that don't exist.

The migration file naming follows the recent convention: `backend/prisma/migrations/hackathon-1-core.sql`,
`hackathon-2-voting.sql`. Each is idempotent (`IF NOT EXISTS`), wrapped in `BEGIN; SET LOCAL lock_timeout='5s'; ... COMMIT;`,
and applied to prod by a `backend/scripts/apply-hackathon-migration.cjs` script before the PR that
adds the Prisma fields merges. `npm --prefix backend run check:schema-drift` must pass.

Models (column names are snake_case via `@map`, UUID PKs, `timestamptz` timestamps):

- **Hackathon** (`hackathons`). One per party (`party_id UNIQUE`, FK RESTRICT, see the delete rules in section 16). A row existing
  means the app is enabled.
  - Content and schedule: `rules` (text), `submissions_open_at`, `submission_deadline`.
  - Team and track rules: `team_min_size` int default 1 CHECK >= 1, `team_max_size` int default 5
    CHECK >= team_min_size and <= 20, `max_tracks_per_submission` int default 1, `eligibility`
    ('registered' | 'checked_in', default 'registered').
  - Judging: `blind_judging` bool default false, `judging_status` ('not_started' | 'open' |
    'closed').
  - Visibility and reveal: `published_at` (tracks/prizes/rules visible on the event page),
    `gallery_visibility` ('hidden' | 'after_deadline' | 'after_reveal', default 'after_reveal'),
    `results_revealed_at`.
  - Voting (added in hackathon-2): `voting_enabled`, `voting_scope` ('event' | 'track'),
    `voting_eligibility` ('logged_in' | 'registered' | 'checked_in'), `voting_opens_at`,
    `voting_closes_at`.
  - Bookkeeping: `created_at`, `updated_at`.
- **HackathonTrack** (`hackathon_tracks`): `hackathon_id`, `name` (<=80), `description` (<=2000),
  `sponsor_name` nullable, `sort_order`.
- **HackathonPrize** (`hackathon_prizes`): `hackathon_id`, `track_id` nullable (null = overall),
  `name`, `description`, `rank` int nullable, `amount_text` (free text such as "$5,000" or "2,500
  MON"), `amount_value` numeric nullable, `currency` text nullable, `quantity` int default 1,
  `kind` ('judged' | 'peoples_choice'), `sort_order`.
- **HackathonCriterion** (`hackathon_criteria`): `hackathon_id`, `name`, `description`, `weight` int
  default 1 (1..10), `max_score` int default 5 (1..10), `sort_order`.
- **HackathonTeam** (`hackathon_teams`): `hackathon_id`, `name` (<=80), `invite_code` (unique,
  10-char base32 random from `crypto.randomBytes`), `created_by_user_id` FK `"User"(id)`,
  `created_at`.
- **HackathonTeamMember** (`hackathon_team_members`): `team_id` FK cascade, `hackathon_id`
  (denormalized), `user_id` FK `"User"`, `guest_id` nullable FK `guests` ON DELETE SET NULL,
  `role` ('captain' | 'member'), `joined_at`. Unique on `(hackathon_id, user_id)`, which enforces
  one team per person per event.
- **HackathonSubmission** (`hackathon_submissions`): `hackathon_id`, `team_id` UNIQUE (one project
  per team).
  - Text fields: `name` (<=80), `slug` (unique per hackathon), `tagline` (<=140), `description`
    (<=10000, markdown rendered with the existing sanitizer).
  - Links (validated, <=500 each): `repo_url`, `demo_video_url`, `deck_url`, `live_url`.
  - Images: `cover_path`, `screenshot_paths` text[] (<=6). These are storage paths, never
    arbitrary URLs.
  - State: `status` ('draft' | 'submitted' | 'disqualified' | 'withdrawn'), `submitted_at`,
    `disqualified_reason`, `table_number` nullable, `created_at`, `updated_at`.
- **HackathonSubmissionTrack** (`hackathon_submission_tracks`): PK `(submission_id, track_id)`.
- **HackathonJudge** (`hackathon_judges`): `hackathon_id`, `email` (trimmed + lowercased,
  CHECKed), `name`, `user_id` nullable (linked on first authenticated visit), `status`
  ('active' | 'removed'), `invited_by`, `created_at`. Unique on `(hackathon_id, email)`.
- **HackathonJudgeTrack** (`hackathon_judge_tracks`, replaces the earlier `track_ids` uuid[]):
  PK `(judge_id, track_id)`, `hackathon_id`, composite FKs to the judge and the track of the
  same hackathon, CASCADE on judge/track delete. No rows for a judge = all tracks, so stale
  track ids can't exist.
- **HackathonScore** (`hackathon_scores`): `hackathon_id`, `judge_id` and `submission_id` (composite FKs, NO ACTION),
  `criterion_scores` jsonb (`{criterionId: int}`, validated against the rubric on write),
  `total` numeric (weighted, normalized to 0-100, computed on write), `private_comment` (<=2000),
  `team_feedback` (<=2000), `updated_at`. Unique on `(judge_id, submission_id)`.
- **HackathonAward** (`hackathon_awards`): `hackathon_id`, `prize_id` (composite FK, NO ACTION), `submission_id` (composite FK, RESTRICT),
  `place` int nullable, `awarded_at`, `awarded_by`. Payout tracking: `payout_status`,
  `recipient_user_id`, `recipient_wallet`, `payout_reference`, `paid_at`, `payout_notes`. Unique on
  `(prize_id, submission_id)`.
- **HackathonVote** (`hackathon_votes`, migration 2): `hackathon_id`, `track_id` nullable,
  `submission_id`, `voter_user_id`, `ip_hash` (sha256(ip + secret), for abuse review only),
  `created_at`, `updated_at`. Unique on `(hackathon_id, COALESCE(track_id, '0000...'),
  voter_user_id)` via a raw-SQL expression index, the same approach as checklist_defaults'
  COALESCE unique.

**Storage**: a new **private** bucket `hackathon-media`, created in the Supabase dashboard (images
only: jpeg/png/webp/avif/heic/gif, 10 MB cap). Uploads use the signed-upload-URL pattern from
`backend/src/routes/pizza-index-submissions.routes.ts`, so bytes never pass through Express. The
backend returns signed read URLs, or proxies public URLs only for revealed projects.

Why private and not `event-images`: pre-reveal screenshots must not be enumerable or readable by
URL, which matters for blind judging and pre-reveal secrecy. Orphan cleanup follows the
pizza-index `cleanupOrphanedUploads` pattern.

**Score aggregation (MVP)**:
- Per judge: `total = 100 * sum(w_i * s_i / max_i) / sum(w_i)`.
- Per submission: the mean of judge totals, plus `judgeCount` and the min/max spread.
- Rankings are per track and overall.
- Ties are shown as ties; the host decides.
- Normalization comes later.

## 6. Identity

- **Participants and voters must be logged in** (existing email code / magic link,
  `backend/src/lib/loginCode.ts`). Teams span devices and days, and votes need a durable
  identity, so the stateless guest token isn't enough on its own.
- Guest-token holders (`X-Guest-Token`, `backend/src/lib/guestToken.ts`) see the CTA "Log in to
  join the hackathon" with their RSVP email prefilled. That uses the existing login-code email,
  so it's not a new send.
- **Eligibility check** (`lib/hackathon/eligibility.ts`): the caller's JWT email
  (case-insensitive) must match a `guests` row for the party. The row must have
  `approved !== false`, `status = 'CONFIRMED'` (not waitlisted), and `checked_in_at IS NOT NULL`
  when `eligibility = 'checked_in'`.
  - Hosts, co-hosts and judges are not eligible as participants by default (open question Q6).
  - The guest id is stored on the member row so the host can see who's on which team in the
    guest list.
- **Judges**: matched by JWT email against `hackathon_judges.email` (status active). On first
  visit, `user_id` is linked.
  - Judges get no host-page access. This is a separate, narrower role than co-hosts, because
    co-host `allowedTabs` can't express "read submissions + write my own scores only".
- **Hosts**: `canUserEditParty` + `canUserAccessTab(..., 'hackathon')`
  (`backend/src/helpers/partyAccess.ts`). Super-admins pass. Series admins work however they do
  today (no change).

## 7. API routes and authz matrix

New files:
- `backend/src/routes/hackathon.routes.ts`: host and participant routes, mounted at
  `/api/parties` before `partyRoutes`, like raffle.
- `backend/src/routes/hackathon-judge.routes.ts`: mounted at `/api/hackathon-judge`.
- `backend/src/routes/hackathon-public.routes.ts`: public reads plus voting, mounted at
  `/api/parties`, with an explicit allowlist of returned fields.

Shared helpers go in `backend/src/lib/hackathon/` (`access.ts`, `eligibility.ts`, `scoring.ts`,
`urls.ts`, `inviteCode.ts`, `serialize.ts`). `serialize.ts` holds the public, judge, blind-judge
and host shapes, and is unit-tested so that private fields never leak.

| Route | Public | Participant (eligible, logged in) | Team member | Judge | Host / co-host (tab) / admin |
|---|---|---|---|---|---|
| `GET /:partyId/hackathon` (config, tracks, prizes, rubric names, deadline) | if `published_at` | yes | yes | yes | yes (+ drafts) |
| `PUT /:partyId/hackathon` (enable/settings), tracks/prizes/criteria CRUD | - | - | - | - | yes |
| `POST /:partyId/hackathon/enable` / `DELETE` (disable = soft: hide; hard delete only if no submissions) | - | - | - | - | yes |
| `GET /:partyId/hackathon/me` (eligibility, my team, my submission) | - | yes | yes | yes (judge flag) | yes |
| `POST /:partyId/hackathon/teams` (create, caller = captain) | - | yes | - | - | - |
| `POST /:partyId/hackathon/teams/join` `{code}` | - | yes, if size < max and before deadline | - | - | - |
| `POST .../teams/:teamId/leave`, `PATCH .../teams/:teamId` (rename), `DELETE .../members/:memberId` | - | - | yes (rename/remove: captain) | - | yes |
| `POST .../teams/:teamId/regenerate-code` | - | - | captain | - | yes |
| `PUT .../submission` (upsert draft), `POST .../submission/submit`, `POST .../submission/withdraw` | - | - | yes, before deadline | - | yes (any time) |
| `POST .../hackathon/upload-url` `{mimeType,fileSize}` | - | - | yes | - | yes |
| `GET /:partyId/hackathon/submissions` (full, incl. members/emails, scores summary) | - | - | - | - | yes |
| `PATCH .../submissions/:id` (disqualify/restore, table number) | - | - | - | - | yes |
| judges CRUD `.../hackathon/judges` | - | - | - | - | yes |
| `POST .../hackathon/judging` `{status: open/closed}` | - | - | - | - | yes |
| `GET .../hackathon/leaderboard` (per-judge breakdown, comments) | - | - | - | - | yes |
| awards CRUD + `PATCH .../awards/:id/payout` | - | - | - | - | yes |
| `POST .../hackathon/reveal` / `unreveal` | - | - | - | - | yes |
| `GET .../hackathon/export.csv` | - | - | - | - | yes |
| `GET /api/hackathon-judge/:partyId/queue`, `GET .../submissions/:id` | - | - | - | yes (scoped tracks; blind shape if `blind_judging` and not yet scored) | - |
| `PUT /api/hackathon-judge/:partyId/submissions/:id/score` | - | - | - | yes, while `judging_status = open` | - |
| `GET /:partyId/hackathon/gallery`, `GET .../projects/:slug` | when visible per `gallery_visibility`; only `submitted` | same | own draft visible to own team | - | yes |
| `GET /:partyId/hackathon/winners` | after `results_revealed_at` | same | same | - | yes |
| `POST /:partyId/hackathon/votes` `{submissionId, trackId?}` / `GET .../votes/mine` | - | if eligible per `voting_eligibility`, window open, not own project | same | same | same |
| `GET .../hackathon/votes/tally` | after close + reveal | - | - | - | after close (count only while open) |

Notes:
- Event-page addressing: the frontend already resolves slug or invite code to a party. All routes
  take `partyId` (uuid, validated with `isUuid`).
- Public serializers never return emails, user ids, guest ids, scores or private comments, and
  never return draft or disqualified projects.
- Team members on public pages are shown as name + avatar only, with an opt-out toggle per
  member (`show_on_gallery`, default true; add the column to members).
- Add `'hackathon'` to `VALID_TAB_IDS` (`backend/src/helpers/partyAccess.ts`) and to the
  broadcast catalog (`backend/src/lib/broadcastApps.ts` + `frontend/src/lib/appDefinitions.ts`
  `BROADCAST_APPS`; the invariant test enforces both).
- Deadline enforcement is server-side, using server time and `submission_deadline`. The host can
  extend the deadline.

## 8. Frontend

Follow the CLAUDE.md component rules: `IconInput` (incl. `multiline`), `Checkbox`, placeholders
not labels, the `LoginModal` pattern for modals, `Layout`. No raw inputs.

- **Host app**:
  - Add `{ id: 'hackathon', name: 'Hackathon', tab: 'hackathon', icon: Trophy }` to
    `PINNABLE_APPS` (`frontend/src/lib/appDefinitions.ts`) and the `AppsHub.tsx` catalog.
  - Add the `activeTab === 'hackathon'` branch in `frontend/src/pages/HostPage.tsx`, lazy-loaded.
  - `frontend/src/components/hackathon/HackathonTab.tsx` has sub-sections with a pill nav:
    - **Setup**: enable, schedule, team size, eligibility, blind toggle with caveat text, rules.
    - **Tracks & Prizes**.
    - **Judging**: rubric, judges list with "copy judge link", open/close judging.
    - **Submissions**.
    - **Leaderboard**: per track, expandable per-judge breakdown.
    - **Winners & Payouts**: award picker per prize, payout status table, reveal button, CSV
      export.
    - **Voting** (PR 7).
  - The disabled state shows an "Enable Hackathon" card.
- **Event page** (`EventPage.tsx`): a `HackathonSection` renders when the hackathon is published.
  It shows tracks/prizes/rules (collapsible), the deadline countdown, and the participant CTA.
  - CTA states: "Log in", "RSVP first", "Waiting for approval/check-in", "Create or join a team",
    "Edit submission", "Submitted".
  - After reveal, a winners strip and a "View all projects" link.
- **Participant**:
  - `HackathonTeamModal`: create, join by code, member list, copy invite link.
  - `/:slug/hack/join/:code`: a join landing page that resolves the event and opens the modal
    after login.
  - `HackathonSubmissionForm`: a full-page route `/:slug/hack/submit`, with autosaved draft,
    track multi-select capped by `max_tracks_per_submission`, and image uploader using the
    signed-upload helper in `frontend/src/lib/hackathonApi.ts`.
- **Judge**: `/judge/:inviteCode` (`frontend/src/pages/JudgePage.tsx`).
  - Login gate, then a queue sorted with unscored first, then the scoring panel.
  - In blind mode it shows a "Links unlock after you save a score" placeholder.
  - It's mobile-first, since judges walk around demo tables.
- **Public gallery**: `/:slug/projects` (grid with track filter, winners badged) and
  `/:slug/projects/:projectSlug`.
  - Video embeds only for allowlisted hosts (YouTube, Vimeo, Loom); everything else is a link.
  - OG tags use the cover image through the existing OG path if there is one; otherwise defer.
- **Display**:
  - Add a `'hackathon'` content type to `display.routes.ts` `validContentTypes`, and a
    `HackathonDisplay` component in `DisplayPage.tsx` (modes: countdown / gallery rotation /
    winners).
  - The display endpoint embeds only public-serializer data. It polls every 30s, the same as the
    existing photos display.
- Routes are added in `frontend/src/App.tsx` and must not be in `GPP_ONLY_PATHS`, so they work on
  brand sites. The implementer must confirm that the `/:slug/...` nesting doesn't collide with the
  existing slug catch-all route.
- **Hooks**: any new hook stays above early returns. CI's `react-hooks/rules-of-hooks` gate
  catches the black-screen class of bug.
- **Theming**:
  - Use the existing semantic classes and CSS variables only, so the `.monad-theme` light theme
    (`frontend/src/index.css` ~L830) and the Team1 dark theme apply automatically. No hardcoded
    `#6E54FF` and no "Monad" copy.
  - Copy comes from `BRAND` where brand names appear. The brand-check CI blocks new hardcoded
    `rsv.pizza` strings.
  - Verify the new tab, judge page, gallery and display on the monad preview: the light theme is
    where `text-white/..` style classes break.

## 9. Defaults for the hackathon create flow + checklist

- `backend/src/lib/createPresets.ts` and `frontend/src/config/createPresets.ts`: add `'hackathon'`
  to `hackathon.pinnedApps`. Update both preset tests.
- `backend/src/lib/brandCreate.ts`: when `preset.key === 'hackathon'`, create the `Hackathon` row
  in the same transaction as the party, with `submission_deadline` = event end and defaults from
  section 3.
- Backfill: a one-off script `backend/scripts/enable-hackathon-for-series.cjs <seriesSlug>`
  (dry run by default, `--apply`) creates rows for existing events in hackathon-flow series. Run
  it for `monad` after PR 2 deploys.
- Checklist:
  - Set `link_tab = 'hackathon'` and `is_auto/auto_rule` on the Monad `checklist_defaults`, through
    the existing `seed-brand-checklists.cjs` / `apply-brand-checklists.cjs` path, and patch
    existing `checklist_items` rows for monad parties the same way.
  - Rules computed in the frontend `AutoCompleteStates` from a light
    `GET /:partyId/hackathon/summary` (host-only):

    | Checklist item | Auto rule | Done when |
    |---|---|---|
    | Publish tracks, prizes and rules | `hackathon_published` | published_at set, >= 1 track, >= 1 prize |
    | Set up the submission platform | `hackathon_submissions_ready` | deadline set, rubric >= 1 criterion |
    | Line up judges and mentors | `hackathon_judges_added` | >= 1 active judge (mentors stay manual) |
    | Run demos and judging | `hackathon_judging_closed` | judging closed |
    | Post winners and photos | `hackathon_results_revealed` | revealed (photos stay manual) |
    | Send prizes to winners | `hackathon_prizes_paid` | all awards `paid` or `not_applicable` |

  - Icons go in `checklistIcons.ts` and actions in `checklistActions.ts`, which open the right
    sub-section.

## 10. Emails

**No new sends in MVP.**
- Judges get a copyable `/judge/:inviteCode` link from the host (the host shares it however they
  like). Logging in uses the existing login-code email.
- Teammates join with a copyable invite link.
- Winners see the result on the reveal.

Candidates for later, each needing owner OK: judge invite email, "your team submitted" receipt,
deadline reminder to teams with drafts, winner notification + payout details request.

## 11. Anti-abuse and safety

- **Rate limits** (express-rate-limit, as in `pizza-index-submissions.routes.ts`):
  - team create/join: 10/hr per user
  - submission writes: 60/hr per user
  - upload-url: 30/hr per user and per IP
  - votes: 20/hr per user
  - judge score writes: 300/hr per judge
- **Invite codes**: 10 random base32 chars (~50 bits). Join attempts are rate-limited and the
  captain can regenerate the code. A failed join never reveals the team name.
- **URLs** (`lib/hackathon/urls.ts`, unit-tested): `https:` only (http upgraded or rejected),
  <=500 chars, no credentials in the URL, no IP-literal or localhost hosts. Rendered with
  `rel="noopener noreferrer nofollow ugc"`. Video embed only for an allowlisted host set; the
  rest are plain links. We never fetch them server-side, so there's no SSRF surface.
- **Uploads**: images only, MIME and size checked at signed-URL issue (10 MB) and by the bucket.
  Max 7 images per project. Paths are namespaced `hackathonId/submissionId/...`. The finalize
  step checks that the object exists and is under the submission's prefix.
- **Text**: length caps above. Markdown goes through the existing sanitizer (whatever
  `EventPage` uses for descriptions). No raw HTML.
- **Moderation**: host disqualify/hide. Gallery shows only `submitted` projects.
- **Voting**:
  - Login and eligibility, plus a unique index per scope.
  - Self-vote blocked.
  - Window enforced server-side.
  - `ip_hash` is stored so the host/admin can review clusters (no auto-blocking in MVP).
  - The `checked_in` default makes email-farm sybils useless for in-person events.
  - Optional host setting (later): "accounts created before voting opened only".
- **Authz tests**: a route-level test per row of the matrix, following the pattern of
  `raffle`/`photo.routes.test.ts`. They include the blind-judge serializer and "public never sees
  drafts, emails, scores".

## 12. Realtime

None. Do not add any table to `supabase_realtime`, because the publication allowlist check would
fail and it's an incident risk (see CLAUDE.md). Instead:
- the host leaderboard and judge queue refresh on focus and poll every 30s while visible
- the display polls every 30s
- the vote count polls every 60s

## 13. Phased delivery (each PR independently shippable; migrations applied to prod first)

| # | PR | Contents | Size |
|---|---|---|---|
| 1 | `hackathon-1-schema` | `hackathon-1-core.sql` (all MVP tables, RLS on, REVOKE), apply script, Prisma models, `anon-no-access-tables.json` additions, create bucket `hackathon-media` (dashboard). **Apply SQL to prod before merge**; schema-drift and RLS-anon CI green. No routes yet. | S |
| 2 | `hackathon-host-setup` | Host routes: enable, settings, tracks, prizes, criteria, judges CRUD. `VALID_TAB_IDS`, broadcast catalog, `PINNABLE_APPS`/AppsHub, HostPage tab (Setup, Tracks & Prizes, Judging-config). Public `GET /hackathon` + EventPage `HackathonSection` (read-only info). createPresets + brandCreate default-on. Backfill script for monad. Checklist link_tab + auto rules (`hackathon_published`, `_submissions_ready`, `_judges_added`). | L |
| 3 | `hackathon-teams-submit` | Eligibility, teams (create/join/leave/captain), invite link page, submission draft/submit/withdraw, signed uploads, URL validation, rate limits, deadline enforcement. Host Submissions list + moderation + CSV export. | L |
| 4 | `hackathon-judging` | Judge routes + `/judge/:inviteCode` page, blind serializer, score write with rubric validation, open/close judging, host Leaderboard. Checklist `hackathon_judging_closed`. | M-L |
| 5 | `hackathon-winners` | Awards, reveal/unreveal, winners on event page, payout status table, checklist `_results_revealed`/`_prizes_paid`. | M |
| 6 | `hackathon-gallery-display` | Public gallery + project pages, `gallery_visibility`, `hackathon` display content type (countdown/gallery/winners). | M |
| 7 | `hackathon-voting` | `hackathon-2-voting.sql` (votes table + hackathon voting columns; prod first; add to no-access list), voting settings UI, vote button on gallery/project pages, tally after close, People's Choice prize kind auto-ranked from tally. | M |

PRs 5 and 6 can swap or run in parallel after 4. PR 6 only depends on 3, since the gallery
renders whether or not there are winners.

## 14. Risks

- **Schema-before-code**: the Prisma model must not merge before the tables exist in prod (the
  2026-05-17 incident class). PR 1 is schema-only and applied first. PR 7's columns on
  `hackathons` follow the same order.
- **Data leaks through public endpoints** (the guests-anon class): all access goes through the
  backend, there are no anon grants, and centralized serializers have tests. The display endpoint
  is public, so it must use the public serializer.
- **Blind judging is leaky by nature.** Documented in the UI.
- **Identity mismatch**: guests who RSVP'd with one email and log in with another fail the
  eligibility check. The UI needs to explain "log in with the email you RSVP'd with". The host can
  fix this by editing the guest email.
- **Vercel 4.5 MB body limit**: avoided by signed uploads.
- **Light theme regressions on monad**: verify on the preview.
- **Scope creep** (finalists, normalization, sponsor portals): explicitly deferred.
- **Pooler**: no session `SET`s in any script (memory: DATABASE_URL is the 6543 transaction
  pooler). Use `SET LOCAL` inside transactions only.
- **Prize money and tax**: tracking only. No funds move in MVP. If winners get paid from PizzaDAO
  or series treasuries later, tax-form/KYC requirements need a separate plan.

## 15. Verification

- **Unit tests (vitest, backend)**: `scoring.ts` (weights, max normalization, missing criterion
  rejected), `urls.ts`, `inviteCode.ts`, `eligibility.ts` (approved / waitlisted / declined /
  checked-in modes, email case), the serializers (public / judge / blind-before-score /
  blind-after-score / host), and the vote rules (window, scope uniqueness, self-vote).
- **Route tests**: the authz matrix (anonymous, non-eligible user, eligible user, team member,
  captain, judge out of track scope, removed judge, co-host without `hackathon` tab, host).
  Deadline passed. Team full. Second team join is rejected.
- **CI gates**: rules-of-hooks lint, brand-check, schema-drift, RLS anon-exposure (new tables in
  the no-access list), and `vite build` / `tsc`.
- **Prod DB after PR 1**: confirm in `information_schema.role_table_grants` that anon and
  authenticated have nothing on `hackathon_%`, then run `scripts/check-rls-anon-exposure.js`
  locally.
- **Vercel preview** (`https://rsvpizza-git-<branch>-pizza-dao.vercel.app`, plus the monad brand
  preview). Previews share the prod backend, so backend routes must be deployed (merged) before
  the frontend preview can use them. Order frontend-only verification accordingly, or merge
  backend-first within a PR.
  1. On a throwaway test event, enable the app, add 2 tracks, 3 prizes and a 3-criterion rubric,
     then publish. The event page shows the section.
  2. With two test accounts, both approved as guests: A creates a team, B joins via the link, the
     team submits with screenshots, and edits after the deadline are rejected.
  3. Add a judge email, log in as the judge, and score. With blind ON, the links are hidden until
     the score is saved and member names never appear (check the network response, not just the
     UI).
  4. The leaderboard ranks correctly. Award, reveal, and the gallery, winners and display (TV
     mode) render. An incognito window sees nothing before reveal. API calls from incognito
     return no drafts, emails or scores.
  5. Voting: an ineligible account is rejected, a second vote replaces the first, the tally is
     hidden until close.
  6. `/mobile-check` at 390px on the judge page and submission form. Check the monad light theme.
- **Monad rollout**: run the backfill script (dry run, then `--apply`) and re-seed the checklist
  link_tab/auto rules for the monad series. Spot-check one monad event's checklist deep-links.

## 16. Owner decisions on the open questions (resolved 2026-11-14)

The owner approved the plan with the default answer to every open question:

- **Q1. Eligibility**: approved RSVPs (`registered`) can submit. Checked-in attendees can vote
  (`voting_eligibility` default `checked_in`, PR 7).
- **Q2. Tracks per submission**: 1 by default (`max_tracks_per_submission` = 1); the host can
  raise it.
- **Q3. Remote participants**: no virtual / anyone-logged-in-can-submit hackathons for now. The
  MVP stays RSVP-gated.
- **Q4. Prize payouts**: payout status tracking only. No money movement, no tax forms/KYC.
- **Q5. Judge invites**: copyable judge links only, no judge-invite email.
- **Q6. Hosts, co-hosts and judges as participants**: judges can't join teams; co-hosts can.
- **Q7. Devpost**: CSV export only, no Devpost import.
- **Q8. Team-visible judge feedback**: teams see a judge's feedback after the reveal if the judge
  wrote any (empty `team_feedback` = nothing shown, so no separate opt-in flag). Later phase; the
  `hackathon_scores.team_feedback` column ships in PR 1.
- **Q9. Gallery permanence**: projects stay public after the reveal. A series-wide projects page
  comes later.
- **Q10. People's Choice**: voting decides People's Choice only if the host adds a prize with
  `kind = 'peoples_choice'`; it doesn't create a prize automatically.

Also confirmed: public voting = yes (PR 7, its own `hackathon-2-voting.sql`), team size
configurable (default 1-5), blind judging optional and default off.

### PR 1 implementation notes (`hackathon-schema`)

- Migration `backend/prisma/migrations/hackathon-1-core.sql`; runner
  `backend/scripts/apply-hackathon-schema.cjs` (dry run default, `--apply`, guarded
  `--rollback` that refuses while any row exists). The branch is `hackathon-schema`.
- Added beyond section 5, because adding a column later costs another migration-first PR:
  `hackathons.disabled_at` (soft disable, from the route table in section 7),
  `hackathon_team_members.show_on_gallery` (section 7 notes), `updated_at` on tracks, prizes,
  criteria, teams and judges, `created_at` on submission tracks, scores and judges, and length /
  enum CHECKs on the text columns. `table_number` is `text` (e.g. "A12").
- No per-judge invite code column: `/judge/:inviteCode` is read as the party's invite code, and
  judges are identified by JWT email. Revisit in PR 4 if a per-judge token is wanted.
- **Same-hackathon integrity (schema review)**: tracks, prizes, teams, judges and submissions
  have UNIQUE `(id, hackathon_id)`. Team members, prizes (track), submissions (team),
  submission tracks, judge tracks, scores and awards carry `hackathon_id` and use composite FKs
  `(ref_id, hackathon_id) -> parent(id, hackathon_id)`, so no row can point across hackathons.
  Route code must set `hackathon_id` on scores, awards, submission tracks and judge tracks.
- **One captain per team**: partial unique index `hackathon_team_members_one_captain_per_team`
  on `(team_id) WHERE role = 'captain'` (raw SQL, not expressible in Prisma).
- **Slug format**: CHECK `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`.
- **Delete rules**: nothing silently deletes submissions, scores or awards (payout history).
  - RESTRICT: `hackathons.party_id`, `submissions.team_id`, `awards.submission_id`.
  - NO ACTION (blocks a direct delete like RESTRICT, but is checked at the end of the statement
    so a hackathon-level cascade that removes both sides succeeds): `prizes.track_id`,
    `submissions.hackathon_id`, `submission_tracks.track_id`, `scores.judge_id` /
    `submission_id`, `awards.prize_id`.
  - CASCADE: hackathon to its own config (tracks, prizes, criteria, teams, members, judges),
    team to members, submission to submission tracks, judge/track to judge tracks.
  - SET NULL: team creator, judge user, award recipient, member guest.
  - The result: a track with prizes or entries, a team with a submission, a judge with scores,
    and a prize or submission with awards/scores can't be deleted. A hard hackathon delete fails
    while any submission exists. A config-only hackathon deletes cleanly.
- **Party deletion (PR 2 must handle)**: hosts' `DELETE /api/parties/:id` is a soft cancel
  (porchetta-81402), so it's unaffected. The only hard party delete in the backend is
  `DELETE /api/v1/parties/:id` (API key, `backend/src/routes/v1/parties.ts`). Because
  `hackathons.party_id` is RESTRICT, that path will raise a raw FK error (P2003, currently a
  500) for a party with a hackathon row. PR 2 must check for a hackathon row and answer 409
  ("disable the hackathon first"), or delete a config-only hackathon first in the same
  transaction. "User" rows are not hard-deleted anywhere in the code.
- **Apply transaction**: creating the FKs holds SHARE ROW EXCLUSIVE on parties / "User" /
  guests until COMMIT. The runner uses `lock_timeout = 3s` (it fails fast behind a long writer
  instead of queueing writers behind it), runs one aggregated check inside the transaction,
  verifies fully after COMMIT, and prints the elapsed time.

### PR 7 implementation notes (`hackathon-voting`)

- Migration `backend/prisma/migrations/hackathon-2-voting.sql`; runner
  `backend/scripts/apply-hackathon-voting.cjs` (same contract as PR 1: dry run default, `--apply`
  in one short transaction, guarded `--rollback`). **Apply to prod before merging.**
- **Settings are a new 1:1 table `hackathon_voting`, not `hackathons.voting_*` columns** (changes
  §5). Prisma SELECTs every declared field, so new columns on the hot `Hackathon` model would 500
  every hackathon read if the deploy beat the migration; a separate table limits that to the
  voting routes, and `hackathons` takes no ALTER. No row = voting off.
- `hackathon_votes`: one row per (hackathon, scope, voter), unique expression index
  `hackathon_votes_one_per_scope` on `(hackathon_id, COALESCE(track_id, nil-uuid), voter_user_id)`;
  writes are `INSERT ... ON CONFLICT` on that expression (the nil uuid must be a literal, not a bind
  parameter, or Postgres can't infer the index once the statement goes generic). Composite FKs to
  submission / track of the same hackathon; CASCADE from hackathon, submission, track and voter.
  `ip_hash` is a 64-hex HMAC (CHECKed), never an IP.
- Voting eligibility: `registered` | `checked_in` (default). No `logged_in` option (§16 Q3: the
  MVP stays RSVP-gated). Judges, hosts and co-hosts may vote when they qualify.
- Voters may change or retract their vote until close; after close votes are final.
- Re-opening a closed vote (open now, or new times that put now back inside the window) is
  allowed behind a confirm and hides the tallies again, EXCEPT when a People's Choice award
  already exists for the hackathon: 409 `PEOPLES_CHOICE_AWARDED`, "Remove the People's Choice
  award before reopening voting." (owner decision).
- Locking: both sides lock in the same order, hackathons row -> hackathon_voting row. A vote
  takes FOR KEY SHARE on the hackathon then FOR SHARE on the settings row and re-checks the
  window; host writes take FOR UPDATE on both before counting votes (scope lock), so in-flight
  votes commit first. (Locking the settings row before the hackathon row deadlocks against the
  vote INSERT's FK key-share lock: 40P01, reproduced on Postgres 17.)
- Votes only for `submitted` projects while the gallery is open (`gallery_visibility`): with the
  default `after_reveal`, voting starts after the reveal (a People's Choice award added after the
  reveal shows up automatically). The host Voting section explains this.
- Tallies: hidden from everyone (host included) until `closes_at` passes; the host sees only total
  votes / voters and votes per ip_hash bucket while open. The public never gets counts; People's
  Choice winners reach the public only through the awards reveal. Self-votes (by user id, account
  email or RSVP email) are rejected on write and dropped again when counting.
- People's Choice: after close the tally suggests the winner(s) in Winners & Payouts; the host
  awards it. A `peoples_choice` prize can't be awarded while voting is scheduled or open (409).
- Rate limits: 20 vote writes / hour / user. Authenticated (verified JWT) vote writes, voting
  reads and gallery / project page reads skip the per-IP limiters (global and gallery; venue
  Wi-Fi) and use per-user buckets; anonymous reads stay per-IP. The TV display stays per-IP.
- Pending owner decision (not implemented): when a host enables voting while
  `gallery_visibility = 'after_reveal'`, auto-switch the gallery to `after_deadline` with a
  notice. Today the Voting section only warns.

## Sources (competitor scan)

- [DoraHacks: external judges](https://dev.to/dorahacks/new-feature-hackathon-judging-made-easier-with-external-judges-1k97)
- [DoraHacks: judging plan](https://dev.to/dorahacks/how-to-design-a-hackathon-judging-plan-olf)
- [DoraHacks hackathon wiki](https://hellodorahacks.github.io/dorahacks-wiki/features/hackathon)
- [DoraHacks MACI voting](https://dorahacks.io/blog/maci-voting-guide-hello-nft-world/)
- [ETHDenver track judging](https://www.ETHDenver.com/buidl/judging)
- [Devpost judging criteria guide (Eventflare)](https://eventflare.io/journal/crafting-effective-hackathon-judging-criteria-a-step-by-step-guide)
- [What judges score (dev.to)](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
