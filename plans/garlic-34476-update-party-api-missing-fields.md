# garlic-34476 — Fix `updatePartyApi` dropping fields (telegramGroup et al.)

**Priority**: P1
**Type**: Bug fix

## Problem

Hosts can enter a Telegram group link on `/host/{invite}/details`, blur the field, see the green "Event updated" toast — but on reload the value is gone. Same silent failure for the host-facing turtle-roles toggle, the country field (location-derived), and the expected-guests count.

## Root cause

`frontend/src/lib/api.ts:199-262` — `updatePartyApi` builds its PATCH body by hand-enumerating each field from `data`. Four fields that `updateParty` in `frontend/src/lib/supabase.ts:1677-1739` *does* forward are missing from that list, so they are silently dropped before the request leaves the browser:

| Field | supabase.ts forwards | api.ts body includes | UpdatePartyData type has |
|-------|----------------------|----------------------|--------------------------|
| `telegramGroup`      | ✓ (line 1737) | ✗ | ✗ |
| `turtleRolesEnabled` | ✓ (line 1738) | ✗ | ✗ |
| `country`            | ✓ (line 1685) | ✗ | ✗ |
| `expectedGuests`     | ✓ (line 1699) | ✗ | ✗ |

Backend PATCH handler in `backend/src/routes/party.routes.ts:404-581` correctly accepts all four (each is gated by `!== undefined`). Because the frontend never sends them, the backend's update spread skips them and the response is still 200 OK — that's why the toast is green but the DB never changes.

Verified end-to-end:
- DB column `telegram_group` exists + has SELECT grant (service-role PATCH succeeds, deployed `/api/events/:slug` returns the value).
- Mappers (`SAFE_PARTY_COLUMNS`, `DbParty`, `dbPartyToParty`) are all wired up — the read side works fine.
- Single break point is `updatePartyApi`.

## Files to change

Only `frontend/src/lib/api.ts`:

1. Extend `UpdatePartyData` interface (~line 167) to include the four missing optional fields:
   ```ts
   country?: string | null;
   expectedGuests?: number | null;
   telegramGroup?: string | null;
   turtleRolesEnabled?: boolean;
   ```

2. Add the four fields to the body in `updatePartyApi` (~line 261, after `externalLinks`):
   ```ts
   country: data.country,
   expectedGuests: data.expectedGuests,
   telegramGroup: data.telegramGroup,
   turtleRolesEnabled: data.turtleRolesEnabled,
   ```

No DB changes, no backend changes, no env var changes.

## Verification

1. After deploy, on a host event details page enter a Telegram link → blur → reload. Value persists.
2. Toggle turtle-roles checkbox → reload. Value persists.
3. Pick a new venue via the location autocomplete → reload. `country` round-trips.
4. Set expected guests → reload. Value persists.

## Out of scope

- The architectural smell that `updatePartyApi` hand-lists every field. Fixing that (e.g. pass-through whitelist or generated type) is a separate refactor — leaving it alone here to keep the fix minimal and reviewable.
