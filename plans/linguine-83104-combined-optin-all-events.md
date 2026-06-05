# linguine-83104: Show combined opt-in checkbox on every event (not just SWC-tagged)

**Priority:** P2
**Type:** Small UI tweak — extend rigatoni-72401
**Status:** Plan
**Branch:** `linguine-83104-combined-optin-all-events`

## Context

After rigatoni-72401 (#858) shipped, the combined "Hear from PizzaDAO + our partners" checkbox renders on every SWC-tagged event (US + 5 regional). On **non-SWC events**, the form still shows the older standalone `step1.mailingList` checkbox.

Snax wants the unified "Hear from PizzaDAO + our partners" copy on **every event** for consistency. The merge already passed A/B with no PizzaDAO cost; no reason to keep two different copy variants.

This is throwaway-ish — the in-flight marinara-XXXXX DB-config refactor (see neighboring plan) will eventually drive checkbox config from the DB and supersede this hardcoded change. Acceptable: ship now, refactor later.

## Important discoveries up front

1. **`setCombinedOptIn` already handles non-SWC events safely.** In `useRSVPForm.ts`, the callback sets `mailingListOptIn` unconditionally and only enters the SWC switch when `activeRegionConfig` is truthy. On a non-SWC event, it just toggles `mailingListOptIn` — exactly what we want.

2. **`combinedOptIn` derived getter also handles non-SWC.** Returns `false` if `!activeRegionConfig || !mailingListOptIn`. **This needs a tweak** — on a non-SWC event we want it to track `mailingListOptIn` alone, not always return `false`. Otherwise the checkbox visually never becomes "checked" on non-SWC events.

3. **The (i) info modal is SWC-specific.** It pulls copy from `activeRegionConfig.modalNamespace` (`swcModal`, `swcCaModal`, etc.). On a non-SWC event there's no equivalent partner whose privacy/terms we'd link. **Skip the (i) button entirely on non-SWC events.**

4. **Existing-guest control preservation must still work.** If a guest previously RSVPed in the control arm of an SWC event, their `optinAbVariant='control'` is preserved on re-submit and they see the legacy two-checkbox UI. That codepath must stay reachable.

## Files to modify

### 1. `frontend/src/hooks/useRSVPForm.ts` — fix `combinedOptIn` getter for non-SWC events

Current (~line 256):
```ts
const combinedOptIn = (() => {
  if (!activeRegionConfig || !mailingListOptIn) return false;
  if (isEthconfEvent && !ethconfOptIn) return false;
  switch (activeRegionConfig.swcOptInField) { ... }
})();
```

Replace with:
```ts
const combinedOptIn = (() => {
  if (!mailingListOptIn) return false;
  if (isEthconfEvent && !ethconfOptIn) return false;
  if (!activeRegionConfig) return mailingListOptIn; // non-SWC: track mailing list alone
  switch (activeRegionConfig.swcOptInField) { ... }
})();
```

The `setCombinedOptIn` callback already handles non-SWC correctly — no change.

### 2. `frontend/src/components/RSVPFormStep1.tsx` — render combined block on every event

Current logic (~line 156): render combined block only if `form.activeRegionConfig && form.optinAbVariant === 'variant'`.

New logic: render combined block **unless** the user is on the preserved-control codepath (`form.activeRegionConfig && form.optinAbVariant === 'control'`).

**Change the gate from:**
```tsx
{form.activeRegionConfig && form.optinAbVariant === 'variant' ? (
  <>{/* combined block */}</>
) : (
  <>{/* legacy mailingList + per-region SWC blocks */}</>
)}
```

**To:**
```tsx
{form.activeRegionConfig && form.optinAbVariant === 'control' ? (
  <>{/* legacy mailingList + per-region SWC blocks — unchanged */}</>
) : (
  <>{/* combined block — render on every event */}</>
)}
```

**Inside the combined block**, wrap the (i) info button in `{form.activeRegionConfig && (...)}` so it only appears on SWC events. On non-SWC events, the checkbox renders alone (no info button to its right).

Also adjust the checkbox's flex container: when there's no info button, the checkbox should be `w-full` not `flex-1`. Easiest: keep the outer `<div className="flex items-center gap-2">` but make the checkbox `flex-1` always — without a sibling, it'll naturally fill the row.

### 3. NOTHING else

- No i18n changes — `step1.combinedOptIn` already exists in all 8 locales (rigatoni-72401 shipped that).
- No backend changes.
- No DB changes.
- No admin UI changes.

## Verification

1. `cd frontend && npm run build` — TS + JSON parse clean.
2. Vercel preview smoke test on:
   - Non-SWC event (any event NOT tagged with `swc`/`swccanada`/`swcau`/`swceu`/`swcuk`/`swcbr`): should render ONE checkbox labeled "Hear from PizzaDAO + our partners" with NO (i) button. Clicking toggles `mailing_list_opt_in`.
   - US SWC event (fresh incognito, no `existingGuest`): should render ONE checkbox with the (i) button. Clicking toggles both `mailing_list_opt_in` and `swc_opt_in`. (Same as current variant arm.)
   - SWC event with simulated existing-guest control bucket (manually set `optin_ab_variant='control'` on a guest row in dev): should render the legacy two-checkbox UI. (Preservation path intact.)

## Out of scope

- DB-driven checkbox config (separate task — marinara/lasagna planner).
- Renaming `step1.mailingList` to something else (still used by the control preservation path).
- Touching the SWC regional control blocks (still used by preservation path).
