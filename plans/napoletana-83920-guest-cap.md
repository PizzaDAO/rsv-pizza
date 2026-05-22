# napoletana-83920 — Drop INVITED guests from host page query

## Problem
`frontend/src/lib/supabase.ts` `getPartyWithGuests` and `getGuestsByPartyId` do `.select('*').order('submitted_at', ascending: true)` with no explicit limit. PostgREST silently caps the response at 1000 rows (returned as HTTP 206 with `Content-Range: 0-999/<total>`). Events with >1000 guests (Guayaquil 1106, San Diego 1288, SF 1168) lose the newest rows. As of 2026-05-21, 37 PENDING RSVPs are invisible to hosts.

## Fix
Add `.neq('status', 'INVITED')` to both queries. Max non-INVITED across all events is 921 — well under the 1000 cap. The bulk INVITED-via-blast rows are noise on the host page; they only appear in the GuestList `invitedGuests` section which gates on length>0.

## Files
`frontend/src/lib/supabase.ts`
- `getPartyWithGuests` (~L1295): add `.neq('status', 'INVITED')`
- `getGuestsByPartyId` (~L1770): same

## Out of scope
- No `.range()` pagination defense (separate task if needed)
- No GuestList UI changes
- No backend changes

## Verification
- `/host/guayaquil` shows "Pending Approval: 13" and 13 Approve buttons
- `/host/sandiego` shows 24 pending
