# pie-29481 — Underboss dashboard: actions shouldn't blank the page

**Priority:** P2

## Problem

Snax reports: "Taking an action on the underboss tab shouldn't make the page reload, but it should update."

There's no actual `window.location.reload()`. The "reload feel" comes from `loadDashboard()` setting `loading: true`, which trips the early-return at `UnderbossDashboard.tsx:246-257` and renders a full-screen centered spinner — the entire dashboard unmounts, scroll position is lost, then everything re-renders fresh. Individual EventRow actions (approve/reject/hide a single event) are already optimistic via `handleEventUpdate` and behave correctly.

## Root cause

`UnderbossDashboard.tsx:115`:
```ts
const loadDashboard = useCallback(async () => {
  setLoading(true);            // ← this is what blanks the page
  setError(null);
  try {
    const result = await fetchUnderbossDashboard('all');
    setAllData(result);
    …
  } finally {
    setLoading(false);
  }
}, []);
```

Callers that trip it on user action:
- `EventTable.tsx:510` — bulk Reject → `onBulkAction?.()` → `loadDashboard`
- `EventTable.tsx:525` — bulk Hide → same
- `EventTable.tsx:738` — bulk Delete → same
- `UnderbossDashboard.tsx:448` — `<PartnerManager onSyncComplete={loadDashboard} />`

## Approach

Make `loadDashboard` capable of a "silent" refetch that keeps the existing data on screen while new data is fetched. Only the initial page load should ever trigger the full-screen spinner. This is the minimum-scope change that fixes every reported action at once and naturally extends to any future caller.

Optionally, we could rewrite each bulk action as a pure optimistic mutation (no refetch) — but that requires per-action state surgery (filter rows out for delete, recompute stats, etc.) and we'd still want the silent refetch as a safety net for partner sync (which touches lots of fields). Skipping that for now.

## Files to modify

### 1. `frontend/src/pages/UnderbossDashboard.tsx`

Change `loadDashboard` signature + body to accept a silent flag:

```ts
const loadDashboard = useCallback(async (silent = false) => {
  if (!silent) setLoading(true);
  setError(null);
  try {
    const result = await fetchUnderbossDashboard('all');
    setAllData(result);
    try {
      const { sponsorUsers } = await fetchSponsorUsers();
      const tags = sponsorUsers
        .filter(su => su.autoCoHost && su.isActive)
        .map(su => su.tag);
      setPartnerTags(tags);
    } catch {
      // Non-critical
    }
  } catch (err: any) {
    if (!silent) setError(err.message || 'Failed to load dashboard');
    else console.error('Silent dashboard refetch failed:', err);
  } finally {
    if (!silent) setLoading(false);
  }
}, []);
```

Reasoning for the silent error branch: if a background refetch fails, we don't want to wipe the visible dashboard with an error screen — log + leave stale data. Initial-load failures still go to the error UI.

Update the two prop sites (`UnderbossDashboard.tsx:440` and `:448`) to pass a silent wrapper, since the prop signatures take `() => void`:

```ts
<EventTable
  …
  onBulkAction={() => loadDashboard(true)}
  …
/>
…
<PartnerManager
  …
  onSyncComplete={() => loadDashboard(true)}
  …
/>
```

The two existing initial-load call sites (`UnderbossDashboard.tsx:159` and `:170`) stay as `loadDashboard()` — full-spinner behavior is correct there.

## Verification

1. Open `/underboss` as an admin or underboss.
2. Select 2+ events → bulk Reject → confirm the dashboard does NOT blank to a spinner; the rejected rows update in place (status changes/styling updates after the silent refetch returns).
3. Same for bulk Hide and bulk Delete.
4. Switch to Partners tab → trigger a partner sync that adds/removes partners → confirm the dashboard's events list updates without blanking.
5. Hard refresh the page (Cmd-R / Ctrl-R) — initial load should still show the full-screen spinner (correct behavior preserved).
6. Trigger a network error during a bulk action (e.g., disable Wi-Fi mid-action) — confirm the dashboard stays visible (no error screen takeover) and the error is logged to console.

## Out of scope

- Converting bulk reject/hide/delete to pure optimistic updates with no refetch. Could be a follow-up if the silent refetch still feels too slow.
- Any individual EventRow action behavior — those already work correctly via `handleEventUpdate`.
- Cities tab actions, FunnelTab, TelegramBroadcast — none currently route through `loadDashboard`. Spot-check during implementation; if any do, apply the same silent-refetch pattern.
