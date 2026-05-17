# zucchini-24569 — Host X avatar refetch lockout after partial-handle blur

**Priority:** P2 (focused bug fix)

## Problem

In the Hosts editor (both Add and Edit modals), the Twitter handle input has an `onBlur` that auto-fetches the user's X avatar via fxtwitter and mirrors it to Supabase storage. This works on the very first blur — but if the user blurs with an incomplete handle (e.g. "sn"), the lookup resolves *some* real short-handle user, writes their avatar URL into the avatar slot, and from that point forward the blur guard refuses to refetch. The user then finishes typing the full handle (e.g. "snaxhandle"), blurs, and nothing happens. The wrong avatar is stuck until they manually clear the avatar field and re-blur.

The same lockout pattern exists in `AccountPage.tsx` for the logged-in user's own profile picture (blurs on the X handle field), though it's slightly less likely to bite because users typically only set their own handle once.

`HostPage.tsx` line 274 (`fetchXAvatarToSupabase` in `SponsorCRM.onAddAsCoHost`) is a one-shot fire-and-forget on add — no blur lockout — and is out of scope.

## Root cause

The guard in all three blur handlers is:

```ts
if (avatarSlot.trim() && !isAutoFilledXAvatar(avatarSlot)) return;
```

`isAutoFilledXAvatar` (in `frontend/src/utils/avatarUtils.ts`) only matches legacy `https://unavatar.io/x/...` URLs. The current code path no longer writes unavatar URLs — it writes Supabase storage URLs via `proxyAvatarToStorage`. So after the first successful auto-fill, the avatar slot contains a Supabase URL, the guard classifies it as "user-set," and refuses to overwrite on subsequent blurs.

URL-sniffing can't distinguish "we auto-filled this Supabase URL" from "the user uploaded this Supabase URL" — both look identical. The fix has to track provenance in state instead.

## Approach

**Track avatar provenance in component state.** Add a new state field per modal that remembers the handle that produced the current avatar. Treat it as a small ownership flag:

- `null` → we don't own the avatar slot (either user-set or unknown — respect existing data)
- a string handle → we own the slot and it reflects that handle

Blur decision matrix:

| `avatarFromX` | new handle | avatar slot   | Action               |
|---------------|------------|---------------|----------------------|
| `null`        | empty      | —             | no-op                |
| `null`        | non-empty  | empty or legacy unavatar | first-time fetch |
| `null`        | non-empty  | user-set      | no-op (respect user) |
| `"foo"`       | `"foo"`    | —             | no-op (already current) |
| `"foo"`       | `"bar"`    | —             | refetch unconditionally |
| `"foo"`       | empty      | —             | no-op (don't blank an existing avatar; user can clear manually) |

State lifecycle:

- On opening the Edit modal → initialize `avatarFromX` to `null` (provenance of any saved avatar is unknown).
- On the Add modal mount/reset → `null`.
- After a successful auto-fill → set `avatarFromX` to the handle that produced it.
- On manual file upload (`handleNew/EditAvatarFileChange`) → set to `null` (user is taking ownership).
- On the "Clear" button click → set to `null` (slot is empty; future blur falls to the first-time-fetch branch).

This avoids URL sniffing entirely and correctly distinguishes "we own this slot" from "user owns this slot." `isAutoFilledXAvatar` stays in place for the first-fetch path so we can still replace legacy unavatar URLs from old data.

## Secondary improvements (in scope per task)

1. **Minimum-handle-length gate.** In `cleanXHandle` (`avatarUtils.ts`), `HANDLE_RE` already enforces `{1,15}` — too permissive. Add a separate min-length check in the blur handler before calling `fetchXAvatarToSupabase`: skip the fetch if `handle.length < 4`. Don't change `cleanXHandle` itself (still useful as a normalizer in other call sites). This is a guard at the call site only.
2. **Loading state on the Twitter input.** Add a `xAvatarFetching` boolean per modal. While `true`, the Twitter input is `disabled` and a small `Loader2` spinner renders next to it. Clear on success/failure.
3. **Console-warn on failure.** In `fetchXAvatarToSupabase` (`avatarUtils.ts`), replace the silent `return null` branches with `console.warn` so this class of bug isn't invisible in the future. Cases: (a) handle didn't pass `cleanXHandle`, (b) fxtwitter HTTP failure, (c) fxtwitter `code !== 200` / missing `avatar_url`, (d) `catch` block. `proxyAvatarToStorage` already has `console.error` in both fail paths — verify on read and leave alone.

## Out of scope

- Don't refactor Add and Edit modals into a shared component.
- Don't migrate or remove `isAutoFilledXAvatar` — old data may still hold legacy unavatar URLs.
- Don't touch `FlyerGenerator.tsx` line ~353 or `HostPage.tsx` line ~274 (`SponsorCRM.onAddAsCoHost`) — both are one-shot, no blur lockout.

## Files to change

### 1. `frontend/src/components/HostsManager.tsx`

State additions (near existing avatar state):

```ts
const [editHostAvatarFromX, setEditHostAvatarFromX] = useState<string | null>(null);
const [newCoHostAvatarFromX, setNewCoHostAvatarFromX] = useState<string | null>(null);
const [editXAvatarFetching, setEditXAvatarFetching] = useState(false);
const [newXAvatarFetching, setNewXAvatarFetching] = useState(false);
```

Edit modal blur handler (replacing lines ~587–596) — `onBlur` for the Twitter input becomes:

```ts
onBlur={async () => {
  const handle = stripToHandle(editHostTwitter);
  setEditHostTwitter(handle);
  if (!handle) return;
  if (handle.length < 4) return;                       // (1) min-length gate
  if (editHostAvatarFile) return;                       // local file wins
  // Already up-to-date for this handle?
  if (editHostAvatarFromX === handle) return;
  if (editHostAvatarFromX == null) {
    // Provenance unknown — only fill if slot is empty or legacy unavatar
    if (editHostAvatarUrl.trim() && !isAutoFilledXAvatar(editHostAvatarUrl)) return;
  }
  // Either we own this slot (avatarFromX != null, handle changed) or slot is empty/legacy → fetch
  setEditXAvatarFetching(true);
  try {
    const fetched = await fetchXAvatarToSupabase(handle);
    if (fetched) {
      setEditHostAvatarUrl(fetched);
      setEditHostAvatarFromX(handle);
    }
  } finally {
    setEditXAvatarFetching(false);
  }
}}
disabled={editXAvatarFetching}
```

Add modal blur handler (lines ~710–718) — mirror the same logic with `newCoHostAvatarFromX` / `newCoHostAvatarUrl` / `newCoHostAvatarFile` / `setNewXAvatarFetching`.

Spinner placement: render a `Loader2` (already imported via `lucide-react` siblings — add the import) absolutely positioned inside the Twitter input container, or inline next to it. Keep it visually minimal.

Provenance resets:

- In `handleEditAvatarFileChange` (line ~92): after `setEditHostAvatarFile(file); setEditHostAvatarUrl('');` add `setEditHostAvatarFromX(null);`.
- In `handleNewAvatarFileChange` (line ~82): after the equivalent two setters, add `setNewCoHostAvatarFromX(null);`.
- In the Edit modal "Clear" button onClick (line ~548): add `setEditHostAvatarFromX(null);`.
- In the Add modal "Clear" button onClick (line ~671): add `setNewCoHostAvatarFromX(null);`.
- In `startEditingHost` (line ~207): add `setEditHostAvatarFromX(null);` — we never know the provenance of a saved avatar.
- In `cancelEditingHost` (line ~218): add `setEditHostAvatarFromX(null);` and `setEditXAvatarFetching(false);`.
- In `addCoHost` reset block (lines ~189–198): add `setNewCoHostAvatarFromX(null);` and `setNewXAvatarFetching(false);`.

### 2. `frontend/src/utils/avatarUtils.ts`

Add `console.warn` to each failure path in `fetchXAvatarToSupabase`:

```ts
export async function fetchXAvatarToSupabase(handleOrUrl: string): Promise<string | null> {
  const handle = cleanXHandle(handleOrUrl);
  if (!handle) {
    console.warn('fetchXAvatarToSupabase: invalid handle', handleOrUrl);
    return null;
  }
  try {
    const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
    if (!res.ok) {
      console.warn('fetchXAvatarToSupabase: fxtwitter HTTP', res.status, handle);
      return null;
    }
    const json = await res.json();
    if (json.code !== 200 || !json.user?.avatar_url) {
      console.warn('fetchXAvatarToSupabase: fxtwitter no avatar', { code: json.code, handle });
      return null;
    }
    const big = String(json.user.avatar_url).replace(/_normal(\.[a-zA-Z0-9]+)$/, '_400x400$1');
    return await proxyAvatarToStorage(big);
  } catch (err) {
    console.warn('fetchXAvatarToSupabase: fetch threw', handle, err);
    return null;
  }
}
```

Do **not** modify `cleanXHandle` or `isAutoFilledXAvatar`.

### 3. `frontend/src/pages/AccountPage.tsx`

Apply the same provenance pattern to the own-profile X-handle blur (line ~462). State additions next to the existing avatar state:

```ts
const [profilePictureFromX, setProfilePictureFromX] = useState<string | null>(null);
const [xAvatarFetching, setXAvatarFetching] = useState(false);
```

Replace the blur handler (lines 462–467) with:

```ts
onBlur={async () => {
  if (profilePictureFile) return;
  const handle = twitter.trim();
  if (!handle) return;
  if (handle.length < 4) return;
  if (profilePictureFromX === handle) return;
  if (profilePictureFromX == null) {
    if (profilePicture && !isAutoFilledXAvatar(profilePicture)) return;
  }
  setXAvatarFetching(true);
  try {
    const avatarUrl = await fetchXAvatarToSupabase(twitter);
    if (avatarUrl) {
      setProfilePicture(avatarUrl);
      setProfilePictureFromX(handle);
    }
  } finally {
    setXAvatarFetching(false);
  }
}}
disabled={xAvatarFetching}
```

Provenance resets:

- In `handleProfilePictureChange` (line 173): after `setProfilePictureFile(file); setProfilePicture(objectUrl);` add `setProfilePictureFromX(null);`.
- On initial load in the `useEffect` that calls `setProfilePicture(user.profilePictureUrl)` (line 123): leave `profilePictureFromX` as `null` — provenance of stored avatar is unknown.
- Note: import `isAutoFilledXAvatar` is already in place (line 11).

Add the small spinner next to the X input (use `Loader2` from `lucide-react`, already imported).

### 4. `frontend/src/lib/supabase.ts`

No code changes. `proxyAvatarToStorage` already logs `console.error` on both the storage upload failure (line 216) and the outer catch (line 226). Verify on read.

### 5. `frontend/src/pages/HostPage.tsx`

No changes. Line 274 is the `SponsorCRM.onAddAsCoHost` callback — one-shot at add time, no blur, no lockout pattern.

## Step-by-step implementation

1. **HostsManager.tsx — state** Add the four new state fields (two `*AvatarFromX`, two `*XAvatarFetching`).
2. **HostsManager.tsx — Edit blur** Replace the Edit modal Twitter `onBlur` with the new provenance-aware logic. Add `disabled={editXAvatarFetching}` and inline `Loader2` spinner.
3. **HostsManager.tsx — Add blur** Mirror the same change for the Add modal Twitter input.
4. **HostsManager.tsx — resets** Add `setEditHostAvatarFromX(null)` / `setNewCoHostAvatarFromX(null)` in: `handleEditAvatarFileChange`, `handleNewAvatarFileChange`, both "Clear" button onClicks, `startEditingHost`, `cancelEditingHost`, and the `addCoHost` reset block. Also clear the fetching booleans in `cancelEditingHost` and `addCoHost`.
5. **avatarUtils.ts** Add `console.warn` to each of the four failure branches in `fetchXAvatarToSupabase`. Leave `cleanXHandle` and `isAutoFilledXAvatar` untouched.
6. **AccountPage.tsx — state + blur + resets** Add `profilePictureFromX` and `xAvatarFetching`, replace the X-input `onBlur`, reset `profilePictureFromX` in `handleProfilePictureChange`. Add `disabled` and spinner.
7. **Lint & typecheck** Run the frontend's typecheck/lint commands; fix any TS errors (likely just unused imports or formatting).
8. **Smoke test in browser** Walk through the verification scenarios below.

## Verification

In Edit Host modal:

1. Open an Edit Host modal for a host with no avatar set. Type `sn`, Tab/blur → avatar populates with whoever "sn" resolves to. Spinner appears briefly on the input.
2. Without changing anything else, append to make the handle `snaxhandle`, Tab/blur → avatar **updates** to the new user (the fix; previously this was the failure case).
3. Upload an image file → handle field still editable, but blur on the Twitter input does **not** overwrite the uploaded preview.
4. Clear the avatar (Clear button), retype Twitter handle, blur → fetches fresh.
5. Open an existing host whose avatar is already saved → editing the Twitter field does **not** auto-overwrite (provenance unknown, respect user data). Clear the avatar first if you want to refetch.
6. Type a 2-char handle → blur → no network call (min-length gate).

In Add Host modal: repeat (1)–(4) and (6).

In Account page (`/account`):

7. With a profile picture loaded from the user's account, edit only the X handle and blur → no auto-overwrite (provenance unknown).
8. Clear the profile picture (or with a fresh account that has none), set the X handle to `sn`, blur → avatar fills. Change to `snaxhandle`, blur → avatar updates.
9. Upload a profile picture file → blurring the X input does not overwrite it.

Devtools console:

10. Set the X handle to a known-bad value (e.g. `_____________`) → console shows a `fetchXAvatarToSupabase: ...` warn explaining the failure.
11. Network panel: confirm only one fxtwitter request per blur, no duplicate calls when re-blurring with the same handle.

## Critical Files for Implementation

- frontend/src/components/HostsManager.tsx
- frontend/src/utils/avatarUtils.ts
- frontend/src/pages/AccountPage.tsx
- frontend/src/lib/supabase.ts (verify only, no edits)
