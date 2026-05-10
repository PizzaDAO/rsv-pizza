# Persist Flyer Customizations to Database

## Task ID: calzone-91482
## Priority: High

## Context

GPP flyer customizations (element positions, text overrides, logo sizes, popped logos) are stored **only in localStorage** (`flyer-{partyId}`). This means:
- Auto-regen and mass-gen scripts always use `DEFAULT_POSITIONS`, overwriting host customizations
- Customizations are lost if the browser cache is cleared or when using a different device
- Server-side scripts have no access to customizations at all

**Goal**: Add a `flyerConfig` JSON column to the Party model so customizations persist in the DB. All regen paths (auto-regen, GraphicsDashboard mass gen, `gen-template-flyers.cjs`) will respect saved customizations.

---

## Changes

### 1. Prisma Schema — add column
**File**: `backend/prisma/schema.prisma`
- Add `flyerConfig Json? @map("flyer_config")` to Party model (after `flyerGeneratedAt`)
- Run `npx prisma migrate dev --name add-flyer-config`

### 2. Backend PATCH handler — accept field
**File**: `backend/src/routes/party.routes.ts`
- Destructure `flyerConfig` from `req.body` (line ~408)
- Add `...(flyerConfig !== undefined && { flyerConfig })` to update data (line ~555)

### 3. Frontend API chain — thread through 6 touchpoints

**`frontend/src/lib/api.ts`**:
- `UpdatePartyData` interface: add `flyerConfig?: Record<string, any> | null`
- `updatePartyApi()` body: add `flyerConfig: data.flyerConfig`

**`frontend/src/lib/supabase.ts`**:
- `DbParty` interface: add `flyer_config?: Record<string, any> | null`
- `SAFE_PARTY_COLUMNS`: add `flyer_config` after `underboss_status`
- `updateParty()` updates type: add `flyer_config?: Record<string, any> | null`
- `updateParty()` API call mapping: add `flyerConfig: updates.flyer_config`

**`frontend/src/contexts/PizzaContext.tsx`**:
- `dbPartyToParty()`: add `flyerConfig: dbParty.flyer_config || null`

**`frontend/src/types.ts`**:
- `Party` interface: add `flyerConfig?: Record<string, any> | null`

### 4. Define FlyerConfig type
**File**: `frontend/src/components/flyer/renderFlyer.ts`
```ts
export interface FlyerConfig {
  positions?: FlyerPositions;
  poppedLogos?: Record<string, { x: number; y: number }>;
  logoSizes?: Record<string, number>;
  sponsorBoxSize?: { width: number; height: number };
  editVenueName?: string | null;
  editStreetAddress?: string | null;
  editCity?: string | null;
  editTime?: string | null;
}
```

### 5. Extend `renderFlyer()` to accept config
**File**: `frontend/src/components/flyer/renderFlyer.ts`
- Add `config?: FlyerConfig` to `RenderFlyerOptions`
- Add `id?: string` to the sponsors array items (needed for popped logo lookup)
- Use `config.positions` instead of `DEFAULT_POSITIONS` when provided
- Use `config.sponsorBoxSize` instead of `DEFAULT_SPONSOR_BOX` when provided
- Apply text overrides: `config.editCity`, `config.editVenueName`, `config.editStreetAddress`, `config.editTime`
- Apply `config.logoSizes` for per-sponsor sizing
- Separate sponsors into group vs popped (via `config.poppedLogos`), render popped at absolute positions

### 6. FlyerGenerator — save to DB, load from DB
**File**: `frontend/src/components/flyer/FlyerGenerator.tsx`
- **Load**: Change `savedState` memo to prefer `party.flyerConfig` over localStorage
- **Save**: In `handleUseAsEventImage()`, include `flyer_config` in the `updateParty()` call with the current customization state. Only save if there are actual customizations (non-default).
- **Reset**: In `handleResetPositions()`, also call `updateParty(party.id, { flyer_config: null })`
- **Backfill**: Add a one-time `useEffect` that syncs localStorage → DB if `party.flyerConfig` is null but localStorage has data

### 7. Auto-regen — use DB config
**File**: `frontend/src/components/flyer/autoRegenFlyer.ts`
- Add `flyerConfig?: Record<string, any> | null` to `FlyerRegenData` interface
- In `triggerFlyerRegen()`: if DB config exists, allow regen (with customizations); if only localStorage exists and no DB config, still skip (backwards compat)
- In `doRegen()`: pass `config` to `renderFlyer()`, apply text overrides from config
- In `triggerFlyerRegenForEvents()`: same logic for batch

### 8. GraphicsDashboard — use config in mass gen
**File**: `frontend/src/pages/GraphicsDashboard.tsx`
- Pass `event.flyerConfig` as `config` to `renderFlyer()` in `handleMassGenerate()`

**File**: `frontend/src/types.ts`
- Add `flyerConfig?: Record<string, any> | null` to `UnderbossEvent`

**File**: `backend/src/routes/underboss.routes.ts`
- Include `flyerConfig` in the Prisma select and event response mapping

### 9. Mass gen script — use config
**File**: `scripts/gen-template-flyers.cjs`
- Add `flyerConfig: true` to Prisma select
- Apply config positions, text overrides, popped logos, logo sizes in the local render function

---

## Implementation Order
1. Prisma migration (must land on prod first since preview shares prod DB)
2. Backend PATCH handler
3. Frontend API chain (all 6 touchpoints)
4. FlyerConfig type + renderFlyer extension
5. FlyerGenerator save/load/backfill
6. Auto-regen + mass gen updates
7. Script update

## Verification
1. Open a GPP event's flyer tab → drag elements, edit text, resize logos → click "Use as Event Image" → verify `flyer_config` is saved in DB (`SELECT flyer_config FROM parties WHERE id = '...'`)
2. Clear localStorage → reload the page → verify customizations load from DB
3. Change the venue name on the event → verify auto-regen preserves custom positions/text
4. Run `gen-template-flyers.cjs --dry-run` → verify it reads flyerConfig from events that have one
5. Reset positions → verify DB config is cleared
