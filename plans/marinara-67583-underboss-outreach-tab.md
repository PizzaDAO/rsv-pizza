# marinara-67583: /underboss/outreach admin tab

**Priority**: P2
**Type**: Full feature (worktree + draft PR + Vercel preview)
**Depends on**: `stagioni-29104` — the `outreach_communities` table must exist in production before this tab works on any preview deploy. The migration in `stagioni-29104` MUST land (and be applied to prod via `mcp__supabase-pizzadao__apply_migration`) before this branch ships.

## Problem

GPP 2026 outreach (run from `supreme-43217` gap analysis + `stagioni-29104` scrapers) currently has nowhere for an admin to do the actual recruitment work. Snax + underbosses need a single screen that:

1. Lists candidate blockchain communities in uncovered cities (joined from `outreach_communities`).
2. Provides one-click "copy template" actions for Twitter DM / Email / Telegram (the three channels Snax confirmed).
3. Logs every outreach attempt (channel, template, who sent it, when) so we don't double-message a community.
4. Tracks each community's lifecycle: sent → replied → declined → converted → bounced, and when converted, links to the actual `parties` row that the community produced.

Without this, the scraped data from `stagioni-29104` sits in a table no one looks at.

## Approach

A standard rsvpizza feature: backend migration + backend endpoints + frontend tab. No new infrastructure. Reuse:

- `requireAuth` + `requireUnderbossAuth` middleware (proven pattern; see `backend/src/routes/underboss.routes.ts` lines 27-99).
- The existing `UnderbossDashboard.tsx` tab list (events / cities / partners / fake-detection on origin/master) — add an `'outreach'` tab string and a 5th button + 5th render branch.
- `IconInput`, `Checkbox`, and the established `fixed inset-0 bg-black/60 backdrop-blur-sm z-50` modal pattern.
- `apiRequest<T>()` from `frontend/src/lib/api.ts` for all calls.

Message templates are stored **inline** in `frontend/src/lib/outreachTemplates.ts` for v1 (per task spec). No DB table for templates yet — keeps the feature scope tight and lets Snax iterate copy by editing one file.

**Per memory `architecture_router_use_at_shared_prefix.md`**: the existing `underboss.routes.ts` already uses per-route middleware (every route has `requireAuth, requireUnderbossAuth` inline; no path-less `router.use(gate)`). The new outreach endpoints will follow this exact same per-route pattern. They live inside the existing `underboss.routes.ts` router (mounted at `app.use('/api/underboss', underbossRoutes)` in `backend/src/index.ts:107`), so no new top-level mount is added and no path-less middleware is introduced.

**Per memory `feedback_reversible_actions_no_confirm.md`**: logging an outreach attempt is fully reversible (delete the row, or PATCH the status). No confirm modals on "Mark as sent", "Mark status", or "Link to converted party".

## Database changes

### Migration: `outreach_attempts`

File: `supabase/migrations/20260520_create_outreach_attempts.sql` (using Supabase migration path per stagioni-29104 precedent — not `backend/prisma/migrations/`).

```sql
-- marinara-67583: Outreach attempts log
-- Admin-only — no anon/authenticated GRANTs (mirrors outreach_communities).
-- Backend reads/writes via service_role.

CREATE TABLE outreach_attempts (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  community_id        TEXT NOT NULL REFERENCES outreach_communities(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,                              -- 'twitter_dm' | 'email' | 'telegram'
  template_id         TEXT NOT NULL,                              -- 'v1_twitter' | 'v1_email' | 'v1_telegram'
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by             TEXT NOT NULL,                              -- admin email from req.userEmail
  status              TEXT NOT NULL DEFAULT 'sent',               -- 'sent' | 'replied' | 'declined' | 'converted' | 'bounced'
  converted_party_id  UUID REFERENCES parties(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT outreach_attempts_channel_check
    CHECK (channel IN ('twitter_dm', 'email', 'telegram')),
  CONSTRAINT outreach_attempts_status_check
    CHECK (status IN ('sent', 'replied', 'declined', 'converted', 'bounced'))
);

CREATE INDEX idx_outreach_attempts_community ON outreach_attempts(community_id);
CREATE INDEX idx_outreach_attempts_status ON outreach_attempts(status);
CREATE INDEX idx_outreach_attempts_sent_at ON outreach_attempts(sent_at DESC);

ALTER TABLE outreach_attempts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_outreach_attempts_updated_at
  BEFORE UPDATE ON outreach_attempts
  FOR EACH ROW
  EXECUTE FUNCTION set_outreach_communities_updated_at();  -- reuse the function from stagioni-29104
```

**Verified against origin/master `backend/prisma/schema.prisma`:**
- `Party.id` is `String @id @default(uuid()) @db.Uuid` and maps to `@@map("parties")` (line 227). So the FK column type must be `UUID`, and the referenced table is `"parties"` (lowercase, plural).
- `User` has NO `@@map` (line 10), confirming the memory note that "User is capital singular, no @@map." Not directly relevant here but reinforces the pattern.
- `outreach_communities.id` is `TEXT` per stagioni-29104. So `community_id` is `TEXT`.

### Prisma schema additions

Add to `backend/prisma/schema.prisma` (after the `OutreachCommunity` model that `stagioni-29104` will introduce):

```prisma
model OutreachAttempt {
  id                String   @id @default(cuid())
  communityId       String   @map("community_id")
  community         OutreachCommunity @relation(fields: [communityId], references: [id], onDelete: Cascade)
  channel           String   // 'twitter_dm' | 'email' | 'telegram'
  templateId        String   @map("template_id") // 'v1_twitter' | 'v1_email' | 'v1_telegram'
  sentAt            DateTime @default(now()) @map("sent_at") @db.Timestamptz
  sentBy            String   @map("sent_by")  // admin email from req.userEmail
  status            String   @default("sent") // 'sent' | 'replied' | 'declined' | 'converted' | 'bounced'
  convertedPartyId  String?  @map("converted_party_id") @db.Uuid
  convertedParty    Party?   @relation(fields: [convertedPartyId], references: [id], onDelete: SetNull)
  notes             String?
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@index([communityId])
  @@index([status])
  @@index([sentAt(sort: Desc)])
  @@map("outreach_attempts")
}
```

Add the back-relations:
- On `OutreachCommunity` (created by stagioni-29104): `attempts OutreachAttempt[]`
- On `Party`: `outreachAttempts OutreachAttempt[]` (add inside the `Party` block near the other relations around line 220).

### Order of operations

1. `stagioni-29104` ships and its migration is applied to production via `mcp__supabase-pizzadao__apply_migration` — confirms `outreach_communities` exists.
2. This branch applies `20260520_create_outreach_attempts` via `mcp__supabase-pizzadao__apply_migration` to prod **before** opening the PR for review (per the CLAUDE.md note: "New DB columns and backend endpoints must be applied to production before they'll work on preview branches").
3. Run `npx prisma generate` locally + in CI so the Prisma client knows the new model.
4. Backend deploy from `master` picks up the new Prisma client + new endpoints automatically once merged.
5. Frontend Vercel preview talks to production backend; once steps 2-4 are done the preview works.

## Backend API

All endpoints live in `backend/src/routes/underboss.routes.ts`, added before `export default router;`. They follow the **exact same per-route auth pattern** the rest of the file uses (`requireAuth, requireUnderbossAuth`) — no shared `router.use()` at any prefix.

### Endpoints

**`GET /api/underboss/outreach/communities`**
- Query params: `?city=<string>`, `?priority=<string>`, `?status=<sent|replied|declined|converted|bounced|none>`, `?source=<string>`
- Returns `{ communities: Array<{ id, city, name, source, followerCount, priority, twitterHandle, email, telegramHandle, lastAttempt: { id, channel, templateId, sentAt, sentBy, status, convertedPartyId, notes } | null, attemptCount: number }> }`.
- Implementation: `prisma.outreachCommunity.findMany({ where: <filters>, include: { attempts: { orderBy: { sentAt: 'desc' }, take: 1 } } })`. Then compute `lastAttempt` from the first element and `attemptCount` from a separate `_count` aggregation in the same query.
- Filter logic:
  - `city` → `where.city = { contains: <city>, mode: 'insensitive' }`
  - `priority` → `where.priority = <priority>`
  - `source` → `where.source = <source>`
  - `status === 'none'` → `where.attempts = { none: {} }` (communities never contacted)
  - `status === 'sent' | 'replied' | ...` → filter on `attempts.some.status = <status>` AND ensure it's the latest by sorting in JS after fetch (Prisma can't trivially filter "latest attempt has status X"; simpler to fetch and post-filter, given dataset size will be ~hundreds, not thousands).

**`POST /api/underboss/outreach/attempts`**
- Body: `{ communityId: string, channel: 'twitter_dm' | 'email' | 'telegram', templateId: string, notes?: string }`
- `sentBy` is set from `req.userEmail` (the authenticated admin email) — NOT from the body.
- `status` defaults to `'sent'`.
- Validate `channel` is one of the 3 allowed values; validate `templateId` is one of `['v1_twitter', 'v1_email', 'v1_telegram']`; validate `communityId` exists.
- Returns `{ attempt: <full row> }`.

**`PATCH /api/underboss/outreach/attempts/:id`**
- Body: `{ status?: string, convertedPartyId?: string | null, notes?: string }`
- Validate `status` is one of `['sent', 'replied', 'declined', 'converted', 'bounced']`.
- If `convertedPartyId` is provided, validate the party exists via `prisma.party.findUnique({ where: { id }, select: { id: true } })`. If status is set to `'converted'`, `convertedPartyId` SHOULD be set (warn in response but don't block — admin may link later).
- Returns `{ attempt: <full row> }`.

**`GET /api/underboss/outreach/parties-search?q=<query>`**
- Helper for the "Link to converted party" action. Searches `parties` by `name` ILIKE `%<q>%` OR `customUrl` ILIKE — limit 10.
- Returns `{ parties: Array<{ id, name, customUrl, city }> }`.
- Same `requireAuth, requireUnderbossAuth` gate.

### Routing pattern (PATH-SCOPED MIDDLEWARE)

The new endpoints live INSIDE the existing `underboss.routes.ts` router. They use per-route middleware exactly like every other route in the file:

```ts
// Add near line 1450, before `export default router;`
router.get(
  '/outreach/communities',
  requireAuth,
  requireUnderbossAuth,
  async (req: UnderbossRequest, res: Response, next: NextFunction) => { ... }
);

router.post(
  '/outreach/attempts',
  requireAuth,
  requireUnderbossAuth,
  async (req: UnderbossRequest, res: Response, next: NextFunction) => { ... }
);

router.patch(
  '/outreach/attempts/:id',
  requireAuth,
  requireUnderbossAuth,
  async (req: UnderbossRequest, res: Response, next: NextFunction) => { ... }
);

router.get(
  '/outreach/parties-search',
  requireAuth,
  requireUnderbossAuth,
  async (req: UnderbossRequest, res: Response, next: NextFunction) => { ... }
);
```

**No `router.use('/outreach', ...)`** anywhere. The shared underboss router is already mounted at `/api/underboss` in `backend/src/index.ts:107` via `app.use('/api/underboss', underbossRoutes)`. Adding more `router.METHOD()` calls to that same router file is the proven pattern — every existing route there does the same thing. No risk of leaking auth across sibling routers.

### Auth gate

Reuse `requireUnderbossAuth` (defined at `underboss.routes.ts:27-99`). It already handles:
- Admin emails (granted via `isAdmin(email)` check)
- Active underbosses (looked up in `underbosses` table)
- Graphics admins (looked up in `graphics_admins` table)

All three of these populate `req.underboss` and are eligible to use the outreach tab. **Non-admins / non-underbosses get 403** — same as every other underboss route. No new middleware needed.

## Frontend

### New tab in UnderbossDashboard

File: `frontend/src/pages/UnderbossDashboard.tsx`

The origin/master version has the tab state at line ~72:
```ts
const [activeTab, setActiveTab] = useState<'events' | 'cities' | 'partners' | 'fake-detection'>('events');
```

Changes:

1. Extend the `activeTab` type to include `'outreach'`.
2. Add a 5th tab button after the `partners` button (~line 540), gated to admin OR underboss (i.e. anyone reaching this page already passes the gate).
3. Add a 5th render branch after the `partners` branch (~line 580): `{activeTab === 'outreach' && <OutreachTab isAdmin={isAdmin} />}`.
4. Add `OutreachTab` to the `underboss` index (`frontend/src/components/underboss/index.ts`) and import it at the top of `UnderbossDashboard.tsx`.

### New component: `OutreachTab.tsx`

Location: `frontend/src/components/underboss/OutreachTab.tsx`

Top-level structure:
```tsx
export function OutreachTab({ isAdmin }: { isAdmin: boolean }) {
  const [communities, setCommunities] = useState<OutreachCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ city: '', priority: '', status: '', source: '' });
  const [selected, setSelected] = useState<OutreachCommunity | null>(null);
  const [templateModal, setTemplateModal] = useState<{ community: OutreachCommunity; channel: Channel } | null>(null);
  const [linkPartyModal, setLinkPartyModal] = useState<{ attemptId: string } | null>(null);
  // ... fetch + filter logic
}
```

### Filter bar

A horizontal row of `IconInput` + 3 select dropdowns (the select pattern is similar to the regionDropdown in `UnderbossDashboard.tsx` ~line 380-410):

- City search: `<IconInput icon={MapPin} placeholder="Search city..." value={filters.city} onChange={...} />` (debounced 300ms).
- Priority select: dropdown with `All / High / Medium / Low`.
- Status select: dropdown with `All / Not contacted / Sent / Replied / Declined / Converted / Bounced`. "Not contacted" maps to `status=none` query param.
- Source select: dropdown with `All / Lu.ma / Meetup / Curated / Twitter`.
- "Clear filters" button (resets all four to empty string).

### Communities table

Columns (left to right):

| Column | Source |
|--------|--------|
| City | `community.city` |
| Community | `community.name` (with `community.twitterHandle` / `telegramHandle` icon link if present) |
| Source | `community.source` (small badge) |
| Followers | `community.followerCount.toLocaleString()` |
| Priority | `community.priority` (colored badge: high=red, medium=yellow, low=gray) |
| Last attempt | If `lastAttempt`: status badge + relative time ("2 days ago"). If null: "—" + "Not contacted" muted text. |
| Actions | 3 inline buttons (see below) |

Sort: default by `priority desc, followerCount desc`. Allow column sort on City, Followers, Priority, Last attempt by clicking the header (use the same `ArrowUpDown` icon + sort-toggle pattern as `EventTable.tsx:90-100`).

Empty state: "No communities match your filters. Try clearing them." with a centered icon.

Loading state: existing `Loader2 className="animate-spin"` pattern.

### Inline actions per row

#### 1. "Copy template" dropdown
A dropdown button (Twitter / Email / Telegram). Clicking a channel opens the `<TemplateModal>` (see below).

Disabled state: gray out if no contact info for that channel (e.g. disable "Twitter" if `community.twitterHandle == null`; disable "Email" if `community.email == null`).

#### 2. "Mark status" (only shown if `lastAttempt != null`)
A small select inline in the row: changes the `lastAttempt.status` via `PATCH /api/underboss/outreach/attempts/:id`. Options: Sent / Replied / Declined / Converted / Bounced. Optimistic update. No confirm modal (reversible).

#### 3. "Link party" (only shown if `lastAttempt.status === 'converted'` AND `convertedPartyId == null`)
Opens the `<LinkPartyModal>` (see below).

### TemplateModal

```tsx
<TemplateModal
  community={selected}
  channel={'twitter_dm' | 'email' | 'telegram'}
  onClose={...}
  onMarkSent={(notes) => POST /api/underboss/outreach/attempts}
/>
```

Layout (uses the project modal pattern from CLAUDE.md: `fixed inset-0 bg-black/60 backdrop-blur-sm z-50`):

- Modal card: `max-w-2xl` centered, white bg, rounded.
- Title: "Outreach template — {channel label}"
- Subject line (email only): rendered above body, with a "Copy subject" button.
- Body textarea (read-only, monospace, `IconInput multiline`): rendered template with placeholders interpolated against:
  - `{{community_name}}` → `community.name`
  - `{{city}}` → `community.city`
  - `{{calendar_link}}` → `https://cal.com/pizzadao/gpp-host` (constant in `outreachTemplates.ts`, can be tweaked)
  - `{{sender_name}}` → admin's display name from `fetchUnderbossMe()` — or fall back to "PizzaDAO"
- "Copy to clipboard" button (uses `navigator.clipboard.writeText`) — shows a checkmark for 2s after click.
- Optional notes field: `<IconInput multiline placeholder="Notes (optional, internal only)..." />` for any context the admin wants to attach to the attempt log.
- "Mark as sent" button (primary, red): POSTs the attempt and closes the modal. **No confirm step** per `feedback_reversible_actions_no_confirm.md`.
- "Cancel" button (secondary): closes modal without logging.

### LinkPartyModal

```tsx
<LinkPartyModal attemptId={...} onClose={...} onLink={(partyId) => PATCH /api/underboss/outreach/attempts/:id} />
```

- `IconInput` with debounced search (300ms), hits `GET /api/underboss/outreach/parties-search?q=<query>`.
- Results list (up to 10): each row shows `party.name` + `party.city` + `rsv.pizza/{customUrl}` muted.
- Clicking a result: PATCHes the attempt with `convertedPartyId`, closes modal, refreshes the row.

## Message templates

File: `frontend/src/lib/outreachTemplates.ts`

```ts
export const OUTREACH_CALENDAR_LINK = 'https://cal.com/pizzadao/gpp-host';

export type OutreachChannel = 'twitter_dm' | 'email' | 'telegram';

export interface OutreachTemplate {
  id: string;
  channel: OutreachChannel;
  subject?: string;
  body: string;
}

export const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'v1_twitter',
    channel: 'twitter_dm',
    body: `hey {{community_name}} — we're running Global Pizza Party 2026 on Sept 20, a worldwide simultaneous pizza meetup. {{city}} doesn't have a host yet. would love to chat about you running one — free pizza budget, no upfront cost. 15 min call? {{calendar_link}}`,
  },
  {
    id: 'v1_email',
    channel: 'email',
    subject: 'Host the {{city}} Global Pizza Party 2026?',
    body: `Hi {{community_name}},

We're organizing Global Pizza Party 2026 — a global, simultaneous pizza meetup on Sept 20 across hundreds of cities. We don't have a host in {{city}} yet and your community seemed like a strong fit.

PizzaDAO covers the pizza budget; you bring the venue and the people. 200+ cities ran their own party last year.

15-minute intro call? {{calendar_link}}

— {{sender_name}}, PizzaDAO`,
  },
  {
    id: 'v1_telegram',
    channel: 'telegram',
    body: `hi {{community_name}} 👋 we're running Global Pizza Party 2026 (sept 20, simultaneous worldwide). {{city}} is uncovered. interested in hosting? we pay for the pizza. {{calendar_link}}`,
  },
];

export function renderTemplate(
  tpl: OutreachTemplate,
  vars: { community_name: string; city: string; calendar_link?: string; sender_name?: string }
): { subject?: string; body: string } {
  const calendar = vars.calendar_link ?? OUTREACH_CALENDAR_LINK;
  const sender = vars.sender_name ?? 'PizzaDAO';
  const replace = (s: string) =>
    s
      .replaceAll('{{community_name}}', vars.community_name)
      .replaceAll('{{city}}', vars.city)
      .replaceAll('{{calendar_link}}', calendar)
      .replaceAll('{{sender_name}}', sender);
  return {
    subject: tpl.subject ? replace(tpl.subject) : undefined,
    body: replace(tpl.body),
  };
}

export function getTemplate(channel: OutreachChannel): OutreachTemplate | undefined {
  return OUTREACH_TEMPLATES.find((t) => t.channel === channel);
}
```

**Placeholder resolution**: Done client-side at modal render time. The `templateId` stored in `outreach_attempts` is just the identifier (`v1_twitter` etc.) — we don't store the rendered text. This means:
- Tweaks to template copy don't require a migration.
- We can compute "which version was sent" historically by joining `templateId` against the in-code template list.

**Review checkpoint**: Snax may want to refine copy. Surface this in the PR description: "Templates are at `frontend/src/lib/outreachTemplates.ts` — edit there and redeploy. The `id` field (e.g. `v1_email`) MUST stay stable across edits, or bump to `v2_email` if making a material change so old `outreach_attempts` rows still reference a valid template id (or migrate them)."

## Approval gate

The entire `/underboss` route is gated. The new outreach tab is inside the existing `UnderbossDashboard` page, which already does access checks via `fetchUnderbossMe()` (`UnderbossDashboard.tsx:149-181`) and only renders the dashboard if `me.isAdmin` or `me.isUnderboss`. Non-admins see "You are not authorized."

The backend endpoints are independently gated via `requireAuth, requireUnderbossAuth` (defense in depth — if a non-admin somehow guesses the URL, the API still refuses).

## Files to create

- `supabase/migrations/20260520_create_outreach_attempts.sql`
- `frontend/src/components/underboss/OutreachTab.tsx`
- `frontend/src/components/underboss/OutreachTemplateModal.tsx`
- `frontend/src/components/underboss/OutreachLinkPartyModal.tsx`
- `frontend/src/lib/outreachTemplates.ts`

## Files to modify

- `backend/prisma/schema.prisma` — add `OutreachAttempt` model + back-relations on `OutreachCommunity` (already added by stagioni-29104) and `Party`.
- `backend/src/routes/underboss.routes.ts` — add 4 new routes (`GET /outreach/communities`, `POST /outreach/attempts`, `PATCH /outreach/attempts/:id`, `GET /outreach/parties-search`) before `export default router;`.
- `frontend/src/pages/UnderbossDashboard.tsx` — extend `activeTab` union, add tab button (~line 540), add render branch (~line 580), import `OutreachTab`.
- `frontend/src/components/underboss/index.ts` — export `OutreachTab`.
- `frontend/src/lib/api.ts` — add 4 API client functions: `fetchOutreachCommunities(filters)`, `logOutreachAttempt(body)`, `updateOutreachAttempt(id, body)`, `searchPartiesForOutreach(q)`. Add corresponding TS types.
- `frontend/src/types/index.ts` (or wherever Underboss types live) — add `OutreachCommunity`, `OutreachAttempt`, `OutreachChannel`, `OutreachStatus` types.
- `frontend/src/locales/en/admin.json` (or wherever `underbossDashboard.tabs.*` lives) — add `tabs.outreach: "Outreach"` key. Default English-only; other locales fall back per i18n config. (Korean is in the locale list per memory note, but admin tabs aren't translated.)

## Step-by-step implementation

1. **Block until `stagioni-29104` is merged.** Verify `outreach_communities` exists in prod Supabase via `mcp__supabase-pizzadao__list_tables`.
2. Create worktree branch `marinara-67583-underboss-outreach-tab` off `origin/master`.
3. Add the `OutreachAttempt` Prisma model + back-relations on `Party`.
4. Write the migration SQL file. Apply to prod via `mcp__supabase-pizzadao__apply_migration` first (per CLAUDE.md preview/prod-backend note).
5. Run `npx prisma generate` to refresh the client.
6. Implement the 4 backend routes in `underboss.routes.ts` — copy the per-route auth pattern from existing routes (e.g. lines 326-378). Each handler wraps in `try/catch` and calls `next(error)`.
7. Wire `index.ts` — no change needed; routes auto-mount under `/api/underboss`.
8. Add the 4 frontend API client functions + TS types.
9. Create `frontend/src/lib/outreachTemplates.ts` (copy from the spec above).
10. Create `OutreachTemplateModal.tsx` (renders one template, interpolates, copy + mark-sent buttons).
11. Create `OutreachLinkPartyModal.tsx` (search + select + PATCH).
12. Create `OutreachTab.tsx` (filter bar + table + inline actions + state for both modals).
13. Wire `OutreachTab` into `UnderbossDashboard.tsx` as the 5th tab.
14. Add `tabs.outreach: "Outreach"` translation key to `en/admin.json`.
15. Local smoke test: `npm run dev` in `frontend/`, run `backend/` against staging DB. Verify all 4 endpoints + tab UI.
16. Open draft PR. Tag Snax for template-copy review.
17. Verify Vercel preview loads `/underboss` → Outreach tab → all 3 templates render with correct interpolation → mark-as-sent persists → status PATCH persists → link-party search returns parties.
18. Lift to ready-for-review once Snax signs off on copy.

## Verification

- `outreach_attempts` table exists in prod Supabase (`mcp__supabase-pizzadao__list_tables`).
- `prisma generate` succeeds locally; `npx tsc --noEmit` passes in both `backend/` and `frontend/`.
- Vercel preview `https://rsvpizza-git-marinara-67583-underboss-outreach-tab-pizza-dao.vercel.app/underboss` loads.
- "Outreach" tab is visible and clickable.
- Tab loads communities from the prod `outreach_communities` table (assuming stagioni-29104 has populated it).
- Filter bar: typing in city box, changing priority/status/source filters, all narrow the list.
- "Copy template" → Twitter / Email / Telegram each open a modal with the correct interpolated text. Copy-to-clipboard works (paste into a text field to verify).
- "Mark as sent" creates an `outreach_attempts` row visible in Supabase Table Editor. Row has correct `community_id`, `channel`, `template_id`, `sent_by` (= admin email), `status='sent'`.
- After marking sent, the row in the table updates to show the new last-attempt status without a full page reload.
- "Mark status" → changing status to "replied" persists; row reflects new status.
- "Link party" appears only when status is "converted". Search returns matching parties; selecting one updates `converted_party_id`.
- Non-underboss user (logged in as a regular host) hits `/api/underboss/outreach/communities` directly → gets 403.
- No console errors. No 401/500s.
- Confirm no `router.use(<gate>)` was introduced (`grep -nE "^router\.use\(" backend/src/routes/underboss.routes.ts` should still show zero results).
- Confirm no confirm-modal anti-pattern on Mark-as-sent / Mark-status / Link-party.

## Out of scope (handed off to supreme-43217 / stagioni-29104)

- The `outreach_communities` staging table (stagioni-29104 owns the migration + scrapers).
- The four scrapers (Twitter / Telegram / Meetup / Eventbrite) — stagioni-29104.
- Cross-reference logic that flags which scraped communities are in "uncovered" cities — stagioni-29104.
- The GPP 2026 coverage-gap Google Sheet — supreme-43217.
- Template versioning beyond `v1` (no `v2_*` planned for this task).
- Outbound automated sending (e.g. auto-DM via Twitter API). v1 is **manual copy-paste only** — admin sends the message themselves and logs the attempt. Automation can come in a follow-up task once we know which templates convert.
- Per-locale template translation. Templates are English-only for v1.

### Critical files for implementation

- `backend/src/routes/underboss.routes.ts`
- `backend/prisma/schema.prisma`
- `frontend/src/pages/UnderbossDashboard.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/components/underboss/index.ts`
