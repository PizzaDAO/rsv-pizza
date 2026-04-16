# Bulk CSV Invites

## Feature
Hosts can upload a `.csv` of email addresses to bulk-invite people to their party. CSV rows are parsed into guests (created in DB as pending/invited) and each gets an invite email.

## User Flow
1. Host opens the **Promo app** (`PromoWidget`) on the host page
2. Expands the new **"Invite Guests"** section
3. Drops a `.csv` file (or clicks to select)
4. **Preview table** inline in the section shows parsed rows (name, email) with checkboxes — host can uncheck bad rows
5. Invalid rows (malformed email, missing email) are visually flagged and auto-unchecked
6. Duplicates (already existing in guest list) flagged and auto-unchecked
7. Optional custom message textarea
8. Host clicks "Send X invites"
9. Progress indicator shows as invites send
10. Results summary: "Sent X, failed Y, skipped Z (duplicates)"

## CSV Parsing Rules
- **Flexible headers**: case-insensitive match for `name`/`full name`/`full_name` and `email`/`email address`/`e-mail`
- **If no header row detected** (first row looks like data): assume first column = name, second = email
- **Required**: email must be valid format (basic regex)
- **Optional**: name — if missing, use the local part of email (before `@`) as fallback
- **Dedup**: skip rows where email already exists in this party's guests (case-insensitive)
- **Dedup within CSV**: skip duplicate emails within the file

## Backend Changes

### New endpoint: `POST /api/v1/parties/:partyId/guests/bulk-invite`
- **Auth**: requires party ownership
- **Body**: `{ guests: Array<{ name: string; email: string }>, customMessage?: string }`
- **Logic**:
  1. For each guest in the input array:
     - Check if a guest with this email already exists on the party → skip (return as "skipped")
     - Create a new `Guest` row: `name`, `email`, `status: 'PENDING'`, `submittedVia: 'invite'`, `approved: null`
     - Send invite email via Resend using existing template from `/send-invite` endpoint (extract into shared helper)
     - Track success/failure per row
  2. Return `{ sent: number, failed: Array<{email, reason}>, skipped: Array<{email, reason}>, createdGuestIds: string[] }`
- **Rate limiting**: Send in batches of 10 with a 500ms delay between batches to stay under Resend limits
- **Backend location**: `backend/src/routes/v1/guests.ts` — add new route

### Refactor
- Extract the invite email HTML builder from `/send-invite` (lines 462-548) into a shared helper function `buildInviteEmail(party, guestName, guestEmail, customMessage?)` so both single and bulk endpoints use the same template.

## Frontend Changes

### New component: `frontend/src/components/promo/BulkInvite.tsx`
Inline component (not a modal — lives inside the PromoWidget's expanded section). Single scrollable view with 4 states, controlled by component-local state:

**State 1 — Upload (initial)**:
- Drag-and-drop zone + file picker for `.csv`
- Helper text: "CSV should have `name` and `email` columns. Max 500 rows."

**State 2 — Preview (after parse)**:
- Summary: "Found X rows, Y will be invited" with counts of valid/invalid/duplicate
- Scrollable table of rows: checkbox, name, email, status indicator (✓ valid, ⚠ invalid email, ↻ duplicate)
- Invalid/duplicate rows auto-unchecked and visually dimmed
- Optional `IconInput` (multiline) for custom message
- "Clear / pick different file" link and "Send X invites" button (disabled when 0 checked)

**State 3 — Sending**:
- Spinner with "Sending X/Y..."

**State 4 — Results**:
- "Sent X invites, Y skipped (duplicates), Z failed"
- Collapsible details of skipped/failed rows
- "Invite more" button — returns to State 1
- Triggers parent guest list refresh (via `loadParty` from `usePizza()`)

### Integration into `PromoWidget.tsx`
Add a new section to the `SECTIONS` array:
```typescript
{
  id: 'invite',
  label: 'Invite Guests',
  description: 'Upload a CSV to send bulk invites',
  icon: UserPlus, // from lucide-react
},
```

Add `PromoSection` type: `'social' | 'publish' | 'email' | 'invite'`

Render `<BulkInvite party={party} />` when `section.id === 'invite'`.

### CSV parsing
- Use native `FileReader` + string splitting (no library needed for simple CSV)
- Handle: comma separator, optional quoted fields, CRLF or LF line endings, trim whitespace
- Keep it in a utility function: `frontend/src/lib/csvParser.ts`

## Files to Create
- `frontend/src/components/promo/BulkInvite.tsx`
- `frontend/src/lib/csvParser.ts`

## Files to Modify
- `backend/src/routes/v1/guests.ts` — new bulk-invite route + refactor email builder into helper
- `frontend/src/components/promo/PromoWidget.tsx` — add "Invite Guests" section
- `frontend/src/components/promo/index.ts` — export `BulkInvite`
- `frontend/src/lib/api.ts` (or wherever guest API calls live) — add `bulkInviteGuests(partyId, rows, customMessage?)` function

## DB Changes
**None**. The existing `Guest` table supports this — `status: 'PENDING'`, `submittedVia: 'invite'`.

## Edge Cases to Handle
- Empty CSV
- CSV with only headers, no data rows
- CSV with unrecognized columns (show error, don't crash)
- Emails with whitespace / mixed case → normalize to lowercase-trimmed
- Extremely large CSV (>1000 rows) → show warning, enforce max 500/upload
- Network failure mid-send → allow retry of just the failed ones

## Verification
1. Create a test CSV with 5 valid rows, 1 invalid email, 1 duplicate
2. Upload → preview shows all 7, last 2 flagged
3. Send → 5 invites sent, 2 skipped
4. Check guests tab → 5 new pending guests appear
5. Check email inbox → invite received with correct party details and RSVP link
6. Re-upload same CSV → all 5 should show as "duplicate" in preview
7. Test with CSV that has no header row
8. Test with CSV that uses "Full Name" / "E-mail" column headers
