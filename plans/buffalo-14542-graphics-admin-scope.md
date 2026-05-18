# buffalo-14542 — Graphics admin restricted to underboss city scope on Graphics Dashboard

**Priority:** P1 (blocks a real user — graphics admin sees only 4 of ~760 events)

## Problem

A user who is BOTH a graphics admin AND an underboss with a limited city scope (e.g., 4 Sri Lankan cities) sees only those 4 cities' events on the Graphics Dashboard. Graphics admins are supposed to see all GPP events for flyer/graphics work.

## Root cause

`backend/src/middleware/underbossAuth.ts` checks the `underboss` table **before** the `graphicsAdmin` table. When the same email is in both, the underboss branch matches first and the graphics-admin fallback never fires — the user gets `req.underboss = { regions: [], cities: [4 SL cities] }`. The Graphics Dashboard calls `GET /api/underboss/all`, which uses `buildScopedWhereClause(scope)` to filter the Prisma `Party` query to only those 4 cities.

`partyAccess.ts` (per-party edit / tab access) already short-circuits to allow for graphics admins. The listing scope check just needs to be made consistent.

## Fix

In `backend/src/middleware/underbossAuth.ts`, look up both the `underboss` row and the `graphicsAdmin` row in parallel. If the user is a graphics admin, set scope to admin-equivalent (`regions: ['__admin__']`) regardless of any underboss row.

## Files to modify

- `backend/src/middleware/underbossAuth.ts` (only file)

No DB migration. No frontend changes. No Prisma changes.

## Verification

1. `cd backend && npm run build` passes.
2. Backend Vercel preview deploys cleanly.
3. Manual test post-deploy: graphics-admin-and-underboss user sees all GPP events on `/graphics`.
4. Regression: underboss-only user still scoped; graphics-admin-only user still admin-scoped (unchanged).
