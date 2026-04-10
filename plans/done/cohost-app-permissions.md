# Granular Co-Host Tab Permissions

## Problem
Co-hosts have a single `canEdit: true/false` boolean. No way to limit a co-host to specific tabs (e.g., "only Photos and Music").

## Design
- **Allowlist model**: `allowedTabs: string[]` on the co-host JSON object
- **Backward compatible**: `canEdit: true` + no `allowedTabs` = full access (existing behavior)
- **No DB migration needed**: `co_hosts` is already JSONB, just add the field to the JSON objects

### Permission rules
| `canEdit` | `allowedTabs` | Result |
|-----------|--------------|--------|
| `false` | any | No access |
| `true` | undefined/empty | All tabs (legacy) |
| `true` | `['photos','music']` | Only those tabs |

---

## Implementation

### 1. Shared tab permissions constant
**New file**: `frontend/src/lib/tabPermissions.ts`
- `ALL_HOST_TABS` array with id, label, icon for each tab
- `getCoHostAllowedTabs(coHost)` helper: returns `'all'` or `string[]`

### 2. Update types
**`frontend/src/types.ts`** — Add `allowedTabs?: string[]` to `CoHost` and `Party` interfaces

### 3. HostsManager UI
**`frontend/src/components/HostsManager.tsx`**
- When "Editor" checkbox is on, show "Customize permissions" expander
- Checkbox grid of all tabs using `Checkbox` component
- Summary text: "All tabs" or "3 of 16 tabs"

### 4. HostPage tab filtering
**`frontend/src/pages/HostPage.tsx`**
- New `allowedTabs` useMemo that resolves the current user's tab permissions
- Filter visible tabs: `tabs.filter(t => allowedTabs === 'all' || allowedTabs.includes(t.id))`
- Block direct URL navigation to forbidden tabs (redirect to first allowed tab)

### 5. Backend: return `allowedTabs` in API response
**`backend/src/routes/party.routes.ts`** — GET handler
- Find the requesting user's co-host entry
- Return `allowedTabs` alongside `canEdit` in the response

### 6. Frontend data pipeline
- `frontend/src/lib/supabase.ts` — Add `allowed_tabs?: string[]` to `DbParty`, capture from backend response
- `frontend/src/contexts/PizzaContext.tsx` — Map `allowed_tabs` in `dbPartyToParty`

### 7. Backend: shared permission helper with tab-level checks
**New file**: `backend/src/helpers/partyAccess.ts`
```typescript
async function canUserEditParty(partyId, userId, userEmail, requiredTab?): Promise<boolean>
```
- Extracts the duplicated `canUserEditParty` from 15 route files into one shared helper
- Adds optional `requiredTab` param for tab-level enforcement
- Each route passes its tab: sponsors→`'sponsors'`, photos→`'photos'`, etc.

### Route-to-tab mapping
| Route file | `requiredTab` |
|---|---|
| `sponsor.routes.ts` | `'sponsors'` |
| `budget.routes.ts` | `'budget'` |
| `staff.routes.ts` | `'staff'` |
| `performer.routes.ts` | `'music'` |
| `photo.routes.ts` | `'photos'` |
| `raffle.routes.ts` | `'raffle'` |
| `display.routes.ts` | `'displays'` |
| `checklist.routes.ts` | `'checklist'` |
| `kit.routes.ts` | `'gpp'` |
| `venue*.routes.ts` | `'venue'` |
| `report.routes.ts` | `'report'` |
| `party.routes.ts` (PATCH) | none (multi-tab) |
| `party.routes.ts` (guests) | `'guests'` |

---

## Files changed

**New files:**
- `frontend/src/lib/tabPermissions.ts`
- `backend/src/helpers/partyAccess.ts`

**Modified:**
- `frontend/src/types.ts` — CoHost + Party interfaces
- `frontend/src/lib/supabase.ts` — DbParty interface
- `frontend/src/contexts/PizzaContext.tsx` — mapper
- `frontend/src/components/HostsManager.tsx` — permissions picker UI
- `frontend/src/pages/HostPage.tsx` — tab filtering
- `backend/src/routes/party.routes.ts` — return allowedTabs, use shared helper
- 14 other backend route files — import shared canUserEditParty

## No 6-place update needed
`co_hosts` is JSONB — no column changes. The `allowedTabs` field is added to the JSON objects within the existing column. No migration, no Prisma change, no `updateParty` field list change, no `dbPartyToParty` co-hosts change, no `safeColumns` change.

The only data pipeline additions are for the *current user's* `allowedTabs` returned by the backend API (separate from the co-host definition).

## Verification
1. Existing co-host with `canEdit: true`, no `allowedTabs` → sees all tabs (backward compat)
2. Co-host restricted to Photos + Music → only sees those tabs
3. Direct URL to `/host/{code}/budget` when not allowed → redirects to first allowed tab
4. API call to `/api/parties/{id}/budget` when not allowed → 403
5. Owner always sees all tabs
