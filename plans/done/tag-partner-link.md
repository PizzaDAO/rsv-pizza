# Tag-Partner Auto Co-Host Feature

## Overview

When an admin tags an event (e.g., "Stand With Crypto"), automatically add the linked partner as a co-host and create a sponsor record on that event. When the tag is removed, clean up.

## Current State

- **Event tags** (`eventTags`): `String[]` on Party, managed via underboss dashboard bulk actions
- **SponsorUser** (partner dashboard access): Has a `tag` field that links to events via `eventTags` matching — but currently only for dashboard *viewing*, no auto co-hosting
- **Co-hosts**: JSON array on Party. `isUnderboss: true` entries are protected from client edits
- **Gap**: No link between a tag and a partner identity for auto-co-hosting

## Database Changes

Extend `SponsorUser` with co-host profile fields:

```sql
ALTER TABLE sponsor_users ADD COLUMN co_host_name VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN co_host_website VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN co_host_twitter VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN co_host_instagram VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN co_host_avatar_url VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN co_host_logo_url VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN auto_co_host BOOLEAN DEFAULT false;
ALTER TABLE sponsor_users ADD COLUMN auto_sponsor BOOLEAN DEFAULT false;
```

No new join table — relationship is `SponsorUser.tag` → `Party.eventTags`.

## Co-Host Entry Format

```json
{
  "id": "generated-id",
  "name": "Stand With Crypto",
  "website": "https://standwithcrypto.org",
  "avatar_url": "https://...",
  "showOnEvent": true,
  "canEdit": false,
  "isPartner": true,
  "partnerTag": "swc"
}
```

`isPartner: true` is a protected flag (like `isUnderboss`) — clients cannot remove these entries.

## Backend Changes

### 1. New helper: `backend/src/helpers/partnerSync.ts`

```typescript
addPartnerToParty(party, sponsorUser)    // Add co-host + sponsor record
removePartnerFromParty(partyId, tag)     // Remove co-host, flag sponsor
syncPartnerToAllEvents(sponsorUser)      // Retroactive sync
removePartnerFromAllEvents(tag)          // Cleanup on deactivation
```

### 2. Hook into tag mutations

- **`PATCH /api/underboss/events/bulk-event-tags`**: After updating tags, trigger partner sync
  - `action: 'add'` → find SponsorUsers with matching tag + `autoCoHost`, call `addPartnerToParty`
  - `action: 'remove'` → call `removePartnerFromParty`
  - `action: 'set'` → diff old vs new tags, add/remove accordingly

### 3. Hook into SponsorUser lifecycle

- **Create** with `autoCoHost: true` → sync to all existing events with that tag
- **Update** tag or toggle `autoCoHost` → reconcile (remove old, add new)
- **Deactivate** → remove from all events

### 4. Protect partner co-hosts in party PATCH

```typescript
const protectedEntries = existingCoHosts.filter(
  (h: any) => h.isUnderboss === true || h.isPartner === true
);
```

### 5. Extend SponsorUser CRUD routes

Accept new fields in POST/PATCH: `coHostName`, `coHostWebsite`, `coHostTwitter`, `coHostInstagram`, `coHostAvatarUrl`, `coHostLogoUrl`, `autoCoHost`, `autoSponsor`

## Frontend Changes

### 1. Types (`types.ts`)
- Add `isPartner?: boolean`, `partnerTag?: string` to CoHost
- Add new profile fields to SponsorUser type

### 2. HostsManager.tsx
- Filter out `isPartner: true` from editable list (same pattern as `isUnderboss`)
- Merge partner entries back when saving

### 3. Underboss Dashboard — Partner Management UI
- Add a "Partners" section/tab to the underboss dashboard (admin-only)
- List existing SponsorUsers with their tag, `autoCoHost`/`autoSponsor` status
- Create/edit partner: name, tag, co-host profile (avatar, website, socials), toggles
- Show count of events currently linked via each tag
- "Sync now" button to retroactively apply partner to existing tagged events

### 4. EventRow.tsx
- Show partner icon next to tags that have linked partners (visual indicator in the event list)

## Edge Cases

| Case | Handling |
|------|----------|
| Partner already exists as manual co-host | Add partner entry separately, don't overwrite |
| Partner already exists as manual sponsor | Skip auto-creation, preserve manual record |
| Tag removed from event | Remove `isPartner` co-host; keep sponsor but add note |
| SponsorUser tag changed | Remove from old tag events, add to new tag events |
| Multiple SponsorUsers with same tag | Each becomes a separate co-host entry |
| Event created with default tags (GPP) | Check for linked partners after creation |
| Race conditions | Sync is idempotent (skip if already present) |

## Implementation Order

1. DB migration (add columns to `sponsor_users`)
2. Prisma schema update
3. Backend helper (`partnerSync.ts`)
4. Backend SponsorUser routes (extend CRUD)
5. Backend underboss routes (hook into `bulk-event-tags`)
6. Backend party routes (protect `isPartner` co-hosts)
7. Backend GPP routes (hook into event creation)
8. Frontend types
9. Frontend HostsManager (filter `isPartner`)
10. Frontend admin UI (partner profile fields)
11. Testing
12. Deploy backend before preview branches (shared DB)

## Key Files

- `backend/src/routes/underboss.routes.ts` — hook into `bulk-event-tags` (line 580-638)
- `backend/src/routes/sponsor-user.routes.ts` — extend CRUD with profile fields
- `backend/src/routes/party.routes.ts` — protect `isPartner` entries
- `backend/src/helpers/partnerSync.ts` — new sync helper
- `frontend/src/components/HostsManager.tsx` — filter `isPartner` from editable list
- `backend/prisma/schema.prisma` — add fields to SponsorUser
