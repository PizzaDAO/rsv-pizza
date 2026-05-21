# vesuvio-58492 — Cap RSVP pizzeria list to top 3 by weighted score

**Priority:** Medium
**Branch:** `vesuvio-58492-pizzeria-top3`

## Problem

The RSVP modal "Favorite Pizzerias (click to rank 1-3)" section currently renders the full list of pizzerias on the event. When a host has pre-selected many pizzerias (e.g. Istanbul GPP shows ~15+), the UI becomes overwhelming and pushes the actual rank-selection workflow below the fold.

Auto-fetched fallback already slices to 3 (`useRSVPForm.ts:296`). The host-selected branch (`useRSVPForm.ts:280`) does not — that is the root of the bug shown in the screenshot.

## Goal

Show only the **top 3** pizzerias, ranked by a composite "closest + highest rated" score, in **both** code paths (host-selected and auto-fetched). User-suggested pizzerias (added in-form via "Suggest a Pizzeria") continue to append uncapped.

## Ranking formula

```
score = (rating ?? 3.5) - (distanceMiles * 0.3)
```

- Missing rating → treat as 3.5 (neutral mid-rating, neither penalized nor boosted).
- Missing venue location or missing pizzeria coordinates → distance term = 0 (rank by rating alone, don't drop the row).
- Sort `score` descending, take first 3.

Examples (with venue at Istanbul Fatih, distances illustrative):
- Hidden Garden 4.9, 0.3mi → 4.81
- Divella 4.8, 0.4mi → 4.68
- GRACE 4.7, 0.5mi → 4.55
- Wake N Bake 4.6, 5.0mi → 3.10 (rating high but penalized for distance)

## Files to modify

**`frontend/src/hooks/useRSVPForm.ts`** — only file with logic changes.

1. Add a pure helper (top of file, after imports, or just above `useRSVPForm`):
   ```ts
   const TOP_PIZZERIA_LIMIT = 3;
   const DISTANCE_WEIGHT_PER_MILE = 0.3;

   function rankPizzerias(
     list: Pizzeria[],
     venue: { lat: number; lng: number } | null,
   ): Pizzeria[] {
     return [...list]
       .map(p => {
         const rating = p.rating ?? 3.5;
         const hasDistance =
           venue &&
           p.location &&
           p.location.lat !== 0 &&
           p.location.lng !== 0;
         const distance = hasDistance
           ? calculateDistanceMiles(venue.lat, venue.lng, p.location.lat, p.location.lng)
           : 0;
         return { p, score: rating - distance * DISTANCE_WEIGHT_PER_MILE };
       })
       .sort((a, b) => b.score - a.score)
       .slice(0, TOP_PIZZERIA_LIMIT)
       .map(x => x.p);
   }
   ```

2. In the `fetchPizzerias` effect (currently `useRSVPForm.ts:274-305`):
   - **Host-selected branch** (line 279-285): geocode venue first (await before set), then `setNearbyPizzerias(rankPizzerias(eventData.selectedPizzerias, location))`. Currently the geocode is fire-and-forget which means the first render of host-selected pizzerias would have no distance data — we need to await it so ranking is correct on first paint.
   - **Auto-fetch branch** (line 290-302): replace `setNearbyPizzerias(results.slice(0, 3))` with `setNearbyPizzerias(rankPizzerias(results, location))`.

3. Verify the existing user-suggest append path (line 362-365) still works — it should, because it adds to `nearbyPizzerias` after the initial ranked fetch, so suggestions land at the end of the visible list.

4. The "merge existing suggested pizzerias when editing" effect (line 261-271) also appends — that is fine, those should remain visible (they're returning guests' personal suggestions).

**No backend, no DB, no other frontend files.**

## Import additions

`useRSVPForm.ts` already imports `calculateDistanceMiles` from `../lib/ordering` (verified at line 199 of `RSVPFormStep2.tsx`; need to add to `useRSVPForm.ts` if not already imported — agent should check and add if missing).

## Verification

1. **Auto-fetch path**: open an RSVP modal on an event with no `selectedPizzerias`. Confirm exactly 3 pizzerias appear (was already true; should not regress).
2. **Host-selected path with many entries**: open rsv.pizza/istanbul (the screenshot's event) RSVP modal. Confirm exactly 3 pizzerias appear, and they are the highest-scored (mix of high rating + low distance), not just the first 3 in the host's list.
3. **User suggest**: click "Suggest a Pizzeria", add one. Confirm it appears as a 4th row below the top 3.
4. **Edit existing RSVP**: re-open an existing guest's RSVP with previously-suggested pizzerias. Confirm their old suggestions still render.
5. **No location**: confirm the modal doesn't break if a pizzeria has `location.lat === 0` (sort still works, distance term is 0).

## Out of scope

- Changing the cap to a configurable host-setting.
- Server-side filtering (`searchPizzerias` Supabase function still returns its full radius set; we just cap client-side).
- Renaming the "click to rank 1-3" label (already matches the new cap).

## Notes

- This is UI-only; backend/DB untouched, so backend deploy not required and preview will work end-to-end.
- One file modified → small, isolated PR.
