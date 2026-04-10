# Hotfix: Restore co-host edit permissions

## Context
The Feb 2026 security audit stripped `email` from the `co_hosts_public` generated column to prevent PII leaks. But the frontend's `canEdit` check in `HostPage.tsx:54-58` matches the logged-in user's email against `party.coHosts[].email` — which is now always `undefined` from the public column. **Result: no co-host can edit any event.** Only party owners and super admins can edit.

## Fix
Have the backend return a `canEdit` flag on the party response so the frontend doesn't need co-host emails.

### Files to modify

**1. `backend/src/routes/party.routes.ts`** — GET `/api/parties/:inviteCode` (line ~356-396)
- After fetching the party data, check if the requesting user is a co-host with edit permissions (reuse existing `canUserEdit()` helper at line 8)
- Add `canEdit: true/false` to the JSON response

**2. `frontend/src/pages/HostPage.tsx`** — `canEdit` useMemo (line 50-61)
- Instead of iterating `party.coHosts` to match emails, check `party.canEdit` from the backend response
- Keep the super admin and owner checks as fallbacks
- New logic:
  ```js
  const canEdit = useMemo(() => {
    if (!party || !user) return false;
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
    if (party.userId === user.id) return true;
    if (party.canEdit) return true; // Backend already verified co-host permissions
    return false;
  }, [party, user]);
  ```

**3. `frontend/src/contexts/PizzaContext.tsx`** — `dbPartyToParty` mapper (line ~103 area)
- Pass through the `canEdit` field from the backend response

**4. `frontend/src/types.ts`** — Party type
- Add `canEdit?: boolean` to the Party interface

### What stays the same
- `co_hosts_public` keeps emails stripped (security preserved)
- Backend auth checks unchanged (they already work correctly)
- `HostsManager.tsx` still gets full co_hosts with emails from the backend's enriched response (for displaying in the host editor)

### Verification
1. Log in as a co-host with `canEdit: true` → should be able to access host dashboard
2. Log in as a co-host without `canEdit` → should be redirected to RSVP page
3. Check that `co_hosts_public` still has no emails (security preserved)
