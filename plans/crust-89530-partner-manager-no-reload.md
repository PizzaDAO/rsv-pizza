# crust-89530: PartnerManager — don't flash loading spinner after save

**Priority**: P2 (UX polish)
**Surface**: `/underboss` → Partners tab → Edit Partner modal → "Update Partner"

## Problem

Clicking **Update Partner** (or **Add Partner**) in the PartnerManager modal makes the entire Partners panel disappear and a loading spinner flash for ~300–800ms before the panel returns. The modal also momentarily vanishes. Feels like a full page reload.

## Root cause

`frontend/src/components/underboss/PartnerManager.tsx`

1. `handlePartnerSubmit` (line 119) calls `await loadPartners()` after a successful save.
2. `loadPartners` (line 32–43) unconditionally calls `setLoading(true)`.
3. The render gate at line 172–178 returns *only* a spinner whenever `loading === true`, replacing the partner list **and the open modal** until the refetch resolves.

Same bug fires after `handleDelete` (line 165) and after a failed `handleDragEnd` reorder (line 157).

## Fix

Only show the full-panel spinner on the **initial** load. Subsequent refreshes should refetch silently in the background.

### Implementation

Edit `frontend/src/components/underboss/PartnerManager.tsx`:

1. Change the `loadPartners` callback to accept a `silent` flag (default `false`):

   ```ts
   const loadPartners = useCallback(async (silent = false) => {
     try {
       if (!silent) setLoading(true);
       const result = await fetchSponsorUsers();
       setPartners(result.sponsorUsers);
       setTagCounts(result.tagCounts);
     } catch (err: any) {
       setError(err.message || 'Failed to load partners');
     } finally {
       if (!silent) setLoading(false);
     }
   }, []);
   ```

2. Pass `true` from the three post-mount call sites:
   - `handlePartnerSubmit` line 119 → `await loadPartners(true);`
   - `handleDelete` line 165 → `await loadPartners(true);`
   - `handleDragEnd` line 157 → `await loadPartners(true);` (error fallback)

3. Leave the initial `useEffect` call (line 46) as `loadPartners()` so the first mount still shows the spinner.

That's it. No behavior change to data flow, no optimistic updates, no API changes.

## Files changed

- `frontend/src/components/underboss/PartnerManager.tsx` (one function + three call sites)

## Verification

On the Vercel preview at `https://rsvpizza-git-crust-89530-partner-no-reload-pizza-dao.vercel.app/underboss`:

1. Open Partners tab → click **Edit** on any partner → change a field → click **Update Partner**.
   - **Expected**: modal closes (or stays open with sync message), partner row updates in place, **no spinner flash**.
2. Click **Add Partner** → fill fields → click **Create Partner**.
   - **Expected**: new partner appears in list, no spinner flash.
3. Click **Deactivate** on a partner → confirm.
   - **Expected**: row updates in place, no spinner flash.
4. Hard refresh the page.
   - **Expected**: initial spinner DOES still appear (we only suppress it on refresh, not first load).
5. Reorder partners via drag (admin only) and force a backend failure (offline) — error path should still silently refetch without a spinner flash.

## Out of scope

- Optimistic in-place merge using the response payload (would also work but is a bigger change; `updateSponsorUser` returns the full updated record so it's a reasonable follow-up if the silent-refetch feels laggy).
- Refactoring the `loading` gate to render the list with an overlay spinner.
