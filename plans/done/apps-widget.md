# Plan: Apps Widget

## Summary

A centralized control panel on the HostPage Settings tab where hosts can activate/deactivate features for their event. Consolidates the existing scattered toggles (donations, photos, NFTs) and adds new ones (beverages, AI ordering, check-in) into a single "Apps" section.

---

## 1. App Inventory

| App | Current State | Default | DB Column |
|-----|--------------|---------|-----------|
| **Photos** | `photosEnabled` toggle exists | `true` | `photos_enabled` |
| **Donations** | `donationEnabled` toggle exists | `false` | `donation_enabled` |
| **NFT Minting** | `nftEnabled` toggle exists | `false` | `nft_enabled` |
| **Beverages** | Always on (no toggle) | `true` | `beverages_enabled` (new) |
| **AI Phone Ordering** | Always on (no toggle) | `true` | `ai_ordering_enabled` (new) |
| **Check-in** | Always on (no toggle) | `true` | `checkin_enabled` (new) |

**Not included (core, always on):** Pizza ordering/recommendations, guest preferences/toppings, pizzeria selection.

---

## 2. UI Design

Lives in the Settings/Details tab of HostPage, inside `EventDetailsTab`. Replaces the standalone DonationSettings and NFT toggle.

```
+--------------------------------------------------+
| Apps                                              |
| Manage which features are active for your event   |
+--------------------------------------------------+
| [Camera]      Photos                    [toggle]  |
| [Beer]        Beverages                 [toggle]  |
| [DollarSign]  Donations                 [toggle]  |
|   └─ (inline DonationSettings when enabled)       |
| [Bot]         AI Phone Ordering         [toggle]  |
| [ScanLine]    Check-in                  [toggle]  |
| [Coins]       NFT Minting              [toggle]  |
|   └─ (inline chain selector when enabled)         |
+--------------------------------------------------+
```

Each row: icon + name + description + `<Checkbox />` toggle. Auto-saves on change via `updateParty()`. Sub-settings expand inline when parent is enabled.

---

## 3. Database Changes

### New columns on `parties` table (Prisma)

```prisma
beveragesEnabled  Boolean @default(true)  @map("beverages_enabled")
aiOrderingEnabled Boolean @default(true)  @map("ai_ordering_enabled")
checkinEnabled    Boolean @default(true)  @map("checkin_enabled")
```

**Must be deployed to production before frontend preview branches work.**

---

## 4. File-by-File Changes

### Phase 1: Database & Backend

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add 3 new boolean fields to `Party` model |
| `backend/src/routes/party.routes.ts` | Accept new fields in PATCH handler |
| `backend/src/routes/event.routes.ts` | Return new fields in `select` and response objects |

### Phase 2: Frontend Types & API

| File | Change |
|------|--------|
| `frontend/src/types.ts` | Add `beveragesEnabled`, `aiOrderingEnabled`, `checkinEnabled` to `Party` interface |
| `frontend/src/lib/supabase.ts` | Add to `DbParty`, `SAFE_PARTY_COLUMNS`, `updateParty` function |
| `frontend/src/lib/api.ts` | Add to `UpdatePartyData`, `updatePartyApi`, `PublicEvent` |
| `frontend/src/contexts/PizzaContext.tsx` | Add to `dbPartyToParty` mapping (default `true`) |

### Phase 3: Apps Widget Component

| File | Type | Change |
|------|------|--------|
| `frontend/src/components/AppsSettings.tsx` | **New** | Apps widget component with toggles for all 6 apps, inline sub-settings |
| `frontend/src/components/EventDetailsTab.tsx` | Modify | Replace standalone `<DonationSettings />` and NFT toggle with `<AppsSettings />` |

### Phase 4: Conditional Rendering

| File | Change |
|------|--------|
| `frontend/src/pages/HostPage.tsx` | Gate `<BeverageSettings />` with `party.beveragesEnabled !== false`, gate `<AiCallHistory />` with `party.aiOrderingEnabled !== false` |
| `frontend/src/components/RSVPModal.tsx` | Gate beverage preferences section with `event.beveragesEnabled !== false` |
| `frontend/src/pages/CheckInPage.tsx` | Show disabled message when `checkinEnabled` is false |

---

## 5. Implementation Order

1. **Database migration** — add columns, deploy to production
2. **Backend routes** — accept and return new fields
3. **Frontend types/API** — wire up new fields end-to-end
4. **AppsSettings component** — build the widget
5. **EventDetailsTab integration** — swap in the new widget
6. **Conditional rendering** — gate features on HostPage, RSVPModal, CheckInPage

---

## 6. Design Decisions

- **`!== false` pattern** — treats `undefined`/`null` (pre-migration parties) as enabled
- **Data preservation** — disabling an app hides it but does NOT delete data; re-enabling restores everything
- **All tabs stay visible** — disabled apps show inline "disabled" state rather than hiding tabs, so hosts can re-enable easily
- **Defaults** — new columns default to `true` so existing parties are unaffected. Only donations and NFTs default to `false` (matching current behavior)
