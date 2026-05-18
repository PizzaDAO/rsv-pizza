# salami-47402 — Hide drinks/beverage UI on GPP events (preserve data)

**Priority**: P2 (product hygiene; GPP-only display fix)

## Problem

GPP (Global Pizza Party) events should not show drinks/beverage UI to hosts or guests, but every party in the system uses the same `Party.availableBeverages` schema and the same React components. Today, every GPP event surfaces:

- Host: a `BeverageSettings` card on the "Pizza & Drinks" tab
- Host: a `BeverageOrderSummary` and beverage sections inside `PizzaOrderSummary`
- Host: a "Beverage Preferences" subsection in `AddGuestForm`
- Host: beverage chips on guest rows (`TableRow` requests variant, `GuestCard`)
- Guest: a "Drink Preferences" subsection in RSVP Step 2 (`RSVPFormStep2`)

Per Snax: hide all of this for `Party.eventType === 'gpp'`. **No data mutations** — `Party.availableBeverages`, `RSVP.likedBeverages`, `RSVP.dislikedBeverages`, `User.defaultLikedBeverages` all stay untouched. Pure frontend conditional rendering. Non-GPP events must behave exactly as today.

## Gating approach

**Compute a derived boolean `isGppEvent` at each call site that already consumes the party.**

Justification (vs. a `shouldShowBeverages(party)` util):
1. The check is a trivial one-line equality. Adding a util adds a new module, a new test, and import noise for no behavior gain.
2. Existing precedent throughout the codebase — `HostPage.tsx:92` (`const isGPP = party?.eventType === 'gpp'`), `EventPage.tsx:534`, `RSVPPage.tsx:75`, `PartyHeader.tsx:213`, `FlyerTab.tsx:13`, `PreviousYearPhotos.tsx:312`. We match the established idiom.
3. The two RSVP-side files (`RSVPFormStep2`, `useRSVPForm`) read the party through the `RSVPEventData` shape, which already carries `eventType` (set by both `dbPartyToRSVPData` and `publicEventToRSVPData` in `useRSVPForm.ts`). Computing locally is one line.
4. Host-side components consume `party` from `usePizza()` and can read `party?.eventType` directly. `BeverageSettings` and `BeverageOrderSummary` already destructure `party` from the context.

**Single-line pattern at every gate:** `const isGppEvent = party?.eventType === 'gpp';` (or, in `useRSVPForm`, `eventData.eventType === 'gpp'`).

## Files to modify

Frontend only. Eight component files, one hook, one page label change, one AppsHub label override, and seven locale files for a new `tabs.pizza` key. **Zero changes** to backend, Prisma schema, Supabase, types, or `constants/options.ts`.

| # | File | What changes |
|---|---|---|
| 1 | `frontend/src/components/BeverageSettings.tsx` | Return `null` when `isGppEvent` (after all hooks) |
| 2 | `frontend/src/components/BeverageOrderSummary.tsx` | Return `null` when `isGppEvent` (after all hooks) |
| 3 | `frontend/src/hooks/useRSVPForm.ts` | Expose `isGppEvent` flag in returned object |
| 4 | `frontend/src/components/RSVPFormStep2.tsx` | Hide drinks subsection (line 61) when `form.isGppEvent` |
| 5 | `frontend/src/components/PizzaOrderSummary.tsx` | Hide three beverage sections + omit beverages from copy-order text when `isGppEvent` |
| 6 | `frontend/src/components/AddGuestForm.tsx` | Hide "Beverage Preferences" subsection (lines ~211–264) when `isGppEvent` |
| 7 | `frontend/src/components/TableRow.tsx` | New optional prop `hideBeverages?: boolean`; skip beverage chip blocks (lines ~367–382) in requests variant when true |
| 8 | `frontend/src/components/GuestPreferencesList.tsx` | Compute `isGppEvent`; pass `hideBeverages={isGppEvent}` to `TableRow`; drop beverage signals from `guestsWithRequests` filter (lines 27–35) when GPP |
| 9 | `frontend/src/components/GuestCard.tsx` | Pull `party` from `usePizza()`; hide beverage chips block (lines ~52–73) when `isGppEvent` |
| 10 | `frontend/src/pages/HostPage.tsx` | Line 164: conditional tab label — `isGPP ? t('tabs.pizza') : t('tabs.pizzaAndDrinks')` (`isGPP` already in scope at line 92) |
| 11 | `frontend/src/components/AppsHub.tsx` | For the `pizzeria-selection` tile (lines 78–86), override `name` to `'Pizza'` and `description` to `'Find and select nearby pizzerias'` when `isGppEvent` (compute from `usePizza().party`) |
| 12 | `frontend/src/i18n/locales/{de,en,es,fr,ja,pt,zh}/host.json` | Add `tabs.pizza` key alongside `tabs.pizzaAndDrinks`. Values: de/en/es/fr/pt = `"Pizza"`, ja = `"ピザ"`, zh = `"披萨"` |

**Not touched** (verified): `frontend/src/lib/tabPermissions.ts:57` keeps its static "Pizza & Drinks" label — only consumed by `HostsManager.tsx`, an admin/permission-picker UI with no current-event context. Leaving it static avoids a broader refactor for no user-visible benefit on the GPP host experience.

## Step-by-step changes

### 1. `frontend/src/components/BeverageSettings.tsx`

After the `useState` calls (line 20, after `customInput`), add:
```ts
const isGppEvent = party?.eventType === 'gpp';
if (isGppEvent) return null;
```
Placed after all hooks so Rules of Hooks holds.

### 2. `frontend/src/components/BeverageOrderSummary.tsx`

After the `useState` call (Rules of Hooks), add:
```ts
const isGppEvent = party?.eventType === 'gpp';
if (isGppEvent) return null;
```

### 3. `frontend/src/hooks/useRSVPForm.ts`

- Compute `const isGppEvent = eventData.eventType === 'gpp';` near the other computed values (next to `isEthconfEvent`, ~line 167).
- Add `isGppEvent` to the returned object (near the other `isSwc*Event` keys around line 575–582).

This avoids leaking the conditional into JSX and matches the existing pattern of derived flags exposed from the form hook.

### 4. `frontend/src/components/RSVPFormStep2.tsx`

Change the drinks block guard at line 61:
```tsx
{form.availableBeverages.length > 0 && (
```
to:
```tsx
{!form.isGppEvent && form.availableBeverages.length > 0 && (
```
Closing brace at line 151 remains. No step-numbering impact — Step 2 is one "page" with multiple optional subsections.

### 5. `frontend/src/components/PizzaOrderSummary.tsx`

After the `usePizza()` destructure (line 25), compute:
```ts
const isGppEvent = party?.eventType === 'gpp';
```
Wrap three beverage blocks with `!isGppEvent &&`:
- Line 608 (summary "Total drinks:" block)
- Line 668 (multi-wave Beverage Order section)
- Line 711 (single-wave Beverage Order section)

In the `handleCopyOrder`/`handleCopyAllWaves` text-building logic at line 312–319, also gate the `beverageText`:
```ts
const beverageText = !isGppEvent && beverageRecommendations.length > 0
  ? '\n\n=== BEVERAGES (Order Once) ===\n' + ...
  : '';
```
Apply the same gate to any per-wave copy helper (`handleCopyWave`) if it includes beverages — verify during implementation by grepping `beverage` in this file. Hiding UI but copying beverages would leak.

### 6. `frontend/src/components/AddGuestForm.tsx`

The `usePizza()` destructure (line 13) already pulls `party`. Add after it:
```ts
const isGppEvent = party?.eventType === 'gpp';
```
Change Beverage Preferences block guard at line 212:
```tsx
{!isGppEvent && party?.availableBeverages && party.availableBeverages.length > 0 && (
```
Closing brace at line 264 remains.

The `likedBeverages`/`dislikedBeverages` state stays in the form (defaults `[]`), and `addGuest({ ... likedBeverages, dislikedBeverages })` still passes empty arrays — preserves the data shape contract.

### 7. `frontend/src/components/TableRow.tsx`

Add a new optional prop `hideBeverages?: boolean` to `TableRowProps` (after `beverageNameById` at line 41):
```ts
hideBeverages?: boolean;
```
Destructure in the function signature (after line 68):
```ts
hideBeverages = false,
```
Wrap the two beverage map blocks in the requests variant (lines 367–382):
```tsx
{!hideBeverages && guest.likedBeverages?.map(...)}
{!hideBeverages && guest.dislikedBeverages?.map(...)}
```
The `variant="beverage"` branch (lines 224–246) is only used by `PizzaOrderSummary`, which already gates the whole section in change #5 — no extra gate needed.

### 8. `frontend/src/components/GuestPreferencesList.tsx`

After the `usePizza()` destructure (line 14), compute:
```ts
const isGppEvent = party?.eventType === 'gpp';
```
Two changes:
- In the `guestsWithRequests` `useMemo` (lines 27–35), drop beverage signals from the filter when `isGppEvent` so a guest who only liked drinks doesn't show up as a ghost row in the GPP "Guest Requests" panel:
```ts
return guests.filter(guest =>
  (guest.dietaryRestrictions && guest.dietaryRestrictions.length > 0) ||
  (guest.toppings && guest.toppings.length > 0) ||
  (guest.dislikedToppings && guest.dislikedToppings.length > 0) ||
  (!isGppEvent && guest.likedBeverages && guest.likedBeverages.length > 0) ||
  (!isGppEvent && guest.dislikedBeverages && guest.dislikedBeverages.length > 0)
);
```
- Pass the prop on the `TableRow` at lines 100–110: add `hideBeverages={isGppEvent}`.

### 9. `frontend/src/components/GuestCard.tsx`

Extend the `usePizza()` destructure at line 12 to also pull `party`:
```ts
const { removeGuest, availableToppings, availableBeverages, party } = usePizza();
const isGppEvent = party?.eventType === 'gpp';
```
Wrap the existing beverage chips block (lines 53–73):
```tsx
{!isGppEvent && ((guest.likedBeverages && guest.likedBeverages.length > 0) || ...) && (
  ...
)}
```

## Special considerations (resolved)

- **RSVP wizard step numbering**: Confirmed safe. Step 2 contains independent optional subsections (dietary, drinks, pizzerias, donation). The drinks block already self-hides when host configured zero beverages. `Step 2 of 2` label in `RSVPModal.tsx:265` is hard-coded.

- **AccountPage** (`/account`): **No change**. Page renders global `DRINKS` from `constants/options.ts` against a user's profile-level `User.defaultLikedBeverages`. User setting, not event-tied. A user may host both GPP and non-GPP events.

- **Staff form** (`StaffForm.tsx:27` "Bar / Drinks"): **No change**. Staffing *role name* (a person who tends bar), not the ordering feature.

- **Budget category** (`BudgetCategorySection.tsx:18` `drinks: Wine`): **No change**. Budget category icon mapping. Drinks remain a real budget line item.

- **Partner form** (`PartnerForm.tsx:107` `'drinks'` partner type): **No change**. Drinks sponsor type stays.

- **AppsHub** "Pizza & Drinks" tile: **No change to the tile by default**. It routes to `/pizza` which still exists for pizza ordering. Drinks-specific cards inside that tab are hidden by changes #1 and #5. Optionally relabel — see open questions.

- **tabPermissions.ts**: **No change required**. `pizza` tab stays. Optionally relabel — see open questions.

- **i18n locales**: No string deletions. Strings stay in `host.json`, `rsvp.json`, `account.json` for de/en/es/fr/ja/pt/zh — they just aren't rendered for GPP. Cleaner if we ever revert.

- **Real-time recommendations** (`PizzaContext.generateBeverageRecommendations`): No change. Algorithm still runs and populates `beverageRecommendations` in state. Host UI just doesn't render it for GPP. Guarantees data preservation and avoids regressing non-GPP behavior.

- **Tests**: Existing unit tests for `beverageAlgorithm.test.ts` and `field-sync.test.ts` exercise the algorithm and data shapes, not UI — should pass unchanged. `RSVPModal.test.tsx` mock provides `availableBeverages: []` already (line 41) — equivalent to a GPP event with no beverages. No new tests added (conditional rendering against an established pattern).

## Verification (Vercel preview)

On `https://rsvpizza-git-salami-47402-hide-gpp-drinks-pizza-dao.vercel.app`:

1. **GPP host view**: `/host/{gpp-invite-code}/pizza` → BeverageSettings card absent, no Beverage Order section in PizzaOrderSummary, no "Total drinks" line. **Tab label reads "Pizza"** (not "Pizza & Drinks").
2. **GPP host — Apps hub**: pizzeria-selection tile reads **"Pizza"** with description "Find and select nearby pizzerias".
3. **GPP host — Add Guest**: open Add Request modal → no "Beverage Preferences" subsection.
4. **GPP host — Guest Requests**: a GPP guest whose RSVP includes liked beverages → row shows toppings/dietary chips but no blue beverage chips.
5. **GPP guest RSVP**: `/rsvp/{gpp-invite-code}` → Step 2 shows dietary + pizzeria sections but no "Drink Preferences" block.
6. **Non-GPP host view**: BeverageSettings **still present**; Beverage Order section **still present**; **tab label still "Pizza & Drinks"**; **AppsHub tile still "Pizza & Drinks"** (regression checks).
7. **Non-GPP guest RSVP**: Drink Preferences section **still present** in Step 2 (regression check).
8. **DB preservation** (Supabase SQL editor):
   ```sql
   select id, name, event_type, available_beverages from party where event_type = 'gpp' and array_length(available_beverages, 1) > 0 limit 3;
   select id, party_id, liked_beverages, disliked_beverages from rsvp where array_length(liked_beverages, 1) > 0 limit 3;
   ```
   Expect both queries to return rows — arrays untouched.
9. **Account page**: `/account` while signed in → Drink Preferences subsection **still present**.
10. **Copy-order text**: non-GPP with beverages → "Copy Order" clipboard contains BEVERAGES section. GPP → clipboard text does not.

## Implementation additions

### 10. `frontend/src/pages/HostPage.tsx`

Line 164:
```tsx
{ id: 'pizza' as TabType, label: t('tabs.pizzaAndDrinks'), icon: Pizza },
```
→
```tsx
{ id: 'pizza' as TabType, label: isGPP ? t('tabs.pizza') : t('tabs.pizzaAndDrinks'), icon: Pizza },
```
`isGPP` is already computed at line 92.

### 11. `frontend/src/components/AppsHub.tsx`

The `apps` array is module-level static. Simplest: keep it static, override at render time. Inside the component, after `usePizza()`:
```ts
const isGppEvent = party?.eventType === 'gpp';
```
When mapping `apps` to render tiles, override for the `pizzeria-selection` id:
```tsx
const displayName = isGppEvent && app.id === 'pizzeria-selection' ? 'Pizza' : app.name;
const displayDescription = isGppEvent && app.id === 'pizzeria-selection'
  ? 'Find and select nearby pizzerias'
  : app.description;
```
Render `displayName`/`displayDescription` instead of `app.name`/`app.description`. (AppsHub strings are hard-coded English today — matches existing convention; no i18n key needed.)

### 12. i18n locales — add `tabs.pizza`

For each of `frontend/src/i18n/locales/{de,en,es,fr,ja,pt,zh}/host.json`, add a sibling key to `tabs.pizzaAndDrinks`:

| Locale | Value |
|---|---|
| de | `"pizza": "Pizza"` |
| en | `"pizza": "Pizza"` |
| es | `"pizza": "Pizza"` |
| fr | `"pizza": "Pizza"` |
| ja | `"pizza": "ピザ"` |
| pt | `"pizza": "Pizza"` |
| zh | `"pizza": "披萨"` |

## Resolved questions (Snax)

- Relabel "Pizza & Drinks" → "Pizza" tab on GPP: **yes**
- Relabel AppsHub tile copy on GPP: **yes**
- Verification invite codes: Snax will pick GPP/non-GPP events directly when reviewing the preview.
