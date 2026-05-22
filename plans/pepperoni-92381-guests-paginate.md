# pepperoni-92381 — Paginate guests fetch via `.range()` loop

## Problem
PR #570 (napoletana-83920) papered over the PostgREST 1000-row cap by filtering `status='INVITED'`. Max non-INVITED today is 921 (SF). The moment any single event accumulates >1000 actual RSVPs, the same silent-truncation bug returns.

## Fix
Module-scope helper `fetchAllGuests(partyId)` that loops `.range(0..999) → .range(1000..1999) → ...` until a short page comes back. Both `getPartyWithGuests` and `getGuestsByPartyId` call it.

Keeps `.neq('status', 'INVITED')` from #570 to minimize round-trips on current events.

## Files
- `frontend/src/lib/supabase.ts` — add `fetchAllGuests` helper; swap both call sites.

## Out of scope
- `getUserParties` (L2106) — theoretical same bug, no real risk today.
- Backend / Prisma / project-wide PostgREST config.

## Verification
- Smoke: sandiego, guayaquil, sanfrancisco show same data as before.
- Events <1000 non-INVITED make exactly one request (current behavior preserved).
- Events ≥1000 non-INVITED make `ceil(N/1000)` requests.
