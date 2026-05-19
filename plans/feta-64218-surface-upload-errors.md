# feta-64218: Surface Supabase storage upload errors to the host

**Priority**: P2
**Created**: 2026-05-18

## Problem

When a host clicks "Use as Event Image" in the flyer generator (or uploads an event image via Event Details, or adds a sponsor logo via PartnerForm), and the upload fails for any reason (file size > bucket limit, unsupported MIME type, RLS, network), the UI shows a generic "Upload failed" state with no detail. The actual Supabase error message is only `console.error`'d — invisible to support and to the host themselves.

This blocked the Craiova GPP host on 2026-05-18; we had to manually inspect bucket settings to guess the cause. The `event-images` bucket size limit was 5MB; it was raised to 10MB during the incident, but the cause was never confirmed because there is no diagnostic path.

## Root cause

`uploadEventImage` and `uploadSponsorLogo` in `frontend/src/lib/supabase.ts` both swallow Supabase errors and return `null`:

```ts
if (error) {
  console.error('Error uploading image:', error);
  return null;
}
```

Every caller treats `null` as a generic failure and shows a hard-coded "Upload failed" or i18n equivalent. The structured error message (file too large, mime type ..., RLS, etc.) is lost.

## Approach

Change the two upload helpers to **throw** with the original Supabase error message (instead of returning `null`), then update each call site to **catch and surface** the message in the existing error UI.

## Files to change

### 1. `frontend/src/lib/supabase.ts`

- `uploadEventImage` (~line 85): change return type from `Promise<string | null>` to `Promise<string>`. In the `if (error)` branch, throw `new Error(error.message)` (preserve the console.error for ops). The outer `catch` block should re-throw rather than return `null`.
- `uploadSponsorLogo` (~line 122): same treatment.

### 2. `frontend/src/components/flyer/FlyerGenerator.tsx`

- Add a new state slot: `const [setImageError, setSetImageError] = useState<string | null>(null);`
- In `handleUseAsEventImage` (~line 632), in the `catch (err)` block, set `setSetImageError(err instanceof Error ? err.message : 'Upload failed')` alongside the existing `setSetImageState('error')`.
- Clear `setImageError` in the existing 2.5s timeout reset.
- Below the "Use as Event Image" button (~line 1612 where `flyer.uploadFailed` is rendered), conditionally render the captured `setImageError` underneath as a small `text-xs text-red-400` line. Keep the existing pill text for the button itself.

### 3. `frontend/src/hooks/useImageUpload.ts`

- In the `catch (err)` block (~line 98), replace the static `setError('Failed to upload image. Please try again.')` with `setError(err instanceof Error ? err.message : 'Failed to upload image. Please try again.')`.

### 4. `frontend/src/components/EventDetailsTab.tsx`

- `saveImage` (~line 545) calls `uploadEventImage` and checks for falsy. Wrap in `try/catch` — on catch, surface the error message via the existing failure path (toast / error state, whichever pattern is used in this file). Look at the surrounding code in `EventDetailsTab.tsx` and reuse its existing error-surfacing mechanism.
- The main save flow (~line 308–315) does the same `uploadEventImage` + null check. Same try/catch treatment.

### 5. `frontend/src/components/sponsors/PartnerForm.tsx`

- Two `uploadSponsorLogo` call sites (~lines 359 and 374) currently check for null and `setError('Failed to upload logo. Please try again.')` / `'Failed to upload avatar. Please try again.'`. Replace the null-check pattern with `try/catch`, setting `setError(err.message)` on catch.

## Out of scope

- Client-side pre-validation (size/MIME). Could be a follow-up; goal here is diagnosability, not avoidance.
- Other upload helpers (e.g., `uploadProfilePicture`). Same pattern would apply but not part of this incident's blast radius.
- Localization of error messages. Supabase error messages are English; that's acceptable for now since the audience is the host trying to debug their own upload.

## Verification

Run dev server (`cd frontend && npm run dev`) and on an event you can edit:

1. **Normal flow still works**: Open `/<slug>/host` → Flyer tab → click "Use as Event Image". Should succeed and save (no regression).
2. **Forced failure shows real reason**: In DevTools → Application → Storage, delete the auth cookie/local-storage entries. Click "Use as Event Image". Should show a real RLS / unauthorized message, NOT a generic "Upload failed".
3. **MIME failure**: Open Event Details modal → upload an HEIC file (or rename a `.txt` to `.heic`). Should display the Supabase MIME-rejection message.
4. **Sponsor logo path**: Open Flyer tab → Add Sponsor → upload a >10MB image. Should show a size-limit message specifying the limit.
5. **No console regressions**: Existing `console.error` calls still fire so ops logs are unchanged.

## Notes for implementer

- The bucket file_size_limit was raised from 5MB → 10MB on 2026-05-18 (DB change, no code).
- The `uploadEventImage` return-type change from `string | null` to `string` is a deliberate API tightening. Update any TypeScript inference that relied on the nullable type. If a caller was checking `if (!uploadedUrl)`, replace with try/catch.
