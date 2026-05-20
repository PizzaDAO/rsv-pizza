# oregano-44102 — Fix duplicate checklist item seed race

**Priority:** P0 — visible on 3 prod events (Auckland 32/32, Utete Rufiji, Jinja) and a latent landmine for every new GPP host.

## Problem
Dashboard checklist renders every default item twice on some events. DB has 32 rows with is_default=true, 16 distinct names, two timestamps ~19ms apart per party.

## Root cause
`POST /:partyId/checklist/seed` in backend/src/routes/checklist.routes.ts does check-then-insert with no DB-level guard. Concurrent calls insert defaults twice. Both `GPPDashboardTab.tsx` and `ChecklistTab.tsx` call seedChecklist() on first load.

## Fix
1. Migration `supabase/migrations/20260520_oregano_44102_checklist_default_unique.sql` — dedup existing duplicates + add partial unique index `(party_id, name) WHERE is_default = true`.
2. Backend: swap `createMany` for row-by-row `INSERT ... ON CONFLICT DO NOTHING` inside a `prisma.$transaction`. Catch Prisma P2002 and re-fetch instead of 500ing.

## Files
- backend/src/routes/checklist.routes.ts
- supabase/migrations/20260520_oregano_44102_checklist_default_unique.sql (new)

## Order of operations
Apply migration to prod BEFORE deploying backend (migration is idempotent + does dedup in same txn as index creation, so prod stays consistent).
