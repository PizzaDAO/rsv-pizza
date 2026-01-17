# Security Refactor Plan: Fix Vulnerabilities & Secure Database

## Executive Summary
**Current Status**: Critical Vulnerabilities Detected.
**Root Cause**: Architecture Mismatch. The application uses a custom backend for Authentication (issuing custom JWTs), but the Frontend interacts directly with the Supabase Database as an "Anonymous" user. This forces the database to have "Public" (Always True) permissions to function, allowing anyone to modify or delete data.

**The Solution**: Move all "Write" operations (Create, Update, Delete) to the secure Backend API. The Database will then deny all public write attempts, preventing unauthorized tampering.

---

## Phase 1: Lock Down "Backend-Only" Tables (Immediate)
*Goal: Prevent public access to sensitive user and auth data.*

### 1. Enable RLS on `User` and `MagicLink`
These tables are only used by the Backend (Prisma/Express). The Frontend never needs direct access.
**Action**:
- Run SQL in Supabase Dashboard:
  ```sql
  -- Enable Security
  ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "MagicLink" ENABLE ROW LEVEL SECURITY;

  -- Create "Deny All" Policies (Empty policies default to deny)
  CREATE POLICY "No public access" ON "User" FOR ALL USING (false);
  CREATE POLICY "No public access" ON "MagicLink" FOR ALL USING (false);
  ```

---

## Phase 2: Create Secure Backend Endpoints
*Goal: Create API routes that verify the user's identity before allowing changes.*

### 1. Create `Party` Management Routes
**File**: `backend/src/routes/party.routes.ts`
- `POST /` (Create Party): accepts party data, verifies user, uses Prisma to create.
- `PATCH /:id` (Update Party): checks if `req.user.id` matches the host, then updates.
- `DELETE /:id` (Delete Party): checks host ownership, then deletes.

### 2. Create `Guest` Management Routes
**File**: `backend/src/routes/guest.routes.ts`
- `POST /` (Add Guest/RSVP): allows public RSVP (or authenticated).
- `DELETE /:id` (Remove Guest): checks if user is the guest OR the host.

### 3. Implement Auth Middleware
Ensure the existing `authenticateToken` middleware is applied to these routes to secure them.

---

## Phase 3: Refactor Frontend to use API
*Goal: Stop the frontend from talking directly to the DB for changes.*

### 1. Modify `frontend/src/lib/supabase.ts`
Refactor the following functions to use `fetch(`${API_URL}/api/...`)` instead of `supabase.from(...).insert/update`:
- `createParty` -> POST /api/parties
- `updateParty` -> PATCH /api/parties/:id
- `deleteParty` -> DELETE /api/parties/:id
- `addGuestByHost` -> POST /api/guests (as host)
- `removeGuest` -> DELETE /api/guests/:id

*Note: `get` (Read) functions can remain using Supabase for now, providing "Read Performance" isn't compromised.*

---

## Phase 4: Lock Down Public "Write" Access
*Goal: The Final Seal. Prevent anyone bypassing the API.*

### 1. Update RLS on `Party` and `Guest`
**Action**: Run SQL in Supabase Dashboard:
```sql
-- PARTIES
-- Allow public READ (for RSVPs)
CREATE POLICY "Public Read" ON parties FOR SELECT USING (true);
-- Deny public WRITE (Must go through Backend API)
CREATE POLICY "No public write" ON parties FOR INSERT WITH CHECK (false);
CREATE POLICY "No public update" ON parties FOR UPDATE USING (false);
CREATE POLICY "No public delete" ON parties FOR DELETE USING (false);

-- GUESTS
-- Allow public READ (to see who is attending)
CREATE POLICY "Public Read" ON guests FOR SELECT USING (true);
-- Deny public WRITE (Must go through Backend API)
CREATE POLICY "No public write" ON guests FOR INSERT WITH CHECK (false);
CREATE POLICY "No public update" ON guests FOR UPDATE USING (false);
CREATE POLICY "No public delete" ON guests FOR DELETE USING (false);
```

---

## Phase 5: Verification
1. Attempt to create a party via the UI -> Should succeed (via API).
2. Attempt to use the browser console to run `supabase.from('parties').delete().eq('id', 'some-id')` -> **Must Fail** with RLS error.
3. Verify `User` table is not accessible via Supabase Client.
