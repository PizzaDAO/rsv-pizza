# slice-41958 — Cities tab priority flag

**Priority:** P2
**Stage:** Doing
**Branch:** `slice-41958-priority-flag`

## Goal

Add a **priority** flag to cities on the `/underboss` Cities tab, separate from the existing `created/todo/skip` status. A city can be priority *and* any status. Surface it as:

1. A new bulk action ("Mark Priority" / "Unmark Priority") in the Actions dropdown
2. A clickable count chip in the summary badges row (alongside Created/Todo/Skip)
3. A "Priority" option in the status filter `<select>` dropdown
4. A small ★ indicator on the city row when priority is set

> Decision (Snax): priority is a **separate boolean flag**, not a 4th status. Visibility = count chip + filter dropdown option. Do NOT sort priority to top.

## Database changes

Add a `priority boolean` column to `city_statuses`. New migration:

`supabase/migrations/{YYYYMMDD}_add_priority_to_city_statuses.sql`
```sql
ALTER TABLE city_statuses ADD COLUMN priority boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_city_statuses_priority ON city_statuses(priority) WHERE priority = true;
```

Notes:
- `city_statuses` already has RLS enabled with no policies (deny-all for anon). Backend uses Prisma directly, bypassing RLS. **No column-level SELECT grant needed** — the Feb 2026 audit's grant requirement is specific to the `parties` table.
- Because of the new `priority` field, the existing PATCH logic that *deletes* the row when status becomes `todo` must be adjusted: only delete if status === 'todo' AND priority === false. Otherwise the row needs to persist to keep the priority flag.

## Backend changes

`backend/prisma/schema.prisma` — add field:
```prisma
model CityStatus {
  id        String   @id @default(uuid()) @db.Uuid
  cityKey   String   @unique @map("city_key")
  status    String   @default("todo")
  priority  Boolean  @default(false)
  updatedBy String?  @map("updated_by")
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  @@map("city_statuses")
}
```

Run `npx prisma generate` (locally, agent will commit `node_modules` isn't tracked but the generated client is — verify whatever pattern the repo uses; do **not** push generated files if gitignored).

`backend/src/routes/underboss.routes.ts`:

1. **GET /api/underboss/city-statuses** — include `priority` in the response map:
   ```ts
   map[row.cityKey] = {
     status: row.status,
     priority: row.priority,
     updatedBy: row.updatedBy,
     updatedAt: row.updatedAt.toISOString(),
   };
   ```

2. **PATCH /api/underboss/city-statuses** — accept optional `priority` field; allow either `status`, `priority`, or both. Rewrite the delete-when-todo shortcut so it only deletes when status==='todo' AND (priority===false OR not provided AND existing row has priority===false).

   Suggested handler shape:
   ```ts
   const { cityKey, status, priority } = req.body;
   if (!cityKey) throw 400;
   if (status !== undefined && !['created','skip','todo'].includes(status)) throw 400;
   if (priority !== undefined && typeof priority !== 'boolean') throw 400;
   if (status === undefined && priority === undefined) throw 400 'nothing to update';

   const existing = await prisma.cityStatus.findUnique({ where: { cityKey } });
   const nextStatus   = status   ?? existing?.status   ?? 'todo';
   const nextPriority = priority ?? existing?.priority ?? false;

   if (nextStatus === 'todo' && nextPriority === false) {
     await prisma.cityStatus.deleteMany({ where: { cityKey } });
     return res.json({ success: true, deleted: true });
   }
   const result = await prisma.cityStatus.upsert({
     where: { cityKey },
     update: { status: nextStatus, priority: nextPriority, updatedBy },
     create: { cityKey, status: nextStatus, priority: nextPriority, updatedBy },
   });
   res.json({ success: true, cityStatus: result });
   ```

## Frontend changes

`frontend/src/lib/api.ts`:
```ts
export interface CityStatusMap {
  [cityKey: string]: { status: string; priority: boolean; updatedBy: string | null; updatedAt: string };
}

export async function updateCityStatus(
  cityKey: string,
  patch: { status?: 'created' | 'skip' | 'todo'; priority?: boolean }
): Promise<void> {
  await apiRequest('/api/underboss/city-statuses', {
    method: 'PATCH',
    body: { cityKey, ...patch },
  });
}
```

> Keep the function signature change in mind — any other callers must be updated. Grep confirms only `CitiesTable.tsx` calls it.

`frontend/src/components/underboss/CitiesTable.tsx`:

1. Add `priority` to `MergedCity` and threading through `cityStatuses`:
   ```ts
   interface MergedCity {
     ...
     priority: boolean;
     ...
   }
   ```
2. Merge priority from `cityStatuses[key]?.priority` into MergedCity (independent of status auto-detection).
3. Add `'priority'` to `statusFilter` union: `'all' | CityStatusValue | 'priority'`. When filter==='priority', filter to cities with `priority===true`.
4. Add a count chip in the summary badges row (yellow/amber theme, ★ icon) showing `statusCounts.priority`.
5. Add `<option value="priority">Priority</option>` to the status filter `<select>`.
6. Add bulk actions in the dropdown:
   - "★ Mark Priority" → calls handler that PATCHes `priority: true` for each selected key
   - "☆ Unmark Priority" → PATCHes `priority: false`
   Place them after the status set actions, before the Telegram divider.
7. Update `handleStatusChange` to accept the new `{status?, priority?}` patch shape; update `cityStatuses` optimistically with merge semantics.
8. Add a tiny ★ indicator next to the city name (or in the status badge) for priority cities. Use `Star` icon from lucide-react with `fill-yellow-400 text-yellow-400` styling. Show on both desktop row and mobile card.
9. Update `statusCounts` to compute `priority` count.
10. Add i18n strings to `frontend/src/i18n/locales/en/partner.json` (only English — other locales fall back to en):
    - `cities.markPriority`: "★ Mark Priority"
    - `cities.unmarkPriority`: "☆ Unmark Priority"
    - `cities.statusPriority`: "Priority"
    - `cities.statusPriorityCount`: "{{count}} priority"

## Files modified

1. `supabase/migrations/{YYYYMMDD}_add_priority_to_city_statuses.sql` (new)
2. `backend/prisma/schema.prisma`
3. `backend/src/routes/underboss.routes.ts`
4. `frontend/src/lib/api.ts`
5. `frontend/src/components/underboss/CitiesTable.tsx`
6. `frontend/src/i18n/locales/en/partner.json`

## Verification

1. Migration applied to production DB (since preview frontends hit prod backend per CLAUDE.md):
   - `mcp__supabase-pizzadao__apply_migration` with the SQL above
2. Backend deployed to production: `cd backend && vercel --prod --scope pizza-dao`
3. Confirm GET returns `priority: false` for an existing city, and `priority: true` after PATCH
4. Confirm Cities tab on `/underboss` shows:
   - New priority chip in summary row with correct count
   - Priority option in filter dropdown
   - Mark/Unmark Priority in bulk action dropdown when ≥1 city selected
   - ★ icon on rows where priority=true
   - Bulk mark/unmark updates UI optimistically and persists across refresh
5. Confirm setting status to `todo` while priority=true keeps the row (and the priority flag survives)

## Deploy order (important)

The frontend Vercel preview hits the production backend. So:
1. Apply the migration FIRST (Supabase MCP)
2. Deploy backend SECOND (`vercel --prod`)
3. Then the frontend preview will work

If we don't follow this order, the preview will 500 on every city-status request.
