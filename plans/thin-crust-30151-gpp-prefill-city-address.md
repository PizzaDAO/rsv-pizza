# thin-crust-30151 — GPP events pre-fill address with selected city

**Priority:** P2

## Problem

When a host creates a GPP event from `/gpp`, the city/country picked via `LocationAutocomplete` is **not** persisted as the party `address`. The host has to re-enter their city on the host dashboard before the public event page (and downstream consumers like the events map) can show a location.

We want to pre-fill `parties.address` with the formatted city name on creation. But the recently-shipped `pesto-58917` change auto-completes the "venue_added" checklist item the moment `address` is non-null. Auto-checking the box just because the GPP city pre-fill exists would be wrong — the host hasn't actually added a venue yet.

## Approach

1. Persist the city's formatted address (and lat/lng) on GPP event create.
2. Add a server-only boolean `address_is_city_default` on `parties` to mark "this address is the GPP city pre-fill, not a real venue".
3. Set the flag `true` on GPP create. Flip it to `false` whenever the address is patched through the normal party PATCH route.
4. Update the checklist auto-complete rule to: `address is set AND address_is_city_default is false`.

The boolean is purely backend-controlled. The frontend never reads or writes it directly — it only sees the resulting `autoCompleteStates.venue_added` from the checklist response. So `safeColumns`, `DbParty`, `dbPartyToParty`, and the two PATCH allowlists do **not** need updating.

## Database changes

New column on `parties`:

```sql
ALTER TABLE parties
  ADD COLUMN address_is_city_default boolean NOT NULL DEFAULT false;

GRANT SELECT (address_is_city_default) ON parties TO anon, authenticated;
```

(Per the Feb 2026 column-level grant policy in CLAUDE.md, new columns on `parties` need explicit SELECT grants.)

Apply via `mcp__supabase-pizzadao__apply_migration` with name `thin_crust_30151_address_is_city_default`. **Apply BEFORE merging** so preview deploys against prod backend don't 500.

## Files to modify

### 1. `backend/prisma/schema.prisma`

Add field after `longitude` on the `Party` model:

```prisma
addressIsCityDefault Boolean @default(false) @map("address_is_city_default")
```

### 2. `backend/src/routes/gpp.routes.ts`

In `POST /api/gpp/events` (around line 246):

a. Accept `cityFormattedName` from the request body:

```ts
const { city, hostName, email, telegram, country, countryCode,
        cityFormattedName, cityLat, cityLng, timezone } = req.body;
```

b. Compute the city address to persist (prefer the formatted name from Google, fall back to the raw city the user typed):

```ts
const cityAddress =
  (typeof cityFormattedName === 'string' && cityFormattedName.trim()) ||
  normalizedCity;
```

c. In `prisma.party.create({ data: { … } })` (around line 383), add:

```ts
address: cityAddress,
addressIsCityDefault: true,
latitude: typeof cityLat === 'number' ? cityLat : null,
longitude: typeof cityLng === 'number' ? cityLng : null,
placeId: null, // city-level result has no real placeId we want to persist
```

(Keep the existing `country: country || null`.)

### 3. `backend/src/routes/party.routes.ts`

In the `PATCH /api/parties/:id` handler (around line 516), update the `address` line to also clear the flag whenever `address` is patched — even to the same value (host explicitly chose it):

```ts
...(address !== undefined && { address, addressIsCityDefault: false }),
```

This is the only place that needs to flip the flag. The `updateParty` Supabase path (frontend `supabase.ts`) is a different code path used by some host-side updates, but address edits flow through the backend PATCH (LocationAutocomplete → `updatePartyApi`). Spot-check that `updateParty` (Supabase direct) is NOT used for address edits — it isn't (line 889 sets address but is the create path, not an update). If we find an update site that bypasses the backend, add the same flip there.

### 4. `backend/src/routes/checklist.routes.ts`

Update the `select` (around line 45) to pull the new field and update the rule (around line 97):

```ts
select: { address: true, addressIsCityDefault: true, venueName: true,
          coHosts: true, userId: true, region: true,
          user: { select: { email: true, name: true } } },
```

```ts
venue_added: !!party?.address && !party.addressIsCityDefault,
```

The `venueName` select can stay (used elsewhere on the response shape — verify and drop if truly unused).

### 5. `frontend/src/lib/api.ts`

Extend `CreateGPPEventData` (around line 907):

```ts
export interface CreateGPPEventData {
  city: string;
  hostName: string;
  email: string;
  telegram?: string;
  country?: string;
  countryCode?: string;
  cityFormattedName?: string; // NEW — full formatted city, e.g. "New York, NY, USA"
  cityLat?: number;
  cityLng?: number;
  timezone?: string;
}
```

### 6. `frontend/src/pages/GPPLandingPage.tsx`

In `handleSubmit` (around line 169), include the formatted name in the create payload:

```ts
...(cd && {
  country: cd.country,
  countryCode: cd.countryCode,
  cityFormattedName: cd.formattedName, // NEW
  cityLat: cd.lat,
  cityLng: cd.lng,
}),
```

`CityData.formattedName` already exists (`LocationAutocomplete.tsx:11`) and is populated from `place.formatted_address`.

## Verification

1. **DB migration applied** via Supabase MCP — confirm new column + grant exist.
2. **Backend deployed to master** before testing on preview (preview frontends call prod backend).
3. **Create a fresh GPP event** at `/gpp` for a test city. Confirm:
   - `parties.address` is set to `"<City>, <State>, <Country>"`.
   - `parties.address_is_city_default` is `true`.
   - `parties.latitude` / `longitude` populated.
4. **Open the host dashboard checklist** for the new event — "Find a venue" item should be **unchecked**.
5. **Edit the address** on the host dashboard (Event Details → location autocomplete). Confirm:
   - `address_is_city_default` flips to `false`.
   - Checklist "Find a venue" item flips to **checked**.
6. **Public event page** (`/<custom-url>`) — confirm city address shows up immediately after create (no need for the host to log in first).
7. **Existing GPP events** with a real venue already added must remain checked — `address_is_city_default` defaults to `false` for legacy rows, so the rule degrades correctly.
8. **No regression for non-GPP events** — `address_is_city_default` is `false` by default, so the venue_added rule still triggers on any non-null address (matching pesto-58917 behavior).

## Edge cases

- **Host types raw city without picking from dropdown** — `cityDataRef.current` is required (line 161 of GPPLandingPage), so this path can't happen today. If it ever changes, `cityAddress` falls back to `normalizedCity` which is fine.
- **Google Places returns no `formatted_address`** — `LocationAutocomplete` already falls back to `place.name` when populating `formattedName`, so `cityFormattedName` is never empty when sent.
- **Host edits the address back to the exact city default string** — flag still flips to `false` (host explicitly confirmed it). This is the right behavior; if they meant to clear it, they'd clear the field.
- **Host clears the address** — PATCH sends `address: null`, `addressIsCityDefault: false`, checklist correctly returns to unchecked.

## Out of scope

- Auto-zooming the events map to the new city's lat/lng (already happens via existing query path).
- Backfilling `address_is_city_default = true` for already-created GPP events that currently have the city in `address` — they don't have it; address is null today. Skip.
- Any frontend `DbParty` / mapper updates — flag is server-only.
